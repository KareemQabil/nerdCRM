package com.ioeti.content.rest;

import com.axelor.auth.AuthUtils;
import com.axelor.auth.db.AuditableModel;
import com.axelor.db.JPA;
import com.axelor.db.JpaSecurity;
import com.axelor.db.Model;
import com.axelor.db.Query;
import com.axelor.inject.Beans;
import com.axelor.meta.MetaFiles;
import com.axelor.rpc.filter.Filter;
import com.axelor.rpc.filter.JPQLFilter;
import com.axelor.utils.api.ConflictChecker;
import com.axelor.utils.api.ResponseConstructor;
import com.axelor.utils.api.SecurityCheck;
import com.ioeti.businessline.db.BusinessLine;
import com.ioeti.content.db.DocumentRevision;
import com.ioeti.content.db.KnowledgeArticle;
import com.ioeti.content.db.KnowledgeCategory;
import com.ioeti.content.db.KnowledgeRevision;
import com.ioeti.content.db.repo.KnowledgeArticleRepository;
import com.ioeti.content.db.RecordDocument;
import com.ioeti.content.service.ContentService;
import com.ioeti.core.api.ApiException;
import com.ioeti.core.api.IoetiEndpoint;
import com.ioeti.core.api.RecordAccess;
import com.ioeti.core.text.ArabicNormalizer;
import com.ioeti.core.web.OptimisticLockConflicts;
import io.swagger.v3.oas.annotations.Operation;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.QueryParam;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;

/**
 * Document register with revisions, and the knowledge base (Wave 7a).
 *
 * <p>Documents have no permissions of their own: whoever may read the record a document is filed on
 * may read the document and download its revisions; whoever may change that record may file
 * documents and add revisions. Knowledge articles use native permissions on {@link
 * KnowledgeArticle}; readers see only the latest published revision.
 */
@Path("/ioeti/content")
@Produces(MediaType.APPLICATION_JSON)
public class ContentRestController {

  static final String[] KINDS = {"PROPOSAL", "CONTRACT", "EVIDENCE", "REPORT", "CORRESPONDENCE", "OTHER"};
  static final String[] LANGUAGES = {"AR", "EN", "BILINGUAL"};
  static final String[] STATUSES = {"DRAFT", "PUBLISHED", "ARCHIVED"};
  static final int MAX_BODY = 50_000;

  // --- documents -----------------------------------------------------------------------------------

  @GET
  @Path("/documents")
  @Operation(summary = "Documents filed on a record the caller may read", tags = {"IOETI content"})
  @IoetiEndpoint
  public Response documents(@QueryParam("subject") String subject, @QueryParam("subjectId") Long subjectId,
      @QueryParam("archived") Boolean archived) {
    int kind = ContentService.subject(subject);
    ContentService.readableSubject(kind, subjectId);
    List<DocumentView> rows = Query.of(RecordDocument.class)
        .filter("self.subjectSelect = ?1 AND self.subjectId = ?2 AND " + (Boolean.TRUE.equals(archived)
            ? "self.archived = true" : "(self.archived IS NULL OR self.archived = false)"), kind, subjectId)
        .order("-id").fetch(200).stream().map(ContentRestController::view).toList();
    return ResponseConstructor.build(Response.Status.OK, "Documents", rows);
  }

  @POST
  @Path("/documents")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "File a document (first revision) on a record the caller may change", tags = {"IOETI content"})
  @IoetiEndpoint
  public Response file(FileDocument command) {
    if (command == null) throw ApiException.badRequest("Document details are required.");
    int subject = ContentService.subject(command.subject());
    ContentService.writableSubject(subject, command.subjectId());
    RecordDocument document = new RecordDocument();
    document.setTitle(text("title", command.title(), 200, true));
    document.setKindSelect(select("kind", command.kind(), KINDS));
    document.setSubjectSelect(subject);
    document.setSubjectId(command.subjectId());
    document.setLanguageSelect(command.language() == null ? null : select("language", command.language(), LANGUAGES));
    ContentService.Upload upload = ContentService.check(command.fileName(), decode(command.contentBase64()));
    String summary = text("changeSummary", command.changeSummary(), 255, false);
    RecordDocument[] saved = new RecordDocument[1];
    write(() -> saved[0] = Beans.get(ContentService.class).file(document, upload, summary));
    return ResponseConstructor.build(Response.Status.CREATED, "Document filed", view(saved[0]));
  }

  @GET
  @Path("/documents/{id}")
  @Operation(summary = "A document and its revisions", tags = {"IOETI content"})
  @IoetiEndpoint
  public Response document(@PathParam("id") Long id) {
    return ResponseConstructor.build(Response.Status.OK, "Document", view(readableDocument(id)));
  }

  @POST
  @Path("/documents/{id}/revisions")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Add a revision; earlier revisions stay unchanged", tags = {"IOETI content"})
  @IoetiEndpoint
  public Response revise(@PathParam("id") Long id, Revise command) {
    RecordDocument document = writableDocument(id, command == null ? null : command.version());
    if (Boolean.TRUE.equals(document.getArchived())) throw new ApiException(422, "DOCUMENT_ARCHIVED", "The document is archived.", null);
    ContentService.Upload upload = ContentService.check(command.fileName(), decode(command.contentBase64()));
    String summary = text("changeSummary", command.changeSummary(), 255, false);
    write(() -> Beans.get(ContentService.class).revise(document, upload, summary));
    return ResponseConstructor.build(Response.Status.CREATED, "Revision added", view(JPA.find(RecordDocument.class, id)));
  }

  @GET
  @Path("/documents/{id}/revisions/{number}/content")
  @Produces(MediaType.WILDCARD)
  @Operation(summary = "Download one revision (as an attachment)", tags = {"IOETI content"})
  @IoetiEndpoint
  public Response download(@PathParam("id") Long id, @PathParam("number") Integer number) {
    RecordDocument document = readableDocument(id);
    DocumentRevision revision = number == null ? null : Query.of(DocumentRevision.class)
        .filter("self.document = ?1 AND self.number = ?2", document, number).fetchOne();
    if (revision == null) throw ApiException.notFound();
    java.nio.file.Path path = MetaFiles.getPath(revision.getFile());
    if (path == null || !Files.isRegularFile(path)) throw new ApiException(410, "FILE_MISSING", "The stored file is missing.", null);
    String ascii = revision.getFileName().replaceAll("[^A-Za-z0-9._ -]", "_");
    String encoded = URLEncoder.encode(revision.getFileName(), StandardCharsets.UTF_8).replace("+", "%20");
    return Response.ok(path.toFile(), revision.getContentType())
        .header("Content-Disposition", "attachment; filename=\"" + ascii + "\"; filename*=UTF-8''" + encoded)
        .header("X-Content-Type-Options", "nosniff")
        .header("Cache-Control", "private, no-store")
        .header("Content-Security-Policy", "default-src 'none'; sandbox")
        .build();
  }

  @POST
  @Path("/documents/{id}/archive")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Archive a document (nothing is deleted)", tags = {"IOETI content"})
  @IoetiEndpoint
  public Response archiveDocument(@PathParam("id") Long id, VersionOnly command) {
    RecordDocument document = writableDocument(id, command == null ? null : command.version());
    write(() -> Beans.get(ContentService.class).archive(document));
    return ResponseConstructor.build(Response.Status.OK, "Document archived", view(JPA.find(RecordDocument.class, id)));
  }

  private static RecordDocument readableDocument(Long id) {
    RecordDocument document = id == null || id <= 0 ? null : JPA.find(RecordDocument.class, id);
    if (document == null) throw ApiException.notFound();
    ContentService.readableSubject(document.getSubjectSelect(), document.getSubjectId());
    return document;
  }

  private static RecordDocument writableDocument(Long id, Integer version) {
    if (version == null) throw ApiException.badRequest("Record version is required.");
    RecordDocument document = readableDocument(id);
    ContentService.writableSubject(document.getSubjectSelect(), document.getSubjectId());
    ConflictChecker.checkVersion(document, version);
    return document;
  }

  private static byte[] decode(String base64) {
    if (base64 == null || base64.isBlank()) throw ApiException.invalidField("content", "REQUIRED", "The file is empty.");
    if (base64.length() > (ContentService.MAX_BYTES / 3 + 1) * 4 + 8) {
      throw ApiException.invalidField("content", "TOO_LARGE", "Files can be at most 10 MiB.");
    }
    try {
      return Base64.getDecoder().decode(base64.strip());
    } catch (IllegalArgumentException e) {
      throw ApiException.invalidField("content", "FORMAT", "The file content is not valid base64.");
    }
  }

  // --- knowledge base ------------------------------------------------------------------------------

  @GET
  @Path("/kb/categories")
  @Operation(summary = "Knowledge base categories", tags = {"IOETI content"})
  @IoetiEndpoint
  public Response categories() {
    new SecurityCheck().readAccess(KnowledgeArticle.class).check();
    List<CategoryView> rows = Query.of(KnowledgeCategory.class).order("sequence").order("code").fetch(200).stream()
        .map(c -> new CategoryView(c.getId(), c.getCode(), c.getNameEn(), c.getNameAr())).toList();
    return ResponseConstructor.build(Response.Status.OK, "Categories", rows);
  }

  @POST
  @Path("/kb/categories")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Add a knowledge base category", tags = {"IOETI content"})
  @IoetiEndpoint
  public Response addCategory(AddCategory command) {
    if (command == null) throw ApiException.badRequest("Category details are required.");
    new SecurityCheck().createAccess(KnowledgeCategory.class).check();
    String code = text("code", command.code(), 40, true).toUpperCase();
    if (!code.matches("[A-Z0-9_-]+")) throw ApiException.invalidField("code", "FORMAT", "Use letters, digits, - and _.");
    if (Query.of(KnowledgeCategory.class).filter("self.code = ?1", code).count() > 0) {
      throw ApiException.invalidField("code", "DUPLICATE", "This code is already used.");
    }
    KnowledgeCategory category = new KnowledgeCategory();
    category.setCode(code);
    category.setNameEn(text("nameEn", command.nameEn(), 255, true));
    category.setNameAr(text("nameAr", command.nameAr(), 255, true));
    category.setSequence(command.sequence());
    KnowledgeCategory[] saved = new KnowledgeCategory[1];
    write(() -> saved[0] = Beans.get(ContentService.class).save(category));
    KnowledgeCategory c = saved[0];
    return ResponseConstructor.build(Response.Status.CREATED, "Category added", new CategoryView(c.getId(), c.getCode(), c.getNameEn(), c.getNameAr()));
  }

  @GET
  @Path("/kb/articles")
  @Operation(summary = "Published articles the caller may read (Arabic-normalized search)", tags = {"IOETI content"})
  @IoetiEndpoint
  public Response articles(@QueryParam("q") String q, @QueryParam("categoryId") Long categoryId, @QueryParam("businessLine") String line) {
    new SecurityCheck().readAccess(KnowledgeArticle.class).check();
    List<String> conditions = new ArrayList<>(List.of("self.statusSelect = ?", "self.publishedRevision IS NOT NULL"));
    List<Object> params = new ArrayList<>(List.of(KnowledgeArticleRepository.STATUS_PUBLISHED));
    String search = ArabicNormalizer.normalize(text("q", q, 100, false));
    if (!search.isEmpty()) {
      for (String word : search.split(" ")) {
        conditions.add("self.publishedSearchKey LIKE ?");
        params.add("%" + word.replace("%", "").replace("_", "") + "%");
      }
    }
    if (categoryId != null) { conditions.add("self.category.id = ?"); params.add(categoryId); }
    if (line != null && !line.isBlank()) { conditions.add("self.businessLine.code = ?"); params.add(line); }
    List<ArticleSummary> rows = readable(KnowledgeArticle.class, new JPQLFilter(String.join(" AND ", conditions), params.toArray()))
        .order("-publishedRevision.publishedAt").fetch(100).stream().filter(ContentRestController::lineVisible)
        .map(a -> summary(a, a.getPublishedRevision())).toList();
    return ResponseConstructor.build(Response.Status.OK, "Articles", rows);
  }

  @GET
  @Path("/kb/drafts")
  @Operation(summary = "Articles the caller may edit, with their working copy", tags = {"IOETI content"})
  @IoetiEndpoint
  public Response drafts() {
    new SecurityCheck().writeAccess(KnowledgeArticle.class).check();
    JpaSecurity security = Beans.get(JpaSecurity.class);
    List<ArticleSummary> rows = readable(KnowledgeArticle.class, null).order("-updatedOn").order("-id").fetch(200).stream()
        .filter(a -> security.isPermitted(JpaSecurity.CAN_WRITE, KnowledgeArticle.class, a.getId()))
        .map(a -> summary(a, null)).toList();
    return ResponseConstructor.build(Response.Status.OK, "Drafts", rows);
  }

  @GET
  @Path("/kb/articles/{id}")
  @Operation(summary = "An article: the published revision, and the working copy for editors", tags = {"IOETI content"})
  @IoetiEndpoint
  public Response article(@PathParam("id") Long id) {
    KnowledgeArticle article = RecordAccess.readable(KnowledgeArticle.class, id);
    boolean editor = Beans.get(JpaSecurity.class).isPermitted(JpaSecurity.CAN_WRITE, KnowledgeArticle.class, id);
    boolean published = Integer.valueOf(KnowledgeArticleRepository.STATUS_PUBLISHED).equals(article.getStatusSelect()) && article.getPublishedRevision() != null;
    if (!editor && (!published || !lineVisible(article))) throw ApiException.notFound();
    return ResponseConstructor.build(Response.Status.OK, "Article", view(article, editor));
  }

  @POST
  @Path("/kb/articles")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Start a draft article", tags = {"IOETI content"})
  @IoetiEndpoint
  public Response createArticle(EditArticle command) {
    if (command == null) throw ApiException.badRequest("Article details are required.");
    new SecurityCheck().createAccess(KnowledgeArticle.class).check();
    KnowledgeArticle article = new KnowledgeArticle();
    article.setStatusSelect(KnowledgeArticleRepository.STATUS_DRAFT);
    article.setAuthor(AuthUtils.getUser());
    apply(article, command);
    KnowledgeArticle[] saved = new KnowledgeArticle[1];
    write(() -> saved[0] = Beans.get(ContentService.class).save(article));
    return ResponseConstructor.build(Response.Status.CREATED, "Draft started", view(saved[0], true));
  }

  @POST
  @Path("/kb/articles/{id}")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Change the working copy (readers keep seeing the published revision)", tags = {"IOETI content"})
  @IoetiEndpoint
  public Response editArticle(@PathParam("id") Long id, EditArticle command) {
    KnowledgeArticle article = writable(KnowledgeArticle.class, id, command == null ? null : command.version());
    if (Integer.valueOf(KnowledgeArticleRepository.STATUS_ARCHIVED).equals(article.getStatusSelect())) {
      throw new ApiException(422, "ARTICLE_ARCHIVED", "The article is archived.", null);
    }
    apply(article, command);
    write(() -> Beans.get(ContentService.class).save(article));
    return ResponseConstructor.build(Response.Status.OK, "Draft saved", view(JPA.find(KnowledgeArticle.class, id), true));
  }

  @POST
  @Path("/kb/articles/{id}/publish")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Publish the working copy as a new revision", tags = {"IOETI content"})
  @IoetiEndpoint
  public Response publish(@PathParam("id") Long id, VersionOnly command) {
    KnowledgeArticle article = writable(KnowledgeArticle.class, id, command == null ? null : command.version());
    if (blank(article.getTitleEn()) && blank(article.getTitleAr())) {
      throw ApiException.invalidField("titleEn", "REQUIRED", "Give the article a title in at least one language.");
    }
    if (blank(article.getBodyEn()) && blank(article.getBodyAr())) {
      throw ApiException.invalidField("bodyEn", "REQUIRED", "Write the article in at least one language.");
    }
    write(() -> Beans.get(ContentService.class).publish(article));
    return ResponseConstructor.build(Response.Status.OK, "Published", view(JPA.find(KnowledgeArticle.class, id), true));
  }

  @POST
  @Path("/kb/articles/{id}/archive")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Archive an article (hidden from readers; revisions are kept)", tags = {"IOETI content"})
  @IoetiEndpoint
  public Response archiveArticle(@PathParam("id") Long id, VersionOnly command) {
    KnowledgeArticle article = writable(KnowledgeArticle.class, id, command == null ? null : command.version());
    write(() -> Beans.get(ContentService.class).archive(article));
    return ResponseConstructor.build(Response.Status.OK, "Archived", view(JPA.find(KnowledgeArticle.class, id), true));
  }

  private static void apply(KnowledgeArticle article, EditArticle command) {
    article.setTitleEn(text("titleEn", command.titleEn(), 200, false));
    article.setTitleAr(text("titleAr", command.titleAr(), 200, false));
    if (article.getTitleEn() == null && article.getTitleAr() == null) {
      throw ApiException.invalidField("titleEn", "REQUIRED", "Give the article a title in at least one language.");
    }
    article.setBodyEn(text("bodyEn", command.bodyEn(), MAX_BODY, false));
    article.setBodyAr(text("bodyAr", command.bodyAr(), MAX_BODY, false));
    if (command.categoryId() == null) {
      article.setCategory(null);
    } else {
      KnowledgeCategory category = JPA.find(KnowledgeCategory.class, command.categoryId());
      if (category == null) throw ApiException.invalidField("categoryId", "UNAVAILABLE", "Choose a configured category.");
      article.setCategory(category);
    }
    if (command.businessLineCode() == null || command.businessLineCode().isBlank()) {
      article.setBusinessLine(null);
    } else {
      BusinessLine line = Query.of(BusinessLine.class).filter("self.code = ?1", command.businessLineCode()).fetchOne();
      if (line == null || !Beans.get(JpaSecurity.class).isPermitted(JpaSecurity.CAN_READ, BusinessLine.class, line.getId())) {
        throw ApiException.invalidField("businessLineCode", "UNAVAILABLE", "Choose a business line you can see.");
      }
      article.setBusinessLine(line);
    }
  }

  /** An article for one business line is visible to readers who may read that line. */
  private static boolean lineVisible(KnowledgeArticle article) {
    BusinessLine line = article.getBusinessLine();
    return line == null || Beans.get(JpaSecurity.class).isPermitted(JpaSecurity.CAN_READ, BusinessLine.class, line.getId());
  }

  // --- helpers -------------------------------------------------------------------------------------

  private static <T extends Model> Query<T> readable(Class<T> type, Filter condition) {
    Filter security = Beans.get(JpaSecurity.class).getFilter(JpaSecurity.CAN_READ, type);
    Filter combined = security == null ? condition : condition == null ? security : Filter.and(security, condition);
    return combined == null ? Query.of(type) : combined.build(type);
  }

  private static <T extends AuditableModel> T writable(Class<T> type, Long id, Integer version) {
    if (version == null) throw ApiException.badRequest("Record version is required.");
    T record = RecordAccess.writable(type, id);
    ConflictChecker.checkVersion(record, version);
    return record;
  }

  private static void write(Runnable command) {
    OptimisticLockConflicts.translate(command::run);
  }

  static int select(String field, String value, String... names) {
    for (int i = 0; i < names.length; i++) if (names[i].equals(value)) return i + 1;
    throw ApiException.invalidField(field, "UNAVAILABLE", "Use one of " + String.join(", ", names) + ".");
  }

  static String name(Integer select, String... names) {
    return select == null || select < 1 || select > names.length ? null : names[select - 1];
  }

  static String text(String field, String value, int max, boolean required) {
    String text = value == null ? null : value.strip();
    if (text == null || text.isEmpty()) {
      if (required) throw ApiException.invalidField(field, "REQUIRED", "This field is required.");
      return null;
    }
    if (text.length() > max) throw ApiException.invalidField(field, "TOO_LONG", "This field can have at most " + max + " characters.");
    return text;
  }

  private static boolean blank(String value) {
    return value == null || value.isBlank();
  }

  static DocumentView view(RecordDocument d) {
    List<RevisionView> revisions = Query.of(DocumentRevision.class).filter("self.document = ?1", d).order("-number").fetch(100).stream()
        .map(r -> new RevisionView(r.getNumber(), r.getFileName(), r.getContentType(), r.getSizeBytes(), r.getSha256(), r.getChangeSummary(),
            r.getUploadedBy() == null ? null : r.getUploadedBy().getName(), r.getUploadedAt()))
        .toList();
    return new DocumentView(d.getId(), d.getVersion(), d.getTitle(), name(d.getKindSelect(), KINDS), name(d.getSubjectSelect(), ContentService.SUBJECTS),
        d.getSubjectId(), name(d.getLanguageSelect(), LANGUAGES), d.getOwner() == null ? null : d.getOwner().getName(), d.getCurrentRevision(),
        Boolean.TRUE.equals(d.getArchived()), revisions);
  }

  static ArticleSummary summary(KnowledgeArticle a, KnowledgeRevision shown) {
    return new ArticleSummary(a.getId(), name(a.getStatusSelect(), STATUSES), shown == null ? a.getTitleEn() : shown.getTitleEn(),
        shown == null ? a.getTitleAr() : shown.getTitleAr(), a.getCategory() == null ? null : a.getCategory().getId(),
        a.getBusinessLine() == null ? null : a.getBusinessLine().getCode(),
        a.getPublishedRevision() == null ? null : a.getPublishedRevision().getNumber(),
        a.getPublishedRevision() == null ? null : a.getPublishedRevision().getPublishedAt());
  }

  static ArticleView view(KnowledgeArticle a, boolean editor) {
    KnowledgeRevision p = a.getPublishedRevision();
    boolean visible = p != null && (editor || Integer.valueOf(KnowledgeArticleRepository.STATUS_PUBLISHED).equals(a.getStatusSelect()));
    PublishedArticle published = !visible ? null : new PublishedArticle(p.getNumber(), p.getTitleEn(), p.getTitleAr(), p.getBodyEn(), p.getBodyAr(),
        p.getPublishedBy() == null ? null : p.getPublishedBy().getName(), p.getPublishedAt());
    WorkingCopy working = !editor ? null : new WorkingCopy(a.getTitleEn(), a.getTitleAr(), a.getBodyEn(), a.getBodyAr(),
        p == null || !(eq(p.getTitleEn(), a.getTitleEn()) && eq(p.getTitleAr(), a.getTitleAr()) && eq(p.getBodyEn(), a.getBodyEn()) && eq(p.getBodyAr(), a.getBodyAr())));
    List<PublishedRevisionRow> history = !editor ? List.of() : Query.of(KnowledgeRevision.class).filter("self.article = ?1", a).order("-number").fetch(50)
        .stream().map(r -> new PublishedRevisionRow(r.getNumber(), r.getPublishedBy() == null ? null : r.getPublishedBy().getName(), r.getPublishedAt())).toList();
    return new ArticleView(a.getId(), a.getVersion(), name(a.getStatusSelect(), STATUSES), a.getCategory() == null ? null : a.getCategory().getId(),
        a.getBusinessLine() == null ? null : a.getBusinessLine().getCode(), editor, published, working, history);
  }

  private static boolean eq(String a, String b) {
    return a == null ? b == null : a.equals(b);
  }

  public record VersionOnly(Integer version) {}
  public record FileDocument(
      String subject, Long subjectId, String title, String kind, String language, String fileName, String contentBase64, String changeSummary) {}
  public record Revise(Integer version, String fileName, String contentBase64, String changeSummary) {}
  public record RevisionView(
      Integer number, String fileName, String contentType, Long sizeBytes, String sha256, String changeSummary, String uploadedBy, LocalDateTime uploadedAt) {}
  public record DocumentView(
      Long id, Integer version, String title, String kind, String subject, Long subjectId, String language, String ownerName,
      Integer currentRevision, boolean archived, List<RevisionView> revisions) {}
  public record AddCategory(String code, String nameEn, String nameAr, Integer sequence) {}
  public record CategoryView(Long id, String code, String nameEn, String nameAr) {}
  public record EditArticle(
      Integer version, String titleEn, String titleAr, String bodyEn, String bodyAr, Long categoryId, String businessLineCode) {}
  public record ArticleSummary(
      Long id, String status, String titleEn, String titleAr, Long categoryId, String businessLineCode, Integer revision, LocalDateTime publishedAt) {}
  public record PublishedArticle(Integer revision, String titleEn, String titleAr, String bodyEn, String bodyAr, String publishedBy, LocalDateTime publishedAt) {}
  public record WorkingCopy(String titleEn, String titleAr, String bodyEn, String bodyAr, boolean unpublishedChanges) {}
  public record PublishedRevisionRow(Integer number, String publishedBy, LocalDateTime publishedAt) {}
  public record ArticleView(
      Long id, Integer version, String status, Long categoryId, String businessLineCode, boolean canEdit, PublishedArticle published,
      WorkingCopy working, List<PublishedRevisionRow> revisions) {}
}

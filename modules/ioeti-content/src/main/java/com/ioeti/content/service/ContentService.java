package com.ioeti.content.service;

import com.axelor.apps.base.db.Partner;
import com.axelor.apps.contract.db.Contract;
import com.axelor.apps.crm.db.Lead;
import com.axelor.apps.crm.db.Opportunity;
import com.axelor.apps.intervention.db.Intervention;
import com.axelor.apps.project.db.Project;
import com.axelor.apps.sale.db.SaleOrder;
import com.axelor.auth.AuthUtils;
import com.axelor.common.MimeTypesUtils;
import com.axelor.db.JPA;
import com.axelor.db.Model;
import com.axelor.db.Query;
import com.axelor.inject.Beans;
import com.axelor.meta.MetaFiles;
import com.axelor.meta.db.MetaFile;
import com.google.inject.persist.Transactional;
import com.ioeti.content.db.DocumentRevision;
import com.ioeti.content.db.KnowledgeArticle;
import com.ioeti.content.db.KnowledgeRevision;
import com.ioeti.content.db.repo.KnowledgeArticleRepository;
import com.ioeti.content.db.RecordDocument;
import com.ioeti.core.api.ApiException;
import com.ioeti.core.api.RecordAccess;
import com.ioeti.core.text.ArabicNormalizer;
import jakarta.persistence.LockModeType;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.LocalDateTime;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;
import java.util.stream.Stream;

/**
 * Document register and knowledge base rules.
 *
 * <ul>
 *   <li>A document belongs to one business record; reading it needs read access to that record and
 *       adding a revision needs write access. Revisions are immutable and numbered without gaps.
 *   <li>Uploads are at most 10 MiB, must have an allowed extension and content whose detected type
 *       matches it (the extension alone is not trusted).
 *   <li>Knowledge readers see only the latest published revision; the working copy stays private to
 *       those who may edit it until it is published again.
 * </ul>
 */
public class ContentService {

  public static final int MAX_BYTES = 10 * 1024 * 1024;

  /** Allowed extensions and the detected content types accepted for each. */
  static final Map<String, Set<String>> TYPES = Map.of(
      "pdf", Set.of("application/pdf"),
      "docx", Set.of("application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/x-tika-ooxml", "application/zip"),
      "xlsx", Set.of("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/x-tika-ooxml", "application/zip"),
      "pptx", Set.of("application/vnd.openxmlformats-officedocument.presentationml.presentation", "application/x-tika-ooxml", "application/zip"),
      "png", Set.of("image/png"),
      "jpg", Set.of("image/jpeg"),
      "jpeg", Set.of("image/jpeg"),
      "txt", Set.of("text/plain"));

  /** The type served back for each extension (never the detected or the client's claim). */
  static final Map<String, String> SERVED = Map.of(
      "pdf", "application/pdf",
      "docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "png", "image/png", "jpg", "image/jpeg", "jpeg", "image/jpeg", "txt", "text/plain");

  /** Stored by position (subjectSelect = index + 1): new subjects are only ever appended. */
  public static final String[] SUBJECTS = {"LEAD", "OPPORTUNITY", "ACCOUNT", "QUOTE", "CONTRACT", "ENGAGEMENT", "VISIT"};
  static final List<Class<? extends Model>> SUBJECT_TYPES =
      List.of(Lead.class, Opportunity.class, Partner.class, SaleOrder.class, Contract.class, Project.class, Intervention.class);

  public record Upload(String fileName, String extension, String contentType, byte[] bytes, String sha256) {}

  /** A clean file name: no path, no control or reserved characters, at most 120 characters. */
  public static String cleanFileName(String name) {
    if (name == null) throw ApiException.invalidField("fileName", "REQUIRED", "A file name is required.");
    String base = name.replace('\\', '/');
    base = base.substring(base.lastIndexOf('/') + 1);
    base = base.replaceAll("[\\p{Cntrl}<>:\"|?*]", "").strip();
    while (base.startsWith(".")) base = base.substring(1);
    if (base.isEmpty()) throw ApiException.invalidField("fileName", "REQUIRED", "A file name is required.");
    if (base.length() > 120) {
      int dot = base.lastIndexOf('.');
      String ext = dot > 0 ? base.substring(dot) : "";
      base = base.substring(0, 120 - ext.length()) + ext;
    }
    return base;
  }

  /** Checks size, extension and detected content; the bytes are never trusted by name alone. */
  public static Upload check(String fileName, byte[] bytes) {
    String clean = cleanFileName(fileName);
    if (bytes == null || bytes.length == 0) throw ApiException.invalidField("content", "REQUIRED", "The file is empty.");
    if (bytes.length > MAX_BYTES) throw ApiException.invalidField("content", "TOO_LARGE", "Files can be at most 10 MiB.");
    int dot = clean.lastIndexOf('.');
    String extension = dot < 0 ? "" : clean.substring(dot + 1).toLowerCase(Locale.ROOT);
    Set<String> accepted = TYPES.get(extension);
    if (accepted == null) throw ApiException.invalidField("fileName", "TYPE_NOT_ALLOWED", "Allowed: PDF, Word, Excel, PowerPoint, PNG, JPEG, text.");
    String detected = MimeTypesUtils.getContentType(new ByteArrayInputStream(bytes), null);
    if (detected == null || !accepted.contains(detected)) {
      throw ApiException.invalidField("content", "TYPE_MISMATCH", "The file content does not match its extension.");
    }
    try {
      MetaFiles.checkType(SERVED.get(extension));
    } catch (RuntimeException e) {
      throw ApiException.invalidField("fileName", "TYPE_NOT_ALLOWED", "This file type is not allowed on this server.");
    }
    return new Upload(clean, extension, SERVED.get(extension), bytes, sha256(bytes));
  }

  static String sha256(byte[] bytes) {
    try {
      return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
    } catch (NoSuchAlgorithmException e) {
      throw new IllegalStateException(e);
    }
  }

  // --- subjects ------------------------------------------------------------------------------------

  public static int subject(String name) {
    for (int i = 0; i < SUBJECTS.length; i++) if (SUBJECTS[i].equals(name)) return i + 1;
    throw ApiException.invalidField("subject", "UNAVAILABLE", "Use one of " + String.join(", ", SUBJECTS) + ".");
  }

  /** The record a document is filed on, if the caller may read it (404 otherwise). */
  public static Model readableSubject(int subject, Long id) {
    Model record = RecordAccess.readable(SUBJECT_TYPES.get(subject - 1), id);
    if (record instanceof Partner partner && !Boolean.TRUE.equals(partner.getIsCustomer()) && !Boolean.TRUE.equals(partner.getIsProspect())) {
      throw ApiException.notFound();
    }
    return record;
  }

  /** The record a document is filed on, if the caller may change it (403/404 otherwise). */
  public static Model writableSubject(int subject, Long id) {
    readableSubject(subject, id);
    return RecordAccess.writable(SUBJECT_TYPES.get(subject - 1), id);
  }

  // --- documents -----------------------------------------------------------------------------------

  @Transactional(rollbackOn = {Exception.class})
  public RecordDocument file(RecordDocument document, Upload upload, String summary) {
    document.setOwner(AuthUtils.getUser());
    document.setCurrentRevision(0);
    RecordDocument saved = JPA.save(document);
    revise(saved, upload, summary);
    return saved;
  }

  @Transactional(rollbackOn = {Exception.class})
  public DocumentRevision revise(RecordDocument document, Upload upload, String summary) {
    JPA.em().lock(document, LockModeType.PESSIMISTIC_FORCE_INCREMENT);
    DocumentRevision latest = latest(document);
    if (latest != null && latest.getSha256().equals(upload.sha256())) {
      throw new ApiException(422, "UNCHANGED", "This file is the same as the current revision.", null);
    }
    MetaFile file;
    try {
      file = Beans.get(MetaFiles.class).upload(new ByteArrayInputStream(upload.bytes()), upload.fileName());
    } catch (IOException e) {
      throw new UncheckedIOException(e);
    }
    int number = (document.getCurrentRevision() == null ? 0 : document.getCurrentRevision()) + 1;
    DocumentRevision revision = new DocumentRevision();
    revision.setDocument(document);
    revision.setNumber(number);
    revision.setFile(file);
    revision.setFileName(upload.fileName());
    revision.setContentType(upload.contentType());
    revision.setSizeBytes((long) upload.bytes().length);
    revision.setSha256(upload.sha256());
    revision.setChangeSummary(summary);
    revision.setUploadedBy(AuthUtils.getUser());
    revision.setUploadedAt(LocalDateTime.now());
    document.setCurrentRevision(number);
    JPA.save(document);
    return JPA.save(revision);
  }

  public static DocumentRevision latest(RecordDocument document) {
    return Query.of(DocumentRevision.class).filter("self.document = ?1", document).order("-number").fetchOne();
  }

  @Transactional(rollbackOn = {Exception.class})
  public RecordDocument archive(RecordDocument document) {
    document.setArchived(true);
    return JPA.save(document);
  }

  // --- knowledge base ------------------------------------------------------------------------------

  @Transactional(rollbackOn = {Exception.class})
  public <T extends Model> T save(T record) {
    return JPA.save(record);
  }

  @Transactional(rollbackOn = {Exception.class})
  public KnowledgeArticle publish(KnowledgeArticle article) {
    JPA.em().lock(article, LockModeType.PESSIMISTIC_FORCE_INCREMENT);
    if (Integer.valueOf(KnowledgeArticleRepository.STATUS_ARCHIVED).equals(article.getStatusSelect())) {
      throw new ApiException(422, "ARTICLE_ARCHIVED", "Restore the article before publishing it.", null);
    }
    KnowledgeRevision current = article.getPublishedRevision();
    if (current != null && same(current.getTitleEn(), article.getTitleEn()) && same(current.getTitleAr(), article.getTitleAr())
        && same(current.getBodyEn(), article.getBodyEn()) && same(current.getBodyAr(), article.getBodyAr())
        && Integer.valueOf(KnowledgeArticleRepository.STATUS_PUBLISHED).equals(article.getStatusSelect())) {
      throw new ApiException(422, "UNCHANGED", "Nothing changed since the published revision.", null);
    }
    KnowledgeRevision revision = new KnowledgeRevision();
    revision.setArticle(article);
    revision.setNumber(current == null ? 1 : current.getNumber() + 1);
    revision.setTitleEn(article.getTitleEn());
    revision.setTitleAr(article.getTitleAr());
    revision.setBodyEn(article.getBodyEn());
    revision.setBodyAr(article.getBodyAr());
    revision.setPublishedBy(AuthUtils.getUser());
    revision.setPublishedAt(LocalDateTime.now());
    JPA.save(revision);
    article.setPublishedRevision(revision);
    article.setStatusSelect(KnowledgeArticleRepository.STATUS_PUBLISHED);
    article.setPublishedSearchKey(searchKey(revision));
    return JPA.save(article);
  }

  @Transactional(rollbackOn = {Exception.class})
  public KnowledgeArticle archive(KnowledgeArticle article) {
    article.setStatusSelect(KnowledgeArticleRepository.STATUS_ARCHIVED);
    return JPA.save(article);
  }

  public static String searchKey(KnowledgeRevision revision) {
    String key = Stream.of(revision.getTitleEn(), revision.getTitleAr(), revision.getBodyEn(), revision.getBodyAr())
        .map(ArabicNormalizer::normalize).filter(s -> !s.isEmpty()).collect(Collectors.joining(" | "));
    return key.length() > 4000 ? key.substring(0, 4000) : key;
  }

  private static boolean same(String a, String b) {
    return a == null ? b == null : a.equals(b);
  }
}

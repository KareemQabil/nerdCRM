import { ApiError, wrapped } from "./api";
import { DEMO_MODE } from "./demo";

/** Wave 7a: documents filed on records (immutable revisions) and the bilingual knowledge base. */
export type Subject = "LEAD" | "OPPORTUNITY" | "ACCOUNT" | "QUOTE" | "CONTRACT" | "ENGAGEMENT" | "VISIT";
export type DocumentKind = "PROPOSAL" | "CONTRACT" | "EVIDENCE" | "REPORT" | "CORRESPONDENCE" | "OTHER";
export type DocumentLanguage = "AR" | "EN" | "BILINGUAL";
export type Revision = {
  number: number; fileName: string; contentType: string; sizeBytes: number | null; sha256: string;
  changeSummary: string | null; uploadedBy: string | null; uploadedAt: string;
};
export type RecordDocument = {
  id: number; version: number; title: string; kind: DocumentKind; subject: Subject; subjectId: number; language: DocumentLanguage | null;
  ownerName: string | null; currentRevision: number | null; archived: boolean; revisions: Revision[];
};
export type Category = { id: number; code: string; nameEn: string; nameAr: string };
export type ArticleSummary = {
  id: number; status: "DRAFT" | "PUBLISHED" | "ARCHIVED"; titleEn: string | null; titleAr: string | null; categoryId: number | null;
  businessLineCode: string | null; revision: number | null; publishedAt: string | null;
};
export type Article = {
  id: number; version: number; status: ArticleSummary["status"]; categoryId: number | null; businessLineCode: string | null; canEdit: boolean;
  published: { revision: number; titleEn: string | null; titleAr: string | null; bodyEn: string | null; bodyAr: string | null; publishedBy: string | null; publishedAt: string } | null;
  working: { titleEn: string | null; titleAr: string | null; bodyEn: string | null; bodyAr: string | null; unpublishedChanges: boolean } | null;
  revisions: { number: number; publishedBy: string | null; publishedAt: string }[];
};
export type ArticleDraft = { titleEn?: string; titleAr?: string; bodyEn?: string; bodyAr?: string; categoryId?: number | null; businessLineCode?: string | null };

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const ACCEPTED_FILES = ".pdf,.docx,.xlsx,.pptx,.png,.jpg,.jpeg,.txt";
const BASE = "/ws/ioeti/content";
const PREFIX = "/axelor-erp";
async function list<T>(url: string): Promise<T[]> {
  if (DEMO_MODE) return [];
  const values = await wrapped<T[]>(url);
  if (!Array.isArray(values)) throw new ApiError(502, "Invalid content response");
  return values;
}
async function post<T>(url: string, body: Record<string, unknown> = {}): Promise<T> {
  if (DEMO_MODE) throw new ApiError(403, "Preview mode is read-only");
  return wrapped<T>(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}
const id = (value: number) => encodeURIComponent(value);

/** The file as base64 (without the data: prefix), after a size check the server repeats. */
export async function readFile(file: File): Promise<string> {
  if (file.size > MAX_UPLOAD_BYTES) throw new ApiError(422, "File too large", "VALIDATION_FAILED", [{ field: "content", code: "TOO_LARGE" }]);
  const buffer = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let i = 0; i < buffer.length; i += 0x8000) binary += String.fromCharCode(...buffer.subarray(i, i + 0x8000));
  return btoa(binary);
}

export const getDocuments = (subject: Subject, subjectId: number, archived = false) =>
  list<RecordDocument>(`${BASE}/documents?subject=${subject}&subjectId=${id(subjectId)}${archived ? "&archived=true" : ""}`);
export const fileDocument = (body: { subject: Subject; subjectId: number; title: string; kind: DocumentKind; language?: DocumentLanguage; fileName: string; contentBase64: string; changeSummary?: string }) =>
  post<RecordDocument>(`${BASE}/documents`, body);
export const reviseDocument = (documentId: number, version: number, fileName: string, contentBase64: string, changeSummary?: string) =>
  post<RecordDocument>(`${BASE}/documents/${id(documentId)}/revisions`, { version, fileName, contentBase64, changeSummary });
export const archiveDocument = (documentId: number, version: number) => post<RecordDocument>(`${BASE}/documents/${id(documentId)}/archive`, { version });
/** Same-origin download link; the server answers with an attachment, never inline content. */
export const revisionUrl = (documentId: number, number: number) => `${PREFIX}${BASE}/documents/${id(documentId)}/revisions/${id(number)}/content`;

export const getCategories = () => list<Category>(`${BASE}/kb/categories`);
export const addCategory = (code: string, nameEn: string, nameAr: string) => post<Category>(`${BASE}/kb/categories`, { code, nameEn, nameAr });
export function searchArticles(q: string, categoryId?: number, businessLine?: string) {
  const params = new URLSearchParams();
  if (q.trim()) params.set("q", q.trim());
  if (categoryId) params.set("categoryId", String(categoryId));
  if (businessLine) params.set("businessLine", businessLine);
  const query = params.toString();
  return list<ArticleSummary>(`${BASE}/kb/articles${query ? `?${query}` : ""}`);
}
export const getDrafts = () => list<ArticleSummary>(`${BASE}/kb/drafts`);
export const getArticle = (articleId: number) => wrapped<Article>(`${BASE}/kb/articles/${id(articleId)}`);
export const createArticle = (draft: ArticleDraft) => post<Article>(`${BASE}/kb/articles`, draft);
export const saveArticle = (articleId: number, version: number, draft: ArticleDraft) => post<Article>(`${BASE}/kb/articles/${id(articleId)}`, { version, ...draft });
export const publishArticle = (articleId: number, version: number) => post<Article>(`${BASE}/kb/articles/${id(articleId)}/publish`, { version });
export const archiveArticle = (articleId: number, version: number) => post<Article>(`${BASE}/kb/articles/${id(articleId)}/archive`, { version });

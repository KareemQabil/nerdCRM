import { ApiError, wrapped } from "./api";
import { DEMO_MODE } from "./demo";
import type { Subject } from "./contentApi";

/** Wave 7b: the in-app inbox, mentions and the held outbox. Nothing is sent outside the CRM. */
export type Notice = { id: number; kind: string; subject: string | null; subjectId: number | null; title: string; actorName: string | null; read: boolean; at: string };
export type Person = { id: number; name: string };
export type OutboundMessage = {
  id: number; version: number; leadId: number; channel: "EMAIL"; subjectLine: string; body: string; status: "DRAFT" | "CANCELLED";
  authorName: string | null; createdAt: string; sendStatus: "BLOCKED_BY_POLICY";
};

const BASE = "/ws/ioeti/automation";
async function list<T>(url: string): Promise<T[]> {
  if (DEMO_MODE) return [];
  const values = await wrapped<T[]>(url);
  if (!Array.isArray(values)) throw new ApiError(502, "Invalid automation response");
  return values;
}
async function post<T>(url: string, body: Record<string, unknown> = {}): Promise<T> {
  if (DEMO_MODE) throw new ApiError(403, "Preview mode is read-only");
  return wrapped<T>(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}
const id = (value: number) => encodeURIComponent(value);

export const getInbox = (unread = false) => list<Notice>(`${BASE}/inbox${unread ? "?unread=true" : ""}`);
export const getUnreadCount = async () => DEMO_MODE ? 0 : (await wrapped<{ unread: number }>(`${BASE}/inbox/count`)).unread;
export const markRead = (noticeId: number) => post<Notice>(`${BASE}/inbox/${id(noticeId)}/read`);
export const markAllRead = () => post<{ marked: number }>(`${BASE}/inbox/read-all`);
export const findPeople = (q: string) => list<Person>(`${BASE}/people?q=${encodeURIComponent(q)}`);
export const mention = (recipientId: number, subject: Subject, subjectId: number, message: string) =>
  post<{ recipientId: number }>(`${BASE}/mentions`, { recipientId, subject, subjectId, message });
export const getOutbox = (leadId: number) => list<OutboundMessage>(`${BASE}/outbox?leadId=${id(leadId)}`);
export const draftMessage = (leadId: number, subjectLine: string, body: string) =>
  post<OutboundMessage>(`${BASE}/outbox`, { leadId, channel: "EMAIL", subjectLine, body });
export const sendMessage = (messageId: number, version: number) => post<OutboundMessage>(`${BASE}/outbox/${id(messageId)}/send`, { version });
export const cancelMessage = (messageId: number, version: number) => post<OutboundMessage>(`${BASE}/outbox/${id(messageId)}/cancel`, { version });

/** Where a notice leads in the app; the record's own permissions apply when it opens. */
export function noticeRoute(notice: Notice): string | null {
  if (notice.subjectId == null) return null;
  switch (notice.subject) {
    case "LEAD": return `#/leads/${notice.subjectId}`;
    case "ACCOUNT": return `#/accounts/${notice.subjectId}`;
    case "OPPORTUNITY": return `#/opportunities/${notice.subjectId}`;
    case "HANDOVER": case "ENGAGEMENT": return "#/operations";
    case "VISIT": return `#/visits/${notice.subjectId}`;
    case "QUALITY": return `#/quality/${notice.subjectId}`;
    default: return null;
  }
}

/** One global, source-aware feedback contract. No raw backend exception or PII shown. */
export type FeedbackKind = "success" | "error" | "info";
export type FeedbackNotice = {
  id: number;
  kind: FeedbackKind;
  code: string;
  status?: number;
  ar: string;
  en: string;
};
type NoticeInput = Omit<FeedbackNotice, "id">;
const listeners = new Set<(notice: FeedbackNotice) => void>();
let sequence = 0;
let previous = "";
let previousAt = 0;

export function subscribeFeedback(listener: (notice: FeedbackNotice) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function emitFeedback(notice: NoticeInput): void {
  const dedupeKey = [notice.kind, notice.code, notice.status].join(":");
  const now = Date.now();
  if (previous === dedupeKey && now - previousAt < 1000) return;
  previous = dedupeKey;
  previousAt = now;
  const item = {...notice, id: ++sequence};
  listeners.forEach(listener => listener(item));
}

export type ApiFailure = {statusCode: number; code?: string | null};
export function describeFailure(error: ApiFailure): NoticeInput {
  const status = error.statusCode;
  const backendCode = error.code ?? "";
  // The contract code is kept as metadata; never render arbitrary backend messages.
  const id = /^[A-Z][A-Z0-9_]{1,55}$/.test(backendCode) ? backendCode : null;
  const namedCode = id ?? (status > 0 ? "HTTP_" + status : "NETWORK_ERROR");
  if (status === 0) return {kind:"error",code:namedCode,status,ar:"تعذر الاتصال بالخادم. اتأكد من الإنترنت وحاول تاني.",en:"Unable to reach the server. Check your connection and try again."};
  if (status === 401) return {kind:"error",code:namedCode,status,ar:"انتهت جلسة الدخول. سجّل دخولك من جديد.",en:"Your session expired. Sign in again."};
  if (status === 403) return {kind:"error",code:namedCode,status,ar:"مش عندك صلاحية تنفيذ الإجراء ده. البيانات لم تتغير.",en:"You do not have permission for this action. Nothing was changed."};
  if (status === 404) return {kind:"error",code:namedCode,status,ar:"السجل المطلوب غير متاح أو ليس ضمن صلاحياتك.",en:"This record is unavailable or outside your access scope."};
  if (status === 409) return {kind:"error",code:namedCode,status,ar:"السجل اتعدل في مكان تاني. حدّثه وراجع التغييرات قبل الحفظ.",en:"This record changed elsewhere. Reload and review before saving."};
  if (status === 422 && id === "BLOCKED_BY_POLICY") return {kind:"error",code:namedCode,status,ar:"الإجراء موقوف لحد اعتماد سياسة الشركة. مفيش اعتماد أو معاملة تمت.",en:"This action is awaiting approved business policy. No transaction was completed."};
  // business rules are the owners' policies (P1): a missing one is not the user's input error
  if (status === 422 && id === "POLICY_NOT_SET") return {kind:"error",code:namedCode,status,ar:"الإجراء محتاج قاعدة عمل مالك السياسات لسه ما ضبطهاش. مفيش حاجة اتغيرت.",en:"This needs a business rule the policy owners have not set yet. Nothing was changed."};
  if (status === 422 && id === "ACCOUNTING_NOT_READY") return {kind:"error",code:namedCode,status,ar:"إعداد الحسابات ناقص للإجراء ده. مفيش فاتورة اتعملت.",en:"The accounting set-up is incomplete for this. No invoice was created."};
  if (status === 400 || status === 422) return {kind:"error",code:namedCode,status,ar:"راجع الحقول المطلوبة وصحة المدخلات.",en:"Review the required fields and entered values."};
  if (status === 502 && id === "FX_SOURCE_UNAVAILABLE") return {kind:"error",code:namedCode,status,ar:"مصدر أسعار الصرف مش متاح دلوقتي. مفيش سعر اتسجل.",en:"The exchange-rate source is unavailable. No rate was recorded."};
  if (status === 429) return {kind:"error",code:namedCode,status,ar:"طلبات كتير في وقت قصير. حاول بعد شوية.",en:"Too many requests. Try again shortly."};
  if (status >= 500) return {kind:"error",code:namedCode,status,ar:"حصل عطل في الخادم. لم يتم تأكيد نجاح الإجراء؛ راجع السجل قبل إعادة المحاولة.",en:"The server had a problem. The outcome is unconfirmed; check the record before retrying."};
  return {kind:"error",code:namedCode,status,ar:"تعذر إكمال الإجراء. لم يتم تأكيد نجاحه.",en:"The operation could not be confirmed."};
}
export function notifyApiFailure(error: unknown): void {
  const candidate = error as Partial<ApiFailure> | null;
  const statusCode = typeof candidate?.statusCode === "number" ? candidate.statusCode : 0;
  const code = typeof candidate?.code === "string" ? candidate.code : null;
  emitFeedback(describeFailure({statusCode,code}));
}
export function notifyApiSuccess(method: string, status: number): void {
  const code = method === "DELETE" ? "DELETED" : status === 201 ? "CREATED" : status === 202 ? "ACCEPTED" : "SAVED";
  emitFeedback({
    kind:"success",code,status,
    ar:code === "DELETED" ? "اتنفذ الحذف بنجاح." : code === "CREATED" ? "تم إنشاء السجل بنجاح." : code === "ACCEPTED" ? "تم استلام الطلب للمعالجة." : "تم حفظ التغييرات بنجاح.",
    en:code === "DELETED" ? "Record deleted successfully." : code === "CREATED" ? "Record created successfully." : code === "ACCEPTED" ? "Request accepted for processing." : "Changes saved successfully.",
  });
}

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";

/** D-03 training (certificates, national ID, cancellation and refunds) against a mocked API; the live API is in scripts/training_probe.py. */

type Posted = { path: string; body: Record<string, unknown> };
type Options = { rulesSet?: boolean; certificates?: number; cancellation?: Record<string, unknown>; finance?: boolean };

const RULES = { criteriaSet: true, minAttendancePercent: 80, passMark: 70, identityCollection: "REQUIRED", cancellationSet: true,
  refundSteps: [{ daysBeforeStart: 7, refundPercent: 50 }, { daysBeforeStart: 14, refundPercent: 100 }, { daysBeforeStart: 0, refundPercent: 0 }],
  cohortCancelledRefundPercent: 100 };
const NO_RULES = { criteriaSet: false, minAttendancePercent: null, passMark: null, identityCollection: null, cancellationSet: false, refundSteps: null,
  cohortCancelledRefundPercent: null };

const refund = (extra: Record<string, unknown> = {}) => ({ id: 31, version: 0, enrollmentId: 501, traineeName: "Omar Nabil", cohortId: 40, cohortCode: "IA-NOV",
  courseName: "Internal auditor ISO 9001", cause: "ENROLMENT_CANCELLED", status: "REQUESTED", invoiceId: 77, invoiceNumber: "INV-0077", invoiceVersion: 3,
  currency: "EGP", invoiceTotal: 11400, paidAmount: 11400, daysBeforeStart: 9, refundPercent: 50, amount: 5700, creditPercent: 50,
  requestedAt: "2026-10-27T09:00:00", requestedBy: "Sara Coordinator", decidedAt: null, decidedBy: null, rejectReason: null, creditId: null,
  creditNumber: null, creditedAmount: null, canDecide: true, pendingCreditId: null, ...extra });

async function mock(page: Page, { rulesSet = true, certificates = 0, cancellation, finance = false }: Options = {}) {
  const posted: Posted[] = [];
  let cohort = { id: 40, version: 5, code: "IA-NOV", courseId: 3, courseName: "Internal auditor ISO 9001", startDate: "2026-11-05", endDate: "2026-11-06",
    capacity: 10, minSeats: null, location: "Cairo", status: "CLOSED", confirmed: 2, waitlisted: 0, seatsLeft: 8, coordinatedByMe: true };
  const enrollments = [
    { id: 500, version: 2, traineeId: 951, traineeName: "Sara Adel", clientName: "Delta Foods", status: "CONFIRMED", waitlistPosition: null, identityProvided: true },
    { id: 501, version: 4, traineeId: 952, traineeName: "Omar Nabil", clientName: "Delta Foods", status: "CONFIRMED", waitlistPosition: null, identityProvided: false },
  ];
  const rows = [
    { enrollmentId: 500, version: 2, traineeName: "Sara Adel", sessionsPresent: 4, attendancePercent: 80, score: null as number | null, eligible: false,
      reason: rulesSet ? "SCORE_MISSING" : "POLICY_NOT_SET", certificateId: null as number | null, certificateVersion: null as number | null,
      certificateSerial: null as string | null, certificateIssued: null as string | null },
    { enrollmentId: 501, version: 4, traineeName: "Omar Nabil", sessionsPresent: 2, attendancePercent: 40, score: 90, eligible: false,
      reason: rulesSet ? "ATTENDANCE_BELOW" : "POLICY_NOT_SET", certificateId: null, certificateVersion: null, certificateSerial: null, certificateIssued: null },
  ];
  const certificate = { id: 90, version: 0, serial: "TC-2026-0001", enrollmentId: 500, issueDate: "2026-10-27", traineeName: "Sara Adel",
    courseName: "Internal auditor ISO 9001", courseNameAr: "مراجع داخلي أيزو 9001", durationHours: 16, cohortCode: "IA-NOV", startDate: "2026-11-05",
    endDate: "2026-11-06", attendancePercent: 80, score: 85, status: "ISSUED", revokedOn: null as string | null };
  let refunds = [refund()];
  await page.route("**/axelor-erp/ws/ioeti/**", async (route: Route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^.*\/ws\/ioeti/, "");
    const method = route.request().method();
    const body = method === "POST" ? (route.request().postDataJSON() as Record<string, unknown>) ?? {} : {};
    if (method === "POST") posted.push({ path, body });
    const result = (object: unknown, code = 200) =>
      route.fulfill({ status: code, contentType: "application/json", body: JSON.stringify({ codeStatus: code, messageStatus: "ok", object }) });
    const failure = (code: number, error: Record<string, unknown>) =>
      route.fulfill({ status: code, contentType: "application/json", body: JSON.stringify({ codeStatus: code, error }) });
    if (path === "/session") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ code: "sara", name: "Sara", language: "ar" }) });
    if (path === "/accounts" && method === "GET") return result([{ id: 902, name: "Delta Foods", reference: "AC-902", customer: true, prospect: false }]);
    if (path === "/accounts/902/contacts") return result([{ id: 953, name: "Mona Hany", jobTitle: null }]);
    if (path === "/training/courses") return result([{ id: 3, version: 0, code: "ISO-IA", name: "Internal auditor ISO 9001", nameAr: null, durationHours: 16, active: true }]);
    if (path === "/training/cohorts") return result([cohort]);
    if (path === "/training/cohorts/40") return result(cohort);
    if (path === "/training/cohorts/40/enrollments" && method === "GET") return result(enrollments);
    if (path === "/training/cohorts/40/enrollments") {
      if (rulesSet && !body.nationalId) return failure(422, { code: "VALIDATION_FAILED", fields: [{ field: "nationalId", code: "REQUIRED" }] });
      enrollments.push({ id: 502, version: 0, traineeId: 953, traineeName: "Mona Hany", clientName: "Delta Foods", status: "CONFIRMED", waitlistPosition: null,
        identityProvided: !!body.nationalId });
      cohort = { ...cohort, version: cohort.version + 1 };
      return result(enrollments[2], 201);
    }
    if (path === "/training/cohorts/40/sessions" && method === "GET") return result([]);
    if (path === "/training/cohorts/40/rules") return result(rulesSet ? RULES : NO_RULES);
    if (path === "/training/cohorts/40/eligibility") return result({ cohortId: 40, cohortVersion: cohort.version, criteriaSet: rulesSet,
      minAttendancePercent: rulesSet ? 80 : null, passMark: rulesSet ? 70 : null, sessions: 5, canIssue: true, rows });
    if (path === "/training/cohorts/40/refunds") return finance ? result(refunds) : result([]);
    if (path === "/training/refunds") return finance ? result(url.searchParams.get("status") === "REQUESTED" ? refunds.filter(r => r.status === "REQUESTED") : refunds)
      : failure(403, { code: "FORBIDDEN", fields: [] });
    if (path === "/training/enrollments/500/assessment") {
      rows[0] = { ...rows[0], score: body.score as number, eligible: (body.score as number) >= 70, reason: (body.score as number) >= 70 ? null as unknown as string : "SCORE_BELOW", version: 3 };
      return result(enrollments[0]);
    }
    if (path === "/training/enrollments/500/certificate") {
      rows[0] = { ...rows[0], certificateId: 90, certificateVersion: 0, certificateSerial: "TC-2026-0001", certificateIssued: "2026-10-27" };
      return result(certificate, 201);
    }
    if (path === "/training/enrollments/501/certificate") return failure(422, { code: "NOT_ELIGIBLE", fields: [{ field: "enrollment", code: "ATTENDANCE_BELOW" }] });
    if (path === "/training/certificates/90" && method === "GET") return result(certificate);
    if (path === "/training/certificates/90/revoke") {
      certificate.status = "REVOKED"; certificate.revokedOn = "2026-10-27";
      rows[0] = { ...rows[0], certificateId: null, certificateSerial: null, certificateIssued: null };
      return result(certificate);
    }
    if (path === "/training/enrollments/501/national-id") { enrollments[1] = { ...enrollments[1], identityProvided: true, version: 5 }; return result(enrollments[1]); }
    if (path === "/training/enrollments/501/cancellation") return result({ enrollmentId: 501, version: 4, status: "CONFIRMED", outcome: "REFUND",
      fee: { id: 8, version: 0, invoiceId: 77, invoiceNumber: "INV-0077", amount: 11400, currency: "EGP", paid: 11400 }, paid: 11400, daysBeforeStart: 9,
      refundPercent: 50, refundAmount: 5700, currency: "EGP", canLinkInvoice: false, refund: null, ...cancellation });
    if (path === "/training/enrollments/500/cancellation") return result({ enrollmentId: 500, version: 2, status: "CONFIRMED", outcome: "NOT_INVOICED", fee: null,
      paid: 0, daysBeforeStart: 9, refundPercent: null, refundAmount: 0, currency: null, canLinkInvoice: true, refund: null });
    if (path === "/training/enrollments/500/invoices") return result([{ id: 78, number: "INV-0078", date: "2026-10-20", currency: "EGP", totalWithTax: 22800,
      received: 22800, unlinked: 22800 }]);
    if (path === "/training/enrollments/500/fee") return result({ id: 9, version: 0, invoiceId: 78, invoiceNumber: "INV-0078", amount: body.amount ?? 22800, currency: "EGP", paid: 11400 }, 201);
    if (path === "/training/enrollments/501/cancel") { enrollments[1] = { ...enrollments[1], status: "CANCELLED", version: 5 }; return result(enrollments[1]); }
    if (path === "/training/cohorts/40/cancellation") return result({ cohortId: 40, version: cohort.version, enrollments: 2, paidEnrollments: 1, refunds: 1,
      refundTotal: 11400, currency: "EGP", refundPercent: 100, outcome: "REFUND", certificatesIssued: certificates });
    if (path === "/finance/invoices/77/credit-notes") return result({ id: 77, version: 4, refunds: [{ id: 300, reason: "older" },
      { id: 301, reason: String(body.reason) }] }, 201);
    if (path === "/training/refunds/31/approve") { refunds = [refund({ status: "CREDITED", creditId: 301, creditNumber: "CN-0301", creditedAmount: 5700, canDecide: false })]; return result(refunds[0]); }
    if (path === "/training/refunds/31/reject") {
      if (!String(body.reason ?? "").trim()) return failure(422, { code: "VALIDATION_FAILED", fields: [{ field: "reason", code: "REQUIRED" }] });
      refunds = [refund({ status: "REJECTED", rejectReason: body.reason, canDecide: false })]; return result(refunds[0]);
    }
    return result([]);
  });
  return { posted };
}

async function openCohort(page: Page) {
  await page.goto("/#/training");
  await page.getByRole("button", { name: /Internal auditor ISO 9001/ }).click();
  await expect(page.getByRole("heading", { name: "قواعد الدورة" })).toBeVisible();
}

test("D-03: the coordinator sees the course rules, records a score, issues a certificate, prints and revokes it; ineligible is explained", async ({ page }) => {
  const { posted } = await mock(page);
  await openCohort(page);
  const rules = page.locator(".training-rules");
  await expect(rules).toContainText("أقل حضور 80%");
  await expect(rules).toContainText("درجة النجاح 70");
  await expect(rules).toContainText("إجباري");
  await expect(rules).toContainText("قبل البداية بـ 14 يوم أو أكتر: 100%");
  await expect(rules).toContainText("لو إحنا لغينا الدفعة: 100%");
  const certs = page.getByRole("table", { name: "الشهادات والتقييم" });
  await expect(certs.getByRole("row", { name: /Omar Nabil/ })).toContainText("الحضور أقل من المطلوب");
  await expect(certs.getByRole("row", { name: /Sara Adel/ })).toContainText("الدرجة لسه متسجلتش");
  await certs.getByRole("spinbutton", { name: "الدرجة Sara Adel" }).fill("85");
  await certs.getByRole("row", { name: /Sara Adel/ }).getByRole("button", { name: "حفظ الدرجة" }).click();
  await expect(certs.getByRole("row", { name: /Sara Adel/ })).toContainText("مستوفي الشروط");
  await certs.getByRole("row", { name: /Sara Adel/ }).getByRole("button", { name: "إصدار شهادة" }).click();
  await expect(certs.getByRole("row", { name: /Sara Adel/ })).toContainText("TC-2026-0001");
  await certs.getByRole("row", { name: /Sara Adel/ }).getByRole("button", { name: "طباعة" }).click();
  const print = page.getByRole("dialog", { name: "شهادة إتمام تدريب" });
  await expect(print.getByRole("article")).toContainText("Sara Adel");
  await expect(print.getByRole("article")).toContainText("مراجع داخلي أيزو 9001");
  await expect(print.getByRole("article")).toContainText("TC-2026-0001");
  await print.getByRole("button", { name: "رجوع" }).click();
  await certs.getByRole("row", { name: /Sara Adel/ }).getByRole("button", { name: "سحب الشهادة" }).click();
  const revoke = page.getByRole("dialog", { name: "سحب الشهادة" });
  await expect(revoke.getByRole("button", { name: "سحب الشهادة" })).toBeDisabled();
  await revoke.getByLabel("سبب السحب").fill("Issued to the wrong trainee");
  await revoke.getByRole("button", { name: "سحب الشهادة" }).click();
  await expect(revoke).toHaveCount(0);
  expect(posted.map(p => p.path)).toEqual(["/training/enrollments/500/assessment", "/training/enrollments/500/certificate", "/training/certificates/90/revoke"]);
  expect(posted[0].body).toEqual({ version: 2, score: 85 });
  expect(posted[1].body).toEqual({ version: 3 });
  expect(posted[2].body).toEqual({ version: 0, reason: "Issued to the wrong trainee" });
});

test("D-03: the national ID is asked per course policy, sent once and only shown as on file / not on file", async ({ page }) => {
  const { posted } = await mock(page);
  await openCohort(page);
  const trainees = page.getByRole("table").filter({ hasText: "الجهة الراعية" }).first();
  await expect(trainees.getByRole("row", { name: /Sara Adel/ })).toContainText("متسجّل");
  await expect(trainees.getByRole("row", { name: /Omar Nabil/ })).toContainText("مش متسجّل");
  await trainees.getByRole("row", { name: /Omar Nabil/ }).getByRole("button", { name: "تسجيل الرقم القومي" }).click();
  const dialog = page.getByRole("dialog", { name: "تسجيل الرقم القومي" });
  await dialog.getByLabel(/الرقم القومي/).fill("29001011234567");
  await dialog.getByRole("button", { name: "حفظ" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(trainees.getByRole("row", { name: /Omar Nabil/ })).toContainText("متسجّل");
  expect(posted.at(-1)).toEqual({ path: "/training/enrollments/501/national-id", body: { version: 4, nationalId: "29001011234567" } });
  // the number is never shown back anywhere on the page
  await expect(page.locator("body")).not.toContainText("29001011234567");
});

test("D-03: with no policies set the page says which are missing, asks no national ID and offers no certificate", async ({ page }) => {
  await mock(page, { rulesSet: false });
  await openCohort(page);
  const gaps = page.locator(".training-policy-gaps");
  await expect(gaps).toContainText("training.certificate");
  await expect(gaps).toContainText("training.national-id");
  await expect(gaps).toContainText("training.cancellation");
  await expect(page.getByRole("button", { name: /إصدار لكل المستوفين/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "إصدار شهادة" })).toHaveCount(0);
  await expect(page.getByRole("columnheader", { name: "الرقم القومي" })).toHaveCount(0);
});

test("D-03: cancelling a paid enrolment shows the computed refund before confirming; a missing policy blocks it", async ({ page }) => {
  const { posted } = await mock(page);
  await openCohort(page);
  await page.getByRole("row", { name: /Omar Nabil/ }).first().getByRole("button", { name: "إلغاء التسجيل" }).click();
  const dialog = page.getByRole("dialog", { name: "إلغاء التسجيل" });
  await expect(dialog).toContainText("INV-0077");
  await expect(dialog).toContainText("5,700.00 EGP");
  await expect(dialog).toContainText("50% من المدفوع");
  await expect(dialog).toContainText("قبل البداية بـ 9 يوم");
  await dialog.getByRole("button", { name: "تأكيد الإلغاء" }).click();
  await expect(dialog).toHaveCount(0);
  expect(posted.at(-1)).toEqual({ path: "/training/enrollments/501/cancel", body: { version: 4 } });
});

test("D-03: a missing cancellation policy blocks cancelling a paid enrolment, and the dialog says why", async ({ page }) => {
  const { posted } = await mock(page, { cancellation: { outcome: "POLICY_NOT_SET", refundPercent: null, refundAmount: 0 } });
  await openCohort(page);
  await page.getByRole("row", { name: /Omar Nabil/ }).first().getByRole("button", { name: "إلغاء التسجيل" }).click();
  const dialog = page.getByRole("dialog", { name: "إلغاء التسجيل" });
  await expect(dialog).toContainText("training.cancellation");
  await expect(dialog.getByRole("button", { name: "تأكيد الإلغاء" })).toBeDisabled();
  expect(posted).toEqual([]);
});

test("D-03: finance links an enrolment to its invoice with the enrolment's share", async ({ page }) => {
  const { posted } = await mock(page);
  await openCohort(page);
  await page.getByRole("row", { name: /Sara Adel/ }).first().getByRole("button", { name: "الفاتورة والاسترداد" }).click();
  const dialog = page.getByRole("dialog", { name: "الفاتورة والاسترداد" });
  await expect(dialog).toContainText("مفيش فاتورة مربوطة");
  await dialog.getByRole("radio").check();
  await dialog.getByLabel(/نصيب التسجيل/).fill("11400");
  await dialog.getByRole("button", { name: "ربط الفاتورة" }).click();
  await expect(dialog).toHaveCount(0);
  expect(posted.at(-1)).toEqual({ path: "/training/enrollments/500/fee", body: { invoiceId: 78, amount: 11400 } });
});

test("D-03: cancelling a cohort with issued certificates is blocked and explained", async ({ page }) => {
  await mock(page, { certificates: 2 });
  await openCohort(page);
  await page.getByRole("button", { name: "إلغاء الدفعة" }).click();
  const dialog = page.getByRole("dialog", { name: "إلغاء الدفعة" });
  await expect(dialog).toContainText("اتصدر لها 2 شهادة");
  await expect(dialog.getByRole("button", { name: "تأكيد إلغاء الدفعة" })).toBeDisabled();
});

test("D-03: finance approves a refund: the credit note is issued through finance, then recorded on the refund; rejecting needs a reason", async ({ page }) => {
  const { posted } = await mock(page, { finance: true });
  await page.goto("/#/training");
  await page.getByRole("button", { name: "طلبات الاسترداد" }).click();
  const queue = page.getByRole("table", { name: "طلبات الاسترداد" });
  await expect(queue.getByRole("row", { name: /Omar Nabil/ })).toContainText("5,700.00 EGP");
  await expect(queue.getByRole("row", { name: /Omar Nabil/ })).toContainText("مستني المالية");
  await queue.getByRole("row", { name: /Omar Nabil/ }).getByRole("button", { name: "رفض" }).click();
  const reject = page.getByRole("dialog", { name: "رفض الاسترداد" });
  await expect(reject.getByRole("button", { name: "رفض" })).toBeDisabled();
  await reject.getByRole("button", { name: "رجوع" }).click();
  await queue.getByRole("row", { name: /Omar Nabil/ }).getByRole("button", { name: "اعتماد وإصدار إشعار دائن" }).click();
  const approve = page.getByRole("dialog", { name: "اعتماد الاسترداد" });
  await expect(approve).toContainText("50% من الفاتورة INV-0077");
  await approve.getByRole("button", { name: "اعتماد وإصدار إشعار دائن" }).click();
  await expect(approve).toHaveCount(0);
  await expect(page.getByText("مفيش طلبات استرداد")).toBeVisible();
  await page.getByRole("button", { name: "الكل" }).click();
  await expect(queue.getByRole("row", { name: /Omar Nabil/ })).toContainText("اتصرف بإشعار دائن");
  await expect(queue.getByRole("row", { name: /Omar Nabil/ })).toContainText("CN-0301");
  expect(posted.map(p => p.path)).toEqual(["/finance/invoices/77/credit-notes", "/training/refunds/31/approve"]);
  expect(posted[0].body).toEqual({ version: 3, percent: 50, reason: "Training refund #31 · IA-NOV" });
  expect(posted[1].body).toEqual({ version: 0, creditInvoiceId: 301 });
});

test("D-03: the training page passes axe's WCAG 2.1 A and AA rules in light and dark, and fits a phone", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await mock(page, { finance: true });
  const found: Record<string, string[]> = {};
  for (const theme of ["light", "dark"]) {
    await page.addInitScript(t => localStorage.setItem("ioeti.ui.preferences.v1", JSON.stringify({ theme: t, language: "ar", density: "comfortable", navigation: "expanded" })), theme);
    await openCohort(page);
    await expect(page.getByRole("table", { name: "الشهادات والتقييم" })).toBeVisible();
    const result = await new AxeBuilder({ page }).include(".training-page").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    const issues = result.violations.map(v => `${v.id} (${v.impact}): ${v.nodes.slice(0, 5).map(n => n.target.join(" ")).join(" | ")}`);
    if (issues.length) found[theme] = issues;
  }
  expect(found).toEqual({});
  await page.setViewportSize({ width: 390, height: 844 });
  await openCohort(page);
  await expect(page.getByRole("table", { name: "الشهادات والتقييم" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.screenshot({ path: "test-results/ioeti-training-d03-mobile.png", fullPage: true });
});

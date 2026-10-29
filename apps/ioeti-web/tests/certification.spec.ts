import { expect, test, type Page, type Route } from "@playwright/test";

/**
 * M1 (D-02): the certification decision panel, the certificate card and follow-up audits on the cycle record, against a
 * mocked API. The server decides everything (who may decide, readiness, numbering, dates); the live behaviour is in
 * scripts/certification_probe.py.
 */

type Posted = { path: string; body: Record<string, unknown> };
type Json = Record<string, unknown>;

const cycleBase = { id: 61, version: 7, reference: "CYC-NILE", clientId: 901, clientName: "Nile Foods", standardCode: "ISO9001",
  scope: "Packaged foods", siteCount: 2, openMajors: 0, readyForDecision: true, managedByMe: true, managerName: "Mona",
  phase: "READY_FOR_DECISION", decisionBlockers: [] as string[], decisionStatus: "AWAITING_DECISION", certificateNumber: null, certificateStatus: null };

const certificate = (status = "ACTIVE", version = 0, events: Json[] = [{ action: "ISSUED", reason: null, actorName: "Rania Reviewer", at: "2026-10-27T10:00:00" }]) => ({
  id: 5, version, number: "ISO9001-2026-0001", standardCode: "ISO9001", issuedOn: "2026-10-27", expiresOn: "2029-10-27", status,
  surveillanceMonths: 12, surveillance: [{ index: 1, dueOn: "2027-10-27", done: false, overdue: false }, { index: 2, dueOn: "2028-10-27", done: false, overdue: false }],
  recertificationDueBy: "2029-10-27", events,
});

function panel(over: Json = {}): Json {
  return { cycleId: 61, cycleVersion: 7, status: "AWAITING_DECISION", missingPolicies: [], mode: "INDEPENDENT_REVIEWER", requiredVotes: 1,
    validityMonths: 36, surveillanceMonths: 12, blockers: [], canVote: true, canGrant: true, cannotDecideReason: null,
    eligibleDeciders: [{ id: 12, name: "Rania Reviewer" }], nobodyReason: null, openRound: null, pastRounds: [], certificate: null,
    canManageCertificate: false, ...over };
}

async function mock(page: Page, initial: Json, options: { cycle?: Json } = {}) {
  const posted: Posted[] = [];
  const state = { panel: initial, cycle: { ...cycleBase, ...(options.cycle ?? {}) } as Json, answers: [] as { status: number; code: string }[],
    audits: [{ id: 80, version: 1, type: "STAGE1", plannedDate: "2026-09-01", auditorId: 7, auditorName: "Ahmed Auditor", status: "COMPLETED", completedOn: "2026-09-01" },
      { id: 81, version: 1, type: "STAGE2", plannedDate: "2026-10-01", auditorId: 7, auditorName: "Ahmed Auditor", status: "COMPLETED", completedOn: "2026-10-01" }] as Json[],
    onPost: null as null | ((path: string, body: Json) => Json | null) };
  await page.route("**/axelor-erp/ws/ioeti/**", async (route: Route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^.*\/ws\/ioeti/, "");
    const method = route.request().method();
    const body = method === "POST" ? (route.request().postDataJSON() as Json) ?? {} : {};
    const ok = (object: unknown, code = 200) => route.fulfill({ status: code, contentType: "application/json",
      body: JSON.stringify({ codeStatus: code, messageStatus: "ok", object }) });
    if (path === "/session") return route.fulfill({ status: 200, contentType: "application/json",
      body: JSON.stringify({ code: "rania", name: "Rania Reviewer", language: "ar", administrator: false }) });
    if (path === "/business-lines") return ok([{ id: 1, code: "ISO9001", nameAr: "أيزو 9001", nameEn: "ISO 9001", status: 2, sequence: 1, responsibleTeam: null }]);
    if (!path.startsWith("/certification")) return ok([]);
    const p = path.replace("/certification", "");
    if (method === "POST") {
      posted.push({ path: p, body });
      const refusal = state.answers.shift();
      if (refusal) return route.fulfill({ status: refusal.status, contentType: "application/json", body: JSON.stringify({ codeStatus: refusal.status,
        messageStatus: "x", error: { code: refusal.code, message: "raw server text", correlationId: "c0ffee09", fields: [] } }) });
      const next = state.onPost?.(p, body);
      if (next) return ok(next, p.endsWith("/audits") ? 201 : 200);
      return ok(state.panel);
    }
    if (p === "/cycles/61") return ok(state.cycle);
    if (p === "/cycles/61/audits") return ok(state.audits);
    if (p === "/cycles/61/timeline") return ok([{ at: "2026-10-01T09:00:00", kind: "CYCLE_OPENED", label: "CYC-NILE", actorName: null }]);
    if (p === "/cycles/61/decision") return ok(state.panel);
    if (p.startsWith("/cycles/61/eligible-auditors")) return ok([{ id: 7, name: "Ahmed Auditor" }, { id: 8, name: "Sara Auditor" }]);
    if (/^\/audits\/\d+\/nonconformities$/.test(p)) return ok([]);
    return route.fulfill({ status: 404, body: "{}" });
  });
  return { posted, state };
}

test("fail closed: without the scheme's policies the decision explains which ones are missing and offers no decision", async ({ page }) => {
  await mock(page, panel({ status: "BLOCKED_BY_POLICY", missingPolicies: ["cert.decision", "cert.cycle"], mode: null, requiredVotes: null,
    validityMonths: null, surveillanceMonths: null, blockers: ["POLICY_D02"], canVote: false, canGrant: false }),
  { cycle: { decisionBlockers: ["POLICY_D02"], decisionStatus: "BLOCKED_BY_POLICY" } });
  await page.goto("/#/certification/61");
  const section = page.locator(".cert-decision");
  await expect(section.getByRole("heading", { name: "قرار الاعتماد" })).toBeVisible();
  await expect(section).toContainText("القرار متوقف لحد ما سياسات الاعتماد لمعيار الدورة تتظبط");
  await expect(section).toContainText("ناقص تتظبط السياسات دي لمعيار ISO9001");
  await expect(section).toContainText("مين ياخد القرار: مراجع مستقل واحد أو لجنة (cert.decision)");
  await expect(section).toContainText("صلاحية الشهادة بالشهور وإيقاع تدقيق المراقبة (cert.cycle)");
  await expect(section.getByRole("link", { name: "فتح السياسات" })).toHaveAttribute("href", "#/policies");
  await expect(page.getByRole("radio")).toHaveCount(0);
  await expect(page.locator(".cert-readiness li.is-blocked")).toHaveCount(1);
  await expect(page.locator(".cert-readiness li.is-blocked")).toContainText("D-02");
  await expect(page.locator(".cert-hero-status")).toContainText("القرار متوقف على السياسات");
});

test("independent reviewer grants with a reason; the certificate card shows the number, validity and surveillance; suspend then withdraw", async ({ page }) => {
  const { posted, state } = await mock(page, panel());
  state.onPost = (p, body) => {
    if (p === "/cycles/61/decision") {
      state.cycle = { ...state.cycle, phase: "CERTIFIED", decisionStatus: "GRANTED", certificateNumber: "ISO9001-2026-0001", certificateStatus: "ACTIVE" };
      state.panel = panel({ status: "GRANTED", canVote: false, canGrant: false, certificate: certificate(), canManageCertificate: true,
        pastRounds: [{ id: 3, mode: "INDEPENDENT_REVIEWER", requiredVotes: 1, status: "DECIDED", outcome: "GRANT", decidedAt: "2026-10-27T10:00:00",
          votesCast: 1, grantVotes: 1, refuseVotes: 0, votes: [{ voterId: 12, voterName: "Rania Reviewer", vote: "GRANT", reason: String(body.reason), castAt: "2026-10-27T10:00:00" }] }] });
    } else if (p === "/cycles/61/certificate/suspend") {
      state.panel = { ...state.panel, certificate: certificate("SUSPENDED", 1) };
    } else if (p === "/cycles/61/certificate/withdraw") {
      state.panel = { ...state.panel, certificate: certificate("WITHDRAWN", 2) };
    }
    return state.panel;
  };
  await page.goto("/#/certification/61");
  const section = page.locator(".cert-decision");
  await expect(section).toContainText("مراجع مستقل واحد بياخد القرار ويكتب سببه.");
  await expect(section).toContainText("الشهادة صالحة 36 شهر من تاريخ إصدارها، وتدقيق المراقبة كل 12 شهر.");
  await expect(section.locator(".cert-people")).toContainText("Rania Reviewer");
  const submit = section.getByRole("button", { name: "سجّل قرار الاعتماد" });
  await expect(submit).toBeDisabled();
  await section.getByRole("radio", { name: "منح الشهادة" }).check();
  await expect(submit).toBeDisabled(); // a reason is required
  await section.getByLabel("سبب القرار").fill("Stage 2 completed, all majors closed and verified");
  await submit.click();
  await expect(page.locator(".cert-card-number")).toHaveText("ISO9001-2026-0001");
  await expect(page.locator(".cert-status-badge")).toHaveText("سارية");
  await expect(page.locator(".cert-schedule li")).toHaveCount(3); // two surveillance audits, then recertification
  await expect(page.locator(".cert-hero-status")).toContainText("ISO9001-2026-0001");
  await expect(page.locator(".cert-past-rounds")).toContainText("Stage 2 completed, all majors closed and verified");
  expect(posted[0]).toEqual({ path: "/cycles/61/decision", body: { version: 7, vote: "GRANT", reason: "Stage 2 completed, all majors closed and verified" } });
  await page.screenshot({ path: "test-results/ioeti-certification-decision.png", fullPage: true });

  await page.getByRole("button", { name: "إيقاف الشهادة" }).click();
  const dialog = page.getByRole("dialog", { name: "إيقاف الشهادة" });
  await expect(dialog).toContainText("الشهادة هتظهر موقوفة في التحقق العام");
  await expect(dialog.getByRole("button", { name: "تأكيد" })).toBeDisabled();
  await dialog.getByLabel("السبب (بيتسجل في سجل الشهادة)").fill("Client misused the certification mark");
  await dialog.getByRole("button", { name: "تأكيد" }).click();
  await expect(page.locator(".cert-status-badge")).toHaveText("موقوفة");
  expect(posted[1]).toEqual({ path: "/cycles/61/certificate/suspend", body: { version: 0, reason: "Client misused the certification mark" } });
  await expect(page.getByRole("button", { name: "إعادة تفعيل الشهادة" })).toBeVisible();
  await page.getByRole("button", { name: "سحب الشهادة" }).click();
  const withdraw = page.getByRole("dialog", { name: "سحب الشهادة" });
  await expect(withdraw).toContainText("السحب نهائي");
  await withdraw.getByLabel("السبب (بيتسجل في سجل الشهادة)").fill("No corrective action within the suspension period");
  await withdraw.getByRole("button", { name: "تأكيد" }).click();
  await expect(page.locator(".cert-status-badge")).toHaveText("مسحوبة");
  await expect(page.locator(".cert-card-actions")).toHaveCount(0); // withdrawal is final
  expect(posted[2]).toEqual({ path: "/cycles/61/certificate/withdraw", body: { version: 1, reason: "No corrective action within the suspension period" } });
  await expect(page.locator("body")).not.toContainText("raw server text");
});

test("committee: votes so far without revealing them, grant blocked by open majors, refusal answered by the server", async ({ page }) => {
  const { posted, state } = await mock(page, panel({ mode: "COMMITTEE", requiredVotes: 3, canGrant: false,
    blockers: ["OPEN_MAJOR_NONCONFORMITIES"], eligibleDeciders: [{ id: 12, name: "Rania Reviewer" }, { id: 14, name: "Omar Member" }],
    openRound: { id: 9, mode: "COMMITTEE", requiredVotes: 3, status: "OPEN", outcome: null, decidedAt: null, votesCast: 1, grantVotes: null, refuseVotes: null,
      votes: [{ voterId: 13, voterName: "Hany Member", vote: null, reason: null, castAt: "2026-10-26T12:00:00" }] } }),
  { cycle: { openMajors: 1, readyForDecision: false, phase: "FINDINGS_OPEN", decisionBlockers: ["OPEN_MAJOR_NONCONFORMITIES"] } });
  state.answers.push({ status: 409, code: "ALREADY_VOTED" });
  await page.goto("/#/certification/61");
  const section = page.locator(".cert-decision");
  await expect(section).toContainText("لجنة من 3 أعضاء مستقلين، كل عضو بيصوّت. القرار بالأغلبية، والتعادل بيعتبر رفض.");
  await expect(section.locator(".cert-round")).toContainText("1 من 3 أصوات");
  await expect(section.locator(".cert-round")).toContainText("Hany Member");
  await expect(section.locator(".cert-round .cert-vote-tag")).toHaveCount(0); // how members voted stays hidden while the round is open
  await expect(section).toContainText("الأصوات وأسبابها بتظهر لما كل الأعضاء يصوتوا");
  await expect(section.getByRole("radio", { name: "منح الشهادة" })).toBeDisabled();
  await expect(section).toContainText("المنح مش متاح لحد ما كل عدم المطابقات الجسيمة تتقفل. الرفض متاح.");
  await page.locator(".cert-decision").screenshot({ path: "test-results/ioeti-certification-committee.png" });
  await section.getByRole("radio", { name: "رفض المنح" }).check();
  await section.getByLabel("سبب القرار").fill("Major finding on traceability still open");
  await section.getByRole("button", { name: "سجّل صوتك في قرار الاعتماد" }).click();
  await expect(section.getByRole("alert")).toHaveText(/إنت صوّت خلاص في القرار ده/);
  expect(posted[0].body).toEqual({ version: 7, vote: "REFUSE", reason: "Major finding on traceability still open" });
  await expect(page.locator("body")).not.toContainText("raw server text");
});

test("impartiality and rights are explained: an auditor of the client, nobody eligible, and a reader without the right", async ({ page }) => {
  const { state } = await mock(page, panel({ canVote: false, canGrant: false, cannotDecideReason: "AUDITED_CLIENT", eligibleDeciders: [],
    nobodyReason: "ALL_AUDITED_CLIENT" }));
  await page.goto("/#/certification/61");
  const section = page.locator(".cert-decision");
  await expect(section).toContainText("إنت كنت مدقق عند العميل ده، فمينفعش تاخد قرار اعتماده (الحيادية).");
  await expect(section).toContainText("كل اللي عندهم صلاحية القرار كانوا مدققين عند العميل ده");
  await expect(section.getByRole("radio")).toHaveCount(0);
  // a reader without the decision right sees the certificate but no action on it
  state.panel = panel({ status: "GRANTED", canVote: false, canGrant: false, cannotDecideReason: null, certificate: certificate(), canManageCertificate: false });
  await page.reload();
  await expect(page.locator(".cert-card-number")).toHaveText("ISO9001-2026-0001");
  await expect(page.getByRole("button", { name: "إيقاف الشهادة" })).toHaveCount(0);
  await expect(page.locator(".cert-card")).toContainText("الإيقاف وإعادة التفعيل والسحب لصاحب صلاحية القرار");
});

test("surveillance is planned from the certificate's suggested due date; mobile keeps one column", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { posted, state } = await mock(page, panel({ status: "GRANTED", canVote: false, canGrant: false, certificate: certificate(), canManageCertificate: true }),
    { cycle: { phase: "CERTIFIED", decisionStatus: "GRANTED" } });
  state.onPost = (p, body) => {
    if (p !== "/cycles/61/audits") return null;
    const audit = { id: 90, version: 0, type: body.type, plannedDate: body.plannedDate, auditorId: body.auditorId, auditorName: "Sara Auditor", status: "PLANNED", completedOn: null };
    state.audits.push(audit);
    return audit;
  };
  await page.goto("/#/certification/61");
  const followUps = page.locator("section", { has: page.getByRole("heading", { name: "تدقيقات المراقبة وإعادة الاعتماد" }) });
  await expect(followUps).toBeVisible();
  const surveillance = followUps.locator(".cert-stage", { has: page.getByRole("heading", { name: "تدقيق مراقبة" }) });
  await expect(surveillance.getByLabel("تاريخ التدقيق المخطط")).toHaveValue("2027-10-27");
  await expect(surveillance).toContainText("الموعد المقترح للمراقبة الجاية");
  await surveillance.getByLabel("المدقق الرئيسي").selectOption("8");
  await surveillance.getByRole("button", { name: "تخطيط التدقيق" }).click();
  await expect(followUps.locator(".cert-stage", { hasText: "Sara Auditor" })).toBeVisible();
  expect(posted[0]).toEqual({ path: "/cycles/61/audits", body: { version: 7, type: "SURVEILLANCE", plannedDate: "2027-10-27", auditorId: 8 } });
  await expect(followUps.locator(".cert-stage", { has: page.getByRole("heading", { name: "تدقيق إعادة الاعتماد" }) })).toContainText("لازم يخلص قبل انتهاء الشهادة");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});

test("committee mode: suspending starts a committee vote; members approve or reject; a rejected change leaves the certificate as it was", async ({ page }) => {
  const committee = { mode: "COMMITTEE", requiredVotes: 3, status: "GRANTED", canVote: false, canGrant: false, certificate: certificate(),
    canManageCertificate: true, openChange: null, pastChanges: [] };
  const openChange = (over: Json = {}) => ({ id: 31, action: "SUSPEND", mode: "COMMITTEE", requiredVotes: 3, status: "OPEN", outcome: null,
    requestedById: 12, requestedByName: "Rania Reviewer", reason: "Client misused the certification mark", openedAt: "2026-10-29T09:00:00",
    decidedAt: null, votesCast: 1, approveVotes: null, rejectVotes: null,
    votes: [{ voterId: 12, voterName: "Rania Reviewer", vote: null, reason: null, castAt: "2026-10-29T09:00:00" }],
    canVote: false, cannotVoteReason: "ALREADY_VOTED", ...over });
  const { posted, state } = await mock(page, panel(committee), { cycle: { phase: "CERTIFIED", decisionStatus: "GRANTED" } });
  state.onPost = (p) => {
    if (p === "/cycles/61/certificate/suspend") state.panel = panel({ ...committee, openChange: openChange() });
    if (p === "/cycles/61/certificate/change-vote") {
      state.panel = panel({ ...committee, pastChanges: [openChange({ status: "DECIDED", outcome: "REJECTED", decidedAt: "2026-10-29T12:00:00", votesCast: 3,
        approveVotes: 1, rejectVotes: 2, canVote: false, cannotVoteReason: null,
        votes: [{ voterId: 12, voterName: "Rania Reviewer", vote: "APPROVE", reason: "Mark misuse confirmed", castAt: "2026-10-29T09:00:00" },
          { voterId: 13, voterName: "Hany Member", vote: "REJECT", reason: "Client already corrected the mark", castAt: "2026-10-29T10:00:00" },
          { voterId: 14, voterName: "Omar Member", vote: "REJECT", reason: "Evidence of correction received", castAt: "2026-10-29T12:00:00" }] })] });
    }
    return state.panel;
  };
  await page.goto("/#/certification/61");
  const card = page.locator(".cert-card");
  await expect(card).toContainText("في المعيار ده القرار بلجنة من 3 أعضاء، فالإيقاف وإعادة التفعيل والسحب كمان بيحتاجوا تصويت اللجنة.");
  await expect(page.getByRole("button", { name: "إيقاف الشهادة", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "اطلب إيقاف الشهادة (تصويت لجنة)" }).click();
  const dialog = page.getByRole("dialog", { name: "اطلب إيقاف الشهادة (تصويت لجنة)" });
  await expect(dialog).toContainText("الطلب ده هيفتح تصويت للجنة من 3 أعضاء، وصوتك بالموافقة هيتسجل أول صوت.");
  await dialog.getByLabel("السبب (بيتسجل في سجل الشهادة)").fill("Client misused the certification mark");
  await dialog.getByRole("button", { name: "ابدأ تصويت اللجنة" }).click();
  expect(posted[0]).toEqual({ path: "/cycles/61/certificate/suspend", body: { version: 0, reason: "Client misused the certification mark" } });

  // the round is open: the certificate has not changed, the requester waits, no other change can start
  const round = card.locator(".cert-change-round");
  await expect(round).toContainText("تصويت لجنة مفتوح: إيقاف الشهادة");
  await expect(round).toContainText("1 من 3 أصوات");
  await expect(round).toContainText("Client misused the certification mark");
  await expect(round).toContainText("إنت صوّت خلاص على الطلب ده؛ مستنيين باقي أعضاء اللجنة.");
  await expect(round.locator(".cert-vote-tag")).toHaveCount(0);
  await expect(page.locator(".cert-status-badge")).toHaveText("سارية");
  await expect(card.locator(".cert-card-actions")).toHaveCount(0);
  await expect(card).toContainText("مينفعش حد يطلب تغيير تاني على الشهادة لحد ما التصويت ده يخلص.");
  await page.locator(".cert-card").screenshot({ path: "test-results/ioeti-certification-change-vote.png" });

  // another member may vote: reject with a reason; the server refuses once (409 ALREADY_VOTED), then the vote closes the round
  state.panel = panel({ ...committee, openChange: openChange({ canVote: true, cannotVoteReason: null }) });
  state.answers.push({ status: 409, code: "ALREADY_VOTED" });
  await page.reload();
  const form = page.getByRole("form", { name: "صوتك على الطلب ده" });
  const submit = form.getByRole("button", { name: "سجّل صوتك" });
  await form.getByRole("radio", { name: "رافض التغيير" }).check();
  await expect(submit).toBeDisabled(); // a reason is required
  await form.getByLabel("سبب صوتك").fill("Client already corrected the mark");
  await submit.click();
  await expect(form.getByRole("alert")).toHaveText(/إنت صوّت خلاص في القرار ده/);
  await form.getByRole("button", { name: "سجّل صوتك" }).click();
  expect(posted[2]).toEqual({ path: "/cycles/61/certificate/change-vote", body: { version: 0, vote: "REJECT", reason: "Client already corrected the mark" } });
  const past = card.locator(".cert-past-rounds");
  await expect(past).toContainText("اترفض، والشهادة متغيرتش");
  await expect(past).toContainText("1 موافق · 2 رافض");
  await expect(past).toContainText("Evidence of correction received");
  await expect(page.locator(".cert-status-badge")).toHaveText("سارية");
  await expect(page.getByRole("button", { name: "اطلب سحب الشهادة (تصويت لجنة)" })).toBeVisible();

  // a different change while one is open is refused by the server with a plain explanation
  state.answers.push({ status: 409, code: "CHANGE_PENDING" });
  await page.getByRole("button", { name: "اطلب سحب الشهادة (تصويت لجنة)" }).click();
  const withdraw = page.getByRole("dialog", { name: "اطلب سحب الشهادة (تصويت لجنة)" });
  await withdraw.getByLabel("السبب (بيتسجل في سجل الشهادة)").fill("Repeated misuse");
  await withdraw.getByRole("button", { name: "ابدأ تصويت اللجنة" }).click();
  await expect(withdraw.getByRole("alert")).toHaveText(/فيه تصويت لجنة مفتوح على تغيير تاني للشهادة/);
  await expect(page.locator("body")).not.toContainText("raw server text");
});

test("committee mode in English: an approved change shows the new status and every vote with its reason", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("ioeti.ui.preferences.v1",
    JSON.stringify({ theme: "light", language: "en", density: "comfortable", navigation: "expanded" })));
  const decided = { id: 32, action: "SUSPEND", mode: "COMMITTEE", requiredVotes: 3, status: "DECIDED", outcome: "APPROVED", requestedById: 12,
    requestedByName: "Rania Reviewer", reason: "Client misused the certification mark", openedAt: "2026-10-29T09:00:00", decidedAt: "2026-10-29T12:00:00",
    votesCast: 3, approveVotes: 2, rejectVotes: 1, canVote: false, cannotVoteReason: null,
    votes: [{ voterId: 12, voterName: "Rania Reviewer", vote: "APPROVE", reason: "Mark misuse confirmed", castAt: "2026-10-29T09:00:00" },
      { voterId: 13, voterName: "Hany Member", vote: "APPROVE", reason: "Agreed", castAt: "2026-10-29T10:00:00" },
      { voterId: 14, voterName: "Omar Member", vote: "REJECT", reason: "Give one more week", castAt: "2026-10-29T12:00:00" }] };
  await mock(page, panel({ mode: "COMMITTEE", requiredVotes: 3, status: "GRANTED", canVote: false, canGrant: false,
    certificate: certificate("SUSPENDED", 1), canManageCertificate: true, openChange: null, pastChanges: [decided] }),
  { cycle: { phase: "CERTIFIED", decisionStatus: "GRANTED" } });
  await page.goto("/#/certification/61");
  const card = page.locator(".cert-card");
  await expect(page.locator(".cert-status-badge")).toHaveText("Suspended");
  const past = card.locator(".cert-past-rounds");
  await expect(past).toContainText("Earlier committee votes on certificate changes");
  await expect(past).toContainText("Approved and applied");
  await expect(past).toContainText("2 approve · 1 reject");
  await expect(past).toContainText("Give one more week");
  await expect(card.getByRole("button", { name: "Propose restoring (committee vote)" })).toBeVisible();
  await expect(card).toContainText("For this standard a committee of 3 decides");
});

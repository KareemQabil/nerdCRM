# Platform decision after the foundation phase

## Recommendation: **CONTINUE WITH AXELOR** (with three explicit conditions)

This is not a default preference for the initial choice: it rests on what was built and measured
in this phase.

### Evidence for
1. **It runs, reproducibly, unmodified.** open-suite-webapp v9.1.10 + AOS v9.1.10 build in 2.5 min
   and start on an empty PostgreSQL 16 database in ~4 min; upstream working trees stay clean while
   two IOETI modules are installed (`git status` empty).
2. **Clean extension points work in practice**: new entity with explicit `ioeti_` table, extension of
   the native `Opportunity` entity and form, a JPA listener enforcing an IOETI rule on the upstream
   entity, repository binding, data-init seeds with group/permission, Arabic translations, selection
   override, auto-discovered REST resource. 16/16 JUnit (incl. HSQLDB JPA), 16/16 API, 7/7 UI checks.
3. **The highest-risk IOETI domains have real upstream building blocks** (source + running app):
   Intervention (client visits, auditor assignment, statuses, offline, questionnaires with
   photo/signature) and QualityImprovement (System/Customer) for ISO operations; Contract with
   versions/renewal/`generateContractFromOpportunity`; SaleOrder versions/templates; Pricing
   formulas; Timetable milestone invoicing; DebtRecovery; GDPR; Studio/BPM/DMN (AGPL).
4. **Security fundamentals are server-side**: deny-by-default model permissions and record
   conditions are enforced on the generic API and on IOETI APIs (negative tests pass).
5. **Arabic RTL UI works** natively once Arabic is enabled as a user language.

### Evidence against / risks (accepted with mitigations)
| Risk | Evidence | Mitigation (condition) |
|---|---|---|
| Field-level rules not enforced on API reads | `field_permission_probe.py` | **Condition 1**: structural isolation of sensitive data + DTO APIs; restrict `/ws/rest` for non-admin roles |
| Upstream thread-bound user leak (privilege escalation after certain admin actions) | `record_filter_leak_probe.py`: 10–20 % leaks → 0 % with IOETI filter | `StaleThreadUserFilter` shipped in `ioeti-core`; **Condition 2**: report to Axelor and keep the probe in every release check |
| Arabic PDFs: Flying Saucer ignores RTL; AOS has no Arabic strings | PDF probe, UI test | **Condition 3**: Chromium-based renderer (Gotenberg) + scoped translation work package before quotes/contracts go live |
| Training, recruitment-for-clients, fundraising, certification cycle are new modules | reuse matrix | planned bounded contexts; budgeted in BACKLOG.md |
| No free migration scripts (Community) | Axelor forum | IOETI owns upgrade testing (UPGRADE_STRATEGY.md) |

### Why not switch to Open Mercato now
Measured against IOETI (not generic commerce), Open Mercato covers roughly 30–40 % of the needed
domains, lacks Arabic/RTL, has no record-ownership or field-level ACL, keeps MFA/SSO in a commercial
package, and its vendor states that production use requires an enterprise licence and certification.
Its repository and agent workflow are excellent; the transferable ideas are listed in
OPEN_MERCATO_RESEARCH.md §7 and should be adopted in the IOETI repository conventions.

### What would trigger "reconsider foundation"
- Axelor does not fix (or accept) the thread-user leak and the mitigation proves incomplete in
  production-like testing (e.g. non-JAX-RS paths leaking).
- The Arabic document pipeline (renderer + templates) cannot be integrated within the V1 budget.
- The certification-cycle module turns out to need deep changes to Intervention/Quality internals
  instead of extensions.

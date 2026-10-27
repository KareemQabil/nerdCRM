"""Shared clean-up for the live security probes (disposable test environments only)."""
import secrets
import time

from api_smoke_test import ok

USER = "com.axelor.auth.db.User"
MAIL_MESSAGE = "com.axelor.mail.db.MailMessage"
MAIL_FOLLOWER = "com.axelor.mail.db.MailFollower"
META_MENU = "com.axelor.meta.db.MetaMenu"
RESERVED_SEQUENCE = "com.axelor.apps.base.db.ReservedSequence"
TRACE_BACK = "com.axelor.apps.base.db.TraceBack"
# Wave 7b: in-app notices and outbox drafts point at users (absent before the module exists: no-op)
INBOX_NOTICE = "com.ioeti.automation.db.InboxNotice"
OUTBOUND = "com.ioeti.automation.db.OutboundMessage"
META_FILE = "com.axelor.meta.db.MetaFile"


def _delete_where(admin, model, domain):
    _, found = admin.call("POST", f"/ws/rest/{model}/search", {"fields": ["id"], "limit": 1000, "data": {"_domain": domain, "_archived": True}})
    for row in found.get("data") or []:
        admin.call("DELETE", f"/ws/rest/{model}/{row['id']}")


def delete_record(admin, model, rid):
    """Deletes a fixture. A test user is freed from what Axelor generated for it (change-tracking
    messages, follower rows incl. archived ones, personal menus, sequence reservations, logged
    errors); one that still cannot be deleted is blocked and stripped of its group, and reported
    as left over."""
    if ok(admin.call("DELETE", f"/ws/rest/{model}/{rid}")[1]):
        return True
    if model != USER:
        return False
    # change tracking is written by an asynchronous audit queue, so retry until it has settled
    for attempt in range(5):
        _delete_where(admin, MAIL_MESSAGE, f"self.author.id = {int(rid)}")
        _delete_where(admin, MAIL_FOLLOWER, f"self.user.id = {int(rid)}")
        _delete_where(admin, META_MENU, f"self.user.id = {int(rid)}")  # personal menus (team membership)
        # numbers reserved for records the test user created (e.g. partner references); test data only
        _delete_where(admin, RESERVED_SEQUENCE, f"self.createdBy.id = {int(rid)} OR self.updatedBy.id = {int(rid)}")
        _delete_where(admin, TRACE_BACK, f"self.createdBy.id = {int(rid)}")  # errors logged during its requests
        _delete_where(admin, INBOX_NOTICE, f"self.recipient.id = {int(rid)} OR self.actor.id = {int(rid)}")
        _delete_where(admin, OUTBOUND, f"self.author.id = {int(rid)}")
        # files Axelor generated during its requests (e.g. a product's barcode image)
        _delete_where(admin, META_FILE, f"self.createdBy.id = {int(rid)}")
        if ok(admin.call("DELETE", f"/ws/rest/{model}/{rid}")[1]):
            return True
        time.sleep(1 + attempt)
    _, cur = admin.call("POST", f"/ws/rest/{USER}/{rid}/fetch", {"fields": ["version"]})
    version = (cur.get("data") or [{}])[0].get("version") if isinstance(cur.get("data"), list) else None
    admin.call("POST", f"/ws/rest/{USER}/{rid}", {"data": {"id": rid, "version": version, "blocked": True,
                                                           "group": None, "password": secrets.token_hex(32)}})
    return False


def exists(admin, model, rid):
    _, body = admin.call("POST", f"/ws/rest/{model}/search", {"fields": ["id"], "data": {"_domain": f"self.id = {int(rid)}", "_archived": True}})
    return bool(body.get("data")) if ok(body) else True  # unknown answer counts as "still there"


def cleanup(admin, created, order):
    """Deletes `created` [(model, id)] in dependency `order`; returns (complete, leftovers)."""
    for model, rid in sorted(reversed(created), key=lambda c: order.get(c[0], 99)):
        delete_record(admin, model, rid)
    leftovers = [(m.split(".")[-1], r) for m, r in created if exists(admin, m, r)]
    return not leftovers, leftovers


CONTRACT, CONTRACT_VERSION = "com.axelor.apps.contract.db.Contract", "com.axelor.apps.contract.db.ContractVersion"


def delete_contract(admin, rid):
    """Deletes a test contract and its versions. The generic API cannot: Contract.currentContractVersion
    is mandatory and Hibernate fails on the one-to-one cascade (AssertionFailure). This runs SQL in the
    disposable PostgreSQL container (local/CI only) and deletes only this contract, the versions it
    points to and their lines. Returns True when the contract is gone."""
    from db_migrate import DATABASE, psql
    rid = int(rid)
    psql(DATABASE, f"""
        CREATE TEMP TABLE gone_versions ON COMMIT DROP AS
          SELECT current_contract_version AS id FROM contract_contract WHERE id = {rid}
          UNION SELECT next_version FROM contract_contract WHERE id = {rid}
          UNION SELECT id FROM contract_contract_version WHERE contract_history = {rid};
        DELETE FROM contract_contract_line WHERE contract_version IN (SELECT id FROM gone_versions);
        DELETE FROM contract_contract WHERE id = {rid};
        DELETE FROM contract_contract_version WHERE id IN (SELECT id FROM gone_versions);
""", single_transaction=True)
    return not exists(admin, CONTRACT, rid)


# Native accounting records of a fixture company, removed with SQL (TEST FIXTURE ONLY, disposable databases): ventilated
# invoices, their journal entries, payments and reconciliations cannot be removed through the API, by design.
_ACCOUNTING_PURGE = """
CREATE TEMP TABLE _inv AS SELECT id FROM account_invoice WHERE company = {cid};
CREATE TEMP TABLE _mv AS SELECT id FROM account_move WHERE company = {cid};
CREATE TEMP TABLE _ml AS SELECT id FROM account_move_line WHERE move IN (SELECT id FROM _mv);
CREATE TEMP TABLE _il AS SELECT id FROM account_invoice_line WHERE invoice IN (SELECT id FROM _inv);
CREATE TEMP TABLE _it AS SELECT id FROM account_invoice_term WHERE invoice IN (SELECT id FROM _inv) OR move_line IN (SELECT id FROM _ml);
UPDATE ioeti_ws_invoice_request SET invoice = NULL WHERE invoice IN (SELECT id FROM _inv);
UPDATE supplychain_timetable SET invoice = NULL, invoiced = false WHERE invoice IN (SELECT id FROM _inv);
UPDATE account_invoice SET move = NULL, old_move = NULL, payment_move = NULL, original_invoice = NULL, reject_move_line = NULL
  WHERE id IN (SELECT id FROM _inv);
UPDATE account_move SET invoice = NULL WHERE id IN (SELECT id FROM _mv);
CREATE TEMP TABLE _rc AS SELECT id FROM account_reconcile WHERE company = {cid}
  OR credit_move_line IN (SELECT id FROM _ml) OR debit_move_line IN (SELECT id FROM _ml);
CREATE TEMP TABLE _rg AS SELECT id FROM account_reconcile_group WHERE company = {cid};
CREATE TEMP TABLE _ip AS SELECT id FROM account_invoice_payment WHERE invoice IN (SELECT id FROM _inv) OR move IN (SELECT id FROM _mv);
DELETE FROM account_invoice_term_payment_reconcile_list WHERE reconcile_list IN (SELECT id FROM _rc)
  OR account_invoice_term_payment IN (SELECT id FROM account_invoice_term_payment WHERE invoice_term IN (SELECT id FROM _it) OR invoice_payment IN (SELECT id FROM _ip));
DELETE FROM account_invoice_term_payment WHERE invoice_term IN (SELECT id FROM _it) OR invoice_payment IN (SELECT id FROM _ip);
UPDATE account_invoice_payment SET imputed_by = NULL, reconcile = NULL, move = NULL WHERE id IN (SELECT id FROM _ip);
DELETE FROM account_invoice_payment WHERE id IN (SELECT id FROM _ip);
DELETE FROM account_reconcile_payment_move_line_distribution_list WHERE account_reconcile IN (SELECT id FROM _rc);
DELETE FROM account_payment_move_line_distribution WHERE reconcile IN (SELECT id FROM _rc) OR move_line IN (SELECT id FROM _ml);
UPDATE account_tax_payment_move_line SET reconcile = NULL WHERE reconcile IN (SELECT id FROM _rc);
DELETE FROM account_reconcile WHERE id IN (SELECT id FROM _rc);
UPDATE account_move_line SET reconcile_group = NULL WHERE id IN (SELECT id FROM _ml);
DELETE FROM account_reconcile_group WHERE id IN (SELECT id FROM _rg);
DELETE FROM account_tax_payment_move_line WHERE move_line IN (SELECT id FROM _ml);
DELETE FROM account_analytic_move_line WHERE move_line IN (SELECT id FROM _ml) OR invoice_line IN (SELECT id FROM _il);
DELETE FROM account_move_line_tax_line_set WHERE account_move_line IN (SELECT id FROM _ml);
DELETE FROM account_move_line_source_tax_line_set WHERE account_move_line IN (SELECT id FROM _ml);
DELETE FROM account_move_line_tax_line_before_reverse_set WHERE account_move_line IN (SELECT id FROM _ml);
DELETE FROM account_invoice_term WHERE id IN (SELECT id FROM _it);
DELETE FROM account_move_line WHERE id IN (SELECT id FROM _ml);
DELETE FROM account_move WHERE id IN (SELECT id FROM _mv);
DELETE FROM account_invoice_line_tax_line_set WHERE account_invoice_line IN (SELECT id FROM _il);
DELETE FROM account_invoice_line_tax WHERE invoice IN (SELECT id FROM _inv);
DELETE FROM account_invoice_note WHERE invoice IN (SELECT id FROM _inv);
DELETE FROM account_invoice_line WHERE id IN (SELECT id FROM _il);
DELETE FROM account_invoice WHERE id IN (SELECT id FROM _inv);
DELETE FROM account_accounting_situation WHERE company = {cid};
"""


def purge_company_accounting(psql, database, company_id):
    """Removes the native invoices, journal entries, payments and reconciliations of one fixture company."""
    psql(database, _ACCOUNTING_PURGE.format(cid=int(company_id)), single_transaction=True)

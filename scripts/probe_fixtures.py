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

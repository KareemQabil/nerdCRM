#!/usr/bin/env python3
"""G-007 gate: every field of every IOETI REST record is classified, and no response carries
RESTRICTED personal data.

Reads the Java sources (no server needed) and docs/security/pii-classification.json:
  - each component of each `record` in an IOETI REST package must have a class;
  - response records (…View, …Plan, …Response, SessionIdentity, FieldError) may not hold a RESTRICTED field;
  - a field whose name suggests contact data, identity numbers, money about a person or free text
    (email, phone, address, national id, salary, note, …) must be classified RESTRICTED;
  - registry entries for fields that no longer exist fail too, so the registry stays exact.
Exit 0 when clean. Report: logs/pii-dto-audit.json.
"""
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REGISTRY = os.path.join(ROOT, "docs", "security", "pii-classification.json")
CLASSES = {"REFERENCE", "BUSINESS", "PERSONAL", "RESTRICTED"}
RESPONSE = re.compile(r"(View|Plan|Response|SessionIdentity|FieldError)$")
SENSITIVE_NAME = re.compile(r"(?i)(e?mail|phone|mobile|fax|address|street|national|passport|birth|"
                            r"salary|wage|iban|bank|card|cv|resume|note|comment|description)")
RECORD = re.compile(r"\brecord\s+([A-Z]\w*)\s*\(([^)]*)\)", re.S)


def records():
    found = {}
    for base, _, files in os.walk(os.path.join(ROOT, "modules")):
        if os.sep + "src" + os.sep + "main" + os.sep not in base + os.sep or not re.search(r"ioeti-[a-z-]+", base):
            continue
        if not (base.endswith(os.sep + "rest") or base.endswith(os.sep + "web") or base.endswith(os.sep + "api")):
            continue
        for name in files:
            if not name.endswith(".java"):
                continue
            source = open(os.path.join(base, name), encoding="utf-8").read()
            source = re.sub(r"//[^\n]*|/\*.*?\*/", "", source, flags=re.S)
            for record, params in RECORD.findall(source):
                fields = [p.strip().split()[-1] for p in re.sub(r"<[^<>]*>", "", params).split(",") if p.strip()]
                found[record] = {"file": os.path.relpath(os.path.join(base, name), ROOT), "fields": fields}
    return found


def audit(found, registry):
    problems = []
    for record, info in sorted(found.items()):
        for field in info["fields"]:
            key = f"{record}.{field}"
            klass = registry.get(key)
            if klass not in CLASSES:
                problems.append(f"{key} ({info['file']}): not classified")
                continue
            if RESPONSE.search(record) and klass == "RESTRICTED":
                problems.append(f"{key}: RESTRICTED data in a response record")
            if SENSITIVE_NAME.search(field) and klass != "RESTRICTED":
                problems.append(f"{key}: name suggests restricted data but is classified {klass}")
    known = {f"{r}.{f}" for r, i in found.items() for f in i["fields"]}
    problems += [f"{key}: registry entry has no field any more" for key in sorted(set(registry) - known)]
    return problems


def negative_control():
    """The gate must reject each kind of violation; a gate that cannot fail proves nothing."""
    base = {"LeadView": {"file": "x", "fields": ["id", "name"]}, "LoseLead": {"file": "x", "fields": ["note"]}}
    registry = {"LeadView.id": "REFERENCE", "LeadView.name": "PERSONAL", "LoseLead.note": "RESTRICTED"}
    cases = {
        "clean input passes": (base, registry, 0),
        "unclassified field": ({**base, "LeadView": {"file": "x", "fields": ["id", "name", "score"]}}, registry, 1),
        "restricted field in a response": ({**base, "LeadView": {"file": "x", "fields": ["id", "name", "note"]}},
                                           {**registry, "LeadView.note": "RESTRICTED"}, 1),
        "contact field classified too low": ({**base, "LeadView": {"file": "x", "fields": ["id", "name", "email"]}},
                                             {**registry, "LeadView.email": "PERSONAL"}, 1),
        "stale registry entry": (base, {**registry, "LeadView.phone": "RESTRICTED"}, 1),
    }
    results = {name: len(audit(found, reg)) == expected for name, (found, reg, expected) in cases.items()}
    for name, passed in results.items():
        print(("PASS " if passed else "FAIL ") + "negative control: " + name)
    return all(results.values())


def main():
    registry = json.load(open(REGISTRY, encoding="utf-8"))["fields"]
    found = records()
    problems = audit(found, registry)
    controls_ok = negative_control()
    for problem in problems:
        print("FAIL " + problem)
    known = {f"{r}.{f}" for r, i in found.items() for f in i["fields"]}
    summary = {"records": len(found), "fields": len(known), "problems": problems, "negative_control": controls_ok,
               "by_class": {c: sum(1 for k in known if registry.get(k) == c) for c in sorted(CLASSES)}}
    print(f"\n{len(known)} fields in {len(found)} records · {len(problems)} problem(s) · {summary['by_class']}")
    os.makedirs(os.path.join(ROOT, "logs"), exist_ok=True)
    with open(os.path.join(ROOT, "logs", "pii-dto-audit.json"), "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2)
    return 0 if not problems and controls_ok else 1


if __name__ == "__main__":
    sys.exit(main())

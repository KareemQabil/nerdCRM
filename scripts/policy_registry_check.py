#!/usr/bin/env python3
"""Keeps the policy-decision list the app shows (modules/ioeti-reports/.../policy-decisions.json) equal
to the decision table in docs/decisions/OPEN_IOETI_POLICY_DECISIONS.md (ids, titles, statuses).
Usage: policy_registry_check.py [--write]   (--write regenerates the JSON from the document)."""
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOC = os.path.join(ROOT, "docs", "decisions", "OPEN_IOETI_POLICY_DECISIONS.md")
REGISTRY = os.path.join(ROOT, "modules", "ioeti-reports", "src", "main", "resources", "ioeti", "policy-decisions.json")


def from_document():
    rows = []
    for line in open(DOC, encoding="utf-8"):
        m = re.match(r"\|\s*(D-\d{2})\s*\|\s*\*\*(.+?)\*\*.*\|\s*([A-Z_]+)\s*\|\s*$", line.rstrip("\n"))
        if m:
            rows.append({"id": m.group(1), "title": m.group(2).rstrip("."), "status": m.group(3)})
    return rows


def main():
    expected = from_document()
    if len(expected) < 12:
        print(f"FAIL only {len(expected)} decisions parsed from the document")
        return 1
    if "--write" in sys.argv:
        with open(REGISTRY, "w", encoding="utf-8") as f:
            json.dump(expected, f, ensure_ascii=False, indent=2)
            f.write("\n")
        print(f"wrote {len(expected)} decisions")
        return 0
    actual = json.load(open(REGISTRY, encoding="utf-8"))
    if actual != expected:
        print("FAIL policy-decisions.json differs from the decision document; run scripts/policy_registry_check.py --write")
        return 1
    print(f"PASS {len(expected)} policy decisions match the document")
    return 0


if __name__ == "__main__":
    sys.exit(main())

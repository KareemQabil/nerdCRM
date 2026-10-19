# Contributing

1. Read [AGENTS.md](AGENTS.md) — it applies to humans too.
2. Branch from `main`: `feature/<module>-<short-topic>`, `fix/…`, `upgrade/aos-<version>`.
3. Keep changes inside `modules/ioeti-*`, `gradle/`, `infra/`, `scripts/`, `docs/`.
   Changes under `axelor-app/` are only allowed through the upgrade procedure
   (`docs/UPGRADE_STRATEGY.md`).
4. Code style: Google Java Format (same as upstream; `./gradlew spotlessApply` is available in the
   upstream build), 2-space XML indentation, English identifiers, Arabic only in `messages_ar.csv`
   and data.
5. Before opening a PR: `scripts/ioeti.sh build && scripts/ioeti.sh test`; with a running app:
   `scripts/ioeti.sh smoke` (and `ui` for view changes). Paste the result lines in the PR.
6. Commit messages: imperative subject, reference requirement IDs when available
   (e.g. `LEAD-ASSIGN-004: exclude users on leave from round robin`).
7. Never commit `.env`, `.local/`, logs, dumps or credentials.

# Platform source verification — what actually exists

## Pinned and directly enumerated

| Repository | Resolved immutable revision | Git blobs indexed | Domain XML | View XML | Source ledger |
|---|---|---:|---:|---:|---|
| Axelor Open Suite | `e7cbea53bae88d2540f59a70b09bf0f326f1022e` | 7,865 across 26 modules | 961 | 976 | [AOS module ledgers](source-ledger/) |
| Axelor Studio | `06d8c6dffa1f78a72009b560be53ba6e7b4047be`, tag `4.0.7` | 1,825 | 54 | 51 | [Studio](platform-source-ledger/axelor-studio-4_0_7.csv) |
| Axelor Utils | `69ce513f37a06a23fa3724a1f3f40a473034b02a`, tag `4.0.2` | 494 | 1 | 3 | [Utils](platform-source-ledger/axelor-utils-4_0_2.csv) |
| AOS Webapp wrapper | `dc50bc5a5c4006c607579bafa18c48564a951d6e` | 56 (nested AOS gitlink excluded as blob) | 0 | 0 | [Webapp](platform-source-ledger/open-suite-webapp-v9_1_10.csv) |

**Grand tracked-file index: 10,240 Git blobs.** This is a file inventory, not a claim that every source-level method was independently interpreted. 961 + 54 + 1 = 1,016 domain XML file occurrences and 976 + 51 + 3 = 1,030 view XML file occurrences; reused entities/extensions may appear in more than one file.

## Studio-specific architectural mapping (source-confirmed at version 4.0.7)

| Candidate feature | Native XML/domain | Source service entrypoints | Validation still needed |
|---|---|---|---|
| Custom dynamic fields | `src/main/resources/domains/MetaJsonField.xml`, `MetaJsonModel.xml` | `src/main/java/com/axelor/studio/web/MetaJsonFieldController.java`, `MetaJsonModelController.java` | API data protection, schema publication/rollback, dynamic field version and sync |
| Studio apps and menus | `StudioApp.xml`, `StudioMenu.xml`, `StudioDashboard.xml` | `.../service/constructor/StudioAppService.java` | Decide safe IOETI Admin abstraction, not expose native designer to every admin |
| BPM process models | `WkfModel.xml`, `WkfProcess.xml`, `WkfInstance.xml` | `.../bpm/service/init/ProcessEngineService.java`, `.../bpm/service/execution/WkfInstanceService.java` | Run lifecycle and multi-role approval PoC; migration versioning |
| BPM human tasks | `WkfTaskConfig.xml`, `WkfTaskMenu.xml` | `.../bpm/service/execution/WkfTaskService.java` | Delegation, scoped task APIs, retriable jobs and process compensation |
| DMN | `WkfDmnModel.xml`, `DmnTable.xml`, `DmnField.xml` | `.../dmn/service/DmnService.java`, `DmnDeploymentService.java` | Test versioned policies and model authoring, do not assume arbitrary logic safe |
| BPM migration/history | `WkfMigration.xml`, `WkfInstanceMigrationHistory.xml` | `.../bpm/service/migration/WkfMigrationService.java` | Running process compatibility, audit and rollback |
| Studio connectors | `WsConnector.xml`, `WsRequest.xml` | Studio connector services in ledger | External-secret boundaries, retry, SSRF and endpoint allowlists |

The table provides evidence of source symbols only. Upstream native UX is not the chosen product UI.

## Utils-specific correction

Pinned Utils `4.0.2` contains `com.axelor.utils.api.ConflictChecker.checkVersion` with `ClientErrorException(409)` and `HttpExceptionHandlerImpl` which maps that specific subtype. A plain `WebApplicationException` can fall into generic 500 handling. The separate flush-time optimistic locking and true transaction boundary still need dedicated PostgreSQL tests. Claude's backend branch should own that fix, not this mapping branch.

## AOP source gap (explicit)

The project pins Axelor Open Platform **8.2.5** by build dependencies. The tested public repository tree names `v8.2.5` and `8.2.5` did not resolve; using `master` would be version drift, so **no AOP internal claims have been upgraded to source-verified based on moving source**.

Required forensic follow-up on the exact resolved Gradle artifacts:
1. Record dependency coordinates and SHA256 for `axelor-core`, `axelor-web`, `axelor-front` and related jars.
2. Retrieve matching source JAR where available, inspect AuthUtils, filters, JpaSecurity, MetaPermission, MFA, REST, audit and session code.
3. Build a class/method map analogous to the Studio + Utils ledgers, complete with permissions and transaction test results.
4. Prove no cross-user data leaks in a secured stage environment.

This is a **required unresolved source-audit gap**, not an excuse to claim full code-level security verification.

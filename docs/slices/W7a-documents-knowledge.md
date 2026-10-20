# Wave 7a: document register with revisions, and the knowledge base (`ioeti-content`)

Status: LIVE_INTEGRATION_PASS on Axelor 9.1.10 + PostgreSQL 16 (`scripts/content_probe.py`, also in backend CI), with mocked browser contracts for the UI. Roles are fixtures; production roles are D-07.

Official document templates and their wording (quotation terms, contracts, training and ISO certificates) are owner decisions (**D-11, D-03, D-02**) and are not built. This slice stores and versions documents that people upload, and publishes internal knowledge articles.

## 1. Documents filed on records

A `RecordDocument` belongs to one business record:

| Subject | Native record |
|---|---|
| `LEAD` | `Lead` |
| `OPPORTUNITY` | `Opportunity` |
| `ACCOUNT` | `Partner` (customers and prospects only; any other partner answers 404) |
| `QUOTE` | `SaleOrder` |
| `CONTRACT` | `Contract` |
| `ENGAGEMENT` | `Project` |

**Access follows the record.** Documents have no permissions of their own:
- whoever may read the record may list its documents and download every revision;
- whoever may change it may file documents, add revisions and archive them;
- anyone else gets 404, so the existence of the record is not revealed.

| Endpoint | Notes |
|---|---|
| `GET /ws/ioeti/content/documents?subject=&subjectId=[&archived=true]` | The record's documents, with their revisions, newest first |
| `POST /ws/ioeti/content/documents` | `{subject, subjectId, title, kind, language, fileName, contentBase64, changeSummary}` → revision 1 |
| `GET /ws/ioeti/content/documents/{id}` | One document |
| `POST /ws/ioeti/content/documents/{id}/revisions` | `{version, fileName, contentBase64, changeSummary}` → the next revision. Stale → 409; content identical to the current revision → 422 `UNCHANGED`; archived → 422 `DOCUMENT_ARCHIVED` |
| `GET /ws/ioeti/content/documents/{id}/revisions/{n}/content` | The file, as an attachment |
| `POST /ws/ioeti/content/documents/{id}/archive` | `{version}`; nothing is deleted, and archived documents stay downloadable |

Kinds: `PROPOSAL`, `CONTRACT`, `EVIDENCE`, `REPORT`, `CORRESPONDENCE`, `OTHER`. Languages: `AR`, `EN`, `BILINGUAL`.

**Revisions are immutable.** Each revision keeps its own file, the file name, size, SHA-256, a change summary, who uploaded it and when. Numbers have no gaps: the document row is locked while a revision is added, and `(document, number)` is unique. Two uploads on the same document version give one 201 and one 409.

**Uploads are checked on the server:**
- at most 10 MiB;
- the extension must be one of PDF, DOCX, XLSX, PPTX, PNG, JPEG or TXT;
- the **detected content type must match the extension**. A program renamed `.pdf` or HTML saved as `.txt` → 422 `TYPE_MISMATCH`, and SVG is not allowed at all;
- the platform's own upload allow/deny configuration is applied as well (`MetaFiles.checkType`);
- file names lose any path and reserved characters and are cut to 120 characters.

Files are stored as native `MetaFile`s, not in the DMS tree, so they do not appear in the generic DMS screens.

**Downloads** carry these headers, and their content type comes from the checked extension, never from the client:
- `Content-Disposition: attachment` (with an RFC 5987 file name);
- `X-Content-Type-Options: nosniff`;
- `Cache-Control: private, no-store`;
- a sandboxing `Content-Security-Policy`.

Without a session, a browser is redirected to the login page (302) and a JSON client gets 401; no file bytes are returned either way.

## 2. Knowledge base

Articles use native permissions on `KnowledgeArticle`:
- read, to read published articles;
- write, to edit;
- create, to start one.

Categories need create on `KnowledgeCategory`. Their code is upper-cased and unique.

- An article has a **working copy** (English and Arabic title and text, category, optional business line) and **published revisions**, which are never changed.
- **Readers see only the latest published revision.** Drafts, edits since the last publish and the revision history are visible only to people who may edit the article. A draft or archived article answers 404 to a reader.
- `POST …/kb/articles/{id}/publish {version}` snapshots the working copy as revision *n + 1*. Nothing changed → 422 `UNCHANGED`. A title and a text in at least one language are required.
- An article tied to a business line is hidden from readers who cannot read that line.
- **Search** uses the same Arabic normalization as leads (alef and hamza forms, teh marbuta, alef maksura, diacritics, digits), applied to the published title and text.
- Text is stored and shown as plain text. The UI renders it with `white-space: pre-wrap`, so markup in an article is displayed, not executed.

Approving content before publishing and separating the author from the publisher are D-07; publishing records who published and when.

## 3. UI

- **Lead, account and opportunity pages (live mode):** a Documents panel. It lists the documents with a download link for the current revision and the earlier revisions, and lets the user file a document, upload a revision or archive. A file over 10 MiB is refused before upload, and the server repeats every check.
- **Knowledge base page (live mode):**
  - readers search with Arabic spelling variants, filter by category and line, and read both languages side by side;
  - editors get an Editing tab: new article, edit, publish, archive, categories and the published revision list.
- The fictional preview is unchanged.

## 4. Not done

| Item | Why |
|---|---|
| Official templates and generated documents: quotation and contract terms, training and ISO certificates | D-11, D-03, D-02 |
| E-signature and sending documents to clients | D-10, D-11 |
| Approval before publishing; separation of duties | D-07 |
| Retention and disposal rules for documents | D-07 (retention) |
| Virus scanning of uploads | Hosting decision (D-08); files are type-checked, never served inline, and never executed |
| Documents on certification cycles, training cohorts, job orders and donors | Those modules hold restricted data with their own rules; to be added per module after D-02/D-03/D-04/D-05 |

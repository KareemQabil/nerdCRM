-- Rollback of V013: drops the document tables. The uploaded files stay as native meta_file records
-- (and in the upload directory); remove them separately if the data must go.
DROP TABLE IF EXISTS public.ioeti_doc_revision;
DROP TABLE IF EXISTS public.ioeti_doc_document;
DROP SEQUENCE IF EXISTS public.ioeti_doc_document_seq;
DROP SEQUENCE IF EXISTS public.ioeti_doc_revision_seq;

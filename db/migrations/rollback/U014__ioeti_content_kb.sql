-- Rollback of V014: drops the knowledge base tables (data included). Articles and their published
-- revisions reference each other, so they are dropped in one statement.
DROP TABLE IF EXISTS public.ioeti_kb_revision, public.ioeti_kb_article, public.ioeti_kb_category;
DROP SEQUENCE IF EXISTS public.ioeti_kb_article_seq;
DROP SEQUENCE IF EXISTS public.ioeti_kb_category_seq;
DROP SEQUENCE IF EXISTS public.ioeti_kb_revision_seq;

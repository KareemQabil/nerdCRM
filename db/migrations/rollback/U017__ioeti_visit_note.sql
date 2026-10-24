-- Rollback of V017: drops the field visit log.
DROP TABLE IF EXISTS public.ioeti_ops_visit_note;
DROP SEQUENCE IF EXISTS public.ioeti_ops_visit_note_seq;

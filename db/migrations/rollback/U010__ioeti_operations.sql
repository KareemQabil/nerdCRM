-- Rollback of V010: drops the operations tables (data included), their sequences, and the project's handover link.
ALTER TABLE public.project_project DROP COLUMN IF EXISTS ioeti_handover;
DROP TABLE IF EXISTS public.ioeti_ops_handover_event;
DROP TABLE IF EXISTS public.ioeti_ops_handover_item;
DROP TABLE IF EXISTS public.ioeti_ops_requirement;
DROP TABLE IF EXISTS public.ioeti_ops_handover;
DROP SEQUENCE IF EXISTS public.ioeti_ops_handover_event_seq;
DROP SEQUENCE IF EXISTS public.ioeti_ops_handover_item_seq;
DROP SEQUENCE IF EXISTS public.ioeti_ops_handover_seq;
DROP SEQUENCE IF EXISTS public.ioeti_ops_requirement_seq;

-- Rollback of V016: drops the administration audit trail.
DROP TABLE IF EXISTS public.ioeti_admin_audit;
DROP SEQUENCE IF EXISTS public.ioeti_admin_audit_seq;

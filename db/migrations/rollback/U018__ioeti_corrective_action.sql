-- Rollback of V018: drops the corrective actions of quality issues.
DROP TABLE IF EXISTS public.ioeti_ops_corrective_action;
DROP SEQUENCE IF EXISTS public.ioeti_ops_corrective_action_seq;

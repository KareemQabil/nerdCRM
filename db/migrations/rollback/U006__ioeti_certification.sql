-- Rollback of V006: drops the client certification tables (data included) and their sequences.
DROP TABLE IF EXISTS public.ioeti_cert_nonconformity;
DROP TABLE IF EXISTS public.ioeti_cert_audit;
DROP TABLE IF EXISTS public.ioeti_cert_auditor_qual;
DROP TABLE IF EXISTS public.ioeti_cert_cycle;
DROP SEQUENCE IF EXISTS public.ioeti_cert_audit_seq;
DROP SEQUENCE IF EXISTS public.ioeti_cert_auditor_qual_seq;
DROP SEQUENCE IF EXISTS public.ioeti_cert_cycle_seq;
DROP SEQUENCE IF EXISTS public.ioeti_cert_nonconformity_seq;

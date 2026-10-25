-- Rollback of V019: Rollback of V019: drops the business-rule policy versions.
DROP TABLE IF EXISTS public.ioeti_policy_version;
DROP SEQUENCE IF EXISTS public.ioeti_policy_version_seq;

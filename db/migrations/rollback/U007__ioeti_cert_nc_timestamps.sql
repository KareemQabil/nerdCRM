-- Rollback of V007: drops the nonconformity response and closure timestamps.
ALTER TABLE public.ioeti_cert_nonconformity DROP COLUMN IF EXISTS responded_at;
ALTER TABLE public.ioeti_cert_nonconformity DROP COLUMN IF EXISTS closed_at;

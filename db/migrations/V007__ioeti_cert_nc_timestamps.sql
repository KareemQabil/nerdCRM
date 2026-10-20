-- Wave 4C: Nonconformity.respondedAt and closedAt, for the certification audit history (timeline).
ALTER TABLE public.ioeti_cert_nonconformity ADD COLUMN IF NOT EXISTS closed_at timestamp(6) without time zone;
ALTER TABLE public.ioeti_cert_nonconformity ADD COLUMN IF NOT EXISTS responded_at timestamp(6) without time zone;

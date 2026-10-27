-- Rollback of V028: drops the D-03 training tables (refunds, invoice links, national IDs, certificates) and the enrolment's
-- assessment and cancellation-date columns. Credit notes and invoices stay in accounting; only their links to enrolments go.
DROP TABLE IF EXISTS public.ioeti_training_refund;
DROP TABLE IF EXISTS public.ioeti_training_fee;
DROP TABLE IF EXISTS public.ioeti_training_national_id;
DROP TABLE IF EXISTS public.ioeti_training_certificate;
DROP SEQUENCE IF EXISTS public.ioeti_training_refund_seq;
DROP SEQUENCE IF EXISTS public.ioeti_training_fee_seq;
DROP SEQUENCE IF EXISTS public.ioeti_training_national_id_seq;
DROP SEQUENCE IF EXISTS public.ioeti_training_certificate_seq;
ALTER TABLE public.ioeti_training_enrollment DROP COLUMN IF EXISTS assessed_by;
ALTER TABLE public.ioeti_training_enrollment DROP COLUMN IF EXISTS cancelled_on;
ALTER TABLE public.ioeti_training_enrollment DROP COLUMN IF EXISTS assessed_on;
ALTER TABLE public.ioeti_training_enrollment DROP COLUMN IF EXISTS assessment_score;

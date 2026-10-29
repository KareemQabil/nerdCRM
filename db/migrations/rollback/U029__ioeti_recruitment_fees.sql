-- Rollback of V029: drops the fee / credit requests and the restricted offer terms (data included), and the client agreement
-- and guarantee columns of placements (their constraints and indexes go with them).
DROP TABLE IF EXISTS public.ioeti_rec_fee_request;
DROP TABLE IF EXISTS public.ioeti_rec_offer_private;
DROP SEQUENCE IF EXISTS public.ioeti_rec_fee_request_seq;
DROP SEQUENCE IF EXISTS public.ioeti_rec_offer_private_seq;
ALTER TABLE public.ioeti_rec_placement DROP COLUMN IF EXISTS agreement_policy;
ALTER TABLE public.ioeti_rec_placement DROP COLUMN IF EXISTS replacement_of;
ALTER TABLE public.ioeti_rec_placement DROP COLUMN IF EXISTS exit_outcome_select;
ALTER TABLE public.ioeti_rec_placement DROP COLUMN IF EXISTS exit_reason_select;
ALTER TABLE public.ioeti_rec_placement DROP COLUMN IF EXISTS exited_on;
ALTER TABLE public.ioeti_rec_placement DROP COLUMN IF EXISTS fee_percent;
ALTER TABLE public.ioeti_rec_placement DROP COLUMN IF EXISTS fee_waived;
ALTER TABLE public.ioeti_rec_placement DROP COLUMN IF EXISTS guarantee_days;
ALTER TABLE public.ioeti_rec_placement DROP COLUMN IF EXISTS guarantee_ends_on;
ALTER TABLE public.ioeti_rec_placement DROP COLUMN IF EXISTS invoice_on_select;
ALTER TABLE public.ioeti_rec_placement DROP COLUMN IF EXISTS refund_percent;
ALTER TABLE public.ioeti_rec_placement DROP COLUMN IF EXISTS replacement_select;

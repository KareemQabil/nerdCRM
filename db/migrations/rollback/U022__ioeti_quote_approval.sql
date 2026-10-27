-- Rollback of V022: removes the approval, validity and sending columns of quotations and the decision columns of review
-- requests (finalized quotations stay finalized natively; only the record of who approved and sent them goes).
ALTER TABLE public.ioeti_ws_review DROP COLUMN IF EXISTS subject_record_version;
ALTER TABLE public.ioeti_ws_review DROP COLUMN IF EXISTS decision_note;
ALTER TABLE public.ioeti_ws_review DROP COLUMN IF EXISTS decided_at;
ALTER TABLE public.ioeti_ws_review DROP COLUMN IF EXISTS approver_code;
ALTER TABLE public.sale_sale_order DROP COLUMN IF EXISTS ioeti_validity_policy;
ALTER TABLE public.sale_sale_order DROP COLUMN IF EXISTS ioeti_sent_note;
ALTER TABLE public.sale_sale_order DROP COLUMN IF EXISTS ioeti_sent_by;
ALTER TABLE public.sale_sale_order DROP COLUMN IF EXISTS ioeti_sent_at;
ALTER TABLE public.sale_sale_order DROP COLUMN IF EXISTS ioeti_discount_percent;
ALTER TABLE public.sale_sale_order DROP COLUMN IF EXISTS ioeti_approved_by;
ALTER TABLE public.sale_sale_order DROP COLUMN IF EXISTS ioeti_approved_at;
ALTER TABLE public.sale_sale_order DROP COLUMN IF EXISTS ioeti_approval_tier;
ALTER TABLE public.sale_sale_order DROP COLUMN IF EXISTS ioeti_approval_policy;

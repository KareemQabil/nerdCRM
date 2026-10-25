-- D-11 (signed 2026-10-25): quotation approval. A quotation records the approval policy version and tier it was finalized
-- under, the discount it was judged on, who approved and when, its validity policy version, and when the rep sent it; a review
-- request records the record version asked about, the tier's approver and the decision. Mirrors the schema Hibernate generates
-- from modules/ioeti-commercial/.../domains/SaleOrder.xml and modules/ioeti-workspace/.../domains/Workspace.xml (verified by
-- scripts/db_migrate.py verify). Idempotent: safe on a database where the objects already exist.
ALTER TABLE public.sale_sale_order ADD COLUMN IF NOT EXISTS ioeti_approval_policy bigint;
ALTER TABLE public.sale_sale_order ADD COLUMN IF NOT EXISTS ioeti_approval_tier character varying(20);
ALTER TABLE public.sale_sale_order ADD COLUMN IF NOT EXISTS ioeti_approved_at timestamp(6) without time zone;
ALTER TABLE public.sale_sale_order ADD COLUMN IF NOT EXISTS ioeti_approved_by bigint;
ALTER TABLE public.sale_sale_order ADD COLUMN IF NOT EXISTS ioeti_discount_percent numeric(10,2);
ALTER TABLE public.sale_sale_order ADD COLUMN IF NOT EXISTS ioeti_sent_at timestamp(6) without time zone;
ALTER TABLE public.sale_sale_order ADD COLUMN IF NOT EXISTS ioeti_sent_by bigint;
ALTER TABLE public.sale_sale_order ADD COLUMN IF NOT EXISTS ioeti_sent_note character varying(300);
ALTER TABLE public.sale_sale_order ADD COLUMN IF NOT EXISTS ioeti_validity_policy bigint;
ALTER TABLE public.ioeti_ws_review ADD COLUMN IF NOT EXISTS approver_code character varying(20);
ALTER TABLE public.ioeti_ws_review ADD COLUMN IF NOT EXISTS decided_at timestamp(6) without time zone;
ALTER TABLE public.ioeti_ws_review ADD COLUMN IF NOT EXISTS decision_note character varying(500);
ALTER TABLE public.ioeti_ws_review ADD COLUMN IF NOT EXISTS subject_record_version integer;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_4b175e0baogrsyoxdkmo3vsbn') THEN
    ALTER TABLE public.sale_sale_order ADD CONSTRAINT fk_4b175e0baogrsyoxdkmo3vsbn FOREIGN KEY (ioeti_approval_policy) REFERENCES public.ioeti_policy_version(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_1rjb5o7mtdt8fwxen2fjk31fb') THEN
    ALTER TABLE public.sale_sale_order ADD CONSTRAINT fk_1rjb5o7mtdt8fwxen2fjk31fb FOREIGN KEY (ioeti_approved_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_n0vrqga22s8unor7w4y2xxjqr') THEN
    ALTER TABLE public.sale_sale_order ADD CONSTRAINT fk_n0vrqga22s8unor7w4y2xxjqr FOREIGN KEY (ioeti_sent_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_a934b4trxa4ayisox9pyry70h') THEN
    ALTER TABLE public.sale_sale_order ADD CONSTRAINT fk_a934b4trxa4ayisox9pyry70h FOREIGN KEY (ioeti_validity_policy) REFERENCES public.ioeti_policy_version(id);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS sale_sale_order_ioeti_approval_policy_idx ON public.sale_sale_order USING btree (ioeti_approval_policy);
CREATE INDEX IF NOT EXISTS sale_sale_order_ioeti_approved_by_idx ON public.sale_sale_order USING btree (ioeti_approved_by);
CREATE INDEX IF NOT EXISTS sale_sale_order_ioeti_sent_by_idx ON public.sale_sale_order USING btree (ioeti_sent_by);
CREATE INDEX IF NOT EXISTS sale_sale_order_ioeti_validity_policy_idx ON public.sale_sale_order USING btree (ioeti_validity_policy);

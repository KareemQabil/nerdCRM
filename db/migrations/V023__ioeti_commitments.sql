-- D-11 (signed 2026-10-25): binding commitments on uploaded evidence. A quotation records the client's acceptance (a signed
-- quotation or a purchase order) and the evidence document revision and hash it was recorded on; a contract records the
-- signature evidence it was activated on, when it was signed, who activated it and when, and the signatory policy version.
-- Mirrors the schema Hibernate generates from modules/ioeti-commercial/.../domains/SaleOrder.xml and Contract.xml (verified by
-- scripts/db_migrate.py verify). Idempotent: safe on a database where the objects already exist.
ALTER TABLE public.sale_sale_order ADD COLUMN IF NOT EXISTS ioeti_acceptance_document bigint;
ALTER TABLE public.sale_sale_order ADD COLUMN IF NOT EXISTS ioeti_acceptance_kind character varying(20);
ALTER TABLE public.sale_sale_order ADD COLUMN IF NOT EXISTS ioeti_acceptance_reference character varying(100);
ALTER TABLE public.sale_sale_order ADD COLUMN IF NOT EXISTS ioeti_acceptance_revision integer;
ALTER TABLE public.sale_sale_order ADD COLUMN IF NOT EXISTS ioeti_acceptance_sha256 character varying(64);
ALTER TABLE public.sale_sale_order ADD COLUMN IF NOT EXISTS ioeti_accepted_at timestamp(6) without time zone;
ALTER TABLE public.sale_sale_order ADD COLUMN IF NOT EXISTS ioeti_accepted_by bigint;
ALTER TABLE public.sale_sale_order ADD COLUMN IF NOT EXISTS ioeti_accepted_on date;
ALTER TABLE public.contract_contract ADD COLUMN IF NOT EXISTS ioeti_activated_at timestamp(6) without time zone;
ALTER TABLE public.contract_contract ADD COLUMN IF NOT EXISTS ioeti_activated_by bigint;
ALTER TABLE public.contract_contract ADD COLUMN IF NOT EXISTS ioeti_signatory_policy bigint;
ALTER TABLE public.contract_contract ADD COLUMN IF NOT EXISTS ioeti_signature_document bigint;
ALTER TABLE public.contract_contract ADD COLUMN IF NOT EXISTS ioeti_signature_revision integer;
ALTER TABLE public.contract_contract ADD COLUMN IF NOT EXISTS ioeti_signature_sha256 character varying(64);
ALTER TABLE public.contract_contract ADD COLUMN IF NOT EXISTS ioeti_signed_on date;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_411jvmavojxscy241qlmxdxwx') THEN
    ALTER TABLE public.sale_sale_order ADD CONSTRAINT fk_411jvmavojxscy241qlmxdxwx FOREIGN KEY (ioeti_accepted_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_3jw0j48tbrp9nri2vcyi2vtaa') THEN
    ALTER TABLE public.contract_contract ADD CONSTRAINT fk_3jw0j48tbrp9nri2vcyi2vtaa FOREIGN KEY (ioeti_activated_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_e5p9kteysu1jd7jdu0o9ff6lm') THEN
    ALTER TABLE public.contract_contract ADD CONSTRAINT fk_e5p9kteysu1jd7jdu0o9ff6lm FOREIGN KEY (ioeti_signatory_policy) REFERENCES public.ioeti_policy_version(id);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS sale_sale_order_ioeti_accepted_by_idx ON public.sale_sale_order USING btree (ioeti_accepted_by);
CREATE INDEX IF NOT EXISTS contract_contract_ioeti_activated_by_idx ON public.contract_contract USING btree (ioeti_activated_by);
CREATE INDEX IF NOT EXISTS contract_contract_ioeti_signatory_policy_idx ON public.contract_contract USING btree (ioeti_signatory_policy);

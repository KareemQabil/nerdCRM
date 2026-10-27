-- D-06 (signed 2026-10-25): finance issues the invoice of a requested milestone in Axelor accounting. The request records the
-- native invoice, who issued it, when, and the payment-terms policy version it was issued under. Mirrors the schema Hibernate
-- generates from modules/ioeti-workspace/src/main/resources/domains/Workspace.xml (verified by scripts/db_migrate.py verify).
-- Idempotent: safe on a database where the objects already exist.
ALTER TABLE public.ioeti_ws_invoice_request ADD COLUMN IF NOT EXISTS invoice bigint;
ALTER TABLE public.ioeti_ws_invoice_request ADD COLUMN IF NOT EXISTS issued_at timestamp(6) without time zone;
ALTER TABLE public.ioeti_ws_invoice_request ADD COLUMN IF NOT EXISTS issued_by bigint;
ALTER TABLE public.ioeti_ws_invoice_request ADD COLUMN IF NOT EXISTS payment_terms_policy bigint;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_1ijekrbno5ftw7q4x1e4uq40j') THEN
    ALTER TABLE public.ioeti_ws_invoice_request ADD CONSTRAINT fk_1ijekrbno5ftw7q4x1e4uq40j FOREIGN KEY (invoice) REFERENCES public.account_invoice(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_btr5ephmwnqoj1jhwh62pdgmw') THEN
    ALTER TABLE public.ioeti_ws_invoice_request ADD CONSTRAINT fk_btr5ephmwnqoj1jhwh62pdgmw FOREIGN KEY (issued_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_nq18u6pm7y698d3e8snkddso2') THEN
    ALTER TABLE public.ioeti_ws_invoice_request ADD CONSTRAINT fk_nq18u6pm7y698d3e8snkddso2 FOREIGN KEY (payment_terms_policy) REFERENCES public.ioeti_policy_version(id);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS ioeti_ws_invoice_request_invoice_idx ON public.ioeti_ws_invoice_request USING btree (invoice);
CREATE INDEX IF NOT EXISTS ioeti_ws_invoice_request_issued_by_idx ON public.ioeti_ws_invoice_request USING btree (issued_by);
CREATE INDEX IF NOT EXISTS ioeti_ws_invoice_request_payment_terms_policy_idx ON public.ioeti_ws_invoice_request USING btree (payment_terms_policy);

-- D-02 (owner decision confirmed 2026-10-29): suspending, restoring and withdrawing a certificate follow the same decision
-- mode as granting. A decision round (ioeti_cert_decision) can now be a certificate CHANGE round: the action (SUSPEND,
-- RESTORE or WITHDRAW; NULL for a grant round), the certificate, who asked and why. Votes stay in ioeti_cert_vote.
-- Mirrors the schema Hibernate generates from domains/Certification.xml (verified by scripts/db_migrate.py verify);
-- constraint names are Hibernate's hashed names (md5 of "table`t`column`c`" in base 35), as in V027.
-- Idempotent: safe on a database where the objects already exist.
ALTER TABLE public.ioeti_cert_decision ADD COLUMN IF NOT EXISTS change_action character varying(20);
ALTER TABLE public.ioeti_cert_decision ADD COLUMN IF NOT EXISTS request_reason text;
ALTER TABLE public.ioeti_cert_decision ADD COLUMN IF NOT EXISTS certificate bigint;
ALTER TABLE public.ioeti_cert_decision ADD COLUMN IF NOT EXISTS requested_by bigint;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_lk19y2hupvdlm2s9w6iugqepn') THEN
    ALTER TABLE public.ioeti_cert_decision ADD CONSTRAINT fk_lk19y2hupvdlm2s9w6iugqepn FOREIGN KEY (certificate) REFERENCES public.ioeti_cert_certificate(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_msxp8x5kekt4vcvl99cn1pa69') THEN
    ALTER TABLE public.ioeti_cert_decision ADD CONSTRAINT fk_msxp8x5kekt4vcvl99cn1pa69 FOREIGN KEY (requested_by) REFERENCES public.auth_user(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ioeti_cert_decision_certificate_idx ON public.ioeti_cert_decision USING btree (certificate);
CREATE INDEX IF NOT EXISTS ioeti_cert_decision_requested_by_idx ON public.ioeti_cert_decision USING btree (requested_by);

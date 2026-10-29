-- Rollback of V031: removes certificate change rounds (rows whose change_action is set, with their votes) and the columns
-- that describe them. Grant rounds and their votes are kept.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'ioeti_cert_decision' AND column_name = 'change_action') THEN
    DELETE FROM public.ioeti_cert_vote WHERE decision IN (SELECT id FROM public.ioeti_cert_decision WHERE change_action IS NOT NULL);
    DELETE FROM public.ioeti_cert_decision WHERE change_action IS NOT NULL;
  END IF;
END $$;
DROP INDEX IF EXISTS public.ioeti_cert_decision_requested_by_idx;
DROP INDEX IF EXISTS public.ioeti_cert_decision_certificate_idx;
ALTER TABLE IF EXISTS public.ioeti_cert_decision DROP CONSTRAINT IF EXISTS fk_msxp8x5kekt4vcvl99cn1pa69;
ALTER TABLE IF EXISTS public.ioeti_cert_decision DROP CONSTRAINT IF EXISTS fk_lk19y2hupvdlm2s9w6iugqepn;
ALTER TABLE IF EXISTS public.ioeti_cert_decision DROP COLUMN IF EXISTS requested_by;
ALTER TABLE IF EXISTS public.ioeti_cert_decision DROP COLUMN IF EXISTS certificate;
ALTER TABLE IF EXISTS public.ioeti_cert_decision DROP COLUMN IF EXISTS request_reason;
ALTER TABLE IF EXISTS public.ioeti_cert_decision DROP COLUMN IF EXISTS change_action;

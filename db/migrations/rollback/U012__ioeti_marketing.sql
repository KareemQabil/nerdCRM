-- Rollback of V012: drops the marketing tables and the lead search key.
ALTER TABLE public.crm_lead DROP COLUMN IF EXISTS ioeti_search_key;
DROP TABLE IF EXISTS public.ioeti_mkt_consent;
DROP TABLE IF EXISTS public.ioeti_mkt_saved_view;
DROP SEQUENCE IF EXISTS public.ioeti_mkt_consent_seq;
DROP SEQUENCE IF EXISTS public.ioeti_mkt_saved_view_seq;

-- Rollback of V026: drops the routing log and the governorate and away columns (leads keep the owners routing gave them).
DROP TABLE IF EXISTS public.ioeti_lead_routing;
DROP SEQUENCE IF EXISTS public.ioeti_lead_routing_seq;
ALTER TABLE public.auth_user DROP COLUMN IF EXISTS ioeti_away_until;
ALTER TABLE public.auth_user DROP COLUMN IF EXISTS ioeti_away_from;
ALTER TABLE public.crm_lead DROP COLUMN IF EXISTS ioeti_governorate;

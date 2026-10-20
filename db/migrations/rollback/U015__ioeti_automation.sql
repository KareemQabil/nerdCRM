-- Rollback of V015: drops the notice and outbox tables.
DROP TABLE IF EXISTS public.ioeti_auto_notification;
DROP TABLE IF EXISTS public.ioeti_auto_outbound;
DROP SEQUENCE IF EXISTS public.ioeti_auto_notification_seq;
DROP SEQUENCE IF EXISTS public.ioeti_auto_outbound_seq;

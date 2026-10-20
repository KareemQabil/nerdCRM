-- Rollback of V011: drops the workspace tables (data included), their sequences, and the opportunity's renewal link.
ALTER TABLE public.crm_opportunity DROP COLUMN IF EXISTS ioeti_renewal_of;
DROP TABLE IF EXISTS public.ioeti_ws_invoice_request;
DROP TABLE IF EXISTS public.ioeti_ws_review_event;
DROP TABLE IF EXISTS public.ioeti_ws_review;
DROP SEQUENCE IF EXISTS public.ioeti_ws_invoice_request_seq;
DROP SEQUENCE IF EXISTS public.ioeti_ws_review_event_seq;
DROP SEQUENCE IF EXISTS public.ioeti_ws_review_seq;

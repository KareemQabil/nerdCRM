-- Rollback of V027: drops the certification decision, vote, certificate and certificate-event tables (data included) and their sequences.
DROP TABLE IF EXISTS public.ioeti_cert_certificate_event;
DROP TABLE IF EXISTS public.ioeti_cert_certificate;
DROP TABLE IF EXISTS public.ioeti_cert_vote;
DROP TABLE IF EXISTS public.ioeti_cert_decision;
DROP SEQUENCE IF EXISTS public.ioeti_cert_certificate_event_seq;
DROP SEQUENCE IF EXISTS public.ioeti_cert_certificate_seq;
DROP SEQUENCE IF EXISTS public.ioeti_cert_vote_seq;
DROP SEQUENCE IF EXISTS public.ioeti_cert_decision_seq;

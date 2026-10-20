-- Rollback of V008: drops the agency recruitment tables (data included) and their sequences.
DROP TABLE IF EXISTS public.ioeti_rec_candidate_private;
DROP TABLE IF EXISTS public.ioeti_rec_consent;
DROP TABLE IF EXISTS public.ioeti_rec_fee_milestone;
DROP TABLE IF EXISTS public.ioeti_rec_interview;
DROP TABLE IF EXISTS public.ioeti_rec_placement;
DROP TABLE IF EXISTS public.ioeti_rec_application;
DROP TABLE IF EXISTS public.ioeti_rec_candidate;
DROP TABLE IF EXISTS public.ioeti_rec_job_order;
DROP SEQUENCE IF EXISTS public.ioeti_rec_application_seq;
DROP SEQUENCE IF EXISTS public.ioeti_rec_candidate_private_seq;
DROP SEQUENCE IF EXISTS public.ioeti_rec_candidate_seq;
DROP SEQUENCE IF EXISTS public.ioeti_rec_consent_seq;
DROP SEQUENCE IF EXISTS public.ioeti_rec_fee_milestone_seq;
DROP SEQUENCE IF EXISTS public.ioeti_rec_interview_seq;
DROP SEQUENCE IF EXISTS public.ioeti_rec_job_order_seq;
DROP SEQUENCE IF EXISTS public.ioeti_rec_placement_seq;

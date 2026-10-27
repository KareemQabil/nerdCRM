-- Rollback of V025: removes the response-target schedule and the recorded misses (notices already sent stay in the inboxes).
DELETE FROM public.meta_schedule WHERE job = 'com.ioeti.businessline.job.LeadResponseJob';
DROP TABLE IF EXISTS public.ioeti_lead_response_miss;
DROP SEQUENCE IF EXISTS public.ioeti_lead_response_miss_seq;

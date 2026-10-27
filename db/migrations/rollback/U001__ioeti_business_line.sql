-- Rollback of V001. Removes the business line registry and the opportunity line link.
ALTER TABLE public.crm_opportunity DROP COLUMN IF EXISTS ioeti_business_line;
DROP TABLE IF EXISTS public.ioeti_business_line;
DROP SEQUENCE IF EXISTS public.ioeti_business_line_seq;

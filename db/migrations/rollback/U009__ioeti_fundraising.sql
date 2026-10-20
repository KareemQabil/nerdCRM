-- Rollback of V009: drops the fundraising tables (data included) and their sequences.
DROP TABLE IF EXISTS public.ioeti_fund_collection;
DROP TABLE IF EXISTS public.ioeti_fund_deliverable;
DROP TABLE IF EXISTS public.ioeti_fund_donor_private;
DROP TABLE IF EXISTS public.ioeti_fund_stewardship;
DROP TABLE IF EXISTS public.ioeti_fund_installment;
DROP TABLE IF EXISTS public.ioeti_fund_commitment;
DROP TABLE IF EXISTS public.ioeti_fund_opportunity;
DROP TABLE IF EXISTS public.ioeti_fund_donor;
DROP SEQUENCE IF EXISTS public.ioeti_fund_collection_seq;
DROP SEQUENCE IF EXISTS public.ioeti_fund_commitment_seq;
DROP SEQUENCE IF EXISTS public.ioeti_fund_deliverable_seq;
DROP SEQUENCE IF EXISTS public.ioeti_fund_donor_private_seq;
DROP SEQUENCE IF EXISTS public.ioeti_fund_donor_seq;
DROP SEQUENCE IF EXISTS public.ioeti_fund_installment_seq;
DROP SEQUENCE IF EXISTS public.ioeti_fund_opportunity_seq;
DROP SEQUENCE IF EXISTS public.ioeti_fund_stewardship_seq;

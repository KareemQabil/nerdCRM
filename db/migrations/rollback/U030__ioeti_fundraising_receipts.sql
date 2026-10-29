-- Rollback of V030: drops donation receipts and fund restrictions (data included), and the allocation columns of commitments
-- and collections (their constraints and indexes go with them).
ALTER TABLE public.ioeti_fund_collection DROP COLUMN IF EXISTS fund_restriction;
ALTER TABLE public.ioeti_fund_collection DROP COLUMN IF EXISTS analytic_account;
ALTER TABLE public.ioeti_fund_collection DROP COLUMN IF EXISTS allocated_at;
ALTER TABLE public.ioeti_fund_commitment DROP COLUMN IF EXISTS fund_restriction;
ALTER TABLE public.ioeti_fund_commitment DROP COLUMN IF EXISTS allocated_by;
ALTER TABLE public.ioeti_fund_commitment DROP COLUMN IF EXISTS allocated_at;
DROP TABLE IF EXISTS public.ioeti_fund_receipt;
DROP TABLE IF EXISTS public.ioeti_fund_restriction;
DROP SEQUENCE IF EXISTS public.ioeti_fund_receipt_seq;
DROP SEQUENCE IF EXISTS public.ioeti_fund_restriction_seq;

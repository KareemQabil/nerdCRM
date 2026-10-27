-- Rollback of V020: removes the exchange-rate schedule, the quotation's tax policy link, the policy tax links and the exchange rates.
-- Native taxes, tax versions and conversion lines created from the policies stay: they are accounting records.
DELETE FROM public.meta_schedule WHERE job = 'com.ioeti.workspace.job.FxRefreshJob';
ALTER TABLE public.sale_sale_order DROP COLUMN IF EXISTS ioeti_tax_policy;
DROP TABLE IF EXISTS public.ioeti_policy_tax_line;
DROP TABLE IF EXISTS public.ioeti_fx_rate;
DROP SEQUENCE IF EXISTS public.ioeti_policy_tax_line_seq;
DROP SEQUENCE IF EXISTS public.ioeti_fx_rate_seq;

-- Rollback of V023: removes the acceptance columns of quotations and the signature columns of contracts (confirmed orders and
-- active contracts stay so natively; only the record of the evidence they were committed on goes).
ALTER TABLE public.contract_contract DROP COLUMN IF EXISTS ioeti_signed_on;
ALTER TABLE public.contract_contract DROP COLUMN IF EXISTS ioeti_signature_sha256;
ALTER TABLE public.contract_contract DROP COLUMN IF EXISTS ioeti_signature_revision;
ALTER TABLE public.contract_contract DROP COLUMN IF EXISTS ioeti_signature_document;
ALTER TABLE public.contract_contract DROP COLUMN IF EXISTS ioeti_signatory_policy;
ALTER TABLE public.contract_contract DROP COLUMN IF EXISTS ioeti_activated_by;
ALTER TABLE public.contract_contract DROP COLUMN IF EXISTS ioeti_activated_at;
ALTER TABLE public.sale_sale_order DROP COLUMN IF EXISTS ioeti_accepted_on;
ALTER TABLE public.sale_sale_order DROP COLUMN IF EXISTS ioeti_accepted_by;
ALTER TABLE public.sale_sale_order DROP COLUMN IF EXISTS ioeti_accepted_at;
ALTER TABLE public.sale_sale_order DROP COLUMN IF EXISTS ioeti_acceptance_sha256;
ALTER TABLE public.sale_sale_order DROP COLUMN IF EXISTS ioeti_acceptance_revision;
ALTER TABLE public.sale_sale_order DROP COLUMN IF EXISTS ioeti_acceptance_reference;
ALTER TABLE public.sale_sale_order DROP COLUMN IF EXISTS ioeti_acceptance_kind;
ALTER TABLE public.sale_sale_order DROP COLUMN IF EXISTS ioeti_acceptance_document;

-- Rollback of V004. Drops the contract → quotation lineage (contract lines themselves stay).
ALTER TABLE public.contract_contract DROP COLUMN IF EXISTS ioeti_source_quote;

-- Wave 3 part 2c: Contract.ioetiSourceQuote, the quotation whose lines were copied into the contract.
ALTER TABLE public.contract_contract ADD COLUMN IF NOT EXISTS ioeti_source_quote bigint;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_plor11bot7mn5axkmctr60c8k') THEN
    ALTER TABLE public.contract_contract ADD CONSTRAINT fk_plor11bot7mn5axkmctr60c8k FOREIGN KEY (ioeti_source_quote) REFERENCES public.sale_sale_order(id);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS contract_contract_ioeti_source_quote_idx ON public.contract_contract USING btree (ioeti_source_quote);

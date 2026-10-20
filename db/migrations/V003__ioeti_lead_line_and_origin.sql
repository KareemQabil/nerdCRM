-- Wave 2: Lead.ioetiBusinessLine and Opportunity.ioetiOriginLead (lead lineage).
ALTER TABLE public.crm_lead ADD COLUMN IF NOT EXISTS ioeti_business_line bigint;
ALTER TABLE public.crm_opportunity ADD COLUMN IF NOT EXISTS ioeti_origin_lead bigint;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_9s3v8f3oqny1sv9d9fufr5p49') THEN
    ALTER TABLE public.crm_lead ADD CONSTRAINT fk_9s3v8f3oqny1sv9d9fufr5p49 FOREIGN KEY (ioeti_business_line) REFERENCES public.ioeti_business_line(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_7y5qtg2bjwm0sbrqobjb48mdl') THEN
    ALTER TABLE public.crm_opportunity ADD CONSTRAINT fk_7y5qtg2bjwm0sbrqobjb48mdl FOREIGN KEY (ioeti_origin_lead) REFERENCES public.crm_lead(id);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS crm_lead_ioeti_business_line_idx ON public.crm_lead USING btree (ioeti_business_line);
CREATE INDEX IF NOT EXISTS crm_opportunity_ioeti_origin_lead_idx ON public.crm_opportunity USING btree (ioeti_origin_lead);

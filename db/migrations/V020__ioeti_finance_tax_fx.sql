-- D-06 (signed 2026-10-25): tax on quotations from the finance.tax policy through native AOS taxes, and exchange rates to EGP
-- (public source chosen in finance.fx, manual override by finance). Mirrors the schema Hibernate generates from
-- modules/ioeti-workspace/src/main/resources/domains/Finance.xml and modules/ioeti-commercial/src/main/resources/domains/Tax.xml
-- and SaleOrder.xml (verified by scripts/db_migrate.py verify), and registers the scheduled rate fetch.
-- Idempotent: safe on a database where the objects already exist.
CREATE SEQUENCE IF NOT EXISTS public.ioeti_fx_rate_seq START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;

CREATE TABLE IF NOT EXISTS public.ioeti_fx_rate (
    id bigint NOT NULL,
    archived boolean,
    import_id character varying(255),
    import_origin character varying(255),
    process_instance_id character varying(255),
    version integer,
    created_on timestamp(6) without time zone,
    updated_on timestamp(6) without time zone,
    as_of timestamp(6) without time zone NOT NULL,
    attrs jsonb,
    provider character varying(120),
    rate numeric(20,6) NOT NULL,
    rate_date date NOT NULL,
    reason character varying(500),
    recorded_at timestamp(6) without time zone NOT NULL,
    source character varying(20) NOT NULL,
    created_by bigint,
    updated_by bigint,
    currency bigint NOT NULL,
    entered_by bigint,
    policy_version bigint,
    to_currency bigint NOT NULL,
    CONSTRAINT ioeti_fx_rate_pkey PRIMARY KEY (id)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_ffkk83ht7h3yjkinjmou1hr73') THEN
    ALTER TABLE public.ioeti_fx_rate ADD CONSTRAINT uk_ffkk83ht7h3yjkinjmou1hr73 UNIQUE (import_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_7mabu4ji49qsmfg72dj0m7ii9') THEN
    ALTER TABLE public.ioeti_fx_rate ADD CONSTRAINT fk_7mabu4ji49qsmfg72dj0m7ii9 FOREIGN KEY (entered_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_abhb05pb32qfo1xs02vaxu9cg') THEN
    ALTER TABLE public.ioeti_fx_rate ADD CONSTRAINT fk_abhb05pb32qfo1xs02vaxu9cg FOREIGN KEY (updated_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_efn6ddae9suk88hxwhm65ytp9') THEN
    ALTER TABLE public.ioeti_fx_rate ADD CONSTRAINT fk_efn6ddae9suk88hxwhm65ytp9 FOREIGN KEY (created_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_k67erne2hw00xrkuhvcwi0uxi') THEN
    ALTER TABLE public.ioeti_fx_rate ADD CONSTRAINT fk_k67erne2hw00xrkuhvcwi0uxi FOREIGN KEY (policy_version) REFERENCES public.ioeti_policy_version(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_l2li7nyf95wbvccficfryivid') THEN
    ALTER TABLE public.ioeti_fx_rate ADD CONSTRAINT fk_l2li7nyf95wbvccficfryivid FOREIGN KEY (currency) REFERENCES public.base_currency(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_rwa2b8lli21jtk5dvpwv8l9gc') THEN
    ALTER TABLE public.ioeti_fx_rate ADD CONSTRAINT fk_rwa2b8lli21jtk5dvpwv8l9gc FOREIGN KEY (to_currency) REFERENCES public.base_currency(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ioeti_fx_rate_currency_idx ON public.ioeti_fx_rate USING btree (currency);
CREATE INDEX IF NOT EXISTS ioeti_fx_rate_currency_rate_date_idx ON public.ioeti_fx_rate USING btree (currency, rate_date);
CREATE INDEX IF NOT EXISTS ioeti_fx_rate_entered_by_idx ON public.ioeti_fx_rate USING btree (entered_by);
CREATE INDEX IF NOT EXISTS ioeti_fx_rate_policy_version_idx ON public.ioeti_fx_rate USING btree (policy_version);
CREATE INDEX IF NOT EXISTS ioeti_fx_rate_to_currency_idx ON public.ioeti_fx_rate USING btree (to_currency);

CREATE SEQUENCE IF NOT EXISTS public.ioeti_policy_tax_line_seq START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;

CREATE TABLE IF NOT EXISTS public.ioeti_policy_tax_line (
    id bigint NOT NULL,
    archived boolean,
    import_id character varying(255),
    import_origin character varying(255),
    process_instance_id character varying(255),
    version integer,
    created_on timestamp(6) without time zone,
    updated_on timestamp(6) without time zone,
    attrs jsonb,
    created_by bigint,
    updated_by bigint,
    policy_version bigint NOT NULL,
    tax_line bigint NOT NULL,
    CONSTRAINT ioeti_policy_tax_line_pkey PRIMARY KEY (id)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_cx05m1ffg4lijfnvxpmstd5fn') THEN
    ALTER TABLE public.ioeti_policy_tax_line ADD CONSTRAINT uk_cx05m1ffg4lijfnvxpmstd5fn UNIQUE (import_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_r1xs8n9m9de87yc8lgb94oqh9') THEN
    ALTER TABLE public.ioeti_policy_tax_line ADD CONSTRAINT uk_r1xs8n9m9de87yc8lgb94oqh9 UNIQUE (policy_version);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_3s3yv25pjxq67212xttjuxndw') THEN
    ALTER TABLE public.ioeti_policy_tax_line ADD CONSTRAINT fk_3s3yv25pjxq67212xttjuxndw FOREIGN KEY (created_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_99xbd7jqp8to9k0rumoe428xa') THEN
    ALTER TABLE public.ioeti_policy_tax_line ADD CONSTRAINT fk_99xbd7jqp8to9k0rumoe428xa FOREIGN KEY (updated_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_r1xs8n9m9de87yc8lgb94oqh9') THEN
    ALTER TABLE public.ioeti_policy_tax_line ADD CONSTRAINT fk_r1xs8n9m9de87yc8lgb94oqh9 FOREIGN KEY (policy_version) REFERENCES public.ioeti_policy_version(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_sbv02rp3ygh0557xajq0xk8jn') THEN
    ALTER TABLE public.ioeti_policy_tax_line ADD CONSTRAINT fk_sbv02rp3ygh0557xajq0xk8jn FOREIGN KEY (tax_line) REFERENCES public.account_tax_line(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ioeti_policy_tax_line_tax_line_idx ON public.ioeti_policy_tax_line USING btree (tax_line);

-- SaleOrder.ioetiTaxPolicy (extension of the native SaleOrder): the finance.tax version a quotation's tax was computed with
ALTER TABLE public.sale_sale_order ADD COLUMN IF NOT EXISTS ioeti_tax_policy bigint;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_6ttjuk6stg3n7xxuwk32vh5i2') THEN
    ALTER TABLE public.sale_sale_order ADD CONSTRAINT fk_6ttjuk6stg3n7xxuwk32vh5i2 FOREIGN KEY (ioeti_tax_policy) REFERENCES public.ioeti_policy_version(id);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS sale_sale_order_ioeti_tax_policy_idx ON public.sale_sale_order USING btree (ioeti_tax_policy);

-- The scheduled fetch of exchange rates (native Quartz schedule). It does nothing unless finance.fx names the public source.
INSERT INTO public.meta_schedule (id, version, name, description, job, cron, active)
SELECT nextval('public.meta_schedule_seq'), 0, 'IOETI exchange rates (D-06)',
       'Fetches exchange rates to EGP when the finance.fx policy names the public source and the newest fetched rate is 12 hours old',
       'com.ioeti.workspace.job.FxRefreshJob', '0 15 0/6 * * ?', true
WHERE NOT EXISTS (SELECT 1 FROM public.meta_schedule WHERE job = 'com.ioeti.workspace.job.FxRefreshJob');

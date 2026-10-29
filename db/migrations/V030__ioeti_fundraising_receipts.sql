-- M1 (D-05 signed 2026-10-25), module ioeti-fundraising: donation receipts, fund restrictions mapped to native analytic
-- accounts, and the allocation recorded on restricted commitments and their collections.
-- Mirrors the schema Hibernate generates from domains/Fundraising.xml (verified by scripts/db_migrate.py verify).
-- Idempotent: safe on a database where the objects already exist.
CREATE SEQUENCE IF NOT EXISTS public.ioeti_fund_restriction_seq START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
CREATE SEQUENCE IF NOT EXISTS public.ioeti_fund_receipt_seq START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;

CREATE TABLE IF NOT EXISTS public.ioeti_fund_restriction (
    id bigint NOT NULL,
    archived boolean,
    import_id character varying(255),
    import_origin character varying(255),
    process_instance_id character varying(255),
    version integer,
    created_on timestamp(6) without time zone,
    updated_on timestamp(6) without time zone,
    attrs jsonb,
    active boolean,
    code character varying(30) NOT NULL,
    name character varying(255) NOT NULL,
    created_by bigint,
    updated_by bigint,
    analytic_account bigint NOT NULL,
    CONSTRAINT ioeti_fund_restriction_pkey PRIMARY KEY (id)
);
CREATE TABLE IF NOT EXISTS public.ioeti_fund_receipt (
    id bigint NOT NULL,
    archived boolean,
    import_id character varying(255),
    import_origin character varying(255),
    process_instance_id character varying(255),
    version integer,
    created_on timestamp(6) without time zone,
    updated_on timestamp(6) without time zone,
    attrs jsonb,
    amount numeric(20,2) NOT NULL,
    donor_name character varying(255),
    issued_on date NOT NULL,
    number character varying(30) NOT NULL,
    received_on date NOT NULL,
    status_select integer NOT NULL,
    void_reason_select integer,
    voided_at timestamp(6) without time zone,
    created_by bigint,
    updated_by bigint,
    collection bigint NOT NULL,
    currency bigint NOT NULL,
    issued_by bigint,
    replaces bigint,
    voided_by bigint,
    CONSTRAINT ioeti_fund_receipt_pkey PRIMARY KEY (id)
);

ALTER TABLE public.ioeti_fund_commitment ADD COLUMN IF NOT EXISTS allocated_at timestamp(6) without time zone;
ALTER TABLE public.ioeti_fund_commitment ADD COLUMN IF NOT EXISTS allocated_by bigint;
ALTER TABLE public.ioeti_fund_commitment ADD COLUMN IF NOT EXISTS fund_restriction bigint;
ALTER TABLE public.ioeti_fund_collection ADD COLUMN IF NOT EXISTS allocated_at timestamp(6) without time zone;
ALTER TABLE public.ioeti_fund_collection ADD COLUMN IF NOT EXISTS analytic_account bigint;
ALTER TABLE public.ioeti_fund_collection ADD COLUMN IF NOT EXISTS fund_restriction bigint;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_5eadbn2v8k63ystbtx6pvbw2h') THEN
    ALTER TABLE public.ioeti_fund_restriction ADD CONSTRAINT uk_5eadbn2v8k63ystbtx6pvbw2h UNIQUE (import_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_qvjblhk6povva8n7050wlgg3u') THEN
    ALTER TABLE public.ioeti_fund_restriction ADD CONSTRAINT uk_qvjblhk6povva8n7050wlgg3u UNIQUE (code);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_rmk7xwfgg3pof4hb51lcsb6lp') THEN
    ALTER TABLE public.ioeti_fund_receipt ADD CONSTRAINT uk_rmk7xwfgg3pof4hb51lcsb6lp UNIQUE (number);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_sfgpkmotbi8ee2brjhdsjhviv') THEN
    ALTER TABLE public.ioeti_fund_receipt ADD CONSTRAINT uk_sfgpkmotbi8ee2brjhdsjhviv UNIQUE (import_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_34aw0k3cncban714r6ws8bbrj') THEN
    ALTER TABLE public.ioeti_fund_restriction ADD CONSTRAINT fk_34aw0k3cncban714r6ws8bbrj FOREIGN KEY (created_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_5tdtjknre1paa9x0d8m4sd2w1') THEN
    ALTER TABLE public.ioeti_fund_commitment ADD CONSTRAINT fk_5tdtjknre1paa9x0d8m4sd2w1 FOREIGN KEY (fund_restriction) REFERENCES public.ioeti_fund_restriction(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_7ru6bvi07mt4mejim8sxmc34s') THEN
    ALTER TABLE public.ioeti_fund_receipt ADD CONSTRAINT fk_7ru6bvi07mt4mejim8sxmc34s FOREIGN KEY (voided_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_9v15gl3hvt83p49fd33t9g7n7') THEN
    ALTER TABLE public.ioeti_fund_commitment ADD CONSTRAINT fk_9v15gl3hvt83p49fd33t9g7n7 FOREIGN KEY (allocated_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_9ydtksv51ms55w48bdic9v199') THEN
    ALTER TABLE public.ioeti_fund_restriction ADD CONSTRAINT fk_9ydtksv51ms55w48bdic9v199 FOREIGN KEY (analytic_account) REFERENCES public.account_analytic_account(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_adj2bpkyo8rb8m7405ohn5s7p') THEN
    ALTER TABLE public.ioeti_fund_receipt ADD CONSTRAINT fk_adj2bpkyo8rb8m7405ohn5s7p FOREIGN KEY (collection) REFERENCES public.ioeti_fund_collection(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_bghrtfp8cf2d1dhqa6yd4ohkh') THEN
    ALTER TABLE public.ioeti_fund_collection ADD CONSTRAINT fk_bghrtfp8cf2d1dhqa6yd4ohkh FOREIGN KEY (analytic_account) REFERENCES public.account_analytic_account(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_clng65kqs7xvropo2rerr5a4h') THEN
    ALTER TABLE public.ioeti_fund_receipt ADD CONSTRAINT fk_clng65kqs7xvropo2rerr5a4h FOREIGN KEY (currency) REFERENCES public.base_currency(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_divbw3wh1c179ijdnq1p4oomx') THEN
    ALTER TABLE public.ioeti_fund_receipt ADD CONSTRAINT fk_divbw3wh1c179ijdnq1p4oomx FOREIGN KEY (issued_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_gstxamaasgl7l9fchph7s9gl9') THEN
    ALTER TABLE public.ioeti_fund_receipt ADD CONSTRAINT fk_gstxamaasgl7l9fchph7s9gl9 FOREIGN KEY (created_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_lhayupggwlnvtma88q42ec6xc') THEN
    ALTER TABLE public.ioeti_fund_receipt ADD CONSTRAINT fk_lhayupggwlnvtma88q42ec6xc FOREIGN KEY (replaces) REFERENCES public.ioeti_fund_receipt(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_m07yejw5dfvomk9lehbf600ou') THEN
    ALTER TABLE public.ioeti_fund_restriction ADD CONSTRAINT fk_m07yejw5dfvomk9lehbf600ou FOREIGN KEY (updated_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_snjk033or9rmuw9hq2mx8sofy') THEN
    ALTER TABLE public.ioeti_fund_receipt ADD CONSTRAINT fk_snjk033or9rmuw9hq2mx8sofy FOREIGN KEY (updated_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_tonmebyj8t6yfh7p4lu1org89') THEN
    ALTER TABLE public.ioeti_fund_collection ADD CONSTRAINT fk_tonmebyj8t6yfh7p4lu1org89 FOREIGN KEY (fund_restriction) REFERENCES public.ioeti_fund_restriction(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ioeti_fund_collection_analytic_account_idx ON public.ioeti_fund_collection USING btree (analytic_account);
CREATE INDEX IF NOT EXISTS ioeti_fund_collection_fund_restriction_idx ON public.ioeti_fund_collection USING btree (fund_restriction);
CREATE INDEX IF NOT EXISTS ioeti_fund_commitment_allocated_by_idx ON public.ioeti_fund_commitment USING btree (allocated_by);
CREATE INDEX IF NOT EXISTS ioeti_fund_commitment_fund_restriction_idx ON public.ioeti_fund_commitment USING btree (fund_restriction);
CREATE INDEX IF NOT EXISTS ioeti_fund_receipt_collection_idx ON public.ioeti_fund_receipt USING btree (collection);
CREATE INDEX IF NOT EXISTS ioeti_fund_receipt_currency_idx ON public.ioeti_fund_receipt USING btree (currency);
CREATE INDEX IF NOT EXISTS ioeti_fund_receipt_issued_by_idx ON public.ioeti_fund_receipt USING btree (issued_by);
CREATE INDEX IF NOT EXISTS ioeti_fund_receipt_replaces_idx ON public.ioeti_fund_receipt USING btree (replaces);
CREATE INDEX IF NOT EXISTS ioeti_fund_receipt_voided_by_idx ON public.ioeti_fund_receipt USING btree (voided_by);
CREATE INDEX IF NOT EXISTS ioeti_fund_restriction_analytic_account_idx ON public.ioeti_fund_restriction USING btree (analytic_account);
CREATE INDEX IF NOT EXISTS ioeti_fund_restriction_name_idx ON public.ioeti_fund_restriction USING btree (name);

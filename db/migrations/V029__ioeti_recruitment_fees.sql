-- M1 (D-04 signed 2026-10-25), module ioeti-recruitment: the offered salary kept apart (restricted), the client agreement
-- terms and guarantee on each placement, and fee / credit requests for finance.
-- Mirrors the schema Hibernate generates from domains/Recruitment.xml (verified by scripts/db_migrate.py verify).
-- Idempotent: safe on a database where the objects already exist.
CREATE SEQUENCE IF NOT EXISTS public.ioeti_rec_offer_private_seq START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
CREATE SEQUENCE IF NOT EXISTS public.ioeti_rec_fee_request_seq START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;

CREATE TABLE IF NOT EXISTS public.ioeti_rec_offer_private (
    id bigint NOT NULL,
    archived boolean,
    import_id character varying(255),
    import_origin character varying(255),
    process_instance_id character varying(255),
    version integer,
    created_on timestamp(6) without time zone,
    updated_on timestamp(6) without time zone,
    attrs jsonb,
    annual_salary numeric(20,2) NOT NULL,
    created_by bigint,
    updated_by bigint,
    currency bigint NOT NULL,
    application bigint NOT NULL,
    CONSTRAINT ioeti_rec_offer_private_pkey PRIMARY KEY (id)
);
CREATE TABLE IF NOT EXISTS public.ioeti_rec_fee_request (
    id bigint NOT NULL,
    archived boolean,
    import_id character varying(255),
    import_origin character varying(255),
    process_instance_id character varying(255),
    version integer,
    created_on timestamp(6) without time zone,
    updated_on timestamp(6) without time zone,
    attrs jsonb,
    amount_before_tax numeric(20,2) NOT NULL,
    kind_select integer NOT NULL,
    rate_percent numeric(5,2) NOT NULL,
    requested_at timestamp(6) without time zone NOT NULL,
    status_select integer NOT NULL,
    created_by bigint,
    updated_by bigint,
    agreement_policy bigint,
    client bigint NOT NULL,
    currency bigint NOT NULL,
    placement bigint NOT NULL,
    refund_of bigint,
    requested_by bigint,
    CONSTRAINT ioeti_rec_fee_request_pkey PRIMARY KEY (id)
);

ALTER TABLE public.ioeti_rec_placement ADD COLUMN IF NOT EXISTS exit_outcome_select integer;
ALTER TABLE public.ioeti_rec_placement ADD COLUMN IF NOT EXISTS exit_reason_select integer;
ALTER TABLE public.ioeti_rec_placement ADD COLUMN IF NOT EXISTS exited_on date;
ALTER TABLE public.ioeti_rec_placement ADD COLUMN IF NOT EXISTS fee_percent numeric(5,2);
ALTER TABLE public.ioeti_rec_placement ADD COLUMN IF NOT EXISTS fee_waived boolean;
ALTER TABLE public.ioeti_rec_placement ADD COLUMN IF NOT EXISTS guarantee_days integer;
ALTER TABLE public.ioeti_rec_placement ADD COLUMN IF NOT EXISTS guarantee_ends_on date;
ALTER TABLE public.ioeti_rec_placement ADD COLUMN IF NOT EXISTS invoice_on_select integer;
ALTER TABLE public.ioeti_rec_placement ADD COLUMN IF NOT EXISTS refund_percent numeric(5,2);
ALTER TABLE public.ioeti_rec_placement ADD COLUMN IF NOT EXISTS replacement_select integer;
ALTER TABLE public.ioeti_rec_placement ADD COLUMN IF NOT EXISTS agreement_policy bigint;
ALTER TABLE public.ioeti_rec_placement ADD COLUMN IF NOT EXISTS replacement_of bigint;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_5mk09wdqkk51pl84e8rq0vqpe') THEN
    ALTER TABLE public.ioeti_rec_fee_request ADD CONSTRAINT uk_5mk09wdqkk51pl84e8rq0vqpe UNIQUE (placement, kind_select);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_d302pwheqbxakrba9y3aqbuvx') THEN
    ALTER TABLE public.ioeti_rec_offer_private ADD CONSTRAINT uk_d302pwheqbxakrba9y3aqbuvx UNIQUE (import_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_k01qwkwv92o1s8skf8n73odwo') THEN
    ALTER TABLE public.ioeti_rec_fee_request ADD CONSTRAINT uk_k01qwkwv92o1s8skf8n73odwo UNIQUE (import_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_m4nrp3lmq0ykbd8yis2divgxn') THEN
    ALTER TABLE public.ioeti_rec_offer_private ADD CONSTRAINT uk_m4nrp3lmq0ykbd8yis2divgxn UNIQUE (application);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_2nicbx10yunltgfdupmvox5s6') THEN
    ALTER TABLE public.ioeti_rec_fee_request ADD CONSTRAINT fk_2nicbx10yunltgfdupmvox5s6 FOREIGN KEY (requested_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_2w96eisphv3au0viu3x6rgnbo') THEN
    ALTER TABLE public.ioeti_rec_fee_request ADD CONSTRAINT fk_2w96eisphv3au0viu3x6rgnbo FOREIGN KEY (agreement_policy) REFERENCES public.ioeti_policy_version(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_5fmi8e7plia99wg8t0og3dtxg') THEN
    ALTER TABLE public.ioeti_rec_fee_request ADD CONSTRAINT fk_5fmi8e7plia99wg8t0og3dtxg FOREIGN KEY (updated_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_61alxw8sql1phpn6em7f9v6y2') THEN
    ALTER TABLE public.ioeti_rec_fee_request ADD CONSTRAINT fk_61alxw8sql1phpn6em7f9v6y2 FOREIGN KEY (currency) REFERENCES public.base_currency(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_7axo7pm87i6wlqkjii4ow9q2c') THEN
    ALTER TABLE public.ioeti_rec_fee_request ADD CONSTRAINT fk_7axo7pm87i6wlqkjii4ow9q2c FOREIGN KEY (placement) REFERENCES public.ioeti_rec_placement(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_868c9jttbb71wqlxsbiq56amn') THEN
    ALTER TABLE public.ioeti_rec_fee_request ADD CONSTRAINT fk_868c9jttbb71wqlxsbiq56amn FOREIGN KEY (refund_of) REFERENCES public.ioeti_rec_fee_request(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_csxdmg715pr3jrhnwxdopip0a') THEN
    ALTER TABLE public.ioeti_rec_placement ADD CONSTRAINT fk_csxdmg715pr3jrhnwxdopip0a FOREIGN KEY (agreement_policy) REFERENCES public.ioeti_policy_version(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_e2c8hdqybv4rbelbu3rq4dfc6') THEN
    ALTER TABLE public.ioeti_rec_fee_request ADD CONSTRAINT fk_e2c8hdqybv4rbelbu3rq4dfc6 FOREIGN KEY (created_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_gqgriu7re3e3rrs97vj4en3ma') THEN
    ALTER TABLE public.ioeti_rec_fee_request ADD CONSTRAINT fk_gqgriu7re3e3rrs97vj4en3ma FOREIGN KEY (client) REFERENCES public.base_partner(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ko66gui1ro28cb1la71uu61ko') THEN
    ALTER TABLE public.ioeti_rec_offer_private ADD CONSTRAINT fk_ko66gui1ro28cb1la71uu61ko FOREIGN KEY (currency) REFERENCES public.base_currency(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_l0bccpmkhf04eyej56fb24new') THEN
    ALTER TABLE public.ioeti_rec_placement ADD CONSTRAINT fk_l0bccpmkhf04eyej56fb24new FOREIGN KEY (replacement_of) REFERENCES public.ioeti_rec_placement(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_m4nrp3lmq0ykbd8yis2divgxn') THEN
    ALTER TABLE public.ioeti_rec_offer_private ADD CONSTRAINT fk_m4nrp3lmq0ykbd8yis2divgxn FOREIGN KEY (application) REFERENCES public.ioeti_rec_application(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_mpy7khs56ag293b3n9wyt2jsa') THEN
    ALTER TABLE public.ioeti_rec_offer_private ADD CONSTRAINT fk_mpy7khs56ag293b3n9wyt2jsa FOREIGN KEY (updated_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_n7r85h0c0klfge1xxb6gxq8cb') THEN
    ALTER TABLE public.ioeti_rec_offer_private ADD CONSTRAINT fk_n7r85h0c0klfge1xxb6gxq8cb FOREIGN KEY (created_by) REFERENCES public.auth_user(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ioeti_rec_fee_request_agreement_policy_idx ON public.ioeti_rec_fee_request USING btree (agreement_policy);
CREATE INDEX IF NOT EXISTS ioeti_rec_fee_request_client_idx ON public.ioeti_rec_fee_request USING btree (client);
CREATE INDEX IF NOT EXISTS ioeti_rec_fee_request_currency_idx ON public.ioeti_rec_fee_request USING btree (currency);
CREATE INDEX IF NOT EXISTS ioeti_rec_fee_request_placement_idx ON public.ioeti_rec_fee_request USING btree (placement);
CREATE INDEX IF NOT EXISTS ioeti_rec_fee_request_refund_of_idx ON public.ioeti_rec_fee_request USING btree (refund_of);
CREATE INDEX IF NOT EXISTS ioeti_rec_fee_request_requested_by_idx ON public.ioeti_rec_fee_request USING btree (requested_by);
CREATE INDEX IF NOT EXISTS ioeti_rec_offer_private_currency_idx ON public.ioeti_rec_offer_private USING btree (currency);
CREATE INDEX IF NOT EXISTS ioeti_rec_placement_agreement_policy_idx ON public.ioeti_rec_placement USING btree (agreement_policy);
CREATE INDEX IF NOT EXISTS ioeti_rec_placement_replacement_of_idx ON public.ioeti_rec_placement USING btree (replacement_of);

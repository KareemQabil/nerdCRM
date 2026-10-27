-- Wave 5b: commercial workflows (module ioeti-workspace): review requests and their history, invoice requests; plus the native opportunity's renewal link.
-- Mirrors the schema Hibernate generates from domains/Workspace.xml and domains/Opportunity.xml (verified by scripts/db_migrate.py verify).
-- Idempotent: safe on a database where the objects already exist.
CREATE SEQUENCE IF NOT EXISTS public.ioeti_ws_invoice_request_seq START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
CREATE SEQUENCE IF NOT EXISTS public.ioeti_ws_review_event_seq START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
CREATE SEQUENCE IF NOT EXISTS public.ioeti_ws_review_seq START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;

CREATE TABLE IF NOT EXISTS public.ioeti_ws_invoice_request (
    id bigint NOT NULL,
    archived boolean,
    import_id character varying(255),
    import_origin character varying(255),
    process_instance_id character varying(255),
    version integer,
    created_on timestamp(6) without time zone,
    updated_on timestamp(6) without time zone,
    amount_before_tax numeric(20,3),
    attrs jsonb,
    cancelled_at timestamp(6) without time zone,
    requested_at timestamp(6) without time zone,
    status_select integer NOT NULL,
    created_by bigint,
    updated_by bigint,
    milestone bigint NOT NULL,
    quote bigint NOT NULL,
    requested_by bigint,
    CONSTRAINT ioeti_ws_invoice_request_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.ioeti_ws_review (
    id bigint NOT NULL,
    archived boolean,
    import_id character varying(255),
    import_origin character varying(255),
    process_instance_id character varying(255),
    version integer,
    created_on timestamp(6) without time zone,
    updated_on timestamp(6) without time zone,
    attrs jsonb,
    reason_select integer,
    requested_at timestamp(6) without time zone,
    status_select integer NOT NULL,
    subject_version_number integer,
    created_by bigint,
    updated_by bigint,
    contract bigint,
    quote bigint,
    requested_by bigint,
    reviewed_by bigint,
    CONSTRAINT ioeti_ws_review_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.ioeti_ws_review_event (
    id bigint NOT NULL,
    archived boolean,
    import_id character varying(255),
    import_origin character varying(255),
    process_instance_id character varying(255),
    version integer,
    created_on timestamp(6) without time zone,
    updated_on timestamp(6) without time zone,
    attrs jsonb,
    kind_select integer NOT NULL,
    occurred_at timestamp(6) without time zone NOT NULL,
    reason_select integer,
    created_by bigint,
    updated_by bigint,
    actor bigint,
    review bigint NOT NULL,
    CONSTRAINT ioeti_ws_review_event_pkey PRIMARY KEY (id)
);

-- extension of the native opportunity (domains/Opportunity.xml): the contract it renews
ALTER TABLE public.crm_opportunity ADD COLUMN IF NOT EXISTS ioeti_renewal_of bigint;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_74pc4qdoy89pvl6s8mvhsfghv') THEN
    ALTER TABLE public.ioeti_ws_review ADD CONSTRAINT uk_74pc4qdoy89pvl6s8mvhsfghv UNIQUE (import_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_92ecijuexodjlyvtewu9f29og') THEN
    ALTER TABLE public.ioeti_ws_review_event ADD CONSTRAINT uk_92ecijuexodjlyvtewu9f29og UNIQUE (import_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_qr5a9vrh3w53c2kjhaw395hky') THEN
    ALTER TABLE public.ioeti_ws_invoice_request ADD CONSTRAINT uk_qr5a9vrh3w53c2kjhaw395hky UNIQUE (import_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_1cvfyuwqk6h9ho1r2h4n78b4g') THEN
    ALTER TABLE public.ioeti_ws_invoice_request ADD CONSTRAINT fk_1cvfyuwqk6h9ho1r2h4n78b4g FOREIGN KEY (quote) REFERENCES public.sale_sale_order(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_3bqkt3v94m9e5gfh61bium18t') THEN
    ALTER TABLE public.ioeti_ws_review ADD CONSTRAINT fk_3bqkt3v94m9e5gfh61bium18t FOREIGN KEY (reviewed_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_5qc3h7ipr6n0l43t25kshpuxk') THEN
    ALTER TABLE public.ioeti_ws_review ADD CONSTRAINT fk_5qc3h7ipr6n0l43t25kshpuxk FOREIGN KEY (updated_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_7xqtd1quf62rgqwh2yhlecmnj') THEN
    ALTER TABLE public.ioeti_ws_review_event ADD CONSTRAINT fk_7xqtd1quf62rgqwh2yhlecmnj FOREIGN KEY (actor) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_8smrnxlmwgsmaqdwpe6qoqw87') THEN
    ALTER TABLE public.ioeti_ws_review ADD CONSTRAINT fk_8smrnxlmwgsmaqdwpe6qoqw87 FOREIGN KEY (requested_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_aqbk17afrvvdv3msc90ksxtwe') THEN
    ALTER TABLE public.ioeti_ws_invoice_request ADD CONSTRAINT fk_aqbk17afrvvdv3msc90ksxtwe FOREIGN KEY (created_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_b8kfldqdlrkjuvm6yawoi9gik') THEN
    ALTER TABLE public.ioeti_ws_review_event ADD CONSTRAINT fk_b8kfldqdlrkjuvm6yawoi9gik FOREIGN KEY (updated_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_bgbwki0pb9yc6tiovos3wqi53') THEN
    ALTER TABLE public.ioeti_ws_review_event ADD CONSTRAINT fk_bgbwki0pb9yc6tiovos3wqi53 FOREIGN KEY (review) REFERENCES public.ioeti_ws_review(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_e9n633k7io0e8gb899etaj51b') THEN
    ALTER TABLE public.ioeti_ws_invoice_request ADD CONSTRAINT fk_e9n633k7io0e8gb899etaj51b FOREIGN KEY (milestone) REFERENCES public.supplychain_timetable(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_eiu61h2f9dxiu73jsyyt2v9su') THEN
    ALTER TABLE public.ioeti_ws_invoice_request ADD CONSTRAINT fk_eiu61h2f9dxiu73jsyyt2v9su FOREIGN KEY (updated_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ildp318bfpponxtxsa987hswj') THEN
    ALTER TABLE public.ioeti_ws_invoice_request ADD CONSTRAINT fk_ildp318bfpponxtxsa987hswj FOREIGN KEY (requested_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_j5l14fvby3hr76vxyslwyay1v') THEN
    ALTER TABLE public.ioeti_ws_review ADD CONSTRAINT fk_j5l14fvby3hr76vxyslwyay1v FOREIGN KEY (quote) REFERENCES public.sale_sale_order(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_kv4hyklm4velxqda16ukstuur') THEN
    ALTER TABLE public.ioeti_ws_review_event ADD CONSTRAINT fk_kv4hyklm4velxqda16ukstuur FOREIGN KEY (created_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_r0v4nx0ps9pharsxclrbthg8n') THEN
    ALTER TABLE public.ioeti_ws_review ADD CONSTRAINT fk_r0v4nx0ps9pharsxclrbthg8n FOREIGN KEY (created_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_s91hp8g9qj5gjb4tltxiyypc8') THEN
    ALTER TABLE public.ioeti_ws_review ADD CONSTRAINT fk_s91hp8g9qj5gjb4tltxiyypc8 FOREIGN KEY (contract) REFERENCES public.contract_contract(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_ba6g1cysvbc4ord5ah4hrkj8q') THEN
    ALTER TABLE public.crm_opportunity ADD CONSTRAINT uk_ba6g1cysvbc4ord5ah4hrkj8q UNIQUE (ioeti_renewal_of);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ba6g1cysvbc4ord5ah4hrkj8q') THEN
    ALTER TABLE public.crm_opportunity ADD CONSTRAINT fk_ba6g1cysvbc4ord5ah4hrkj8q FOREIGN KEY (ioeti_renewal_of) REFERENCES public.contract_contract(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ioeti_ws_invoice_request_milestone_idx ON public.ioeti_ws_invoice_request USING btree (milestone);
CREATE INDEX IF NOT EXISTS ioeti_ws_invoice_request_quote_idx ON public.ioeti_ws_invoice_request USING btree (quote);
CREATE INDEX IF NOT EXISTS ioeti_ws_invoice_request_requested_by_idx ON public.ioeti_ws_invoice_request USING btree (requested_by);
CREATE INDEX IF NOT EXISTS ioeti_ws_review_contract_idx ON public.ioeti_ws_review USING btree (contract);
CREATE INDEX IF NOT EXISTS ioeti_ws_review_event_actor_idx ON public.ioeti_ws_review_event USING btree (actor);
CREATE INDEX IF NOT EXISTS ioeti_ws_review_event_review_idx ON public.ioeti_ws_review_event USING btree (review);
CREATE INDEX IF NOT EXISTS ioeti_ws_review_quote_idx ON public.ioeti_ws_review USING btree (quote);
CREATE INDEX IF NOT EXISTS ioeti_ws_review_requested_by_idx ON public.ioeti_ws_review USING btree (requested_by);
CREATE INDEX IF NOT EXISTS ioeti_ws_review_reviewed_by_idx ON public.ioeti_ws_review USING btree (reviewed_by);

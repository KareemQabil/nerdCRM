-- IOETI business line registry (module ioeti-business-lines, entity BusinessLine).
-- Mirrors the schema Hibernate generates from domains/BusinessLine.xml (verified by scripts/db_migrate.py --verify).
-- Idempotent: safe on a database where the objects already exist.
CREATE SEQUENCE IF NOT EXISTS public.ioeti_business_line_seq START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;

CREATE TABLE IF NOT EXISTS public.ioeti_business_line (
    id bigint NOT NULL,
    archived boolean,
    import_id character varying(255),
    import_origin character varying(255),
    process_instance_id character varying(255),
    version integer,
    created_on timestamp(6) without time zone,
    updated_on timestamp(6) without time zone,
    attrs jsonb,
    code character varying(20) NOT NULL,
    description text,
    name_ar character varying(255) NOT NULL,
    name_en character varying(255) NOT NULL,
    sequence integer,
    status_select integer NOT NULL,
    created_by bigint,
    updated_by bigint,
    manager bigint,
    responsible_team bigint,
    CONSTRAINT ioeti_business_line_pkey PRIMARY KEY (id)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_mjg4l0vwm9f6olh36393h0o19') THEN
    ALTER TABLE public.ioeti_business_line ADD CONSTRAINT uk_mjg4l0vwm9f6olh36393h0o19 UNIQUE (import_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_t82hqa4y4l5xqe2ca7pw3i57n') THEN
    ALTER TABLE public.ioeti_business_line ADD CONSTRAINT uk_t82hqa4y4l5xqe2ca7pw3i57n UNIQUE (code);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_10qhk3k4oddh8dvpcxnt2xhn8') THEN
    ALTER TABLE public.ioeti_business_line ADD CONSTRAINT fk_10qhk3k4oddh8dvpcxnt2xhn8 FOREIGN KEY (manager) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_70drladnmm30m1ydtaxe3iftd') THEN
    ALTER TABLE public.ioeti_business_line ADD CONSTRAINT fk_70drladnmm30m1ydtaxe3iftd FOREIGN KEY (updated_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_nsil843ptqbcd94549n0j3k9i') THEN
    ALTER TABLE public.ioeti_business_line ADD CONSTRAINT fk_nsil843ptqbcd94549n0j3k9i FOREIGN KEY (created_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_tojwx5voongqqf0nkj2b8gdvx') THEN
    ALTER TABLE public.ioeti_business_line ADD CONSTRAINT fk_tojwx5voongqqf0nkj2b8gdvx FOREIGN KEY (responsible_team) REFERENCES public.team_team(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ioeti_business_line_manager_idx ON public.ioeti_business_line USING btree (manager);
CREATE INDEX IF NOT EXISTS ioeti_business_line_name_en_idx ON public.ioeti_business_line USING btree (name_en);
CREATE INDEX IF NOT EXISTS ioeti_business_line_responsible_team_idx ON public.ioeti_business_line USING btree (responsible_team);

-- Opportunity.ioetiBusinessLine (extension of the native CRM Opportunity)
ALTER TABLE public.crm_opportunity ADD COLUMN IF NOT EXISTS ioeti_business_line bigint;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ssrvvlp4e93lpmx3vv4s6j4ep') THEN
    ALTER TABLE public.crm_opportunity ADD CONSTRAINT fk_ssrvvlp4e93lpmx3vv4s6j4ep FOREIGN KEY (ioeti_business_line) REFERENCES public.ioeti_business_line(id);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS crm_opportunity_ioeti_business_line_idx ON public.crm_opportunity USING btree (ioeti_business_line);

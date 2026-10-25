-- IOETI business-rule policies (owner decisions D-01..D-12, 2026-10-25): effective-dated, append-only policy versions.
-- Mirrors the schema Hibernate generates from modules/ioeti-core/src/main/resources/domains/Policy.xml (verified by scripts/db_migrate.py verify).
-- Idempotent: safe on a database where the objects already exist.
CREATE SEQUENCE IF NOT EXISTS public.ioeti_policy_version_seq START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;

CREATE TABLE IF NOT EXISTS public.ioeti_policy_version (
    id bigint NOT NULL,
    archived boolean,
    import_id character varying(255),
    import_origin character varying(255),
    process_instance_id character varying(255),
    version integer,
    created_on timestamp(6) without time zone,
    updated_on timestamp(6) without time zone,
    attrs jsonb,
    created_at timestamp(6) without time zone NOT NULL,
    effective_from date NOT NULL,
    policy_key character varying(80) NOT NULL,
    reason character varying(500) NOT NULL,
    retired boolean,
    scope_key character varying(120),
    value_json text,
    created_by bigint,
    updated_by bigint,
    author bigint NOT NULL,
    CONSTRAINT ioeti_policy_version_pkey PRIMARY KEY (id)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_fwx6hehnfyldfgbd8phlqh9si') THEN
    ALTER TABLE public.ioeti_policy_version ADD CONSTRAINT uk_fwx6hehnfyldfgbd8phlqh9si UNIQUE (import_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ejoomanclwcigt0w1v0phx7s6') THEN
    ALTER TABLE public.ioeti_policy_version ADD CONSTRAINT fk_ejoomanclwcigt0w1v0phx7s6 FOREIGN KEY (updated_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_fvxdlb5o6jwxslquvuomw2i4t') THEN
    ALTER TABLE public.ioeti_policy_version ADD CONSTRAINT fk_fvxdlb5o6jwxslquvuomw2i4t FOREIGN KEY (author) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_o3jbumfkvpmxm26nw57x99rs9') THEN
    ALTER TABLE public.ioeti_policy_version ADD CONSTRAINT fk_o3jbumfkvpmxm26nw57x99rs9 FOREIGN KEY (created_by) REFERENCES public.auth_user(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ioeti_policy_version_author_idx ON public.ioeti_policy_version USING btree (author);
CREATE INDEX IF NOT EXISTS ioeti_policy_version_policy_key_scope_key_idx ON public.ioeti_policy_version USING btree (policy_key, scope_key);

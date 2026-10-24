-- IOETI field visits (capability map): the visit log, notes written by field people against a native intervention.
-- Mirrors the schema Hibernate generates from modules/ioeti-operations/src/main/resources/domains/Operations.xml (verified by scripts/db_migrate.py verify).
-- Idempotent: safe on a database where the objects already exist.
CREATE SEQUENCE IF NOT EXISTS public.ioeti_ops_visit_note_seq START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;

CREATE TABLE IF NOT EXISTS public.ioeti_ops_visit_note (
    id bigint NOT NULL,
    archived boolean,
    import_id character varying(255),
    import_origin character varying(255),
    process_instance_id character varying(255),
    version integer,
    created_on timestamp(6) without time zone,
    updated_on timestamp(6) without time zone,
    attrs jsonb,
    body text NOT NULL,
    written_at timestamp(6) without time zone NOT NULL,
    created_by bigint,
    updated_by bigint,
    author bigint,
    visit bigint NOT NULL,
    CONSTRAINT ioeti_ops_visit_note_pkey PRIMARY KEY (id)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_gn8tj24ac1q9bnjxvejdeof8o') THEN
    ALTER TABLE public.ioeti_ops_visit_note ADD CONSTRAINT uk_gn8tj24ac1q9bnjxvejdeof8o UNIQUE (import_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_8ehlly5tgb6canv7tnl8rk28b') THEN
    ALTER TABLE public.ioeti_ops_visit_note ADD CONSTRAINT fk_8ehlly5tgb6canv7tnl8rk28b FOREIGN KEY (author) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_fvscwduhxy2aua5a150lf994r') THEN
    ALTER TABLE public.ioeti_ops_visit_note ADD CONSTRAINT fk_fvscwduhxy2aua5a150lf994r FOREIGN KEY (created_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_gfiutkoqlnpsw8cob5c20drj6') THEN
    ALTER TABLE public.ioeti_ops_visit_note ADD CONSTRAINT fk_gfiutkoqlnpsw8cob5c20drj6 FOREIGN KEY (updated_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_mirhlniy00xxrf9c7pugs4c8a') THEN
    ALTER TABLE public.ioeti_ops_visit_note ADD CONSTRAINT fk_mirhlniy00xxrf9c7pugs4c8a FOREIGN KEY (visit) REFERENCES public.intervention_intervention(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ioeti_ops_visit_note_author_idx ON public.ioeti_ops_visit_note USING btree (author);
CREATE INDEX IF NOT EXISTS ioeti_ops_visit_note_visit_idx ON public.ioeti_ops_visit_note USING btree (visit);

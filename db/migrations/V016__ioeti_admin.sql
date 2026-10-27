-- IOETI administration (journeys plan, phase 1): the audit trail of administrative changes.
-- Mirrors the schema Hibernate generates from modules/ioeti-admin/src/main/resources/domains/Admin.xml (verified by scripts/db_migrate.py verify).
-- Idempotent: safe on a database where the objects already exist.
CREATE SEQUENCE IF NOT EXISTS public.ioeti_admin_audit_seq START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;

CREATE TABLE IF NOT EXISTS public.ioeti_admin_audit (
    id bigint NOT NULL,
    archived boolean,
    import_id character varying(255),
    import_origin character varying(255),
    process_instance_id character varying(255),
    version integer,
    created_on timestamp(6) without time zone,
    updated_on timestamp(6) without time zone,
    action character varying(60) NOT NULL,
    attrs jsonb,
    changes text,
    created_at timestamp(6) without time zone NOT NULL,
    subject character varying(40) NOT NULL,
    subject_id bigint,
    subject_label character varying(200),
    created_by bigint,
    updated_by bigint,
    actor bigint,
    CONSTRAINT ioeti_admin_audit_pkey PRIMARY KEY (id)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_4nmdd3i5cp24l4y965o86c03h') THEN
    ALTER TABLE public.ioeti_admin_audit ADD CONSTRAINT uk_4nmdd3i5cp24l4y965o86c03h UNIQUE (import_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_9aointr41dnfncsdrchpmt10x') THEN
    ALTER TABLE public.ioeti_admin_audit ADD CONSTRAINT fk_9aointr41dnfncsdrchpmt10x FOREIGN KEY (actor) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_bwc87jig8onv352en28bhnvr6') THEN
    ALTER TABLE public.ioeti_admin_audit ADD CONSTRAINT fk_bwc87jig8onv352en28bhnvr6 FOREIGN KEY (created_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_s1s5ktsrokhe5jbs9p1buqe9i') THEN
    ALTER TABLE public.ioeti_admin_audit ADD CONSTRAINT fk_s1s5ktsrokhe5jbs9p1buqe9i FOREIGN KEY (updated_by) REFERENCES public.auth_user(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ioeti_admin_audit_actor_idx ON public.ioeti_admin_audit USING btree (actor);

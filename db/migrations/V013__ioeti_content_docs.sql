-- IOETI documents (Wave 7a): document register and immutable revisions.
-- Mirrors the schema Hibernate generates from modules/ioeti-content/src/main/resources/domains/Content.xml (verified by scripts/db_migrate.py verify).
-- Idempotent: safe on a database where the objects already exist.
CREATE SEQUENCE IF NOT EXISTS public.ioeti_doc_document_seq START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
CREATE SEQUENCE IF NOT EXISTS public.ioeti_doc_revision_seq START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;

CREATE TABLE IF NOT EXISTS public.ioeti_doc_document (
    id bigint NOT NULL,
    archived boolean,
    import_id character varying(255),
    import_origin character varying(255),
    process_instance_id character varying(255),
    version integer,
    created_on timestamp(6) without time zone,
    updated_on timestamp(6) without time zone,
    attrs jsonb,
    current_revision integer,
    kind_select integer NOT NULL,
    language_select integer,
    subject_id bigint NOT NULL,
    subject_select integer NOT NULL,
    title character varying(200) NOT NULL,
    created_by bigint,
    updated_by bigint,
    owner bigint,
    CONSTRAINT ioeti_doc_document_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.ioeti_doc_revision (
    id bigint NOT NULL,
    archived boolean,
    import_id character varying(255),
    import_origin character varying(255),
    process_instance_id character varying(255),
    version integer,
    created_on timestamp(6) without time zone,
    updated_on timestamp(6) without time zone,
    attrs jsonb,
    change_summary character varying(255),
    content_type character varying(255) NOT NULL,
    file_name character varying(255) NOT NULL,
    number integer NOT NULL,
    sha256 character varying(64) NOT NULL,
    size_bytes bigint,
    uploaded_at timestamp(6) without time zone NOT NULL,
    created_by bigint,
    updated_by bigint,
    document bigint NOT NULL,
    file bigint NOT NULL,
    uploaded_by bigint,
    CONSTRAINT ioeti_doc_revision_pkey PRIMARY KEY (id)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_dxxt0i1cyj51dbmvgpwmhmkjd') THEN
    ALTER TABLE public.ioeti_doc_revision ADD CONSTRAINT uk_dxxt0i1cyj51dbmvgpwmhmkjd UNIQUE (document, number);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_jwxnkl56tha84jyypiy30jatd') THEN
    ALTER TABLE public.ioeti_doc_document ADD CONSTRAINT uk_jwxnkl56tha84jyypiy30jatd UNIQUE (import_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_t0s3oi182pmvvh9kve8s50vmf') THEN
    ALTER TABLE public.ioeti_doc_revision ADD CONSTRAINT uk_t0s3oi182pmvvh9kve8s50vmf UNIQUE (import_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_2ucjvh5w9dud4uwinpp7lxfp1') THEN
    ALTER TABLE public.ioeti_doc_document ADD CONSTRAINT fk_2ucjvh5w9dud4uwinpp7lxfp1 FOREIGN KEY (updated_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_5lclxndfsv8v86lxgao3tf3fs') THEN
    ALTER TABLE public.ioeti_doc_document ADD CONSTRAINT fk_5lclxndfsv8v86lxgao3tf3fs FOREIGN KEY (owner) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_9jco6rmjl3t4p586p6fxtl3dt') THEN
    ALTER TABLE public.ioeti_doc_revision ADD CONSTRAINT fk_9jco6rmjl3t4p586p6fxtl3dt FOREIGN KEY (uploaded_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ip7t7so4gd3qk3drc7243668k') THEN
    ALTER TABLE public.ioeti_doc_revision ADD CONSTRAINT fk_ip7t7so4gd3qk3drc7243668k FOREIGN KEY (created_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_kwkrsk3srj8jfr3iorck774d6') THEN
    ALTER TABLE public.ioeti_doc_revision ADD CONSTRAINT fk_kwkrsk3srj8jfr3iorck774d6 FOREIGN KEY (file) REFERENCES public.meta_file(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_m5fkqa2vsc41044kba0ps36al') THEN
    ALTER TABLE public.ioeti_doc_document ADD CONSTRAINT fk_m5fkqa2vsc41044kba0ps36al FOREIGN KEY (created_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_rsdunnpls91bratpksv50ns8r') THEN
    ALTER TABLE public.ioeti_doc_revision ADD CONSTRAINT fk_rsdunnpls91bratpksv50ns8r FOREIGN KEY (document) REFERENCES public.ioeti_doc_document(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_to23thiu51qtjg7smgqnod123') THEN
    ALTER TABLE public.ioeti_doc_revision ADD CONSTRAINT fk_to23thiu51qtjg7smgqnod123 FOREIGN KEY (updated_by) REFERENCES public.auth_user(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ioeti_doc_document_owner_idx ON public.ioeti_doc_document USING btree (owner);
CREATE INDEX IF NOT EXISTS ioeti_doc_document_subject_id_idx ON public.ioeti_doc_document USING btree (subject_id);
CREATE INDEX IF NOT EXISTS ioeti_doc_revision_document_idx ON public.ioeti_doc_revision USING btree (document);
CREATE INDEX IF NOT EXISTS ioeti_doc_revision_file_idx ON public.ioeti_doc_revision USING btree (file);
CREATE INDEX IF NOT EXISTS ioeti_doc_revision_uploaded_by_idx ON public.ioeti_doc_revision USING btree (uploaded_by);

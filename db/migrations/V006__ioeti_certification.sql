-- Wave 4b: client certification (module ioeti-certification): cycles, audits, auditor qualifications, nonconformities.
-- Mirrors the schema Hibernate generates from domains/Certification.xml (verified by scripts/db_migrate.py verify).
-- Idempotent: safe on a database where the objects already exist.
CREATE SEQUENCE IF NOT EXISTS public.ioeti_cert_audit_seq START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
CREATE SEQUENCE IF NOT EXISTS public.ioeti_cert_auditor_qual_seq START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
CREATE SEQUENCE IF NOT EXISTS public.ioeti_cert_cycle_seq START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
CREATE SEQUENCE IF NOT EXISTS public.ioeti_cert_nonconformity_seq START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;

CREATE TABLE IF NOT EXISTS public.ioeti_cert_audit (
    id bigint NOT NULL,
    archived boolean,
    import_id character varying(255),
    import_origin character varying(255),
    process_instance_id character varying(255),
    version integer,
    created_on timestamp(6) without time zone,
    updated_on timestamp(6) without time zone,
    attrs jsonb,
    completed_on date,
    planned_date date NOT NULL,
    status_select integer NOT NULL,
    type_select integer NOT NULL,
    created_by bigint,
    updated_by bigint,
    auditor bigint NOT NULL,
    cycle bigint NOT NULL,
    CONSTRAINT ioeti_cert_audit_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.ioeti_cert_auditor_qual (
    id bigint NOT NULL,
    archived boolean,
    import_id character varying(255),
    import_origin character varying(255),
    process_instance_id character varying(255),
    version integer,
    created_on timestamp(6) without time zone,
    updated_on timestamp(6) without time zone,
    attrs jsonb,
    evidence_reference character varying(255),
    valid_from date NOT NULL,
    valid_until date NOT NULL,
    created_by bigint,
    updated_by bigint,
    auditor bigint NOT NULL,
    business_line bigint NOT NULL,
    CONSTRAINT ioeti_cert_auditor_qual_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.ioeti_cert_cycle (
    id bigint NOT NULL,
    archived boolean,
    import_id character varying(255),
    import_origin character varying(255),
    process_instance_id character varying(255),
    version integer,
    created_on timestamp(6) without time zone,
    updated_on timestamp(6) without time zone,
    attrs jsonb,
    reference character varying(30) NOT NULL,
    scope text,
    site_count integer,
    created_by bigint,
    updated_by bigint,
    business_line bigint NOT NULL,
    client bigint NOT NULL,
    manager bigint,
    CONSTRAINT ioeti_cert_cycle_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.ioeti_cert_nonconformity (
    id bigint NOT NULL,
    archived boolean,
    import_id character varying(255),
    import_origin character varying(255),
    process_instance_id character varying(255),
    version integer,
    created_on timestamp(6) without time zone,
    updated_on timestamp(6) without time zone,
    attrs jsonb,
    clause character varying(20),
    client_response text,
    grade_select integer NOT NULL,
    statement text NOT NULL,
    status_select integer NOT NULL,
    created_by bigint,
    updated_by bigint,
    audit bigint NOT NULL,
    CONSTRAINT ioeti_cert_nonconformity_pkey PRIMARY KEY (id)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_jy1q26ficj33yms685wwewuwn') THEN
    ALTER TABLE public.ioeti_cert_audit ADD CONSTRAINT uk_jy1q26ficj33yms685wwewuwn UNIQUE (import_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_dshg630ufb5kakcsmtboo3hlm') THEN
    ALTER TABLE public.ioeti_cert_auditor_qual ADD CONSTRAINT uk_dshg630ufb5kakcsmtboo3hlm UNIQUE (import_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_7fh8sqiu2kr1x09goqpi0wn0v') THEN
    ALTER TABLE public.ioeti_cert_cycle ADD CONSTRAINT uk_7fh8sqiu2kr1x09goqpi0wn0v UNIQUE (import_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_g0ryba7lvom23esfd43vm7mol') THEN
    ALTER TABLE public.ioeti_cert_cycle ADD CONSTRAINT uk_g0ryba7lvom23esfd43vm7mol UNIQUE (reference);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_j0istti3rmfjjixk1tgd40auw') THEN
    ALTER TABLE public.ioeti_cert_nonconformity ADD CONSTRAINT uk_j0istti3rmfjjixk1tgd40auw UNIQUE (import_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_81f4867nvy03jkhxorapobkdt') THEN
    ALTER TABLE public.ioeti_cert_audit ADD CONSTRAINT fk_81f4867nvy03jkhxorapobkdt FOREIGN KEY (updated_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_l4926q34c27cvfb3dhmhgydud') THEN
    ALTER TABLE public.ioeti_cert_audit ADD CONSTRAINT fk_l4926q34c27cvfb3dhmhgydud FOREIGN KEY (cycle) REFERENCES public.ioeti_cert_cycle(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_m62d96yuqy8jeynelcv9ptn0f') THEN
    ALTER TABLE public.ioeti_cert_audit ADD CONSTRAINT fk_m62d96yuqy8jeynelcv9ptn0f FOREIGN KEY (auditor) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_rn1vgnayh2lgtjii78pwfgeqf') THEN
    ALTER TABLE public.ioeti_cert_audit ADD CONSTRAINT fk_rn1vgnayh2lgtjii78pwfgeqf FOREIGN KEY (created_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_2sv82a3ns5rwau6xrhpxi45dp') THEN
    ALTER TABLE public.ioeti_cert_auditor_qual ADD CONSTRAINT fk_2sv82a3ns5rwau6xrhpxi45dp FOREIGN KEY (created_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_aoiys2bsrm924ovsfmccpte3k') THEN
    ALTER TABLE public.ioeti_cert_auditor_qual ADD CONSTRAINT fk_aoiys2bsrm924ovsfmccpte3k FOREIGN KEY (auditor) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_kcwdbilo6tqkvf1l4mce0w1cd') THEN
    ALTER TABLE public.ioeti_cert_auditor_qual ADD CONSTRAINT fk_kcwdbilo6tqkvf1l4mce0w1cd FOREIGN KEY (updated_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_nuxqak14b5msfjh0i691ml7yn') THEN
    ALTER TABLE public.ioeti_cert_auditor_qual ADD CONSTRAINT fk_nuxqak14b5msfjh0i691ml7yn FOREIGN KEY (business_line) REFERENCES public.ioeti_business_line(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_744pbvmvskhvqvfgg4ai8q7f') THEN
    ALTER TABLE public.ioeti_cert_cycle ADD CONSTRAINT fk_744pbvmvskhvqvfgg4ai8q7f FOREIGN KEY (updated_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_f3xgv66479xp120yfha55stow') THEN
    ALTER TABLE public.ioeti_cert_cycle ADD CONSTRAINT fk_f3xgv66479xp120yfha55stow FOREIGN KEY (created_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_hd5s7vvhwtw8qc5eb1glyqt3a') THEN
    ALTER TABLE public.ioeti_cert_cycle ADD CONSTRAINT fk_hd5s7vvhwtw8qc5eb1glyqt3a FOREIGN KEY (client) REFERENCES public.base_partner(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_n4eeh4h3c75m8huijkni933ai') THEN
    ALTER TABLE public.ioeti_cert_cycle ADD CONSTRAINT fk_n4eeh4h3c75m8huijkni933ai FOREIGN KEY (business_line) REFERENCES public.ioeti_business_line(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_nfa90aesib7ks53008wh34hdx') THEN
    ALTER TABLE public.ioeti_cert_cycle ADD CONSTRAINT fk_nfa90aesib7ks53008wh34hdx FOREIGN KEY (manager) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_2p3298dpyto57758g3m2gf31l') THEN
    ALTER TABLE public.ioeti_cert_nonconformity ADD CONSTRAINT fk_2p3298dpyto57758g3m2gf31l FOREIGN KEY (updated_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_en2tjr9akmt0g3yxwl5glmjjs') THEN
    ALTER TABLE public.ioeti_cert_nonconformity ADD CONSTRAINT fk_en2tjr9akmt0g3yxwl5glmjjs FOREIGN KEY (audit) REFERENCES public.ioeti_cert_audit(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ptdehy0o44dfhhdmlq4uw7pri') THEN
    ALTER TABLE public.ioeti_cert_nonconformity ADD CONSTRAINT fk_ptdehy0o44dfhhdmlq4uw7pri FOREIGN KEY (created_by) REFERENCES public.auth_user(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ioeti_cert_audit_auditor_idx ON public.ioeti_cert_audit USING btree (auditor);
CREATE INDEX IF NOT EXISTS ioeti_cert_audit_cycle_idx ON public.ioeti_cert_audit USING btree (cycle);
CREATE INDEX IF NOT EXISTS ioeti_cert_auditor_qual_auditor_idx ON public.ioeti_cert_auditor_qual USING btree (auditor);
CREATE INDEX IF NOT EXISTS ioeti_cert_auditor_qual_business_line_idx ON public.ioeti_cert_auditor_qual USING btree (business_line);
CREATE INDEX IF NOT EXISTS ioeti_cert_cycle_business_line_idx ON public.ioeti_cert_cycle USING btree (business_line);
CREATE INDEX IF NOT EXISTS ioeti_cert_cycle_client_idx ON public.ioeti_cert_cycle USING btree (client);
CREATE INDEX IF NOT EXISTS ioeti_cert_cycle_manager_idx ON public.ioeti_cert_cycle USING btree (manager);
CREATE INDEX IF NOT EXISTS ioeti_cert_nonconformity_audit_idx ON public.ioeti_cert_nonconformity USING btree (audit);

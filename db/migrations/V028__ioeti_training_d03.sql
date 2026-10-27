-- D-03 (signed 2026-10-25): external training certificates, national IDs, invoice links and refunds (module ioeti-training).
-- An enrolment records its assessment score (where the course has a pass mark) and the day it was cancelled; certificates
-- carry a unique serial from the native numbering and the criteria policy version; a national ID lives in its own restricted
-- table; finance links an enrolment to its issued invoice (with its share) and decides refunds, which record their credit note.
-- Mirrors the schema Hibernate generates from modules/ioeti-training/src/main/resources/domains/Training.xml and
-- TrainingCompletion.xml (verified by scripts/db_migrate.py verify). Idempotent: safe on a database where the objects exist.
ALTER TABLE public.ioeti_training_enrollment ADD COLUMN IF NOT EXISTS assessment_score numeric(5,2);
ALTER TABLE public.ioeti_training_enrollment ADD COLUMN IF NOT EXISTS assessed_on date;
ALTER TABLE public.ioeti_training_enrollment ADD COLUMN IF NOT EXISTS cancelled_on date;
ALTER TABLE public.ioeti_training_enrollment ADD COLUMN IF NOT EXISTS assessed_by bigint;

CREATE SEQUENCE IF NOT EXISTS public.ioeti_training_certificate_seq START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
CREATE SEQUENCE IF NOT EXISTS public.ioeti_training_national_id_seq START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
CREATE SEQUENCE IF NOT EXISTS public.ioeti_training_fee_seq START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
CREATE SEQUENCE IF NOT EXISTS public.ioeti_training_refund_seq START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;

CREATE TABLE IF NOT EXISTS public.ioeti_training_certificate (
    id bigint NOT NULL,
    archived boolean,
    import_id character varying(255),
    import_origin character varying(255),
    process_instance_id character varying(255),
    version integer,
    created_on timestamp(6) without time zone,
    updated_on timestamp(6) without time zone,
    attrs jsonb,
    attendance_percent numeric(5,2) NOT NULL,
    issue_date date NOT NULL,
    course_title character varying(255) NOT NULL,
    course_title_ar character varying(255),
    revoke_reason character varying(500),
    revoked_on date,
    score numeric(5,2),
    serial character varying(40) NOT NULL,
    status_select integer NOT NULL,
    trainee_name character varying(255) NOT NULL,
    created_by bigint,
    updated_by bigint,
    enrollment bigint NOT NULL,
    policy_version bigint NOT NULL,
    issued_by bigint,
    revoked_by bigint,
    CONSTRAINT ioeti_training_certificate_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.ioeti_training_national_id (
    id bigint NOT NULL,
    archived boolean,
    import_id character varying(255),
    import_origin character varying(255),
    process_instance_id character varying(255),
    version integer,
    created_on timestamp(6) without time zone,
    updated_on timestamp(6) without time zone,
    attrs jsonb,
    id_number character varying(20) NOT NULL,
    recorded_at timestamp(6) without time zone NOT NULL,
    created_by bigint,
    updated_by bigint,
    enrollment bigint NOT NULL,
    recorded_by bigint,
    CONSTRAINT ioeti_training_national_id_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.ioeti_training_fee (
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
    linked_at timestamp(6) without time zone NOT NULL,
    created_by bigint,
    updated_by bigint,
    enrollment bigint NOT NULL,
    invoice bigint NOT NULL,
    linked_by bigint,
    CONSTRAINT ioeti_training_fee_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.ioeti_training_refund (
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
    cause_select integer NOT NULL,
    credit_percent numeric(5,2) NOT NULL,
    credited_amount numeric(20,2),
    days_before_start integer,
    decided_at timestamp(6) without time zone,
    paid_amount numeric(20,2) NOT NULL,
    refund_percent numeric(5,2) NOT NULL,
    reject_reason character varying(500),
    requested_at timestamp(6) without time zone NOT NULL,
    status_select integer NOT NULL,
    created_by bigint,
    updated_by bigint,
    enrollment bigint NOT NULL,
    invoice bigint NOT NULL,
    policy_version bigint NOT NULL,
    requested_by bigint,
    decided_by bigint,
    credit_note bigint,
    CONSTRAINT ioeti_training_refund_pkey PRIMARY KEY (id)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_ifdfr5q42gy3qsq6x8rcruye') THEN
    ALTER TABLE public.ioeti_training_certificate ADD CONSTRAINT uk_ifdfr5q42gy3qsq6x8rcruye UNIQUE (import_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_moi0fqybm5nrni7o0fjqdfy5f') THEN
    ALTER TABLE public.ioeti_training_certificate ADD CONSTRAINT uk_moi0fqybm5nrni7o0fjqdfy5f UNIQUE (serial);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_l96hbabwo8a0j1n2gnu6xii54') THEN
    ALTER TABLE public.ioeti_training_certificate ADD CONSTRAINT fk_l96hbabwo8a0j1n2gnu6xii54 FOREIGN KEY (created_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_l426121wjjf20nk0vsqxcgqev') THEN
    ALTER TABLE public.ioeti_training_certificate ADD CONSTRAINT fk_l426121wjjf20nk0vsqxcgqev FOREIGN KEY (updated_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_p7pn6ihrmuj8mmnj7hfuuyyjp') THEN
    ALTER TABLE public.ioeti_training_certificate ADD CONSTRAINT fk_p7pn6ihrmuj8mmnj7hfuuyyjp FOREIGN KEY (enrollment) REFERENCES public.ioeti_training_enrollment(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_8d7o0b0bwfl6mlj2s9241mgv3') THEN
    ALTER TABLE public.ioeti_training_certificate ADD CONSTRAINT fk_8d7o0b0bwfl6mlj2s9241mgv3 FOREIGN KEY (policy_version) REFERENCES public.ioeti_policy_version(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_h7o4koirr5k36kpfm0c3cq5yq') THEN
    ALTER TABLE public.ioeti_training_certificate ADD CONSTRAINT fk_h7o4koirr5k36kpfm0c3cq5yq FOREIGN KEY (issued_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_1njycfl7ryu9netyd4ojb04f1') THEN
    ALTER TABLE public.ioeti_training_certificate ADD CONSTRAINT fk_1njycfl7ryu9netyd4ojb04f1 FOREIGN KEY (revoked_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_8db1omecxcg7ji3esurjfad2q') THEN
    ALTER TABLE public.ioeti_training_national_id ADD CONSTRAINT uk_8db1omecxcg7ji3esurjfad2q UNIQUE (import_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_kdn6ryib62pk4w8khh7pi9fgl') THEN
    ALTER TABLE public.ioeti_training_national_id ADD CONSTRAINT uk_kdn6ryib62pk4w8khh7pi9fgl UNIQUE (enrollment);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_fxf9pssjpqvcyybc5bw197xb8') THEN
    ALTER TABLE public.ioeti_training_national_id ADD CONSTRAINT fk_fxf9pssjpqvcyybc5bw197xb8 FOREIGN KEY (created_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_88f4iqf866p0wv0amvmwx0p15') THEN
    ALTER TABLE public.ioeti_training_national_id ADD CONSTRAINT fk_88f4iqf866p0wv0amvmwx0p15 FOREIGN KEY (updated_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_kdn6ryib62pk4w8khh7pi9fgl') THEN
    ALTER TABLE public.ioeti_training_national_id ADD CONSTRAINT fk_kdn6ryib62pk4w8khh7pi9fgl FOREIGN KEY (enrollment) REFERENCES public.ioeti_training_enrollment(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_eb0he9y4firmxwg27nbl6hi7') THEN
    ALTER TABLE public.ioeti_training_national_id ADD CONSTRAINT fk_eb0he9y4firmxwg27nbl6hi7 FOREIGN KEY (recorded_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_2lq6eok6vj91mteekmp7jd2x4') THEN
    ALTER TABLE public.ioeti_training_fee ADD CONSTRAINT uk_2lq6eok6vj91mteekmp7jd2x4 UNIQUE (import_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_l2saa4xdsg94421ub4mjyridj') THEN
    ALTER TABLE public.ioeti_training_fee ADD CONSTRAINT uk_l2saa4xdsg94421ub4mjyridj UNIQUE (enrollment);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_10v6tiwfo5fh0yh039optskri') THEN
    ALTER TABLE public.ioeti_training_fee ADD CONSTRAINT fk_10v6tiwfo5fh0yh039optskri FOREIGN KEY (created_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_i25opm9y79y6dy73jtyi2m9rn') THEN
    ALTER TABLE public.ioeti_training_fee ADD CONSTRAINT fk_i25opm9y79y6dy73jtyi2m9rn FOREIGN KEY (updated_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_l2saa4xdsg94421ub4mjyridj') THEN
    ALTER TABLE public.ioeti_training_fee ADD CONSTRAINT fk_l2saa4xdsg94421ub4mjyridj FOREIGN KEY (enrollment) REFERENCES public.ioeti_training_enrollment(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_nns6d19bos5cugr4n3ugg0xfc') THEN
    ALTER TABLE public.ioeti_training_fee ADD CONSTRAINT fk_nns6d19bos5cugr4n3ugg0xfc FOREIGN KEY (invoice) REFERENCES public.account_invoice(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_pooxt1qwhwudt9j3idk55yvwu') THEN
    ALTER TABLE public.ioeti_training_fee ADD CONSTRAINT fk_pooxt1qwhwudt9j3idk55yvwu FOREIGN KEY (linked_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_7hriu6pkaj87q27tn1cdqbybj') THEN
    ALTER TABLE public.ioeti_training_refund ADD CONSTRAINT uk_7hriu6pkaj87q27tn1cdqbybj UNIQUE (import_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_evm6u9ktdi81sw9ovw7bn607v') THEN
    ALTER TABLE public.ioeti_training_refund ADD CONSTRAINT uk_evm6u9ktdi81sw9ovw7bn607v UNIQUE (enrollment);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_eteua3rsuna1cji2khxgamsip') THEN
    ALTER TABLE public.ioeti_training_refund ADD CONSTRAINT uk_eteua3rsuna1cji2khxgamsip UNIQUE (credit_note);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_j72k558vr6v905b7by397qjd9') THEN
    ALTER TABLE public.ioeti_training_refund ADD CONSTRAINT fk_j72k558vr6v905b7by397qjd9 FOREIGN KEY (created_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_9q7akthbrodsa0l21g2qoi07l') THEN
    ALTER TABLE public.ioeti_training_refund ADD CONSTRAINT fk_9q7akthbrodsa0l21g2qoi07l FOREIGN KEY (updated_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_evm6u9ktdi81sw9ovw7bn607v') THEN
    ALTER TABLE public.ioeti_training_refund ADD CONSTRAINT fk_evm6u9ktdi81sw9ovw7bn607v FOREIGN KEY (enrollment) REFERENCES public.ioeti_training_enrollment(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_qh5mltrnowpibk7fcuk9gfuko') THEN
    ALTER TABLE public.ioeti_training_refund ADD CONSTRAINT fk_qh5mltrnowpibk7fcuk9gfuko FOREIGN KEY (invoice) REFERENCES public.account_invoice(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_mw4ab1cq2bnhn3lfkxjbmc0p1') THEN
    ALTER TABLE public.ioeti_training_refund ADD CONSTRAINT fk_mw4ab1cq2bnhn3lfkxjbmc0p1 FOREIGN KEY (policy_version) REFERENCES public.ioeti_policy_version(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ije19mmvkckcbh8rq41f7vtva') THEN
    ALTER TABLE public.ioeti_training_refund ADD CONSTRAINT fk_ije19mmvkckcbh8rq41f7vtva FOREIGN KEY (requested_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_gcpw9rd70po90d6wt3fao55v') THEN
    ALTER TABLE public.ioeti_training_refund ADD CONSTRAINT fk_gcpw9rd70po90d6wt3fao55v FOREIGN KEY (decided_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_eteua3rsuna1cji2khxgamsip') THEN
    ALTER TABLE public.ioeti_training_refund ADD CONSTRAINT fk_eteua3rsuna1cji2khxgamsip FOREIGN KEY (credit_note) REFERENCES public.account_invoice(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_2mudgr3tdkkifeckbi3qxtcnx') THEN
    ALTER TABLE public.ioeti_training_enrollment ADD CONSTRAINT fk_2mudgr3tdkkifeckbi3qxtcnx FOREIGN KEY (assessed_by) REFERENCES public.auth_user(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ioeti_training_certificate_enrollment_idx ON public.ioeti_training_certificate USING btree (enrollment);
CREATE INDEX IF NOT EXISTS ioeti_training_certificate_issued_by_idx ON public.ioeti_training_certificate USING btree (issued_by);
CREATE INDEX IF NOT EXISTS ioeti_training_certificate_policy_version_idx ON public.ioeti_training_certificate USING btree (policy_version);
CREATE INDEX IF NOT EXISTS ioeti_training_certificate_revoked_by_idx ON public.ioeti_training_certificate USING btree (revoked_by);
CREATE INDEX IF NOT EXISTS ioeti_training_enrollment_assessed_by_idx ON public.ioeti_training_enrollment USING btree (assessed_by);
CREATE INDEX IF NOT EXISTS ioeti_training_fee_enrollment_idx ON public.ioeti_training_fee USING btree (enrollment);
CREATE INDEX IF NOT EXISTS ioeti_training_fee_invoice_idx ON public.ioeti_training_fee USING btree (invoice);
CREATE INDEX IF NOT EXISTS ioeti_training_fee_linked_by_idx ON public.ioeti_training_fee USING btree (linked_by);
CREATE INDEX IF NOT EXISTS ioeti_training_national_id_enrollment_idx ON public.ioeti_training_national_id USING btree (enrollment);
CREATE INDEX IF NOT EXISTS ioeti_training_national_id_recorded_by_idx ON public.ioeti_training_national_id USING btree (recorded_by);
CREATE INDEX IF NOT EXISTS ioeti_training_refund_credit_note_idx ON public.ioeti_training_refund USING btree (credit_note);
CREATE INDEX IF NOT EXISTS ioeti_training_refund_decided_by_idx ON public.ioeti_training_refund USING btree (decided_by);
CREATE INDEX IF NOT EXISTS ioeti_training_refund_enrollment_idx ON public.ioeti_training_refund USING btree (enrollment);
CREATE INDEX IF NOT EXISTS ioeti_training_refund_invoice_idx ON public.ioeti_training_refund USING btree (invoice);
CREATE INDEX IF NOT EXISTS ioeti_training_refund_policy_version_idx ON public.ioeti_training_refund USING btree (policy_version);
CREATE INDEX IF NOT EXISTS ioeti_training_refund_requested_by_idx ON public.ioeti_training_refund USING btree (requested_by);

-- Wave 4D: agency recruitment (module ioeti-recruitment): job orders, candidates, restricted profiles, consents, applications, interviews, placements, fee events.
-- Mirrors the schema Hibernate generates from domains/Recruitment.xml (verified by scripts/db_migrate.py verify).
-- Idempotent: safe on a database where the objects already exist.
CREATE SEQUENCE IF NOT EXISTS public.ioeti_rec_application_seq START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
CREATE SEQUENCE IF NOT EXISTS public.ioeti_rec_candidate_private_seq START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
CREATE SEQUENCE IF NOT EXISTS public.ioeti_rec_candidate_seq START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
CREATE SEQUENCE IF NOT EXISTS public.ioeti_rec_consent_seq START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
CREATE SEQUENCE IF NOT EXISTS public.ioeti_rec_fee_milestone_seq START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
CREATE SEQUENCE IF NOT EXISTS public.ioeti_rec_interview_seq START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
CREATE SEQUENCE IF NOT EXISTS public.ioeti_rec_job_order_seq START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
CREATE SEQUENCE IF NOT EXISTS public.ioeti_rec_placement_seq START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;

CREATE TABLE IF NOT EXISTS public.ioeti_rec_application (
    id bigint NOT NULL,
    archived boolean,
    import_id character varying(255),
    import_origin character varying(255),
    process_instance_id character varying(255),
    version integer,
    created_on timestamp(6) without time zone,
    updated_on timestamp(6) without time zone,
    attrs jsonb,
    offer_date date,
    offer_status_select integer,
    stage_select integer NOT NULL,
    submitted_at timestamp(6) without time zone,
    created_by bigint,
    updated_by bigint,
    candidate bigint NOT NULL,
    job_order bigint NOT NULL,
    CONSTRAINT ioeti_rec_application_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.ioeti_rec_candidate (
    id bigint NOT NULL,
    archived boolean,
    import_id character varying(255),
    import_origin character varying(255),
    process_instance_id character varying(255),
    version integer,
    created_on timestamp(6) without time zone,
    updated_on timestamp(6) without time zone,
    attrs jsonb,
    display_name character varying(255) NOT NULL,
    headline character varying(255),
    years_experience integer,
    created_by bigint,
    updated_by bigint,
    owner bigint,
    CONSTRAINT ioeti_rec_candidate_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.ioeti_rec_candidate_private (
    id bigint NOT NULL,
    archived boolean,
    import_id character varying(255),
    import_origin character varying(255),
    process_instance_id character varying(255),
    version integer,
    created_on timestamp(6) without time zone,
    updated_on timestamp(6) without time zone,
    attrs jsonb,
    cv_reference character varying(255),
    email character varying(255),
    expected_salary numeric(20,2),
    phone character varying(255),
    created_by bigint,
    updated_by bigint,
    candidate bigint NOT NULL,
    CONSTRAINT ioeti_rec_candidate_private_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.ioeti_rec_consent (
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
    given_on date NOT NULL,
    method_select integer NOT NULL,
    revoked_at timestamp(6) without time zone,
    created_by bigint,
    updated_by bigint,
    candidate bigint NOT NULL,
    job_order bigint NOT NULL,
    CONSTRAINT ioeti_rec_consent_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.ioeti_rec_fee_milestone (
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
    occurred_on date NOT NULL,
    created_by bigint,
    updated_by bigint,
    placement bigint NOT NULL,
    CONSTRAINT ioeti_rec_fee_milestone_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.ioeti_rec_interview (
    id bigint NOT NULL,
    archived boolean,
    import_id character varying(255),
    import_origin character varying(255),
    process_instance_id character varying(255),
    version integer,
    created_on timestamp(6) without time zone,
    updated_on timestamp(6) without time zone,
    attrs jsonb,
    outcome_select integer NOT NULL,
    round integer NOT NULL,
    scheduled_at timestamp(6) without time zone NOT NULL,
    created_by bigint,
    updated_by bigint,
    application bigint NOT NULL,
    CONSTRAINT ioeti_rec_interview_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.ioeti_rec_job_order (
    id bigint NOT NULL,
    archived boolean,
    import_id character varying(255),
    import_origin character varying(255),
    process_instance_id character varying(255),
    version integer,
    created_on timestamp(6) without time zone,
    updated_on timestamp(6) without time zone,
    attrs jsonb,
    headcount integer NOT NULL,
    location character varying(255),
    reference character varying(30) NOT NULL,
    requirements text,
    status_select integer NOT NULL,
    title character varying(255) NOT NULL,
    created_by bigint,
    updated_by bigint,
    client bigint NOT NULL,
    recruiter bigint,
    CONSTRAINT ioeti_rec_job_order_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.ioeti_rec_placement (
    id bigint NOT NULL,
    archived boolean,
    import_id character varying(255),
    import_origin character varying(255),
    process_instance_id character varying(255),
    version integer,
    created_on timestamp(6) without time zone,
    updated_on timestamp(6) without time zone,
    attrs jsonb,
    guarantee_status_select integer NOT NULL,
    start_date date NOT NULL,
    created_by bigint,
    updated_by bigint,
    application bigint NOT NULL,
    CONSTRAINT ioeti_rec_placement_pkey PRIMARY KEY (id)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_15midckumj9uql9md2hn6fbcs') THEN
    ALTER TABLE public.ioeti_rec_candidate_private ADD CONSTRAINT uk_15midckumj9uql9md2hn6fbcs UNIQUE (candidate);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_2mlwmy78gke4s5tqo2v6g3jci') THEN
    ALTER TABLE public.ioeti_rec_fee_milestone ADD CONSTRAINT uk_2mlwmy78gke4s5tqo2v6g3jci UNIQUE (import_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_2r3l1ywqf87w92n3mu1ydyhdi') THEN
    ALTER TABLE public.ioeti_rec_consent ADD CONSTRAINT uk_2r3l1ywqf87w92n3mu1ydyhdi UNIQUE (import_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_9g93poks62hdykt8gd3gd73nn') THEN
    ALTER TABLE public.ioeti_rec_application ADD CONSTRAINT uk_9g93poks62hdykt8gd3gd73nn UNIQUE (job_order, candidate);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_ac8tgcv5ss7tweii3iiofstbb') THEN
    ALTER TABLE public.ioeti_rec_placement ADD CONSTRAINT uk_ac8tgcv5ss7tweii3iiofstbb UNIQUE (import_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_kjud5r7k1l0ns5phxxfjjlsxl') THEN
    ALTER TABLE public.ioeti_rec_candidate_private ADD CONSTRAINT uk_kjud5r7k1l0ns5phxxfjjlsxl UNIQUE (import_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_kwe7mt4hjvn1t3k8tm2ajavdd') THEN
    ALTER TABLE public.ioeti_rec_job_order ADD CONSTRAINT uk_kwe7mt4hjvn1t3k8tm2ajavdd UNIQUE (reference);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_m41keu32y6imnj6memqt2ocb2') THEN
    ALTER TABLE public.ioeti_rec_application ADD CONSTRAINT uk_m41keu32y6imnj6memqt2ocb2 UNIQUE (import_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_o4t4ipkxi6qshwaeuvooc3llk') THEN
    ALTER TABLE public.ioeti_rec_candidate ADD CONSTRAINT uk_o4t4ipkxi6qshwaeuvooc3llk UNIQUE (import_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_paoptxfd28wl3y2uumgc1v964') THEN
    ALTER TABLE public.ioeti_rec_fee_milestone ADD CONSTRAINT uk_paoptxfd28wl3y2uumgc1v964 UNIQUE (placement, kind_select);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_pcx2c12ghrk3d0gtm15ob2coi') THEN
    ALTER TABLE public.ioeti_rec_interview ADD CONSTRAINT uk_pcx2c12ghrk3d0gtm15ob2coi UNIQUE (import_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_r4uapqkpnfqv1cevklqfh91df') THEN
    ALTER TABLE public.ioeti_rec_job_order ADD CONSTRAINT uk_r4uapqkpnfqv1cevklqfh91df UNIQUE (import_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_stxxqx23ss4865bkhlxfvcp0e') THEN
    ALTER TABLE public.ioeti_rec_placement ADD CONSTRAINT uk_stxxqx23ss4865bkhlxfvcp0e UNIQUE (application);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_15midckumj9uql9md2hn6fbcs') THEN
    ALTER TABLE public.ioeti_rec_candidate_private ADD CONSTRAINT fk_15midckumj9uql9md2hn6fbcs FOREIGN KEY (candidate) REFERENCES public.ioeti_rec_candidate(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_1re02o1xjwv6s72v6l6kat14r') THEN
    ALTER TABLE public.ioeti_rec_consent ADD CONSTRAINT fk_1re02o1xjwv6s72v6l6kat14r FOREIGN KEY (updated_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_1wgcrjh6rsp3q1f52ks3vp0p0') THEN
    ALTER TABLE public.ioeti_rec_candidate_private ADD CONSTRAINT fk_1wgcrjh6rsp3q1f52ks3vp0p0 FOREIGN KEY (created_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_31sy63wph19sc86uomkmouwj6') THEN
    ALTER TABLE public.ioeti_rec_job_order ADD CONSTRAINT fk_31sy63wph19sc86uomkmouwj6 FOREIGN KEY (recruiter) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_45j42p2c9q5bugtotitsfxvkt') THEN
    ALTER TABLE public.ioeti_rec_candidate ADD CONSTRAINT fk_45j42p2c9q5bugtotitsfxvkt FOREIGN KEY (owner) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_53nmy9nfi0d7ca83bnqwxpoww') THEN
    ALTER TABLE public.ioeti_rec_fee_milestone ADD CONSTRAINT fk_53nmy9nfi0d7ca83bnqwxpoww FOREIGN KEY (created_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_54awgfdw1diugvhelmfed4v78') THEN
    ALTER TABLE public.ioeti_rec_job_order ADD CONSTRAINT fk_54awgfdw1diugvhelmfed4v78 FOREIGN KEY (updated_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_5t3xteprmadpivvj7dwprm1qr') THEN
    ALTER TABLE public.ioeti_rec_application ADD CONSTRAINT fk_5t3xteprmadpivvj7dwprm1qr FOREIGN KEY (created_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_6e3c342mr5d1oyeg4div6yhr5') THEN
    ALTER TABLE public.ioeti_rec_consent ADD CONSTRAINT fk_6e3c342mr5d1oyeg4div6yhr5 FOREIGN KEY (candidate) REFERENCES public.ioeti_rec_candidate(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_87paqsggb8gtmi7y6w0pqxnko') THEN
    ALTER TABLE public.ioeti_rec_application ADD CONSTRAINT fk_87paqsggb8gtmi7y6w0pqxnko FOREIGN KEY (job_order) REFERENCES public.ioeti_rec_job_order(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_90p9tvlsfqh562l6sjd8xxoh7') THEN
    ALTER TABLE public.ioeti_rec_candidate ADD CONSTRAINT fk_90p9tvlsfqh562l6sjd8xxoh7 FOREIGN KEY (updated_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_c37yv38pcy4omkbarg7miyhbv') THEN
    ALTER TABLE public.ioeti_rec_candidate ADD CONSTRAINT fk_c37yv38pcy4omkbarg7miyhbv FOREIGN KEY (created_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_cejiwkfjhxm028r4pohbv6xjb') THEN
    ALTER TABLE public.ioeti_rec_consent ADD CONSTRAINT fk_cejiwkfjhxm028r4pohbv6xjb FOREIGN KEY (job_order) REFERENCES public.ioeti_rec_job_order(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_dgttqmvtb30kw3lpxiorl7ued') THEN
    ALTER TABLE public.ioeti_rec_application ADD CONSTRAINT fk_dgttqmvtb30kw3lpxiorl7ued FOREIGN KEY (candidate) REFERENCES public.ioeti_rec_candidate(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_g71e50kh76x8f1t5ph5nftffq') THEN
    ALTER TABLE public.ioeti_rec_consent ADD CONSTRAINT fk_g71e50kh76x8f1t5ph5nftffq FOREIGN KEY (created_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_hof6afwkedkum838iqsusk6cf') THEN
    ALTER TABLE public.ioeti_rec_placement ADD CONSTRAINT fk_hof6afwkedkum838iqsusk6cf FOREIGN KEY (created_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_i5xs2atee9ai74g71sjhfk9tg') THEN
    ALTER TABLE public.ioeti_rec_placement ADD CONSTRAINT fk_i5xs2atee9ai74g71sjhfk9tg FOREIGN KEY (updated_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ie98nptxao22lt26rf0vcnymc') THEN
    ALTER TABLE public.ioeti_rec_job_order ADD CONSTRAINT fk_ie98nptxao22lt26rf0vcnymc FOREIGN KEY (client) REFERENCES public.base_partner(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_isrkq8h5ktbqpo1t0x2elpsw3') THEN
    ALTER TABLE public.ioeti_rec_application ADD CONSTRAINT fk_isrkq8h5ktbqpo1t0x2elpsw3 FOREIGN KEY (updated_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_j8rqn1dw0xe1f7hhd7echfmqr') THEN
    ALTER TABLE public.ioeti_rec_fee_milestone ADD CONSTRAINT fk_j8rqn1dw0xe1f7hhd7echfmqr FOREIGN KEY (placement) REFERENCES public.ioeti_rec_placement(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_kglbr6xgg8rr6u6vn78jbkyxp') THEN
    ALTER TABLE public.ioeti_rec_fee_milestone ADD CONSTRAINT fk_kglbr6xgg8rr6u6vn78jbkyxp FOREIGN KEY (updated_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_pqxjh32vcokyyd99sm6s4qm1b') THEN
    ALTER TABLE public.ioeti_rec_job_order ADD CONSTRAINT fk_pqxjh32vcokyyd99sm6s4qm1b FOREIGN KEY (created_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_qcum22ljhackb0532rtiysehi') THEN
    ALTER TABLE public.ioeti_rec_interview ADD CONSTRAINT fk_qcum22ljhackb0532rtiysehi FOREIGN KEY (created_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_qjj155sasgqn0266kuo9hwd4v') THEN
    ALTER TABLE public.ioeti_rec_interview ADD CONSTRAINT fk_qjj155sasgqn0266kuo9hwd4v FOREIGN KEY (updated_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_s8figm6t4qp01h482w3deav5h') THEN
    ALTER TABLE public.ioeti_rec_interview ADD CONSTRAINT fk_s8figm6t4qp01h482w3deav5h FOREIGN KEY (application) REFERENCES public.ioeti_rec_application(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_sqon93y605bmyfk38hcoig1g6') THEN
    ALTER TABLE public.ioeti_rec_candidate_private ADD CONSTRAINT fk_sqon93y605bmyfk38hcoig1g6 FOREIGN KEY (updated_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_stxxqx23ss4865bkhlxfvcp0e') THEN
    ALTER TABLE public.ioeti_rec_placement ADD CONSTRAINT fk_stxxqx23ss4865bkhlxfvcp0e FOREIGN KEY (application) REFERENCES public.ioeti_rec_application(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ioeti_rec_application_candidate_idx ON public.ioeti_rec_application USING btree (candidate);
CREATE INDEX IF NOT EXISTS ioeti_rec_application_job_order_idx ON public.ioeti_rec_application USING btree (job_order);
CREATE INDEX IF NOT EXISTS ioeti_rec_candidate_display_name_idx ON public.ioeti_rec_candidate USING btree (display_name);
CREATE INDEX IF NOT EXISTS ioeti_rec_candidate_owner_idx ON public.ioeti_rec_candidate USING btree (owner);
CREATE INDEX IF NOT EXISTS ioeti_rec_consent_candidate_idx ON public.ioeti_rec_consent USING btree (candidate);
CREATE INDEX IF NOT EXISTS ioeti_rec_consent_job_order_idx ON public.ioeti_rec_consent USING btree (job_order);
CREATE INDEX IF NOT EXISTS ioeti_rec_fee_milestone_placement_idx ON public.ioeti_rec_fee_milestone USING btree (placement);
CREATE INDEX IF NOT EXISTS ioeti_rec_interview_application_idx ON public.ioeti_rec_interview USING btree (application);
CREATE INDEX IF NOT EXISTS ioeti_rec_job_order_client_idx ON public.ioeti_rec_job_order USING btree (client);
CREATE INDEX IF NOT EXISTS ioeti_rec_job_order_recruiter_idx ON public.ioeti_rec_job_order USING btree (recruiter);

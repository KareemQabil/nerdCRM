-- Wave 4a: external training (module ioeti-training): courses, cohorts, enrolments, sessions, attendance.
-- Mirrors the schema Hibernate generates from domains/Training.xml (verified by scripts/db_migrate.py verify).
-- Idempotent: safe on a database where the objects already exist.
CREATE SEQUENCE IF NOT EXISTS public.ioeti_training_attendance_seq START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
CREATE SEQUENCE IF NOT EXISTS public.ioeti_training_cohort_seq START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
CREATE SEQUENCE IF NOT EXISTS public.ioeti_training_course_seq START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
CREATE SEQUENCE IF NOT EXISTS public.ioeti_training_enrollment_seq START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
CREATE SEQUENCE IF NOT EXISTS public.ioeti_training_session_seq START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;

CREATE TABLE IF NOT EXISTS public.ioeti_training_attendance (
    id bigint NOT NULL,
    archived boolean,
    import_id character varying(255),
    import_origin character varying(255),
    process_instance_id character varying(255),
    version integer,
    created_on timestamp(6) without time zone,
    updated_on timestamp(6) without time zone,
    attrs jsonb,
    status_select integer NOT NULL,
    created_by bigint,
    updated_by bigint,
    enrollment bigint NOT NULL,
    session bigint NOT NULL,
    CONSTRAINT ioeti_training_attendance_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.ioeti_training_cohort (
    id bigint NOT NULL,
    archived boolean,
    import_id character varying(255),
    import_origin character varying(255),
    process_instance_id character varying(255),
    version integer,
    created_on timestamp(6) without time zone,
    updated_on timestamp(6) without time zone,
    attrs jsonb,
    capacity integer NOT NULL,
    code character varying(30) NOT NULL,
    end_date date,
    location character varying(255),
    min_seats integer,
    start_date date,
    status_select integer NOT NULL,
    created_by bigint,
    updated_by bigint,
    coordinator bigint,
    course bigint NOT NULL,
    CONSTRAINT ioeti_training_cohort_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.ioeti_training_course (
    id bigint NOT NULL,
    archived boolean,
    import_id character varying(255),
    import_origin character varying(255),
    process_instance_id character varying(255),
    version integer,
    created_on timestamp(6) without time zone,
    updated_on timestamp(6) without time zone,
    active boolean,
    attrs jsonb,
    code character varying(30) NOT NULL,
    duration_hours integer,
    name character varying(255) NOT NULL,
    name_ar character varying(255),
    created_by bigint,
    updated_by bigint,
    business_line bigint,
    CONSTRAINT ioeti_training_course_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.ioeti_training_enrollment (
    id bigint NOT NULL,
    archived boolean,
    import_id character varying(255),
    import_origin character varying(255),
    process_instance_id character varying(255),
    version integer,
    created_on timestamp(6) without time zone,
    updated_on timestamp(6) without time zone,
    attrs jsonb,
    status_select integer NOT NULL,
    waitlist_position integer,
    created_by bigint,
    updated_by bigint,
    client bigint,
    cohort bigint NOT NULL,
    trainee bigint NOT NULL,
    CONSTRAINT ioeti_training_enrollment_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.ioeti_training_session (
    id bigint NOT NULL,
    archived boolean,
    import_id character varying(255),
    import_origin character varying(255),
    process_instance_id character varying(255),
    version integer,
    created_on timestamp(6) without time zone,
    updated_on timestamp(6) without time zone,
    attrs jsonb,
    duration_minutes integer,
    starts_at timestamp(6) without time zone NOT NULL,
    title character varying(255) NOT NULL,
    created_by bigint,
    updated_by bigint,
    cohort bigint NOT NULL,
    CONSTRAINT ioeti_training_session_pkey PRIMARY KEY (id)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_kjaqml2issged9s3tq23rbb0n') THEN
    ALTER TABLE public.ioeti_training_attendance ADD CONSTRAINT uk_kjaqml2issged9s3tq23rbb0n UNIQUE (import_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_srk5oju0dpixfkgu6gag33h2s') THEN
    ALTER TABLE public.ioeti_training_attendance ADD CONSTRAINT uk_srk5oju0dpixfkgu6gag33h2s UNIQUE (session, enrollment);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_ny81hsge1je6px0hwxl43ycwc') THEN
    ALTER TABLE public.ioeti_training_cohort ADD CONSTRAINT uk_ny81hsge1je6px0hwxl43ycwc UNIQUE (import_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_vmtbqi772yuuwwld3c8kkh9v') THEN
    ALTER TABLE public.ioeti_training_cohort ADD CONSTRAINT uk_vmtbqi772yuuwwld3c8kkh9v UNIQUE (code);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_e6tcdo1xjphbjdvk94l5bk3yg') THEN
    ALTER TABLE public.ioeti_training_course ADD CONSTRAINT uk_e6tcdo1xjphbjdvk94l5bk3yg UNIQUE (import_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_i5c55ph7ftlmhvxp8vknetwjf') THEN
    ALTER TABLE public.ioeti_training_course ADD CONSTRAINT uk_i5c55ph7ftlmhvxp8vknetwjf UNIQUE (code);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_q67ybdkkw4ar7varet1li06fk') THEN
    ALTER TABLE public.ioeti_training_enrollment ADD CONSTRAINT uk_q67ybdkkw4ar7varet1li06fk UNIQUE (import_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_qicujbbe6knd3bxgiopuwgsu8') THEN
    ALTER TABLE public.ioeti_training_session ADD CONSTRAINT uk_qicujbbe6knd3bxgiopuwgsu8 UNIQUE (import_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_1upad69r1ddwk6nkqdwivnjl0') THEN
    ALTER TABLE public.ioeti_training_attendance ADD CONSTRAINT fk_1upad69r1ddwk6nkqdwivnjl0 FOREIGN KEY (created_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_43mhoxaiad69s92prtyjy3y6u') THEN
    ALTER TABLE public.ioeti_training_attendance ADD CONSTRAINT fk_43mhoxaiad69s92prtyjy3y6u FOREIGN KEY (updated_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_aa4j2djyrgjylvo7vmlfq5kgw') THEN
    ALTER TABLE public.ioeti_training_attendance ADD CONSTRAINT fk_aa4j2djyrgjylvo7vmlfq5kgw FOREIGN KEY (enrollment) REFERENCES public.ioeti_training_enrollment(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_cymucnddi55u508i6y9196mfs') THEN
    ALTER TABLE public.ioeti_training_attendance ADD CONSTRAINT fk_cymucnddi55u508i6y9196mfs FOREIGN KEY (session) REFERENCES public.ioeti_training_session(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_3kn6ska6du16todv1qfha4bgs') THEN
    ALTER TABLE public.ioeti_training_cohort ADD CONSTRAINT fk_3kn6ska6du16todv1qfha4bgs FOREIGN KEY (updated_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_giw2wa0wgpj5e4mfkdpb16x08') THEN
    ALTER TABLE public.ioeti_training_cohort ADD CONSTRAINT fk_giw2wa0wgpj5e4mfkdpb16x08 FOREIGN KEY (coordinator) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_o7pyfbpc7rnesbj64rcm5auxd') THEN
    ALTER TABLE public.ioeti_training_cohort ADD CONSTRAINT fk_o7pyfbpc7rnesbj64rcm5auxd FOREIGN KEY (course) REFERENCES public.ioeti_training_course(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_un6pbujdebsm8sg2366fjkyx') THEN
    ALTER TABLE public.ioeti_training_cohort ADD CONSTRAINT fk_un6pbujdebsm8sg2366fjkyx FOREIGN KEY (created_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_d6tbgwvr79e0hc5tpdcauds5g') THEN
    ALTER TABLE public.ioeti_training_course ADD CONSTRAINT fk_d6tbgwvr79e0hc5tpdcauds5g FOREIGN KEY (business_line) REFERENCES public.ioeti_business_line(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ewwmqgjrx4u291a3xqh5i1u6c') THEN
    ALTER TABLE public.ioeti_training_course ADD CONSTRAINT fk_ewwmqgjrx4u291a3xqh5i1u6c FOREIGN KEY (created_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_radg9cmujhnqg1rrjq1phcthr') THEN
    ALTER TABLE public.ioeti_training_course ADD CONSTRAINT fk_radg9cmujhnqg1rrjq1phcthr FOREIGN KEY (updated_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_3mrvyefv5lfkgpqkwi9jce9q') THEN
    ALTER TABLE public.ioeti_training_enrollment ADD CONSTRAINT fk_3mrvyefv5lfkgpqkwi9jce9q FOREIGN KEY (updated_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_6h5yd6o6uhjanv5hb4ihyw7ed') THEN
    ALTER TABLE public.ioeti_training_enrollment ADD CONSTRAINT fk_6h5yd6o6uhjanv5hb4ihyw7ed FOREIGN KEY (created_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_aeic47uk09oh8ul1enidyqtu9') THEN
    ALTER TABLE public.ioeti_training_enrollment ADD CONSTRAINT fk_aeic47uk09oh8ul1enidyqtu9 FOREIGN KEY (client) REFERENCES public.base_partner(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_bmgdmlwvh65y8bpovkrp665g7') THEN
    ALTER TABLE public.ioeti_training_enrollment ADD CONSTRAINT fk_bmgdmlwvh65y8bpovkrp665g7 FOREIGN KEY (cohort) REFERENCES public.ioeti_training_cohort(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_smf66abky89il318scw3rbir5') THEN
    ALTER TABLE public.ioeti_training_enrollment ADD CONSTRAINT fk_smf66abky89il318scw3rbir5 FOREIGN KEY (trainee) REFERENCES public.base_partner(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_5r48qxjyvm5lsd1yn4q1bwmix') THEN
    ALTER TABLE public.ioeti_training_session ADD CONSTRAINT fk_5r48qxjyvm5lsd1yn4q1bwmix FOREIGN KEY (cohort) REFERENCES public.ioeti_training_cohort(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_7cvoy74etskws96natnmpk9t2') THEN
    ALTER TABLE public.ioeti_training_session ADD CONSTRAINT fk_7cvoy74etskws96natnmpk9t2 FOREIGN KEY (created_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_7u5vqmrpq1j3mpj5r8lmfc4in') THEN
    ALTER TABLE public.ioeti_training_session ADD CONSTRAINT fk_7u5vqmrpq1j3mpj5r8lmfc4in FOREIGN KEY (updated_by) REFERENCES public.auth_user(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ioeti_training_attendance_enrollment_idx ON public.ioeti_training_attendance USING btree (enrollment);
CREATE INDEX IF NOT EXISTS ioeti_training_attendance_session_idx ON public.ioeti_training_attendance USING btree (session);
CREATE INDEX IF NOT EXISTS ioeti_training_cohort_coordinator_idx ON public.ioeti_training_cohort USING btree (coordinator);
CREATE INDEX IF NOT EXISTS ioeti_training_cohort_course_idx ON public.ioeti_training_cohort USING btree (course);
CREATE INDEX IF NOT EXISTS ioeti_training_course_business_line_idx ON public.ioeti_training_course USING btree (business_line);
CREATE INDEX IF NOT EXISTS ioeti_training_course_name_idx ON public.ioeti_training_course USING btree (name);
CREATE INDEX IF NOT EXISTS ioeti_training_enrollment_client_idx ON public.ioeti_training_enrollment USING btree (client);
CREATE INDEX IF NOT EXISTS ioeti_training_enrollment_cohort_idx ON public.ioeti_training_enrollment USING btree (cohort);
CREATE INDEX IF NOT EXISTS ioeti_training_enrollment_trainee_idx ON public.ioeti_training_enrollment USING btree (trainee);
CREATE INDEX IF NOT EXISTS ioeti_training_session_cohort_idx ON public.ioeti_training_session USING btree (cohort);

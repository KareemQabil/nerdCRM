-- D-02 (signed 2026-10-25): client certification decisions and certificates (module ioeti-certification).
-- A decision round per cycle (independent reviewer: one vote; committee: committeeSize votes from distinct eligible people),
-- each vote with its reason, the certificate a GRANT issues (number per scheme and year, validity and surveillance rhythm from
-- the scheme's cert.cycle policy) and the certificate's audit trail (issued, suspended, restored, withdrawn).
-- Mirrors the schema Hibernate generates from domains/Certification.xml (verified by scripts/db_migrate.py verify).
-- Idempotent: safe on a database where the objects already exist.
CREATE SEQUENCE IF NOT EXISTS public.ioeti_cert_decision_seq START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
CREATE SEQUENCE IF NOT EXISTS public.ioeti_cert_vote_seq START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
CREATE SEQUENCE IF NOT EXISTS public.ioeti_cert_certificate_seq START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
CREATE SEQUENCE IF NOT EXISTS public.ioeti_cert_certificate_event_seq START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;

CREATE TABLE IF NOT EXISTS public.ioeti_cert_decision (
    id bigint NOT NULL,
    archived boolean,
    import_id character varying(255),
    import_origin character varying(255),
    process_instance_id character varying(255),
    version integer,
    created_on timestamp(6) without time zone,
    updated_on timestamp(6) without time zone,
    attrs jsonb,
    decided_at timestamp(6) without time zone,
    mode character varying(30) NOT NULL,
    outcome character varying(20),
    required_votes integer NOT NULL,
    status character varying(20) NOT NULL,
    created_by bigint,
    updated_by bigint,
    cycle bigint NOT NULL,
    policy_version bigint NOT NULL,
    CONSTRAINT ioeti_cert_decision_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.ioeti_cert_vote (
    id bigint NOT NULL,
    archived boolean,
    import_id character varying(255),
    import_origin character varying(255),
    process_instance_id character varying(255),
    version integer,
    created_on timestamp(6) without time zone,
    updated_on timestamp(6) without time zone,
    attrs jsonb,
    cast_at timestamp(6) without time zone NOT NULL,
    reason text NOT NULL,
    vote character varying(10) NOT NULL,
    created_by bigint,
    updated_by bigint,
    decision bigint NOT NULL,
    voter bigint NOT NULL,
    CONSTRAINT ioeti_cert_vote_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.ioeti_cert_certificate (
    id bigint NOT NULL,
    archived boolean,
    import_id character varying(255),
    import_origin character varying(255),
    process_instance_id character varying(255),
    version integer,
    created_on timestamp(6) without time zone,
    updated_on timestamp(6) without time zone,
    attrs jsonb,
    expires_on date NOT NULL,
    issue_year integer NOT NULL,
    issued_on date NOT NULL,
    number character varying(60) NOT NULL,
    serial integer NOT NULL,
    status character varying(20) NOT NULL,
    surveillance_months integer NOT NULL,
    created_by bigint,
    updated_by bigint,
    cycle bigint NOT NULL,
    cycle_policy bigint NOT NULL,
    decision bigint NOT NULL,
    CONSTRAINT ioeti_cert_certificate_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.ioeti_cert_certificate_event (
    id bigint NOT NULL,
    archived boolean,
    import_id character varying(255),
    import_origin character varying(255),
    process_instance_id character varying(255),
    version integer,
    created_on timestamp(6) without time zone,
    updated_on timestamp(6) without time zone,
    attrs jsonb,
    action character varying(20) NOT NULL,
    occurred_at timestamp(6) without time zone NOT NULL,
    reason text,
    created_by bigint,
    updated_by bigint,
    actor bigint NOT NULL,
    certificate bigint NOT NULL,
    CONSTRAINT ioeti_cert_certificate_event_pkey PRIMARY KEY (id)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_aveuwyi7n3m9nq8pmpgxy0m10') THEN
    ALTER TABLE public.ioeti_cert_decision ADD CONSTRAINT uk_aveuwyi7n3m9nq8pmpgxy0m10 UNIQUE (import_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_2sje07e8c281ib3nkiw5cnqij') THEN
    ALTER TABLE public.ioeti_cert_decision ADD CONSTRAINT fk_2sje07e8c281ib3nkiw5cnqij FOREIGN KEY (created_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_165clw1kgwg2rk3vo31gq8mvx') THEN
    ALTER TABLE public.ioeti_cert_decision ADD CONSTRAINT fk_165clw1kgwg2rk3vo31gq8mvx FOREIGN KEY (updated_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_5o363lak6qqf43vpqacmgsss1') THEN
    ALTER TABLE public.ioeti_cert_decision ADD CONSTRAINT fk_5o363lak6qqf43vpqacmgsss1 FOREIGN KEY (cycle) REFERENCES public.ioeti_cert_cycle(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_clhhjbkqq7bbj4fw608ltblqk') THEN
    ALTER TABLE public.ioeti_cert_decision ADD CONSTRAINT fk_clhhjbkqq7bbj4fw608ltblqk FOREIGN KEY (policy_version) REFERENCES public.ioeti_policy_version(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_js6jo057fg731dqa6ea9n7egi') THEN
    ALTER TABLE public.ioeti_cert_vote ADD CONSTRAINT uk_js6jo057fg731dqa6ea9n7egi UNIQUE (import_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_ulhvb4nauxeuhgm3t2m97v0n') THEN
    ALTER TABLE public.ioeti_cert_vote ADD CONSTRAINT uk_ulhvb4nauxeuhgm3t2m97v0n UNIQUE (decision, voter);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_oqd4kceewoa7l7fas4jjlflr1') THEN
    ALTER TABLE public.ioeti_cert_vote ADD CONSTRAINT fk_oqd4kceewoa7l7fas4jjlflr1 FOREIGN KEY (created_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_krxx3plcdr2xgav4l66wvv5kb') THEN
    ALTER TABLE public.ioeti_cert_vote ADD CONSTRAINT fk_krxx3plcdr2xgav4l66wvv5kb FOREIGN KEY (updated_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_o4uv0j00fvvnviydb6y7cqyro') THEN
    ALTER TABLE public.ioeti_cert_vote ADD CONSTRAINT fk_o4uv0j00fvvnviydb6y7cqyro FOREIGN KEY (decision) REFERENCES public.ioeti_cert_decision(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_805n76rl7p3peavrn6lhp0ap') THEN
    ALTER TABLE public.ioeti_cert_vote ADD CONSTRAINT fk_805n76rl7p3peavrn6lhp0ap FOREIGN KEY (voter) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_4lvmrarom6q9rjgh590t0xqf5') THEN
    ALTER TABLE public.ioeti_cert_certificate ADD CONSTRAINT uk_4lvmrarom6q9rjgh590t0xqf5 UNIQUE (import_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_s7xxjy8q62qs3if1g7id7ehh3') THEN
    ALTER TABLE public.ioeti_cert_certificate ADD CONSTRAINT uk_s7xxjy8q62qs3if1g7id7ehh3 UNIQUE (number);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_mf6mknscbvjnuekvl6hnoe75v') THEN
    ALTER TABLE public.ioeti_cert_certificate ADD CONSTRAINT uk_mf6mknscbvjnuekvl6hnoe75v UNIQUE (cycle);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_8ab54ihktgnrbc242p2xv9j8r') THEN
    ALTER TABLE public.ioeti_cert_certificate ADD CONSTRAINT fk_8ab54ihktgnrbc242p2xv9j8r FOREIGN KEY (created_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_r9ruosrokqk3d6j5vmauimtrv') THEN
    ALTER TABLE public.ioeti_cert_certificate ADD CONSTRAINT fk_r9ruosrokqk3d6j5vmauimtrv FOREIGN KEY (updated_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_mf6mknscbvjnuekvl6hnoe75v') THEN
    ALTER TABLE public.ioeti_cert_certificate ADD CONSTRAINT fk_mf6mknscbvjnuekvl6hnoe75v FOREIGN KEY (cycle) REFERENCES public.ioeti_cert_cycle(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_hupeywwld0lsocijww03y9fog') THEN
    ALTER TABLE public.ioeti_cert_certificate ADD CONSTRAINT fk_hupeywwld0lsocijww03y9fog FOREIGN KEY (cycle_policy) REFERENCES public.ioeti_policy_version(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_b6ejadqe456l4hp8vx6ye806y') THEN
    ALTER TABLE public.ioeti_cert_certificate ADD CONSTRAINT fk_b6ejadqe456l4hp8vx6ye806y FOREIGN KEY (decision) REFERENCES public.ioeti_cert_decision(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_bl7j087c29bi15lfkpau409v8') THEN
    ALTER TABLE public.ioeti_cert_certificate_event ADD CONSTRAINT uk_bl7j087c29bi15lfkpau409v8 UNIQUE (import_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_41bnvgl5mke6nv2ma4fa70vkt') THEN
    ALTER TABLE public.ioeti_cert_certificate_event ADD CONSTRAINT fk_41bnvgl5mke6nv2ma4fa70vkt FOREIGN KEY (created_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_74qyj888yvbjygd9me8xkgfl5') THEN
    ALTER TABLE public.ioeti_cert_certificate_event ADD CONSTRAINT fk_74qyj888yvbjygd9me8xkgfl5 FOREIGN KEY (updated_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_9qxsbmh3y2ogryw9gp13ukq0m') THEN
    ALTER TABLE public.ioeti_cert_certificate_event ADD CONSTRAINT fk_9qxsbmh3y2ogryw9gp13ukq0m FOREIGN KEY (actor) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_eapb2aj2153tdahnm1nv85gl9') THEN
    ALTER TABLE public.ioeti_cert_certificate_event ADD CONSTRAINT fk_eapb2aj2153tdahnm1nv85gl9 FOREIGN KEY (certificate) REFERENCES public.ioeti_cert_certificate(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ioeti_cert_decision_cycle_idx ON public.ioeti_cert_decision USING btree (cycle);
CREATE INDEX IF NOT EXISTS ioeti_cert_decision_policy_version_idx ON public.ioeti_cert_decision USING btree (policy_version);
CREATE INDEX IF NOT EXISTS ioeti_cert_vote_decision_idx ON public.ioeti_cert_vote USING btree (decision);
CREATE INDEX IF NOT EXISTS ioeti_cert_vote_voter_idx ON public.ioeti_cert_vote USING btree (voter);
CREATE INDEX IF NOT EXISTS ioeti_cert_certificate_cycle_idx ON public.ioeti_cert_certificate USING btree (cycle);
CREATE INDEX IF NOT EXISTS ioeti_cert_certificate_cycle_policy_idx ON public.ioeti_cert_certificate USING btree (cycle_policy);
CREATE INDEX IF NOT EXISTS ioeti_cert_certificate_decision_idx ON public.ioeti_cert_certificate USING btree (decision);
CREATE INDEX IF NOT EXISTS ioeti_cert_certificate_event_actor_idx ON public.ioeti_cert_certificate_event USING btree (actor);
CREATE INDEX IF NOT EXISTS ioeti_cert_certificate_event_certificate_idx ON public.ioeti_cert_certificate_event USING btree (certificate);

-- D-07 (signed 2026-10-25): retention review decisions. When a data type's retention period (policy privacy.retention) has
-- run out, a record is listed for review and a policy owner keeps it (with a reason, until a date) or anonymizes it; one row
-- per decision, never changed. The record's name is not stored here.
-- Mirrors the schema Hibernate generates from modules/ioeti-workspace/src/main/resources/domains/Privacy.xml (verified by
-- scripts/db_migrate.py verify). Idempotent: safe on a database where the objects already exist.
CREATE SEQUENCE IF NOT EXISTS public.ioeti_privacy_decision_seq START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;

CREATE TABLE IF NOT EXISTS public.ioeti_privacy_decision (
    id bigint NOT NULL,
    archived boolean,
    import_id character varying(255),
    import_origin character varying(255),
    process_instance_id character varying(255),
    version integer,
    created_on timestamp(6) without time zone,
    updated_on timestamp(6) without time zone,
    attrs jsonb,
    data_type character varying(20) NOT NULL,
    decided_at timestamp(6) without time zone NOT NULL,
    decision character varying(20) NOT NULL,
    last_activity_on date NOT NULL,
    reason character varying(500) NOT NULL,
    record_id bigint NOT NULL,
    review_again_on date,
    created_by bigint,
    updated_by bigint,
    decided_by bigint NOT NULL,
    policy_version bigint NOT NULL,
    CONSTRAINT ioeti_privacy_decision_pkey PRIMARY KEY (id)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_2h0v817kjsolffc3rwkxymblp') THEN
    ALTER TABLE public.ioeti_privacy_decision ADD CONSTRAINT uk_2h0v817kjsolffc3rwkxymblp UNIQUE (import_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_3g508voq9x0s3c0x9g0r0lc21') THEN
    ALTER TABLE public.ioeti_privacy_decision ADD CONSTRAINT fk_3g508voq9x0s3c0x9g0r0lc21 FOREIGN KEY (policy_version) REFERENCES public.ioeti_policy_version(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_5uqr537po2agcmjof00hnlo38') THEN
    ALTER TABLE public.ioeti_privacy_decision ADD CONSTRAINT fk_5uqr537po2agcmjof00hnlo38 FOREIGN KEY (created_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_7xh6veoif4bnj8qaior5549wd') THEN
    ALTER TABLE public.ioeti_privacy_decision ADD CONSTRAINT fk_7xh6veoif4bnj8qaior5549wd FOREIGN KEY (decided_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_dhcokw9w8gqb8xxil09kvbiqv') THEN
    ALTER TABLE public.ioeti_privacy_decision ADD CONSTRAINT fk_dhcokw9w8gqb8xxil09kvbiqv FOREIGN KEY (updated_by) REFERENCES public.auth_user(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ioeti_privacy_decision_data_type_record_id_idx ON public.ioeti_privacy_decision USING btree (data_type, record_id);
CREATE INDEX IF NOT EXISTS ioeti_privacy_decision_decided_by_idx ON public.ioeti_privacy_decision USING btree (decided_by);
CREATE INDEX IF NOT EXISTS ioeti_privacy_decision_policy_version_idx ON public.ioeti_privacy_decision USING btree (policy_version);

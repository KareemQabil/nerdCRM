-- D-12 (signed 2026-10-25): lead response targets in working hours. A lead that missed a target (first contact or
-- qualification) is recorded once, with the policy versions it was measured against and the line manager who was notified
-- in-app; nothing is reassigned. A native schedule runs the check every 15 minutes; without the owners' working hours and
-- targets it does nothing.
-- Mirrors the schema Hibernate generates from modules/ioeti-business-lines/src/main/resources/domains/LeadResponse.xml
-- (verified by scripts/db_migrate.py verify). Idempotent: safe on a database where the objects already exist.
CREATE SEQUENCE IF NOT EXISTS public.ioeti_lead_response_miss_seq START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;

CREATE TABLE IF NOT EXISTS public.ioeti_lead_response_miss (
    id bigint NOT NULL,
    archived boolean,
    import_id character varying(255),
    import_origin character varying(255),
    process_instance_id character varying(255),
    version integer,
    created_on timestamp(6) without time zone,
    updated_on timestamp(6) without time zone,
    attrs jsonb,
    detected_at timestamp(6) without time zone NOT NULL,
    due_at timestamp(6) without time zone NOT NULL,
    target character varying(20) NOT NULL,
    created_by bigint,
    updated_by bigint,
    calendar_policy bigint NOT NULL,
    lead bigint NOT NULL,
    notified bigint,
    target_policy bigint NOT NULL,
    CONSTRAINT ioeti_lead_response_miss_pkey PRIMARY KEY (id)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_e1tbo0lctiohrf87162g0syfp') THEN
    ALTER TABLE public.ioeti_lead_response_miss ADD CONSTRAINT uk_e1tbo0lctiohrf87162g0syfp UNIQUE (import_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_hnkivm32v3ntluorpmkgoneqv') THEN
    ALTER TABLE public.ioeti_lead_response_miss ADD CONSTRAINT uk_hnkivm32v3ntluorpmkgoneqv UNIQUE (lead, target);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_1jpo6n09va22gublqe3ku14t') THEN
    ALTER TABLE public.ioeti_lead_response_miss ADD CONSTRAINT fk_1jpo6n09va22gublqe3ku14t FOREIGN KEY (updated_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_7ch4c82lwk46fy5ikt9jmhwm6') THEN
    ALTER TABLE public.ioeti_lead_response_miss ADD CONSTRAINT fk_7ch4c82lwk46fy5ikt9jmhwm6 FOREIGN KEY (calendar_policy) REFERENCES public.ioeti_policy_version(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_8i1l5yh1mii4heuykg28cb6n8') THEN
    ALTER TABLE public.ioeti_lead_response_miss ADD CONSTRAINT fk_8i1l5yh1mii4heuykg28cb6n8 FOREIGN KEY (target_policy) REFERENCES public.ioeti_policy_version(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_9pnr1lys3ied1fus2bc2dwchp') THEN
    ALTER TABLE public.ioeti_lead_response_miss ADD CONSTRAINT fk_9pnr1lys3ied1fus2bc2dwchp FOREIGN KEY (created_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_jit5gfojj05s8u4ocwanscorj') THEN
    ALTER TABLE public.ioeti_lead_response_miss ADD CONSTRAINT fk_jit5gfojj05s8u4ocwanscorj FOREIGN KEY (lead) REFERENCES public.crm_lead(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_lv5aa88t0afljq4unjkqw2o9n') THEN
    ALTER TABLE public.ioeti_lead_response_miss ADD CONSTRAINT fk_lv5aa88t0afljq4unjkqw2o9n FOREIGN KEY (notified) REFERENCES public.auth_user(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ioeti_lead_response_miss_calendar_policy_idx ON public.ioeti_lead_response_miss USING btree (calendar_policy);
CREATE INDEX IF NOT EXISTS ioeti_lead_response_miss_lead_idx ON public.ioeti_lead_response_miss USING btree (lead);
CREATE INDEX IF NOT EXISTS ioeti_lead_response_miss_notified_idx ON public.ioeti_lead_response_miss USING btree (notified);
CREATE INDEX IF NOT EXISTS ioeti_lead_response_miss_target_policy_idx ON public.ioeti_lead_response_miss USING btree (target_policy);

INSERT INTO public.meta_schedule (id, version, name, description, job, cron, active)
SELECT nextval('public.meta_schedule_seq'), 0, 'IOETI lead response targets (D-12)',
       'Records leads that missed a response target and notifies the line manager in-app, once; never reassigns',
       'com.ioeti.businessline.job.LeadResponseJob', '0 0/15 * * * ?', true
WHERE NOT EXISTS (SELECT 1 FROM public.meta_schedule WHERE job = 'com.ioeti.businessline.job.LeadResponseJob');

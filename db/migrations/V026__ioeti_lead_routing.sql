-- D-12 (signed 2026-10-25): lead routing. A lead records its governorate (one of Egypt's 27), a person records the dates
-- they are away (no leads are routed to them then), and every routing of a lead by its line's rules is logged: the rule, the
-- team, who received it by round robin (or why nobody did) and the policy version. The log is also the round robin's memory.
-- Mirrors the schema Hibernate generates from modules/ioeti-business-lines/src/main/resources/domains/Lead.xml, User.xml and
-- LeadResponse.xml (verified by scripts/db_migrate.py verify). Idempotent: safe on a database where the objects already exist.
ALTER TABLE public.crm_lead ADD COLUMN IF NOT EXISTS ioeti_governorate character varying(40);
ALTER TABLE public.auth_user ADD COLUMN IF NOT EXISTS ioeti_away_from date;
ALTER TABLE public.auth_user ADD COLUMN IF NOT EXISTS ioeti_away_until date;

CREATE SEQUENCE IF NOT EXISTS public.ioeti_lead_routing_seq START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;

CREATE TABLE IF NOT EXISTS public.ioeti_lead_routing (
    id bigint NOT NULL,
    archived boolean,
    import_id character varying(255),
    import_origin character varying(255),
    process_instance_id character varying(255),
    version integer,
    created_on timestamp(6) without time zone,
    updated_on timestamp(6) without time zone,
    attrs jsonb,
    outcome character varying(20) NOT NULL,
    routed_at timestamp(6) without time zone NOT NULL,
    rule_index integer,
    created_by bigint,
    updated_by bigint,
    assignee bigint,
    lead bigint NOT NULL,
    policy_version bigint NOT NULL,
    routed_by bigint,
    team bigint,
    CONSTRAINT ioeti_lead_routing_pkey PRIMARY KEY (id)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_dwwkk3pxjpuly3ji310sis8a9') THEN
    ALTER TABLE public.ioeti_lead_routing ADD CONSTRAINT uk_dwwkk3pxjpuly3ji310sis8a9 UNIQUE (import_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_1ntbexh88ms4iculxj99wcl4k') THEN
    ALTER TABLE public.ioeti_lead_routing ADD CONSTRAINT fk_1ntbexh88ms4iculxj99wcl4k FOREIGN KEY (routed_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_3qwo49gbmfgubtp6wopvf214x') THEN
    ALTER TABLE public.ioeti_lead_routing ADD CONSTRAINT fk_3qwo49gbmfgubtp6wopvf214x FOREIGN KEY (policy_version) REFERENCES public.ioeti_policy_version(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_4mmx5iytv3rip3hsao8t9davv') THEN
    ALTER TABLE public.ioeti_lead_routing ADD CONSTRAINT fk_4mmx5iytv3rip3hsao8t9davv FOREIGN KEY (assignee) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_6bi7koyv9j46esnuldqv0ygmb') THEN
    ALTER TABLE public.ioeti_lead_routing ADD CONSTRAINT fk_6bi7koyv9j46esnuldqv0ygmb FOREIGN KEY (lead) REFERENCES public.crm_lead(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_d2xf4egelcroq0ajyaewp2vl1') THEN
    ALTER TABLE public.ioeti_lead_routing ADD CONSTRAINT fk_d2xf4egelcroq0ajyaewp2vl1 FOREIGN KEY (updated_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_p63dlsnd86gwo4301wwstbrml') THEN
    ALTER TABLE public.ioeti_lead_routing ADD CONSTRAINT fk_p63dlsnd86gwo4301wwstbrml FOREIGN KEY (team) REFERENCES public.team_team(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_qc8xff0149jb5hj4b2yt0w4fl') THEN
    ALTER TABLE public.ioeti_lead_routing ADD CONSTRAINT fk_qc8xff0149jb5hj4b2yt0w4fl FOREIGN KEY (created_by) REFERENCES public.auth_user(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ioeti_lead_routing_assignee_idx ON public.ioeti_lead_routing USING btree (assignee);
CREATE INDEX IF NOT EXISTS ioeti_lead_routing_lead_idx ON public.ioeti_lead_routing USING btree (lead);
CREATE INDEX IF NOT EXISTS ioeti_lead_routing_policy_version_idx ON public.ioeti_lead_routing USING btree (policy_version);
CREATE INDEX IF NOT EXISTS ioeti_lead_routing_routed_by_idx ON public.ioeti_lead_routing USING btree (routed_by);
CREATE INDEX IF NOT EXISTS ioeti_lead_routing_team_idx ON public.ioeti_lead_routing USING btree (team);
CREATE INDEX IF NOT EXISTS ioeti_lead_routing_team_assignee_idx ON public.ioeti_lead_routing USING btree (team, assignee);

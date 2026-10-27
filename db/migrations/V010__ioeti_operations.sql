-- Wave 5: handover and engagement (module ioeti-operations): requirements, handovers, checklist items, trail; plus the native project's link to its handover.
-- Mirrors the schema Hibernate generates from domains/Operations.xml and domains/Project.xml (verified by scripts/db_migrate.py verify).
-- Idempotent: safe on a database where the objects already exist.
CREATE SEQUENCE IF NOT EXISTS public.ioeti_ops_handover_event_seq START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
CREATE SEQUENCE IF NOT EXISTS public.ioeti_ops_handover_item_seq START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
CREATE SEQUENCE IF NOT EXISTS public.ioeti_ops_handover_seq START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
CREATE SEQUENCE IF NOT EXISTS public.ioeti_ops_requirement_seq START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;

CREATE TABLE IF NOT EXISTS public.ioeti_ops_handover (
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
    status_select integer NOT NULL,
    submitted_at timestamp(6) without time zone,
    created_by bigint,
    updated_by bigint,
    business_line bigint NOT NULL,
    contract bigint NOT NULL,
    engagement bigint,
    operations_lead bigint,
    requested_by bigint,
    reviewed_by bigint,
    team bigint,
    CONSTRAINT ioeti_ops_handover_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.ioeti_ops_handover_event (
    id bigint NOT NULL,
    archived boolean,
    import_id character varying(255),
    import_origin character varying(255),
    process_instance_id character varying(255),
    version integer,
    created_on timestamp(6) without time zone,
    updated_on timestamp(6) without time zone,
    attrs jsonb,
    item_title character varying(255),
    kind_select integer NOT NULL,
    occurred_at timestamp(6) without time zone NOT NULL,
    reason_select integer,
    created_by bigint,
    updated_by bigint,
    actor bigint,
    from_user bigint,
    handover bigint NOT NULL,
    to_user bigint,
    CONSTRAINT ioeti_ops_handover_event_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.ioeti_ops_handover_item (
    id bigint NOT NULL,
    archived boolean,
    import_id character varying(255),
    import_origin character varying(255),
    process_instance_id character varying(255),
    version integer,
    created_on timestamp(6) without time zone,
    updated_on timestamp(6) without time zone,
    attrs jsonb,
    done boolean,
    done_at timestamp(6) without time zone,
    evidence_reference character varying(255),
    mandatory boolean,
    sequence integer,
    title character varying(255) NOT NULL,
    created_by bigint,
    updated_by bigint,
    done_by bigint,
    handover bigint NOT NULL,
    CONSTRAINT ioeti_ops_handover_item_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.ioeti_ops_requirement (
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
    mandatory boolean,
    sequence integer,
    title character varying(255) NOT NULL,
    created_by bigint,
    updated_by bigint,
    business_line bigint NOT NULL,
    CONSTRAINT ioeti_ops_requirement_pkey PRIMARY KEY (id)
);

-- extension of the native project (domains/Project.xml): the handover that created the engagement
ALTER TABLE public.project_project ADD COLUMN IF NOT EXISTS ioeti_handover bigint;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_6kh2io4wovedqj8ylqp5snlwe') THEN
    ALTER TABLE public.ioeti_ops_handover_event ADD CONSTRAINT uk_6kh2io4wovedqj8ylqp5snlwe UNIQUE (import_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_8ggb5bxuhgh7u879pux0ea2fj') THEN
    ALTER TABLE public.ioeti_ops_handover ADD CONSTRAINT uk_8ggb5bxuhgh7u879pux0ea2fj UNIQUE (import_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_e6i1moxi4p0txyqvqalyvmdn') THEN
    ALTER TABLE public.ioeti_ops_handover_item ADD CONSTRAINT uk_e6i1moxi4p0txyqvqalyvmdn UNIQUE (import_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_eky9jnk3xl7fernx5ekpfv6l4') THEN
    ALTER TABLE public.ioeti_ops_requirement ADD CONSTRAINT uk_eky9jnk3xl7fernx5ekpfv6l4 UNIQUE (business_line, title);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_s18lwmnxvoyli5jdy4yecyxhk') THEN
    ALTER TABLE public.ioeti_ops_requirement ADD CONSTRAINT uk_s18lwmnxvoyli5jdy4yecyxhk UNIQUE (import_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_124gyhnsef6g24yknoy27bjg9') THEN
    ALTER TABLE public.ioeti_ops_handover_event ADD CONSTRAINT fk_124gyhnsef6g24yknoy27bjg9 FOREIGN KEY (handover) REFERENCES public.ioeti_ops_handover(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_1lm5bqjv97xy85v9kw6uae1y4') THEN
    ALTER TABLE public.ioeti_ops_handover_item ADD CONSTRAINT fk_1lm5bqjv97xy85v9kw6uae1y4 FOREIGN KEY (updated_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_1tx1ir6g12mefo5488ufxhln9') THEN
    ALTER TABLE public.ioeti_ops_handover ADD CONSTRAINT fk_1tx1ir6g12mefo5488ufxhln9 FOREIGN KEY (team) REFERENCES public.team_team(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_33123napt5j1wbbdhx2sqsfmc') THEN
    ALTER TABLE public.ioeti_ops_requirement ADD CONSTRAINT fk_33123napt5j1wbbdhx2sqsfmc FOREIGN KEY (created_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_4rjw8qthp2xec2dm9i10a9b1') THEN
    ALTER TABLE public.ioeti_ops_requirement ADD CONSTRAINT fk_4rjw8qthp2xec2dm9i10a9b1 FOREIGN KEY (updated_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_5to1aylslkckvvcdsilra0lke') THEN
    ALTER TABLE public.ioeti_ops_handover ADD CONSTRAINT fk_5to1aylslkckvvcdsilra0lke FOREIGN KEY (reviewed_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_900xt28c3ka7xcemx5tfk221h') THEN
    ALTER TABLE public.ioeti_ops_handover ADD CONSTRAINT fk_900xt28c3ka7xcemx5tfk221h FOREIGN KEY (requested_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_9iou7a4e1jc6kgp657lvql03q') THEN
    ALTER TABLE public.ioeti_ops_handover ADD CONSTRAINT fk_9iou7a4e1jc6kgp657lvql03q FOREIGN KEY (created_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_db9cetw127rmeots4r6f92t6v') THEN
    ALTER TABLE public.ioeti_ops_handover ADD CONSTRAINT fk_db9cetw127rmeots4r6f92t6v FOREIGN KEY (engagement) REFERENCES public.project_project(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_f62sdam7471athic5igc60uu2') THEN
    ALTER TABLE public.ioeti_ops_handover ADD CONSTRAINT fk_f62sdam7471athic5igc60uu2 FOREIGN KEY (business_line) REFERENCES public.ioeti_business_line(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_gea8cbipekfq9jxc2ynmnwvu8') THEN
    ALTER TABLE public.ioeti_ops_handover ADD CONSTRAINT fk_gea8cbipekfq9jxc2ynmnwvu8 FOREIGN KEY (contract) REFERENCES public.contract_contract(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_gnmi2kxf0f7ov7sjydtuxt091') THEN
    ALTER TABLE public.ioeti_ops_handover ADD CONSTRAINT fk_gnmi2kxf0f7ov7sjydtuxt091 FOREIGN KEY (operations_lead) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_idl1me77fml6ag006n3s11c51') THEN
    ALTER TABLE public.ioeti_ops_handover_item ADD CONSTRAINT fk_idl1me77fml6ag006n3s11c51 FOREIGN KEY (handover) REFERENCES public.ioeti_ops_handover(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_k87uktx2gp7h3lotjupfydx9b') THEN
    ALTER TABLE public.ioeti_ops_handover_event ADD CONSTRAINT fk_k87uktx2gp7h3lotjupfydx9b FOREIGN KEY (created_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_n422dftbsf8nvgr938kqfvdvr') THEN
    ALTER TABLE public.ioeti_ops_handover_item ADD CONSTRAINT fk_n422dftbsf8nvgr938kqfvdvr FOREIGN KEY (done_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_oox74ri3emxf67e4erd1cokpu') THEN
    ALTER TABLE public.ioeti_ops_handover_item ADD CONSTRAINT fk_oox74ri3emxf67e4erd1cokpu FOREIGN KEY (created_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_prvhsokgyt01ogjlpx8sc6kcf') THEN
    ALTER TABLE public.ioeti_ops_handover_event ADD CONSTRAINT fk_prvhsokgyt01ogjlpx8sc6kcf FOREIGN KEY (to_user) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_pyj4gt1436kyknbyogxx0jcj4') THEN
    ALTER TABLE public.ioeti_ops_handover ADD CONSTRAINT fk_pyj4gt1436kyknbyogxx0jcj4 FOREIGN KEY (updated_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_q4wc7sa2km54j93dw41ps5den') THEN
    ALTER TABLE public.ioeti_ops_handover_event ADD CONSTRAINT fk_q4wc7sa2km54j93dw41ps5den FOREIGN KEY (updated_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_qkt0qxrrm6r4dyht8gro7yeq2') THEN
    ALTER TABLE public.ioeti_ops_requirement ADD CONSTRAINT fk_qkt0qxrrm6r4dyht8gro7yeq2 FOREIGN KEY (business_line) REFERENCES public.ioeti_business_line(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_rhnu2wtcouho0wxe8wbmw80yu') THEN
    ALTER TABLE public.ioeti_ops_handover_event ADD CONSTRAINT fk_rhnu2wtcouho0wxe8wbmw80yu FOREIGN KEY (from_user) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_s8nnkk06immvpomrdmkrtgo5r') THEN
    ALTER TABLE public.ioeti_ops_handover_event ADD CONSTRAINT fk_s8nnkk06immvpomrdmkrtgo5r FOREIGN KEY (actor) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_44lpq61ruvr5wf2a1e3pskmgb') THEN
    ALTER TABLE public.project_project ADD CONSTRAINT uk_44lpq61ruvr5wf2a1e3pskmgb UNIQUE (ioeti_handover);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_44lpq61ruvr5wf2a1e3pskmgb') THEN
    ALTER TABLE public.project_project ADD CONSTRAINT fk_44lpq61ruvr5wf2a1e3pskmgb FOREIGN KEY (ioeti_handover) REFERENCES public.ioeti_ops_handover(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ioeti_ops_handover_business_line_idx ON public.ioeti_ops_handover USING btree (business_line);
CREATE INDEX IF NOT EXISTS ioeti_ops_handover_contract_idx ON public.ioeti_ops_handover USING btree (contract);
CREATE INDEX IF NOT EXISTS ioeti_ops_handover_engagement_idx ON public.ioeti_ops_handover USING btree (engagement);
CREATE INDEX IF NOT EXISTS ioeti_ops_handover_event_actor_idx ON public.ioeti_ops_handover_event USING btree (actor);
CREATE INDEX IF NOT EXISTS ioeti_ops_handover_event_from_user_idx ON public.ioeti_ops_handover_event USING btree (from_user);
CREATE INDEX IF NOT EXISTS ioeti_ops_handover_event_handover_idx ON public.ioeti_ops_handover_event USING btree (handover);
CREATE INDEX IF NOT EXISTS ioeti_ops_handover_event_to_user_idx ON public.ioeti_ops_handover_event USING btree (to_user);
CREATE INDEX IF NOT EXISTS ioeti_ops_handover_item_done_by_idx ON public.ioeti_ops_handover_item USING btree (done_by);
CREATE INDEX IF NOT EXISTS ioeti_ops_handover_item_handover_idx ON public.ioeti_ops_handover_item USING btree (handover);
CREATE INDEX IF NOT EXISTS ioeti_ops_handover_operations_lead_idx ON public.ioeti_ops_handover USING btree (operations_lead);
CREATE INDEX IF NOT EXISTS ioeti_ops_handover_requested_by_idx ON public.ioeti_ops_handover USING btree (requested_by);
CREATE INDEX IF NOT EXISTS ioeti_ops_handover_reviewed_by_idx ON public.ioeti_ops_handover USING btree (reviewed_by);
CREATE INDEX IF NOT EXISTS ioeti_ops_handover_team_idx ON public.ioeti_ops_handover USING btree (team);
CREATE INDEX IF NOT EXISTS ioeti_ops_requirement_business_line_idx ON public.ioeti_ops_requirement USING btree (business_line);

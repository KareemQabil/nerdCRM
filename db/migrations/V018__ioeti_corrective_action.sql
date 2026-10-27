-- IOETI quality and corrective actions (capability map): actions assigned to people against a native quality improvement.
-- Mirrors the schema Hibernate generates from modules/ioeti-operations/src/main/resources/domains/Operations.xml (verified by scripts/db_migrate.py verify).
-- Idempotent: safe on a database where the objects already exist.
CREATE SEQUENCE IF NOT EXISTS public.ioeti_ops_corrective_action_seq START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;

CREATE TABLE IF NOT EXISTS public.ioeti_ops_corrective_action (
    id bigint NOT NULL,
    archived boolean,
    import_id character varying(255),
    import_origin character varying(255),
    process_instance_id character varying(255),
    version integer,
    created_on timestamp(6) without time zone,
    updated_on timestamp(6) without time zone,
    attrs jsonb,
    done_at timestamp(6) without time zone,
    done_note text,
    due_date date,
    status_select integer NOT NULL,
    title character varying(300) NOT NULL,
    created_by bigint,
    updated_by bigint,
    action_type bigint,
    created_by_user bigint,
    improvement bigint NOT NULL,
    owner bigint NOT NULL,
    CONSTRAINT ioeti_ops_corrective_action_pkey PRIMARY KEY (id)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_2kkon8ttb669ftoyqd7rkj0da') THEN
    ALTER TABLE public.ioeti_ops_corrective_action ADD CONSTRAINT uk_2kkon8ttb669ftoyqd7rkj0da UNIQUE (import_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_2x9ovoms7l6q9mgaqby5tkf4a') THEN
    ALTER TABLE public.ioeti_ops_corrective_action ADD CONSTRAINT fk_2x9ovoms7l6q9mgaqby5tkf4a FOREIGN KEY (owner) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_4dqbh49ra7ocoh6qe0dq4w70n') THEN
    ALTER TABLE public.ioeti_ops_corrective_action ADD CONSTRAINT fk_4dqbh49ra7ocoh6qe0dq4w70n FOREIGN KEY (updated_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_9g8t079o7ri2ga12xwgr7p0c9') THEN
    ALTER TABLE public.ioeti_ops_corrective_action ADD CONSTRAINT fk_9g8t079o7ri2ga12xwgr7p0c9 FOREIGN KEY (improvement) REFERENCES public.quality_quality_improvement(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ajnyasv2ps8fhtl1waanb6qgu') THEN
    ALTER TABLE public.ioeti_ops_corrective_action ADD CONSTRAINT fk_ajnyasv2ps8fhtl1waanb6qgu FOREIGN KEY (action_type) REFERENCES public.quality_qi_action(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_drqo52ohs9sy4gpqsk05th6u3') THEN
    ALTER TABLE public.ioeti_ops_corrective_action ADD CONSTRAINT fk_drqo52ohs9sy4gpqsk05th6u3 FOREIGN KEY (created_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_qvui482nklr6mcm7b5fd5f1ep') THEN
    ALTER TABLE public.ioeti_ops_corrective_action ADD CONSTRAINT fk_qvui482nklr6mcm7b5fd5f1ep FOREIGN KEY (created_by_user) REFERENCES public.auth_user(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ioeti_ops_corrective_action_action_type_idx ON public.ioeti_ops_corrective_action USING btree (action_type);
CREATE INDEX IF NOT EXISTS ioeti_ops_corrective_action_created_by_user_idx ON public.ioeti_ops_corrective_action USING btree (created_by_user);
CREATE INDEX IF NOT EXISTS ioeti_ops_corrective_action_improvement_idx ON public.ioeti_ops_corrective_action USING btree (improvement);
CREATE INDEX IF NOT EXISTS ioeti_ops_corrective_action_owner_idx ON public.ioeti_ops_corrective_action USING btree (owner);

-- IOETI automation (Wave 7b): in-app notices and the held outbox.
-- Mirrors the schema Hibernate generates from modules/ioeti-automation/src/main/resources/domains/Automation.xml (verified by scripts/db_migrate.py verify).
-- Idempotent: safe on a database where the objects already exist.
CREATE SEQUENCE IF NOT EXISTS public.ioeti_auto_notification_seq START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
CREATE SEQUENCE IF NOT EXISTS public.ioeti_auto_outbound_seq START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;

CREATE TABLE IF NOT EXISTS public.ioeti_auto_notification (
    id bigint NOT NULL,
    archived boolean,
    import_id character varying(255),
    import_origin character varying(255),
    process_instance_id character varying(255),
    version integer,
    created_on timestamp(6) without time zone,
    updated_on timestamp(6) without time zone,
    attrs jsonb,
    created_at timestamp(6) without time zone NOT NULL,
    kind character varying(60) NOT NULL,
    seen boolean,
    subject character varying(40),
    subject_id bigint,
    title character varying(300) NOT NULL,
    created_by bigint,
    updated_by bigint,
    actor bigint,
    recipient bigint NOT NULL,
    CONSTRAINT ioeti_auto_notification_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.ioeti_auto_outbound (
    id bigint NOT NULL,
    archived boolean,
    import_id character varying(255),
    import_origin character varying(255),
    process_instance_id character varying(255),
    version integer,
    created_on timestamp(6) without time zone,
    updated_on timestamp(6) without time zone,
    attrs jsonb,
    body text,
    channel_select integer NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    status_select integer NOT NULL,
    subject_line character varying(200) NOT NULL,
    created_by bigint,
    updated_by bigint,
    author bigint,
    lead bigint NOT NULL,
    CONSTRAINT ioeti_auto_outbound_pkey PRIMARY KEY (id)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_1t26btqr97elggppg2tgn23ie') THEN
    ALTER TABLE public.ioeti_auto_notification ADD CONSTRAINT uk_1t26btqr97elggppg2tgn23ie UNIQUE (import_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_5kgq5ucgtk58gunrf48srli78') THEN
    ALTER TABLE public.ioeti_auto_outbound ADD CONSTRAINT uk_5kgq5ucgtk58gunrf48srli78 UNIQUE (import_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_4vgec534lqlmtnhl0fuxwpxnx') THEN
    ALTER TABLE public.ioeti_auto_outbound ADD CONSTRAINT fk_4vgec534lqlmtnhl0fuxwpxnx FOREIGN KEY (lead) REFERENCES public.crm_lead(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_7jadfh1h8u1do3wsv105yctg3') THEN
    ALTER TABLE public.ioeti_auto_outbound ADD CONSTRAINT fk_7jadfh1h8u1do3wsv105yctg3 FOREIGN KEY (updated_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_c19i649g6yr1oyh4gavfwsicc') THEN
    ALTER TABLE public.ioeti_auto_notification ADD CONSTRAINT fk_c19i649g6yr1oyh4gavfwsicc FOREIGN KEY (updated_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_jhlqnwa9ljn7fu017g02608uh') THEN
    ALTER TABLE public.ioeti_auto_outbound ADD CONSTRAINT fk_jhlqnwa9ljn7fu017g02608uh FOREIGN KEY (created_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_jkrqnijhsk0qif89dn9k8pmt0') THEN
    ALTER TABLE public.ioeti_auto_outbound ADD CONSTRAINT fk_jkrqnijhsk0qif89dn9k8pmt0 FOREIGN KEY (author) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_sjxbdb86hvx3vrl3o1rb4theg') THEN
    ALTER TABLE public.ioeti_auto_notification ADD CONSTRAINT fk_sjxbdb86hvx3vrl3o1rb4theg FOREIGN KEY (created_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_tk1pur5q81l0lmfqop2q8jdwm') THEN
    ALTER TABLE public.ioeti_auto_notification ADD CONSTRAINT fk_tk1pur5q81l0lmfqop2q8jdwm FOREIGN KEY (actor) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_tmtjmq1wikau5pap6qdgts6le') THEN
    ALTER TABLE public.ioeti_auto_notification ADD CONSTRAINT fk_tmtjmq1wikau5pap6qdgts6le FOREIGN KEY (recipient) REFERENCES public.auth_user(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ioeti_auto_notification_actor_idx ON public.ioeti_auto_notification USING btree (actor);
CREATE INDEX IF NOT EXISTS ioeti_auto_notification_recipient_idx ON public.ioeti_auto_notification USING btree (recipient);
CREATE INDEX IF NOT EXISTS ioeti_auto_outbound_author_idx ON public.ioeti_auto_outbound USING btree (author);
CREATE INDEX IF NOT EXISTS ioeti_auto_outbound_lead_idx ON public.ioeti_auto_outbound USING btree (lead);

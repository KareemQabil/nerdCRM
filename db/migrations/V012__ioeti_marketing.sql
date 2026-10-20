-- IOETI marketing (Wave 6): lead consent history and saved lead views; Lead.ioetiSearchKey.
-- Mirrors the schema Hibernate generates from modules/ioeti-marketing/src/main/resources/domains/Marketing.xml (verified by scripts/db_migrate.py verify).
-- Idempotent: safe on a database where the objects already exist.
CREATE SEQUENCE IF NOT EXISTS public.ioeti_mkt_consent_seq START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
CREATE SEQUENCE IF NOT EXISTS public.ioeti_mkt_saved_view_seq START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;

CREATE TABLE IF NOT EXISTS public.ioeti_mkt_consent (
    id bigint NOT NULL,
    archived boolean,
    import_id character varying(255),
    import_origin character varying(255),
    process_instance_id character varying(255),
    version integer,
    created_on timestamp(6) without time zone,
    updated_on timestamp(6) without time zone,
    allowed boolean,
    attrs jsonb,
    channel_select integer NOT NULL,
    evidence_reference character varying(255),
    method_select integer NOT NULL,
    occurred_at timestamp(6) without time zone NOT NULL,
    created_by bigint,
    updated_by bigint,
    actor bigint,
    lead bigint NOT NULL,
    CONSTRAINT ioeti_mkt_consent_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.ioeti_mkt_saved_view (
    id bigint NOT NULL,
    archived boolean,
    import_id character varying(255),
    import_origin character varying(255),
    process_instance_id character varying(255),
    version integer,
    created_on timestamp(6) without time zone,
    updated_on timestamp(6) without time zone,
    attrs jsonb,
    name character varying(255) NOT NULL,
    only_mine boolean,
    search_text character varying(255),
    created_by bigint,
    updated_by bigint,
    business_line bigint,
    owner bigint NOT NULL,
    source bigint,
    stage bigint,
    CONSTRAINT ioeti_mkt_saved_view_pkey PRIMARY KEY (id)
);

ALTER TABLE public.crm_lead ADD COLUMN IF NOT EXISTS ioeti_search_key character varying(1000);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_gi2ra1votx7q7yisjp2q9p7o0') THEN
    ALTER TABLE public.ioeti_mkt_saved_view ADD CONSTRAINT uk_gi2ra1votx7q7yisjp2q9p7o0 UNIQUE (import_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_jplc4fj1najddte2rnmfogq4u') THEN
    ALTER TABLE public.ioeti_mkt_consent ADD CONSTRAINT uk_jplc4fj1najddte2rnmfogq4u UNIQUE (import_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_s20tssihiadhte21954m6ekes') THEN
    ALTER TABLE public.ioeti_mkt_saved_view ADD CONSTRAINT uk_s20tssihiadhte21954m6ekes UNIQUE (owner, name);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_157pmac2rvys372yorn5tuftg') THEN
    ALTER TABLE public.ioeti_mkt_saved_view ADD CONSTRAINT fk_157pmac2rvys372yorn5tuftg FOREIGN KEY (updated_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_5j0cwxr6ev13txaek51xh1qtf') THEN
    ALTER TABLE public.ioeti_mkt_saved_view ADD CONSTRAINT fk_5j0cwxr6ev13txaek51xh1qtf FOREIGN KEY (owner) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_84upftdcsnlpj6ni4xt9yatnq') THEN
    ALTER TABLE public.ioeti_mkt_consent ADD CONSTRAINT fk_84upftdcsnlpj6ni4xt9yatnq FOREIGN KEY (created_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_9doqw9yhy251ea7d1lljmmcbq') THEN
    ALTER TABLE public.ioeti_mkt_saved_view ADD CONSTRAINT fk_9doqw9yhy251ea7d1lljmmcbq FOREIGN KEY (source) REFERENCES public.base_source(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_arpmgi85kdijxvqal72hgl95k') THEN
    ALTER TABLE public.ioeti_mkt_saved_view ADD CONSTRAINT fk_arpmgi85kdijxvqal72hgl95k FOREIGN KEY (created_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_h1vwpqff27mignegpbgnh392m') THEN
    ALTER TABLE public.ioeti_mkt_saved_view ADD CONSTRAINT fk_h1vwpqff27mignegpbgnh392m FOREIGN KEY (stage) REFERENCES public.crm_lead_status(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_i895i3u63vsy65hajxm91bbuw') THEN
    ALTER TABLE public.ioeti_mkt_consent ADD CONSTRAINT fk_i895i3u63vsy65hajxm91bbuw FOREIGN KEY (updated_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_iigovw82hrfjg63ihs3a5uj5o') THEN
    ALTER TABLE public.ioeti_mkt_saved_view ADD CONSTRAINT fk_iigovw82hrfjg63ihs3a5uj5o FOREIGN KEY (business_line) REFERENCES public.ioeti_business_line(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_jk44k6m5yh7y2l6nh6bfx4d2m') THEN
    ALTER TABLE public.ioeti_mkt_consent ADD CONSTRAINT fk_jk44k6m5yh7y2l6nh6bfx4d2m FOREIGN KEY (lead) REFERENCES public.crm_lead(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ka8fy1hiwkhp0gj7dyweupjgk') THEN
    ALTER TABLE public.ioeti_mkt_consent ADD CONSTRAINT fk_ka8fy1hiwkhp0gj7dyweupjgk FOREIGN KEY (actor) REFERENCES public.auth_user(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ioeti_mkt_consent_actor_idx ON public.ioeti_mkt_consent USING btree (actor);
CREATE INDEX IF NOT EXISTS ioeti_mkt_consent_lead_idx ON public.ioeti_mkt_consent USING btree (lead);
CREATE INDEX IF NOT EXISTS ioeti_mkt_saved_view_business_line_idx ON public.ioeti_mkt_saved_view USING btree (business_line);
CREATE INDEX IF NOT EXISTS ioeti_mkt_saved_view_name_idx ON public.ioeti_mkt_saved_view USING btree (name);
CREATE INDEX IF NOT EXISTS ioeti_mkt_saved_view_owner_idx ON public.ioeti_mkt_saved_view USING btree (owner);
CREATE INDEX IF NOT EXISTS ioeti_mkt_saved_view_source_idx ON public.ioeti_mkt_saved_view USING btree (source);
CREATE INDEX IF NOT EXISTS ioeti_mkt_saved_view_stage_idx ON public.ioeti_mkt_saved_view USING btree (stage);

-- Backfill the search key of leads recorded before this module. The application keeps it current
-- afterwards (LeadSearchKeyListener); this mirrors ArabicNormalizer: diacritics and tatweel removed,
-- alef/teh marbuta/alef maksura/hamza seats unified, Arabic-Indic digits to Latin, lower case,
-- anything but letters, digits, @ and + to one space; e-mail lower-cased; phones as their last 9 digits.
CREATE FUNCTION pg_temp.ioeti_norm(t text) RETURNS text LANGUAGE sql IMMUTABLE AS $f$
  SELECT btrim(regexp_replace(lower(translate(regexp_replace(coalesce(t, ''), '[\u064B-\u065F\u0670\u06D6-\u06ED\u0640]', '', 'g'),
    'أإآٱةىئؤ٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', 'ااااهييو01234567890123456789')), '[^[:alnum:]@+]+', ' ', 'g'))
$f$;
CREATE FUNCTION pg_temp.ioeti_phone(t text) RETURNS text LANGUAGE sql IMMUTABLE AS $f$
  SELECT right(regexp_replace(pg_temp.ioeti_norm(t), '[^0-9]', '', 'g'), 9)
$f$;
UPDATE public.crm_lead l SET ioeti_search_key = left(concat_ws(' | ',
    nullif(pg_temp.ioeti_norm(l.first_name), ''),
    nullif(pg_temp.ioeti_norm(l.name), ''),
    nullif(pg_temp.ioeti_norm(l.enterprise_name), ''),
    nullif(lower(btrim(e.address)), ''),
    nullif(pg_temp.ioeti_phone(l.mobile_phone), ''),
    nullif(pg_temp.ioeti_phone(l.fixed_phone), '')), 1000)
  FROM public.crm_lead l2 LEFT JOIN public.message_email_address e ON e.id = l2.email_address
 WHERE l2.id = l.id AND l.ioeti_search_key IS NULL;

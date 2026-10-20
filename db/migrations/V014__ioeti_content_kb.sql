-- IOETI knowledge base (Wave 7a): categories, articles and published revisions.
-- Mirrors the schema Hibernate generates from modules/ioeti-content/src/main/resources/domains/Content.xml (verified by scripts/db_migrate.py verify).
-- Idempotent: safe on a database where the objects already exist.
CREATE SEQUENCE IF NOT EXISTS public.ioeti_kb_article_seq START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
CREATE SEQUENCE IF NOT EXISTS public.ioeti_kb_category_seq START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
CREATE SEQUENCE IF NOT EXISTS public.ioeti_kb_revision_seq START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;

CREATE TABLE IF NOT EXISTS public.ioeti_kb_article (
    id bigint NOT NULL,
    archived boolean,
    import_id character varying(255),
    import_origin character varying(255),
    process_instance_id character varying(255),
    version integer,
    created_on timestamp(6) without time zone,
    updated_on timestamp(6) without time zone,
    attrs jsonb,
    body_ar text,
    body_en text,
    published_search_key character varying(4000),
    status_select integer NOT NULL,
    title_ar character varying(200),
    title_en character varying(200),
    created_by bigint,
    updated_by bigint,
    author bigint,
    business_line bigint,
    category bigint,
    published_revision bigint,
    CONSTRAINT ioeti_kb_article_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.ioeti_kb_category (
    id bigint NOT NULL,
    archived boolean,
    import_id character varying(255),
    import_origin character varying(255),
    process_instance_id character varying(255),
    version integer,
    created_on timestamp(6) without time zone,
    updated_on timestamp(6) without time zone,
    attrs jsonb,
    code character varying(40) NOT NULL,
    name_ar character varying(255) NOT NULL,
    name_en character varying(255) NOT NULL,
    sequence integer,
    created_by bigint,
    updated_by bigint,
    CONSTRAINT ioeti_kb_category_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.ioeti_kb_revision (
    id bigint NOT NULL,
    archived boolean,
    import_id character varying(255),
    import_origin character varying(255),
    process_instance_id character varying(255),
    version integer,
    created_on timestamp(6) without time zone,
    updated_on timestamp(6) without time zone,
    attrs jsonb,
    body_ar text,
    body_en text,
    number integer NOT NULL,
    published_at timestamp(6) without time zone NOT NULL,
    title_ar character varying(200),
    title_en character varying(200),
    created_by bigint,
    updated_by bigint,
    article bigint NOT NULL,
    published_by bigint,
    CONSTRAINT ioeti_kb_revision_pkey PRIMARY KEY (id)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_5plqvnd9uu7k4hrvby942qxbk') THEN
    ALTER TABLE public.ioeti_kb_category ADD CONSTRAINT uk_5plqvnd9uu7k4hrvby942qxbk UNIQUE (code);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_feh3jggh5vx96pfovawgphc5s') THEN
    ALTER TABLE public.ioeti_kb_revision ADD CONSTRAINT uk_feh3jggh5vx96pfovawgphc5s UNIQUE (article, number);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_l2oh2oruh9fg210qaro9cxkpm') THEN
    ALTER TABLE public.ioeti_kb_article ADD CONSTRAINT uk_l2oh2oruh9fg210qaro9cxkpm UNIQUE (import_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_npi8kppbaiowv5dhoxflbg9q6') THEN
    ALTER TABLE public.ioeti_kb_revision ADD CONSTRAINT uk_npi8kppbaiowv5dhoxflbg9q6 UNIQUE (import_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_rn09rfoxdxciyo7nb0yfmpjie') THEN
    ALTER TABLE public.ioeti_kb_category ADD CONSTRAINT uk_rn09rfoxdxciyo7nb0yfmpjie UNIQUE (import_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_3307li6adkrg0wtb9dgsnhrw') THEN
    ALTER TABLE public.ioeti_kb_article ADD CONSTRAINT fk_3307li6adkrg0wtb9dgsnhrw FOREIGN KEY (published_revision) REFERENCES public.ioeti_kb_revision(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_3heq4q5u5tyb2t1fvtlaskxp8') THEN
    ALTER TABLE public.ioeti_kb_article ADD CONSTRAINT fk_3heq4q5u5tyb2t1fvtlaskxp8 FOREIGN KEY (business_line) REFERENCES public.ioeti_business_line(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_6kgnyrgskxj74618ebcg2yvp7') THEN
    ALTER TABLE public.ioeti_kb_category ADD CONSTRAINT fk_6kgnyrgskxj74618ebcg2yvp7 FOREIGN KEY (updated_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_75csr1915cxc68yda7qvlperv') THEN
    ALTER TABLE public.ioeti_kb_article ADD CONSTRAINT fk_75csr1915cxc68yda7qvlperv FOREIGN KEY (created_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_7l01nvpcmkw49t33m0xe8nwfn') THEN
    ALTER TABLE public.ioeti_kb_article ADD CONSTRAINT fk_7l01nvpcmkw49t33m0xe8nwfn FOREIGN KEY (category) REFERENCES public.ioeti_kb_category(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_aeauu00nc89a79vrylctpjjy9') THEN
    ALTER TABLE public.ioeti_kb_revision ADD CONSTRAINT fk_aeauu00nc89a79vrylctpjjy9 FOREIGN KEY (published_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_f24il6ffp8sv5xaibpi2uynv9') THEN
    ALTER TABLE public.ioeti_kb_article ADD CONSTRAINT fk_f24il6ffp8sv5xaibpi2uynv9 FOREIGN KEY (author) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_gb6bbd4oci0w7hekwyilckk3g') THEN
    ALTER TABLE public.ioeti_kb_revision ADD CONSTRAINT fk_gb6bbd4oci0w7hekwyilckk3g FOREIGN KEY (created_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_jbrmruypy3wanptlq941w8evm') THEN
    ALTER TABLE public.ioeti_kb_category ADD CONSTRAINT fk_jbrmruypy3wanptlq941w8evm FOREIGN KEY (created_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_l250tgnb4bs0un5h9v10b6hun') THEN
    ALTER TABLE public.ioeti_kb_article ADD CONSTRAINT fk_l250tgnb4bs0un5h9v10b6hun FOREIGN KEY (updated_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_l2fcr02r1imawsgajw8v3pao0') THEN
    ALTER TABLE public.ioeti_kb_revision ADD CONSTRAINT fk_l2fcr02r1imawsgajw8v3pao0 FOREIGN KEY (article) REFERENCES public.ioeti_kb_article(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_n7n21i8u0p5anjjmp1hwj1nch') THEN
    ALTER TABLE public.ioeti_kb_revision ADD CONSTRAINT fk_n7n21i8u0p5anjjmp1hwj1nch FOREIGN KEY (updated_by) REFERENCES public.auth_user(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ioeti_kb_article_author_idx ON public.ioeti_kb_article USING btree (author);
CREATE INDEX IF NOT EXISTS ioeti_kb_article_business_line_idx ON public.ioeti_kb_article USING btree (business_line);
CREATE INDEX IF NOT EXISTS ioeti_kb_article_category_idx ON public.ioeti_kb_article USING btree (category);
CREATE INDEX IF NOT EXISTS ioeti_kb_article_published_revision_idx ON public.ioeti_kb_article USING btree (published_revision);
CREATE INDEX IF NOT EXISTS ioeti_kb_revision_article_idx ON public.ioeti_kb_revision USING btree (article);
CREATE INDEX IF NOT EXISTS ioeti_kb_revision_published_by_idx ON public.ioeti_kb_revision USING btree (published_by);

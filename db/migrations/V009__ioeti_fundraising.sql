-- Wave 4E: fundraising (module ioeti-fundraising): donors, sensitive profiles, opportunities, commitments, installments, collections, deliverables, stewardship.
-- Mirrors the schema Hibernate generates from domains/Fundraising.xml (verified by scripts/db_migrate.py verify).
-- Idempotent: safe on a database where the objects already exist.
CREATE SEQUENCE IF NOT EXISTS public.ioeti_fund_collection_seq START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
CREATE SEQUENCE IF NOT EXISTS public.ioeti_fund_commitment_seq START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
CREATE SEQUENCE IF NOT EXISTS public.ioeti_fund_deliverable_seq START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
CREATE SEQUENCE IF NOT EXISTS public.ioeti_fund_donor_private_seq START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
CREATE SEQUENCE IF NOT EXISTS public.ioeti_fund_donor_seq START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
CREATE SEQUENCE IF NOT EXISTS public.ioeti_fund_installment_seq START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
CREATE SEQUENCE IF NOT EXISTS public.ioeti_fund_opportunity_seq START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
CREATE SEQUENCE IF NOT EXISTS public.ioeti_fund_stewardship_seq START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;

CREATE TABLE IF NOT EXISTS public.ioeti_fund_collection (
    id bigint NOT NULL,
    archived boolean,
    import_id character varying(255),
    import_origin character varying(255),
    process_instance_id character varying(255),
    version integer,
    created_on timestamp(6) without time zone,
    updated_on timestamp(6) without time zone,
    amount numeric(20,2) NOT NULL,
    attrs jsonb,
    bank_reference character varying(60) NOT NULL,
    received_on date NOT NULL,
    status_select integer NOT NULL,
    void_reason_select integer,
    voided_at timestamp(6) without time zone,
    created_by bigint,
    updated_by bigint,
    installment bigint NOT NULL,
    voided_by bigint,
    CONSTRAINT ioeti_fund_collection_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.ioeti_fund_commitment (
    id bigint NOT NULL,
    archived boolean,
    import_id character varying(255),
    import_origin character varying(255),
    process_instance_id character varying(255),
    version integer,
    created_on timestamp(6) without time zone,
    updated_on timestamp(6) without time zone,
    agreement_reference character varying(255),
    approved_on date NOT NULL,
    attrs jsonb,
    committed_amount numeric(20,2) NOT NULL,
    period_end date,
    restricted boolean,
    restriction_purpose character varying(255),
    created_by bigint,
    updated_by bigint,
    opportunity bigint NOT NULL,
    CONSTRAINT ioeti_fund_commitment_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.ioeti_fund_deliverable (
    id bigint NOT NULL,
    archived boolean,
    import_id character varying(255),
    import_origin character varying(255),
    process_instance_id character varying(255),
    version integer,
    created_on timestamp(6) without time zone,
    updated_on timestamp(6) without time zone,
    attrs jsonb,
    due_date date NOT NULL,
    status_select integer NOT NULL,
    submitted_on date,
    title character varying(255) NOT NULL,
    created_by bigint,
    updated_by bigint,
    commitment bigint NOT NULL,
    CONSTRAINT ioeti_fund_deliverable_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.ioeti_fund_donor (
    id bigint NOT NULL,
    archived boolean,
    import_id character varying(255),
    import_origin character varying(255),
    process_instance_id character varying(255),
    version integer,
    created_on timestamp(6) without time zone,
    updated_on timestamp(6) without time zone,
    anonymous boolean,
    attrs jsonb,
    donor_type_select integer NOT NULL,
    created_by bigint,
    updated_by bigint,
    partner bigint NOT NULL,
    relationship_manager bigint,
    CONSTRAINT ioeti_fund_donor_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.ioeti_fund_donor_private (
    id bigint NOT NULL,
    archived boolean,
    import_id character varying(255),
    import_origin character varying(255),
    process_instance_id character varying(255),
    version integer,
    created_on timestamp(6) without time zone,
    updated_on timestamp(6) without time zone,
    attrs jsonb,
    contact_preference character varying(255),
    giving_capacity numeric(20,2),
    relationship_note text,
    created_by bigint,
    updated_by bigint,
    donor bigint NOT NULL,
    CONSTRAINT ioeti_fund_donor_private_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.ioeti_fund_installment (
    id bigint NOT NULL,
    archived boolean,
    import_id character varying(255),
    import_origin character varying(255),
    process_instance_id character varying(255),
    version integer,
    created_on timestamp(6) without time zone,
    updated_on timestamp(6) without time zone,
    amount numeric(20,2) NOT NULL,
    attrs jsonb,
    due_date date NOT NULL,
    sequence integer NOT NULL,
    status_select integer NOT NULL,
    created_by bigint,
    updated_by bigint,
    commitment bigint NOT NULL,
    CONSTRAINT ioeti_fund_installment_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.ioeti_fund_opportunity (
    id bigint NOT NULL,
    archived boolean,
    import_id character varying(255),
    import_origin character varying(255),
    process_instance_id character varying(255),
    version integer,
    created_on timestamp(6) without time zone,
    updated_on timestamp(6) without time zone,
    attrs jsonb,
    deadline date,
    kind_select integer NOT NULL,
    proposed_amount numeric(20,2),
    purpose character varying(255),
    reference character varying(30) NOT NULL,
    stage_select integer NOT NULL,
    title character varying(255) NOT NULL,
    created_by bigint,
    updated_by bigint,
    campaign bigint,
    currency bigint NOT NULL,
    donor bigint NOT NULL,
    owner bigint,
    renewal_of bigint,
    CONSTRAINT ioeti_fund_opportunity_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.ioeti_fund_stewardship (
    id bigint NOT NULL,
    archived boolean,
    import_id character varying(255),
    import_origin character varying(255),
    process_instance_id character varying(255),
    version integer,
    created_on timestamp(6) without time zone,
    updated_on timestamp(6) without time zone,
    attrs jsonb,
    kind_select integer NOT NULL,
    occurred_on date NOT NULL,
    subject character varying(255) NOT NULL,
    created_by bigint,
    updated_by bigint,
    donor bigint NOT NULL,
    owner bigint,
    CONSTRAINT ioeti_fund_stewardship_pkey PRIMARY KEY (id)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_30p7ylji2cq7bk82l8a0rdm1u') THEN
    ALTER TABLE public.ioeti_fund_donor ADD CONSTRAINT uk_30p7ylji2cq7bk82l8a0rdm1u UNIQUE (import_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_4exnhfp7edwkjlnlrw4jlf7sb') THEN
    ALTER TABLE public.ioeti_fund_opportunity ADD CONSTRAINT uk_4exnhfp7edwkjlnlrw4jlf7sb UNIQUE (reference);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_74e7byjgroi6l230oe8guimj4') THEN
    ALTER TABLE public.ioeti_fund_installment ADD CONSTRAINT uk_74e7byjgroi6l230oe8guimj4 UNIQUE (import_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_7q3rhd8e0irp20n5mk7dd6gun') THEN
    ALTER TABLE public.ioeti_fund_opportunity ADD CONSTRAINT uk_7q3rhd8e0irp20n5mk7dd6gun UNIQUE (import_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_835wpdcafqi63b1n5amafoepc') THEN
    ALTER TABLE public.ioeti_fund_installment ADD CONSTRAINT uk_835wpdcafqi63b1n5amafoepc UNIQUE (commitment, sequence);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_fmgh8sia8pvain11iwh0xskyp') THEN
    ALTER TABLE public.ioeti_fund_donor_private ADD CONSTRAINT uk_fmgh8sia8pvain11iwh0xskyp UNIQUE (donor);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_gptw4b8nhlvun5dx4hcemv00g') THEN
    ALTER TABLE public.ioeti_fund_donor ADD CONSTRAINT uk_gptw4b8nhlvun5dx4hcemv00g UNIQUE (partner);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_ixwocudkr08rrukk0ay5fx114') THEN
    ALTER TABLE public.ioeti_fund_deliverable ADD CONSTRAINT uk_ixwocudkr08rrukk0ay5fx114 UNIQUE (import_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_khoorqff3y28b908om1i5fdyw') THEN
    ALTER TABLE public.ioeti_fund_collection ADD CONSTRAINT uk_khoorqff3y28b908om1i5fdyw UNIQUE (import_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_ln3j0ys7lwodg8patad7fs9pm') THEN
    ALTER TABLE public.ioeti_fund_stewardship ADD CONSTRAINT uk_ln3j0ys7lwodg8patad7fs9pm UNIQUE (import_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_mrt0fr5kg6uymja482hjh35jp') THEN
    ALTER TABLE public.ioeti_fund_donor_private ADD CONSTRAINT uk_mrt0fr5kg6uymja482hjh35jp UNIQUE (import_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_qocpbw9oo3aaf8ghwyhjv3vo3') THEN
    ALTER TABLE public.ioeti_fund_collection ADD CONSTRAINT uk_qocpbw9oo3aaf8ghwyhjv3vo3 UNIQUE (bank_reference);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_srqbf3qbcb4aq21cbuw411hfu') THEN
    ALTER TABLE public.ioeti_fund_commitment ADD CONSTRAINT uk_srqbf3qbcb4aq21cbuw411hfu UNIQUE (import_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_thjbda619wd7xasbwvh4jl7mv') THEN
    ALTER TABLE public.ioeti_fund_commitment ADD CONSTRAINT uk_thjbda619wd7xasbwvh4jl7mv UNIQUE (opportunity);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_24wnpdbjg7rxrnsryi1yluifl') THEN
    ALTER TABLE public.ioeti_fund_opportunity ADD CONSTRAINT fk_24wnpdbjg7rxrnsryi1yluifl FOREIGN KEY (renewal_of) REFERENCES public.ioeti_fund_opportunity(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_3kkcux5xgaxw9d7n74w1ap3dm') THEN
    ALTER TABLE public.ioeti_fund_installment ADD CONSTRAINT fk_3kkcux5xgaxw9d7n74w1ap3dm FOREIGN KEY (created_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_3v2tu3bvi7dmw32nl32l5nc18') THEN
    ALTER TABLE public.ioeti_fund_installment ADD CONSTRAINT fk_3v2tu3bvi7dmw32nl32l5nc18 FOREIGN KEY (updated_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_3y8gcy293bhkhstbttq5lrpp7') THEN
    ALTER TABLE public.ioeti_fund_opportunity ADD CONSTRAINT fk_3y8gcy293bhkhstbttq5lrpp7 FOREIGN KEY (donor) REFERENCES public.ioeti_fund_donor(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_4cp3pu6j2ycuybhwohjcywdg3') THEN
    ALTER TABLE public.ioeti_fund_opportunity ADD CONSTRAINT fk_4cp3pu6j2ycuybhwohjcywdg3 FOREIGN KEY (updated_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_4j37d2nxgamf4tb1rqioy9pc0') THEN
    ALTER TABLE public.ioeti_fund_deliverable ADD CONSTRAINT fk_4j37d2nxgamf4tb1rqioy9pc0 FOREIGN KEY (updated_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_5yxnndb29b0imr6rk7qsu341e') THEN
    ALTER TABLE public.ioeti_fund_donor ADD CONSTRAINT fk_5yxnndb29b0imr6rk7qsu341e FOREIGN KEY (updated_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_7wxf9srumeleubpew68vmt3u1') THEN
    ALTER TABLE public.ioeti_fund_stewardship ADD CONSTRAINT fk_7wxf9srumeleubpew68vmt3u1 FOREIGN KEY (donor) REFERENCES public.ioeti_fund_donor(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_b8s0it6m11mi1cprpjqdqsfyu') THEN
    ALTER TABLE public.ioeti_fund_collection ADD CONSTRAINT fk_b8s0it6m11mi1cprpjqdqsfyu FOREIGN KEY (updated_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_bfxupjs1hhbbm9b6xceo9eb0r') THEN
    ALTER TABLE public.ioeti_fund_opportunity ADD CONSTRAINT fk_bfxupjs1hhbbm9b6xceo9eb0r FOREIGN KEY (campaign) REFERENCES public.marketing_campaign(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_bqcs2blk9hf1tk01hxn3hq863') THEN
    ALTER TABLE public.ioeti_fund_donor_private ADD CONSTRAINT fk_bqcs2blk9hf1tk01hxn3hq863 FOREIGN KEY (created_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ctpk075gvvv03b52wt42s2dlq') THEN
    ALTER TABLE public.ioeti_fund_stewardship ADD CONSTRAINT fk_ctpk075gvvv03b52wt42s2dlq FOREIGN KEY (owner) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_cy0ui4rd3n5p98tbs1yh41f0n') THEN
    ALTER TABLE public.ioeti_fund_opportunity ADD CONSTRAINT fk_cy0ui4rd3n5p98tbs1yh41f0n FOREIGN KEY (owner) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_d486oui0li1mhs8lg5s29xukk') THEN
    ALTER TABLE public.ioeti_fund_collection ADD CONSTRAINT fk_d486oui0li1mhs8lg5s29xukk FOREIGN KEY (created_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_drt5mxksjnlcicr5kvugauii6') THEN
    ALTER TABLE public.ioeti_fund_stewardship ADD CONSTRAINT fk_drt5mxksjnlcicr5kvugauii6 FOREIGN KEY (updated_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_fmgh8sia8pvain11iwh0xskyp') THEN
    ALTER TABLE public.ioeti_fund_donor_private ADD CONSTRAINT fk_fmgh8sia8pvain11iwh0xskyp FOREIGN KEY (donor) REFERENCES public.ioeti_fund_donor(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_gptw4b8nhlvun5dx4hcemv00g') THEN
    ALTER TABLE public.ioeti_fund_donor ADD CONSTRAINT fk_gptw4b8nhlvun5dx4hcemv00g FOREIGN KEY (partner) REFERENCES public.base_partner(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_gvjcunpgen65arstn6iauop08') THEN
    ALTER TABLE public.ioeti_fund_collection ADD CONSTRAINT fk_gvjcunpgen65arstn6iauop08 FOREIGN KEY (installment) REFERENCES public.ioeti_fund_installment(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ief9lx635w5hl8bix5nnn2fqi') THEN
    ALTER TABLE public.ioeti_fund_deliverable ADD CONSTRAINT fk_ief9lx635w5hl8bix5nnn2fqi FOREIGN KEY (created_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ixivpmlqgnoxcpmnompw37ruc') THEN
    ALTER TABLE public.ioeti_fund_donor ADD CONSTRAINT fk_ixivpmlqgnoxcpmnompw37ruc FOREIGN KEY (relationship_manager) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_k5ljs5hjpvs0agxwhosau6f8a') THEN
    ALTER TABLE public.ioeti_fund_installment ADD CONSTRAINT fk_k5ljs5hjpvs0agxwhosau6f8a FOREIGN KEY (commitment) REFERENCES public.ioeti_fund_commitment(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_l2xw2v258rtlj3qosacpnjviy') THEN
    ALTER TABLE public.ioeti_fund_collection ADD CONSTRAINT fk_l2xw2v258rtlj3qosacpnjviy FOREIGN KEY (voided_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_l9eulg7i1caijgnq4lj4euc08') THEN
    ALTER TABLE public.ioeti_fund_commitment ADD CONSTRAINT fk_l9eulg7i1caijgnq4lj4euc08 FOREIGN KEY (updated_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_lerewaxe4kvxc585lsesgjy6o') THEN
    ALTER TABLE public.ioeti_fund_opportunity ADD CONSTRAINT fk_lerewaxe4kvxc585lsesgjy6o FOREIGN KEY (currency) REFERENCES public.base_currency(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_mias0bxgw0bii8g6mwl60dn2k') THEN
    ALTER TABLE public.ioeti_fund_commitment ADD CONSTRAINT fk_mias0bxgw0bii8g6mwl60dn2k FOREIGN KEY (created_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_mpblbfv925nq2jwch25kijs47') THEN
    ALTER TABLE public.ioeti_fund_opportunity ADD CONSTRAINT fk_mpblbfv925nq2jwch25kijs47 FOREIGN KEY (created_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_nuvxo9q8bbu92hknot2dbjl0c') THEN
    ALTER TABLE public.ioeti_fund_deliverable ADD CONSTRAINT fk_nuvxo9q8bbu92hknot2dbjl0c FOREIGN KEY (commitment) REFERENCES public.ioeti_fund_commitment(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_nvx8x4g7s19tslxn1vjbgw9by') THEN
    ALTER TABLE public.ioeti_fund_donor_private ADD CONSTRAINT fk_nvx8x4g7s19tslxn1vjbgw9by FOREIGN KEY (updated_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_rx3hywyhxn9cht2f2h7vd65x0') THEN
    ALTER TABLE public.ioeti_fund_stewardship ADD CONSTRAINT fk_rx3hywyhxn9cht2f2h7vd65x0 FOREIGN KEY (created_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_sdmp3gpq84g2rcmrry8o7yh7b') THEN
    ALTER TABLE public.ioeti_fund_donor ADD CONSTRAINT fk_sdmp3gpq84g2rcmrry8o7yh7b FOREIGN KEY (created_by) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_thjbda619wd7xasbwvh4jl7mv') THEN
    ALTER TABLE public.ioeti_fund_commitment ADD CONSTRAINT fk_thjbda619wd7xasbwvh4jl7mv FOREIGN KEY (opportunity) REFERENCES public.ioeti_fund_opportunity(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ioeti_fund_collection_installment_idx ON public.ioeti_fund_collection USING btree (installment);
CREATE INDEX IF NOT EXISTS ioeti_fund_collection_voided_by_idx ON public.ioeti_fund_collection USING btree (voided_by);
CREATE INDEX IF NOT EXISTS ioeti_fund_deliverable_commitment_idx ON public.ioeti_fund_deliverable USING btree (commitment);
CREATE INDEX IF NOT EXISTS ioeti_fund_donor_relationship_manager_idx ON public.ioeti_fund_donor USING btree (relationship_manager);
CREATE INDEX IF NOT EXISTS ioeti_fund_installment_commitment_idx ON public.ioeti_fund_installment USING btree (commitment);
CREATE INDEX IF NOT EXISTS ioeti_fund_opportunity_campaign_idx ON public.ioeti_fund_opportunity USING btree (campaign);
CREATE INDEX IF NOT EXISTS ioeti_fund_opportunity_currency_idx ON public.ioeti_fund_opportunity USING btree (currency);
CREATE INDEX IF NOT EXISTS ioeti_fund_opportunity_donor_idx ON public.ioeti_fund_opportunity USING btree (donor);
CREATE INDEX IF NOT EXISTS ioeti_fund_opportunity_owner_idx ON public.ioeti_fund_opportunity USING btree (owner);
CREATE INDEX IF NOT EXISTS ioeti_fund_opportunity_renewal_of_idx ON public.ioeti_fund_opportunity USING btree (renewal_of);
CREATE INDEX IF NOT EXISTS ioeti_fund_stewardship_donor_idx ON public.ioeti_fund_stewardship USING btree (donor);
CREATE INDEX IF NOT EXISTS ioeti_fund_stewardship_owner_idx ON public.ioeti_fund_stewardship USING btree (owner);

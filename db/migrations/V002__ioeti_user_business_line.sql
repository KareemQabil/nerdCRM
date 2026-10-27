-- SEC-003: User.ioetiBusinessLines membership (join table), domains/User.xml in ioeti-business-lines.
CREATE TABLE IF NOT EXISTS public.ioeti_user_business_line (
    user_id bigint NOT NULL,
    business_line_id bigint NOT NULL,
    CONSTRAINT ioeti_user_business_line_pkey PRIMARY KEY (user_id, business_line_id)
);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_osp7twgjdsaofjoec4g5en6sh') THEN
    ALTER TABLE public.ioeti_user_business_line ADD CONSTRAINT fk_osp7twgjdsaofjoec4g5en6sh FOREIGN KEY (user_id) REFERENCES public.auth_user(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_r1chlesahgu0byfxy9momcp7o') THEN
    ALTER TABLE public.ioeti_user_business_line ADD CONSTRAINT fk_r1chlesahgu0byfxy9momcp7o FOREIGN KEY (business_line_id) REFERENCES public.ioeti_business_line(id);
  END IF;
END $$;

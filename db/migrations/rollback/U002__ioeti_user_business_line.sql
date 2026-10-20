-- Rollback of V002. Removes business line memberships (SEC-003): every Line-scope user loses access.
DROP TABLE IF EXISTS public.ioeti_user_business_line;

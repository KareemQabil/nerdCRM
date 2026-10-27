-- Rollback of V024: drops the retention review decisions (records already anonymized stay anonymized).
DROP TABLE IF EXISTS public.ioeti_privacy_decision;
DROP SEQUENCE IF EXISTS public.ioeti_privacy_decision_seq;

-- Rollback of V003. Drops lineage and lead line data: take a backup first (scripts/backup_restore_drill.sh).
ALTER TABLE public.crm_opportunity DROP COLUMN IF EXISTS ioeti_origin_lead;
ALTER TABLE public.crm_lead DROP COLUMN IF EXISTS ioeti_business_line;

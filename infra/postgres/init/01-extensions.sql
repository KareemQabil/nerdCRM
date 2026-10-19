-- Runs once, when the ioeti_dev_pgdata volume is first initialised.
-- unaccent: Axelor Open Platform enables accent-insensitive search when present (DBHelper.isUnaccentEnabled).
-- pg_trgm: reserved for IOETI fuzzy duplicate detection (company / person names, Arabic normalised text).
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

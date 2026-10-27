-- Rollback of V005: drops the external training tables (data included) and their sequences.
DROP TABLE IF EXISTS public.ioeti_training_attendance;
DROP TABLE IF EXISTS public.ioeti_training_session;
DROP TABLE IF EXISTS public.ioeti_training_enrollment;
DROP TABLE IF EXISTS public.ioeti_training_cohort;
DROP TABLE IF EXISTS public.ioeti_training_course;
DROP SEQUENCE IF EXISTS public.ioeti_training_attendance_seq;
DROP SEQUENCE IF EXISTS public.ioeti_training_cohort_seq;
DROP SEQUENCE IF EXISTS public.ioeti_training_course_seq;
DROP SEQUENCE IF EXISTS public.ioeti_training_enrollment_seq;
DROP SEQUENCE IF EXISTS public.ioeti_training_session_seq;

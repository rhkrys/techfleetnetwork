-- Rename servant_leadership columns to service_leadership in general_applications
ALTER TABLE public.general_applications
  RENAME COLUMN servant_leadership_definition TO service_leadership_definition;

ALTER TABLE public.general_applications
  RENAME COLUMN servant_leadership_actions TO service_leadership_actions;

ALTER TABLE public.general_applications
  RENAME COLUMN servant_leadership_challenges TO service_leadership_challenges;

ALTER TABLE public.general_applications
  RENAME COLUMN servant_leadership_situation TO service_leadership_situation;
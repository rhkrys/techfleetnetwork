CREATE TYPE public.client_kind AS ENUM ('external', 'internal');
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS kind public.client_kind NOT NULL DEFAULT 'external';
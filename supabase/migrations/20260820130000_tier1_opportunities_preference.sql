-- PR 4a (email rearchitecture): the Tier 1 "Opportunities and platform updates" preference.
--
-- One opt-out, default ON. This is the clean successor to the overloaded `notify_announcements`
-- flag for Tier-1 service/opportunity email only: project opening alerts, quest nudges, and
-- service announcements. Default true means everyone receives them unless they opt out; a working
-- one-click unsubscribe (PR 4b) sets this to false. It NEVER gates Tier 0 critical email.
--
-- Expand phase: this column is added now, and the preference-center UI (PR 4c) + the one-click
-- unsubscribe (PR 4b) write it. The Tier-1 senders still read `notify_announcements` until PR 5
-- re-gates them onto this column (dual-read window). `notify_announcements` is dropped in PR 14.
--
-- `ADD COLUMN ... DEFAULT true` backfills every existing row to true in one statement (no separate
-- backfill needed). Owner/RLS: members update their own profile row, so the column is self-editable
-- under the existing profiles UPDATE policy (row-scoped, column-agnostic).

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS notify_opportunities boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.profiles.notify_opportunities IS
  'Tier 1 email opt-out ("Opportunities and platform updates"), default true. Gates project '
  'opening alerts, quest nudges, and service announcements (from PR 5). A one-click unsubscribe '
  'sets this false. Never gates Tier 0 critical email.';

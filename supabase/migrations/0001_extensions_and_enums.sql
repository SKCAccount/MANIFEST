-- 0001_extensions_and_enums.sql
-- MANIFEST — Phase 0 foundation.
--
-- Native enums are used for closed sets only: sets whose members cannot be
-- extended by the operator without a code change. Everything the operator is
-- expected to extend (professional function, specialty, relationship to me,
-- organization type, industry category, source kind, watchlist source) lives in
-- `taxonomies` instead, so adding a value never requires a migration.

-- One schema per system. See the note in 0002 and later files.
create schema if not exists manifest;

-- Extensions stay shared: every system on this database uses the same
-- citext and pg_trgm, and installing them per-schema would duplicate types.
create extension if not exists citext with schema public;
create extension if not exists pg_trgm with schema public;

set search_path = manifest, public, extensions;

-- ---------------------------------------------------------------------------
-- Closed sets
-- ---------------------------------------------------------------------------

-- D is archived. Tier D is never queued and has no cadence.
create type tier as enum ('A', 'B', 'C', 'D');

-- The central invariant of the system. See constraint block on `people`.
create type contact_status as enum ('uncontacted', 'active');

-- Computed by fn_person_stage, never stored, never manually set.
create type dev_stage as enum ('card', 'contact', 'active', 'producing');

create type watch_priority as enum ('high', 'medium', 'low');

create type touch_channel as enum (
  'email', 'call', 'meeting', 'linkedin', 'text',
  'event', 'mail', 'social', 'system', 'other'
);

create type touch_direction as enum ('inbound', 'outbound', 'mutual');

create type touch_source as enum ('manual', 'gmail', 'gcal', 'import', 'bulk_event', 'system');

-- Direction is always from the operator's point of view.
--   'gave'     = the operator did this person a favor
--   'received' = this person did the operator a favor
create type favor_direction as enum ('gave', 'received');

create type deal_stage as enum ('referred', 'screening', 'diligence', 'docs', 'funded', 'declined', 'dead');

create type consent_status as enum (
  'never_asked', 'pending', 'subscribed', 'unsubscribed', 'bounced', 'suppressed'
);

create type intro_perspective as enum ('made_by_me', 'received_by_me', 'observed');

-- Drives mailing-list jurisdiction (CAN-SPAM / CASL / GDPR / PECR) without a
-- second column to keep in sync.
create type region_code as enum ('us', 'ca', 'eu', 'uk', 'apac', 'other');

create type note_category as enum (
  'personal', 'professional', 'preference', 'warning', 'mutual_interest', 'compliance'
);

create type followup_status as enum ('open', 'done', 'dropped');

create type favor_kind as enum ('intro', 'referral', 'business', 'advice', 'hospitality', 'other');

create type staging_kind as enum (
  'person_suggestion', 'dedupe_candidate', 'job_change', 'gmail_suggestion', 'linkedin_connection'
);

create type staging_status as enum ('pending', 'accepted', 'rejected', 'merged');

/**
 * The native Postgres enums, mirrored once in TypeScript.
 *
 * These are the closed sets — the ones the operator cannot extend without a
 * migration. Everything extensible (professional function, specialty,
 * relationship to me, organization type, industry category, source kind,
 * watchlist source) lives in the `taxonomies` table and is read at runtime, so
 * it deliberately does not appear here.
 *
 * The `*_VALUES` arrays are the single source for UI dropdowns and Zod enums,
 * so a value can never be offered in the interface that the database would
 * reject.
 */

export const TIER_VALUES = ['A', 'B', 'C', 'D'] as const;
export type Tier = (typeof TIER_VALUES)[number];

export const CONTACT_STATUS_VALUES = ['uncontacted', 'active'] as const;
export type ContactStatus = (typeof CONTACT_STATUS_VALUES)[number];

export const DEV_STAGE_VALUES = ['card', 'contact', 'active', 'producing'] as const;
export type DevStage = (typeof DEV_STAGE_VALUES)[number];

export const WATCH_PRIORITY_VALUES = ['high', 'medium', 'low'] as const;
export type WatchPriority = (typeof WATCH_PRIORITY_VALUES)[number];

export const TOUCH_CHANNEL_VALUES = [
  'email',
  'call',
  'meeting',
  'linkedin',
  'text',
  'event',
  'mail',
  'social',
  'system',
  'other',
] as const;
export type TouchChannel = (typeof TOUCH_CHANNEL_VALUES)[number];

export const TOUCH_DIRECTION_VALUES = ['inbound', 'outbound', 'mutual'] as const;
export type TouchDirection = (typeof TOUCH_DIRECTION_VALUES)[number];

export const TOUCH_SOURCE_VALUES = ['manual', 'gmail', 'gcal', 'import', 'bulk_event', 'system'] as const;
export type TouchSource = (typeof TOUCH_SOURCE_VALUES)[number];

export const FAVOR_DIRECTION_VALUES = ['gave', 'received'] as const;
export type FavorDirection = (typeof FAVOR_DIRECTION_VALUES)[number];

export const FAVOR_KIND_VALUES = ['intro', 'referral', 'business', 'advice', 'hospitality', 'other'] as const;
export type FavorKind = (typeof FAVOR_KIND_VALUES)[number];

export const DEAL_STAGE_VALUES = [
  'referred',
  'screening',
  'diligence',
  'docs',
  'funded',
  'declined',
  'dead',
] as const;
export type DealStage = (typeof DEAL_STAGE_VALUES)[number];

export const INTRO_PERSPECTIVE_VALUES = ['made_by_me', 'received_by_me', 'observed'] as const;
export type IntroPerspective = (typeof INTRO_PERSPECTIVE_VALUES)[number];

export const NOTE_CATEGORY_VALUES = [
  'personal',
  'professional',
  'preference',
  'warning',
  'mutual_interest',
  'compliance',
] as const;
export type NoteCategory = (typeof NOTE_CATEGORY_VALUES)[number];

export const FOLLOWUP_STATUS_VALUES = ['open', 'done', 'dropped'] as const;
export type FollowupStatus = (typeof FOLLOWUP_STATUS_VALUES)[number];

export const STAGING_KIND_VALUES = [
  'person_suggestion',
  'dedupe_candidate',
  'job_change',
  'gmail_suggestion',
  'linkedin_connection',
] as const;
export type StagingKind = (typeof STAGING_KIND_VALUES)[number];

export const STAGING_STATUS_VALUES = ['pending', 'accepted', 'rejected', 'merged'] as const;
export type StagingStatus = (typeof STAGING_STATUS_VALUES)[number];

/** The extensible lists, by domain key. Values come from `taxonomies` at runtime. */
export const TAXONOMY_DOMAINS = [
  'professional_function',
  'specialty',
  'relationship_to_me',
  'organization_type',
  'industry_category',
  'source_kind',
  'watchlist_source',
] as const;
export type TaxonomyDomain = (typeof TAXONOMY_DOMAINS)[number];

/**
 * Default cadence in days, by tier. Mirrors fn_tier_cadence_days.
 * Tier D is archived: no cadence, never queued.
 */
export const TIER_CADENCE_DAYS: Record<Tier, number | null> = {
  A: 45,
  B: 90,
  C: 180,
  D: null,
};

/** Queue score multipliers. Mirrors fn_tier_weight. */
export const TIER_WEIGHT: Record<Tier, number> = { A: 3.0, B: 1.6, C: 1.0, D: 0 };

/** The horizons the events screen offers, alongside "present". */
export const HORIZONS = [90, 180, 365, 730] as const;
export type Horizon = (typeof HORIZONS)[number];

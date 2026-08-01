/**
 * Database types.
 *
 * Regenerate against a linked instance with:
 *   npm run db:types      (supabase gen types typescript --local)
 *
 * Until the instance is provisioned this file is maintained by hand, and
 * tests/phase0/types.test.ts introspects the real schema to prove that every
 * table, view, enum and function below still exists and that none is missing.
 * That check is what keeps a hand-maintained file from drifting.
 */

import type {
  ContactStatus,
  DealStage,
  DevStage,
  FavorDirection,
  FavorKind,
  FollowupStatus,
  IntroPerspective,
  NoteCategory,
  StagingKind,
  StagingStatus,
  Tier,
  TouchChannel,
  TouchDirection,
  TouchSource,
  WatchPriority,
} from './enums';

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

/** Columns the database always supplies. */
type Generated = 'id' | 'created_at' | 'updated_at';

type Insertable<Row, AlwaysGenerated extends keyof Row, Required extends keyof Row> =
  Partial<Omit<Row, AlwaysGenerated | Required>> & Pick<Row, Required> & Partial<Pick<Row, AlwaysGenerated>>;

// ---------------------------------------------------------------------------
// Table rows
// ---------------------------------------------------------------------------

export type PeopleRow = {
  id: string;
  first_name: string;
  last_name: string | null;
  preferred_name: string | null;
  name_pronunciation: string | null;
  /** Generated. */
  full_name: string;
  /** Generated dedupe key. */
  name_key: string | null;
  position: string | null;
  organization_id: string | null;
  professional_function: string[];
  specialties: string[];
  relationship_to_me: string[];
  city: string | null;
  state: string | null;
  country: string | null;
  contact_status: ContactStatus;
  first_contact_at: string | null;
  watchlist_reason: string | null;
  watchlist_source: string | null;
  watchlist_priority: WatchPriority | null;
  watchlist_added_on: string | null;
  met_at_source_id: string | null;
  met_on: string | null;
  introduced_by_person_id: string | null;
  introduced_by_external: string | null;
  tier: Tier;
  cadence_days_override: number | null;
  cadence_paused_until: string | null;
  email_work: string | null;
  email_personal: string | null;
  phone_mobile: string | null;
  phone_office: string | null;
  linkedin_url: string | null;
  /** Generated dedupe key. */
  linkedin_key: string | null;
  other_url: string | null;
  do_not_contact: boolean;
  summary: string | null;
  tags: string[];
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

export type OrganizationsRow = {
  id: string;
  name: string;
  organization_type: string | null;
  industry_category: string | null;
  sub_industry: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  domain: string | null;
  website: string | null;
  linkedin_url: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type SourcesRow = {
  id: string;
  event_name: string;
  event_year: number | null;
  /** Generated from event_name and event_year. */
  display_name: string;
  kind: string;
  occurred_on: string | null;
  ends_on: string | null;
  city: string | null;
  state: string | null;
  url: string | null;
  plunder_ref: string | null;
  attended: boolean;
  cost_pass_cents: number | null;
  cost_travel_cents: number | null;
  cost_lodging_cents: number | null;
  cost_meals_cents: number | null;
  cost_other_cents: number | null;
  /** Generated sum. The single stored copy of an event's cost. */
  cost_total_cents: number | null;
  cost_note: string | null;
  retro_note: string | null;
  created_at: string;
  updated_at: string;
};

export type TouchpointsRow = {
  id: string;
  person_id: string;
  occurred_at: string;
  channel: TouchChannel;
  direction: TouchDirection;
  substantive: boolean;
  subject: string | null;
  summary: string | null;
  outcome: string | null;
  source: TouchSource;
  external_id: string | null;
  group_key: string | null;
  source_id: string | null;
  supersedes_id: string | null;
  created_at: string;
};

export type NotesRow = {
  id: string;
  person_id: string;
  category: NoteCategory;
  body: string;
  is_pinned: boolean;
  source_touchpoint_id: string | null;
  created_at: string;
  updated_at: string;
};

export type FollowupsRow = {
  id: string;
  person_id: string;
  title: string;
  detail: string | null;
  due_on: string;
  status: FollowupStatus;
  completed_at: string | null;
  source_touchpoint_id: string | null;
  created_at: string;
  updated_at: string;
};

export type TierHistoryRow = {
  id: string;
  person_id: string;
  from_tier: Tier | null;
  to_tier: Tier;
  changed_at: string;
  reason: string | null;
  created_at: string;
};

export type AffiliationHistoryRow = {
  id: string;
  person_id: string;
  organization_id: string | null;
  organization_name: string | null;
  position: string | null;
  started_on: string | null;
  ended_on: string | null;
  note: string | null;
  created_at: string;
};

export type IntroductionsRow = {
  id: string;
  perspective: IntroPerspective;
  introducer_person_id: string | null;
  party_a_person_id: string | null;
  party_b_person_id: string | null;
  external_party_name: string | null;
  occurred_on: string | null;
  outcome: string | null;
  note: string | null;
  /** Set when trg_introduced_by generated this row from a person's referred-by field. */
  auto_from_person_id: string | null;
  created_at: string;
  updated_at: string;
};

export type FavorsRow = {
  id: string;
  person_id: string;
  direction: FavorDirection;
  kind: FavorKind;
  occurred_on: string;
  description: string | null;
  value_note: string | null;
  created_at: string;
  updated_at: string;
};

export type DealsRow = {
  id: string;
  name: string;
  counterparty_organization_id: string | null;
  source_person_id: string | null;
  source_organization_id: string | null;
  stage: DealStage;
  amount_cents: number | null;
  referred_on: string | null;
  closed_on: string | null;
  external_ref: string | null;
  commission_terms: string | null;
  commission_earned_cents: number | null;
  commission_paid_cents: number | null;
  note: string | null;
  created_at: string;
  updated_at: string;
};

export type ContentTouchesRow = {
  id: string;
  person_id: string;
  content_title: string;
  content_ref: string | null;
  sent_on: string;
  channel: TouchChannel;
  response_note: string | null;
  created_at: string;
  updated_at: string;
};

export type StagingRecordsRow = {
  id: string;
  kind: StagingKind;
  status: StagingStatus;
  payload: Json;
  confidence: number | null;
  matched_person_id: string | null;
  dedupe_target_id: string | null;
  source: TouchSource;
  external_id: string | null;
  note: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
};

export type MergeLogRow = {
  id: string;
  winner_person_id: string;
  loser_person_id: string;
  loser_snapshot: Json;
  reassigned: Json;
  merged_at: string;
  reverted_at: string | null;
  expires_on: string;
  note: string | null;
};

export type SyncStateRow = {
  id: string;
  channel: string;
  cursor: string | null;
  last_run_at: string | null;
  last_status: string | null;
  last_error: string | null;
  detail: Json;
  created_at: string;
  updated_at: string;
};

export type TaxonomiesRow = {
  id: string;
  domain: string;
  value: string;
  label: string;
  meta: Json;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type AppOwnersRow = {
  user_id: string;
  label: string | null;
  created_at: string;
};

// ---------------------------------------------------------------------------
// View rows
// ---------------------------------------------------------------------------

export type PersonRecencyRow = {
  person_id: string;
  tier: Tier;
  first_contact_at: string | null;
  last_touch_at: string | null;
  last_substantive_at: string | null;
  last_inbound_at: string | null;
  last_outbound_at: string | null;
  touch_count_365d: number;
  substantive_count_365d: number;
  effective_cadence_days: number | null;
  next_due_at: string | null;
  days_overdue: number | null;
  is_paused: boolean;
  cadence_paused_until: string | null;
  inbound_unanswered: boolean;
};

export type QueueRow = {
  person_id: string;
  full_name: string;
  preferred_name: string | null;
  position: string | null;
  organization_id: string | null;
  organization_name: string | null;
  tier: Tier;
  city: string | null;
  state: string | null;
  days_overdue: number;
  effective_cadence_days: number;
  next_due_at: string;
  last_touch_at: string | null;
  last_substantive_at: string | null;
  inbound_unanswered: boolean;
  last_substantive_summary: string | null;
  job_changed_at: string | null;
  followup_title: string | null;
  followup_due_on: string | null;
  reciprocity_balance: number | null;
  reciprocity_owed: boolean | null;
  value_score: number | null;
  implied_tier: Tier | null;
  unsent_content_title: string | null;
  score: number;
  opener_kind:
    | 'job_change'
    | 'inbound_unanswered'
    | 'followup'
    | 'reciprocity'
    | 'content'
    | 'last_conversation'
    | 'overdue';
  suggested_opener: string;
  queue_rank: number;
};

export type NeverFollowedUpRow = {
  person_id: string;
  full_name: string;
  position: string | null;
  organization_id: string | null;
  organization_name: string | null;
  tier: Tier;
  city: string | null;
  state: string | null;
  met_at: string | null;
  met_on: string | null;
  only_touch_at: string;
  only_touch_channel: TouchChannel;
  only_touch_summary: string | null;
  days_since: number;
};

export type WatchlistRow = {
  person_id: string;
  full_name: string;
  position: string | null;
  organization_id: string | null;
  organization_name: string | null;
  professional_function: string[];
  specialties: string[];
  city: string | null;
  state: string | null;
  country: string | null;
  linkedin_url: string | null;
  email_work: string | null;
  email_personal: string | null;
  phone_mobile: string | null;
  phone_office: string | null;
  watchlist_reason: string;
  watchlist_source: string | null;
  watchlist_priority: WatchPriority | null;
  watchlist_added_on: string | null;
  introduced_by_name: string | null;
  introduced_by_person_id: string | null;
  introduced_by_external: string | null;
  outreach_attempts: number;
  last_attempt_at: string | null;
  last_attempt_channel: TouchChannel | null;
  warm_path_count: number;
  top_paths: string[] | null;
  /** Displayed, never used to rank or flag. Watchlist entries do not expire. */
  days_waiting: number | null;
};

export type DirectoryRow = {
  person_id: string;
  full_name: string;
  preferred_name: string | null;
  name_pronunciation: string | null;
  position: string | null;
  organization_id: string | null;
  organization_name: string | null;
  organization_type: string | null;
  industry_category: string | null;
  professional_function: string[];
  specialties: string[];
  relationship_to_me: string[];
  tags: string[];
  city: string | null;
  state: string | null;
  country: string | null;
  tier: Tier;
  email_work: string | null;
  email_personal: string | null;
  phone_mobile: string | null;
  phone_office: string | null;
  linkedin_url: string | null;
  do_not_contact: boolean;
  summary: string | null;
  last_touch_at: string | null;
  last_substantive_at: string | null;
  days_overdue: number | null;
  stage: DevStage | null;
  met_at: string | null;
  met_on: string | null;
};

export type GeographyRow = {
  cohort: 'active' | 'watchlist';
  person_id: string;
  full_name: string;
  position: string | null;
  organization_name: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  tier: Tier | null;
  professional_function: string[];
  specialties: string[];
  relationship_to_me: string[];
  last_touch_at: string | null;
  last_substantive_at: string | null;
  days_overdue: number | null;
  is_overdue: boolean;
  stage: DevStage | null;
  watchlist_reason: string | null;
  watchlist_priority: WatchPriority | null;
  warm_path_count: number;
  top_paths: string[] | null;
  outreach_attempts: number;
  last_attempt_at: string | null;
};

export type PathToRow = {
  target_person_id: string;
  connector_person_id: string;
  connector_name: string;
  connector_tier: Tier;
  /** 1 explicit referral, 2 shared current org, 3 shared former org, 4 shared event, 5 specialty + city. */
  path_rank: 1 | 2 | 3 | 4 | 5;
  path_reason: string;
};

export type SourceMetricsRow = {
  source_id: string;
  horizon_days: number | null;
  cutoff_at: string | null;
  is_mature: boolean;
  days_since_event: number | null;
  cost_total_cents: number | null;
  new_contacts: number;
  relationships_touched: number;
  stage_card: number;
  stage_contact: number;
  stage_active: number;
  stage_producing: number;
  active_or_better: number;
  tier_ab_contacts: number;
  deals_sourced: number;
  deals_funded: number;
  funded_dollars_cents: number;
  commissions_earned_cents: number;
  cost_per_new_contact_cents: number | null;
  cost_per_active_or_better_cents: number | null;
  cost_per_producing_cents: number | null;
  return_multiple: number | null;
};

export type SourceRoiRow = SourceMetricsRow & {
  event_name: string;
  event_year: number | null;
  display_name: string;
  kind: string;
  occurred_on: string | null;
  city: string | null;
  state: string | null;
  attended: boolean;
  cost_pass_cents: number | null;
  cost_travel_cents: number | null;
  cost_lodging_cents: number | null;
  cost_meals_cents: number | null;
  cost_other_cents: number | null;
  mature_90: boolean | null;
  mature_180: boolean | null;
  mature_365: boolean | null;
  mature_730: boolean | null;
};

export type SourceCohortRow = SourceMetricsRow & {
  event_name: string;
  event_year: number | null;
  display_name: string;
  kind: string;
  occurred_on: string | null;
};

export type SourceSeriesRow = {
  event_name: string;
  editions: number;
  first_year: number | null;
  last_year: number | null;
  cost_total_cents: number | null;
  new_contacts: number;
  relationships_touched: number;
  stage_card: number;
  stage_contact: number;
  stage_active: number;
  stage_producing: number;
  active_or_better: number;
  deals_sourced: number;
  deals_funded: number;
  funded_dollars_cents: number;
  commissions_earned_cents: number;
  cost_per_new_contact_cents: number | null;
  cost_per_active_or_better_cents: number | null;
  cost_per_producing_cents: number | null;
  return_multiple: number | null;
};

export type RelationshipValueRow = {
  person_id: string;
  funded_dollars_cents: number;
  intros_received_count: number;
  inbound_initiation_ratio: number;
  substantive_touches_24mo: number;
  network_centrality: number;
  favors_received: number;
  reciprocity_deficit_flag: number;
  value_score: number;
};

export type TierMismatchRow = {
  person_id: string;
  full_name: string;
  organization_id: string | null;
  assigned_tier: Tier;
  value_score: number;
  implied_tier: Tier | null;
  verdict: 'underrated' | 'overrated';
  last_substantive_at: string | null;
  first_tier: Tier | null;
  tier_changes: number;
  last_tier_change_at: string | null;
  trajectory: 'improving' | 'declining' | 'flat' | 'unknown';
};

export type ReciprocityRow = {
  person_id: string;
  favors_given: number;
  favors_received: number;
  net_balance: number;
  last_favor_on: string | null;
  is_owed: boolean;
};

export type DealSourcesRow = {
  person_id: string;
  full_name: string;
  organization_id: string | null;
  tier: Tier;
  deals_referred: number;
  deals_funded: number;
  funded_dollars_cents: number;
  commissions_earned_cents: number;
  commissions_paid_cents: number;
  conversion_rate: number | null;
  last_referral_on: string | null;
};

export type DataQualityRow = {
  issue_kind:
    | 'duplicate_organization'
    | 'taxonomy_drift'
    | 'missing_contact_info'
    | 'event_missing_cost'
    | 'stale_active_record'
    | 'unnormalized_phone'
    | 'thin_watchlist_identifier';
  severity: 'error' | 'warning' | 'info';
  entity_type: 'person' | 'organization' | 'source' | 'taxonomy';
  entity_id: string;
  entity_label: string;
  detail: string;
};

// ---------------------------------------------------------------------------
// The Database shape supabase-js is generic over
// ---------------------------------------------------------------------------

/**
 * Foreign keys the app actually joins through. supabase-js resolves embedded
 * selects (`organization:organizations(name)`) against this list, so a join
 * that is not declared here fails to type — which is the intended behaviour:
 * it makes an undeclared join a compile error rather than a runtime surprise.
 */
type Rel<
  Name extends string,
  Column extends string,
  Referenced extends string,
  OneToOne extends boolean = false,
> = {
  foreignKeyName: Name;
  columns: [Column];
  isOneToOne: OneToOne;
  referencedRelation: Referenced;
  referencedColumns: ['id'];
};

type Table<Row, Required extends keyof Row, Relationships extends readonly unknown[] = []> = {
  Row: Row;
  Insert: Insertable<Row, Extract<Generated, keyof Row>, Required>;
  Update: Partial<Row>;
  Relationships: Relationships;
};

type View<Row> = { Row: Row; Relationships: [] };

export type Database = {
  /**
   * MANIFEST owns the `manifest` schema, not `public`. The key here must match
   * the `db.schema` option the clients pass, or supabase-js resolves table
   * names against the wrong schema and every query fails to type.
   */
  manifest: {
    Tables: {
      people: Table<
        PeopleRow,
        'first_name',
        [
          Rel<'people_organization_id_fkey', 'organization_id', 'organizations'>,
          Rel<'people_met_at_source_id_fkey', 'met_at_source_id', 'sources'>,
          Rel<'people_introduced_by_person_id_fkey', 'introduced_by_person_id', 'people'>,
        ]
      >;
      organizations: Table<OrganizationsRow, 'name'>;
      sources: Table<SourcesRow, 'event_name' | 'kind'>;
      touchpoints: Table<
        TouchpointsRow,
        'person_id' | 'channel' | 'direction',
        [
          Rel<'touchpoints_person_id_fkey', 'person_id', 'people'>,
          Rel<'touchpoints_source_id_fkey', 'source_id', 'sources'>,
        ]
      >;
      notes: Table<NotesRow, 'person_id' | 'body', [Rel<'notes_person_id_fkey', 'person_id', 'people'>]>;
      followups: Table<
        FollowupsRow,
        'person_id' | 'title' | 'due_on',
        [Rel<'followups_person_id_fkey', 'person_id', 'people'>]
      >;
      tier_history: Table<TierHistoryRow, 'person_id' | 'to_tier'>;
      affiliation_history: Table<AffiliationHistoryRow, 'person_id'>;
      introductions: Table<
        IntroductionsRow,
        'perspective',
        [
          Rel<'introductions_introducer_person_id_fkey', 'introducer_person_id', 'people'>,
          Rel<'introductions_party_a_person_id_fkey', 'party_a_person_id', 'people'>,
          Rel<'introductions_party_b_person_id_fkey', 'party_b_person_id', 'people'>,
        ]
      >;
      favors: Table<FavorsRow, 'person_id' | 'direction'>;
      deals: Table<DealsRow, 'name'>;
      content_touches: Table<ContentTouchesRow, 'person_id' | 'content_title'>;
      staging_records: Table<StagingRecordsRow, 'kind'>;
      merge_log: Table<MergeLogRow, 'winner_person_id' | 'loser_person_id' | 'loser_snapshot'>;
      sync_state: Table<SyncStateRow, 'channel'>;
      taxonomies: Table<TaxonomiesRow, 'domain' | 'value' | 'label'>;
      app_owners: Table<AppOwnersRow, 'user_id'>;
    };
    Views: {
      v_contact_touchpoints: View<TouchpointsRow>;
      v_person_recency: View<PersonRecencyRow>;
      v_person_stage: View<{ person_id: string; stage: DevStage | null }>;
      v_queue: View<QueueRow>;
      v_never_followed_up: View<NeverFollowedUpRow>;
      v_watchlist: View<WatchlistRow>;
      v_directory: View<DirectoryRow>;
      v_geography: View<GeographyRow>;
      v_path_to: View<PathToRow>;
      v_source_roi: View<SourceRoiRow>;
      v_source_cohort: View<SourceCohortRow>;
      v_source_series: View<SourceSeriesRow>;
      v_relationship_value: View<RelationshipValueRow>;
      v_tier_mismatch: View<TierMismatchRow>;
      v_reciprocity: View<ReciprocityRow>;
      v_deal_sources: View<DealSourcesRow>;
      v_deal_sources_org: View<Record<string, unknown>>;
      v_network_centrality: View<{ person_id: string; network_centrality: number }>;
      v_data_quality: View<DataQualityRow>;
    };
    Functions: {
      fn_person_stage: { Args: { p_person_id: string; p_as_of?: string }; Returns: DevStage | null };
      fn_tier_as_of: { Args: { p_person_id: string; p_as_of?: string }; Returns: Tier | null };
      fn_source_metrics: {
        Args: { p_source_id: string; p_horizon_days?: number | null };
        Returns: SourceMetricsRow[];
      };
      fn_path_to: { Args: { p_target_person_id: string }; Returns: PathToRow[] };
      /** Writes an active person and its establishing touchpoint atomically. */
      fn_create_active_person: {
        Args: { p_person: Json; p_touchpoint: Json };
        Returns: string;
      };
      /** One meeting touchpoint per attendee, sharing a group_key. */
      fn_log_bulk_event: {
        Args: {
          p_source_id: string;
          p_person_ids: string[];
          p_occurred_at?: string;
          p_substantive?: boolean;
          p_summary?: string | null;
          p_set_met_at?: boolean;
        };
        Returns: Array<{ person_id: string; promoted: boolean; met_at_set: boolean }>;
      };
      fn_normalize_phone: { Args: { raw: string; default_cc?: string }; Returns: string | null };
      fn_normalize_linkedin: { Args: { raw: string }; Returns: string | null };
      fn_is_owner: { Args: Record<string, never>; Returns: boolean };
    };
    Enums: {
      tier: Tier;
      contact_status: ContactStatus;
      dev_stage: DevStage;
      watch_priority: WatchPriority;
      touch_channel: TouchChannel;
      touch_direction: TouchDirection;
      touch_source: TouchSource;
      favor_direction: FavorDirection;
      favor_kind: FavorKind;
      deal_stage: DealStage;
      intro_perspective: IntroPerspective;
      note_category: NoteCategory;
      followup_status: FollowupStatus;
      staging_kind: StagingKind;
      staging_status: StagingStatus;
    };
    CompositeTypes: Record<string, never>;
  };
};

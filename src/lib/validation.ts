/**
 * Zod schemas. No unvalidated input reaches the database.
 *
 * These mirror the database constraints rather than replacing them. The
 * database is the authority — a constraint that only lives here would be
 * bypassed by a sync job or an import. What these add is a *good error
 * message*: "a watchlist entry needs a reason" instead of
 * "people_uncontacted_requires_reason".
 */

import { z } from 'zod';
import {
  CONTACT_STATUS_VALUES,
  DEAL_STAGE_VALUES,
  FAVOR_DIRECTION_VALUES,
  FAVOR_KIND_VALUES,
  FOLLOWUP_STATUS_VALUES,
  NOTE_CATEGORY_VALUES,
  TIER_VALUES,
  TOUCH_CHANNEL_VALUES,
  TOUCH_DIRECTION_VALUES,
  TOUCH_SOURCE_VALUES,
  WATCH_PRIORITY_VALUES,
} from './db/enums';

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** HTML forms send "" for an untouched field. That means null, not empty string. */
export const nullableText = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((value) => {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    return trimmed === '' ? null : trimmed;
  });

const requiredText = (label: string, max = 500) =>
  z
    .string()
    .transform((v) => v.trim())
    .pipe(z.string().min(1, `${label} is required.`).max(max, `${label} is too long.`));

export const uuid = z.string().uuid('Not a valid id.');
export const nullableUuid = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((v) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null))
  .pipe(z.string().uuid('Not a valid id.').nullable());

/** A calendar day, as an ISO date. */
export const nullableDate = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((v) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null))
  .pipe(
    z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-03-04.')
      .nullable(),
  );

export const nullableTimestamp = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((v) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null))
  .pipe(
    z
      .string()
      .refine((s) => !Number.isNaN(Date.parse(s)), 'Not a valid date and time.')
      .nullable(),
  );

/** Repeated checkbox values arrive as string[]; a single one arrives as string. */
export const stringArray = z
  .union([z.array(z.string()), z.string(), z.null(), z.undefined()])
  .transform((value) => {
    if (value === null || value === undefined) return [] as string[];
    const items = Array.isArray(value) ? value : [value];
    return [...new Set(items.map((v) => v.trim()).filter((v) => v !== ''))];
  });

/** Money is integer cents, never a float. Accepts "4,200" and "$4,200.00". */
export const nullableCents = z
  .union([z.string(), z.number(), z.null(), z.undefined()])
  .transform((value, ctx) => {
    if (value === null || value === undefined || value === '') return null;

    const cleaned = typeof value === 'number' ? String(value) : value.replace(/[$,\s]/g, '');
    if (cleaned.trim() === '') return null;

    const parsed = Number(cleaned);
    if (!Number.isFinite(parsed) || parsed < 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter an amount like 4,200.' });
      return z.NEVER;
    }
    return Math.round(parsed * 100);
  });

const nullableEmail = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((v) => (typeof v === 'string' && v.trim() !== '' ? v.trim().toLowerCase() : null))
  .pipe(z.string().email('Not a valid email address.').nullable());

const nullableUrl = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((v) => {
    const trimmed = typeof v === 'string' ? v.trim() : '';
    if (trimmed === '') return null;
    // The operator pastes "seakingcapital.com" as often as a full URL.
    return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  })
  .pipe(z.string().url('Not a valid URL.').nullable());

/** LinkedIn is stored as typed; fn_normalize_linkedin derives the dedupe key. */
const nullableLinkedIn = nullableText;

const checkbox = z
  .union([z.string(), z.boolean(), z.null(), z.undefined()])
  .transform((v) => v === true || v === 'on' || v === 'true' || v === '1');

// ---------------------------------------------------------------------------
// Shared descriptor fields
// ---------------------------------------------------------------------------

const descriptorFields = {
  first_name: requiredText('First name', 100),
  last_name: nullableText,
  preferred_name: nullableText,
  name_pronunciation: nullableText,
  position: nullableText,
  organization_id: nullableUuid,
  /** Created inline when the operator types a name the combobox does not know. */
  new_organization_name: nullableText,
  professional_function: stringArray,
  specialties: stringArray,
  relationship_to_me: stringArray,
  city: nullableText,
  state: nullableText,
  country: nullableText,
  email_work: nullableEmail,
  email_personal: nullableEmail,
  phone_mobile: nullableText,
  phone_office: nullableText,
  /** 'mobile' | 'office'. Meaningful only when both numbers exist; kept (harmlessly) otherwise. */
  preferred_phone: z
    .union([z.string(), z.null(), z.undefined()])
    .transform((v) => (v === 'mobile' || v === 'office' ? v : null)),
  linkedin_url: nullableLinkedIn,
  other_url: nullableUrl,
  introduced_by_person_id: nullableUuid,
  introduced_by_external: nullableText,
  summary: nullableText,
  tags: stringArray,
};

/** At least one way to reach them. A name with no handle is a note, not a record. */
function hasIdentifier(input: {
  linkedin_url: string | null;
  email_work: string | null;
  email_personal: string | null;
  phone_mobile: string | null;
  phone_office: string | null;
  organization_id: string | null;
  new_organization_name: string | null;
}): boolean {
  return Boolean(
    input.linkedin_url ||
      input.email_work ||
      input.email_personal ||
      input.phone_mobile ||
      input.phone_office ||
      input.organization_id ||
      input.new_organization_name,
  );
}

// ---------------------------------------------------------------------------
// Touchpoints
// ---------------------------------------------------------------------------

export const touchpointSchema = z.object({
  person_id: uuid,
  occurred_at: nullableTimestamp,
  channel: z.enum(TOUCH_CHANNEL_VALUES),
  direction: z.enum(TOUCH_DIRECTION_VALUES),
  substantive: checkbox,
  subject: nullableText,
  summary: nullableText,
  outcome: nullableText,
  source: z.enum(TOUCH_SOURCE_VALUES).default('manual'),
  source_id: nullableUuid,
  group_key: nullableUuid,
});

export type TouchpointInput = z.infer<typeof touchpointSchema>;

/** Whether a touchpoint would promote an uncontacted record. Mirrors trg_first_contact. */
export function qualifiesAsContact(input: { channel: string; direction: string }): boolean {
  return input.direction === 'inbound' || input.direction === 'mutual' || input.channel === 'meeting';
}

/** The touchpoint that establishes a new active relationship, entered alongside the person. */
const firstTouchpointSchema = z.object({
  channel: z.enum(TOUCH_CHANNEL_VALUES),
  direction: z.enum(TOUCH_DIRECTION_VALUES),
  occurred_at: nullableTimestamp,
  substantive: checkbox,
  summary: nullableText,
});

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

/**
 * Creating an active person.
 *
 * The database requires first_contact_at; the application rule (§4.9) is
 * stricter — a qualifying touchpoint must be written in the same transaction.
 * That is enforced by requiring it here and refusing anything that would not
 * promote a watchlist entry, so "active" can never mean "I found their name".
 */
export const createActivePersonSchema = z
  .object({
    ...descriptorFields,
    contact_status: z.literal('active').default('active'),
    tier: z.enum(TIER_VALUES).default('C'),
    met_at_source_id: nullableUuid,
    met_on: nullableDate,
    cadence_days_override: z
      .union([z.string(), z.number(), z.null(), z.undefined()])
      .transform((v) => (v === null || v === undefined || v === '' ? null : Number(v)))
      .pipe(z.number().int().positive('Cadence must be a positive number of days.').nullable()),
    do_not_contact: checkbox,
    first_touchpoint: firstTouchpointSchema,
  })
  .superRefine((input, ctx) => {
    if (!qualifiesAsContact(input.first_touchpoint)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['first_touchpoint', 'direction'],
        message:
          'An active record needs two-way contact: an inbound or mutual touchpoint, or a meeting. ' +
          'If you have only reached out, add them to the watchlist and log the attempt there.',
      });
    }
    if (input.met_on && !input.met_at_source_id && !input.met_at_source_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['met_on'],
        message: 'A "met on" date needs a "met at" source.',
      });
    }
  });

export type CreateActivePersonInput = z.infer<typeof createActivePersonSchema>;

/**
 * Creating a watchlist entry.
 *
 * The reason is required, and that requirement exists to make bulk entry
 * tedious. It is not to be relaxed or defaulted.
 */
export const createWatchlistEntrySchema = z
  .object({
    ...descriptorFields,
    contact_status: z.literal('uncontacted').default('uncontacted'),
    watchlist_reason: requiredText('A reason', 2000),
    watchlist_source: nullableText,
    watchlist_priority: z.enum(WATCH_PRIORITY_VALUES).nullish(),
    watchlist_added_on: nullableDate,
  })
  .superRefine((input, ctx) => {
    if (!hasIdentifier(input)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['linkedin_url'],
        message:
          'Add at least one identifier — LinkedIn, an email, a phone number, or an organization. ' +
          'A name with no handle is a note, not a record.',
      });
    }
    if (input.watchlist_reason.trim().length < 10) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['watchlist_reason'],
        message: 'Say why they are worth meeting, in your own words. One phrase is not a reason.',
      });
    }
  });

export type CreateWatchlistEntryInput = z.infer<typeof createWatchlistEntrySchema>;

/**
 * Editing a person. contact_status is deliberately absent: promotion happens by
 * trigger when a qualifying touchpoint arrives, and the reverse is forbidden
 * outright — you cannot un-meet someone.
 */
export const updatePersonSchema = z.object({
  id: uuid,
  ...descriptorFields,
  tier: z.enum(TIER_VALUES),
  met_at_source_id: nullableUuid,
  met_on: nullableDate,
  cadence_days_override: z
    .union([z.string(), z.number(), z.null(), z.undefined()])
    .transform((v) => (v === null || v === undefined || v === '' ? null : Number(v)))
    .pipe(z.number().int().positive('Cadence must be a positive number of days.').nullable()),
  cadence_paused_until: nullableTimestamp,
  do_not_contact: checkbox,
  watchlist_reason: nullableText,
  watchlist_source: nullableText,
  watchlist_priority: z.enum(WATCH_PRIORITY_VALUES).nullish(),
});

export type UpdatePersonInput = z.infer<typeof updatePersonSchema>;

export const changeTierSchema = z.object({
  person_id: uuid,
  tier: z.enum(TIER_VALUES),
});

export const snoozeSchema = z.object({
  person_id: uuid,
  days: z.coerce.number().int().refine((d) => [30, 60, 90].includes(d), 'Snooze 30, 60 or 90 days.'),
});

/** One tap on a queue row. Sensible defaults, asks nothing, summary optional. */
export const contactedTodaySchema = z.object({
  person_id: uuid,
  channel: z.enum(TOUCH_CHANNEL_VALUES).default('call'),
  substantive: checkbox,
  summary: nullableText,
});

/**
 * Logging an outbound attempt against a watchlist entry.
 *
 * Direction is fixed outbound and channel excludes 'meeting', because both
 * would promote the record. This is the Colorado Springs case: the attempt goes
 * on the record and nothing else changes.
 */
export const logAttemptSchema = z.object({
  person_id: uuid,
  channel: z.enum(['linkedin', 'email', 'call', 'text', 'mail', 'social', 'other'] as const),
  occurred_at: nullableTimestamp,
  summary: nullableText,
});

// ---------------------------------------------------------------------------
// Organizations
// ---------------------------------------------------------------------------

export const createOrganizationSchema = z.object({
  name: requiredText('An organization name', 200),
  organization_type: nullableText,
  industry_category: nullableText,
  sub_industry: nullableText,
  city: nullableText,
  state: nullableText,
  country: nullableText,
  domain: nullableText,
  website: nullableUrl,
  linkedin_url: nullableLinkedIn,
  notes: nullableText,
});

export const updateOrganizationSchema = createOrganizationSchema.extend({ id: uuid });

// ---------------------------------------------------------------------------
// Notes, followups, favors, content
// ---------------------------------------------------------------------------

export const noteSchema = z.object({
  id: nullableUuid,
  person_id: uuid,
  category: z.enum(NOTE_CATEGORY_VALUES).default('professional'),
  body: requiredText('A note body', 5000),
  is_pinned: checkbox,
});

export const followupSchema = z.object({
  id: nullableUuid,
  person_id: uuid,
  title: requiredText('A title', 200),
  detail: nullableText,
  due_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a due date.'),
  status: z.enum(FOLLOWUP_STATUS_VALUES).default('open'),
});

export const favorSchema = z.object({
  person_id: uuid,
  direction: z.enum(FAVOR_DIRECTION_VALUES),
  kind: z.enum(FAVOR_KIND_VALUES).default('other'),
  occurred_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date.'),
  description: nullableText,
  value_note: nullableText,
});

export const contentTouchSchema = z.object({
  person_id: uuid,
  content_title: requiredText('A title', 300),
  content_ref: nullableText,
  sent_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date.'),
});

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

/**
 * Creating a source.
 *
 * An event kind requires the cost breakdown, the year and the date before save.
 * A non-event kind must carry no cost at all, and the form does not render the
 * cost fields for it.
 */
export const sourceSchema = z
  .object({
    id: nullableUuid,
    event_name: requiredText('An event name', 200),
    event_year: z
      .union([z.string(), z.number(), z.null(), z.undefined()])
      .transform((v) => (v === null || v === undefined || v === '' ? null : Number(v)))
      .pipe(z.number().int().min(1980).max(2100).nullable()),
    kind: requiredText('A kind', 100),
    /** True when meta.family is 'event' for this kind; supplied by the form. */
    is_event_kind: checkbox,
    occurred_on: nullableDate,
    ends_on: nullableDate,
    city: nullableText,
    state: nullableText,
    url: nullableUrl,
    attended: checkbox,
    cost_pass_cents: nullableCents,
    cost_travel_cents: nullableCents,
    cost_lodging_cents: nullableCents,
    cost_meals_cents: nullableCents,
    cost_other_cents: nullableCents,
    cost_note: nullableText,
    retro_note: nullableText,
  })
  .superRefine((input, ctx) => {
    const costs = [
      input.cost_pass_cents,
      input.cost_travel_cents,
      input.cost_lodging_cents,
      input.cost_meals_cents,
      input.cost_other_cents,
    ];
    const hasCost = costs.some((c) => c !== null);

    if (input.is_event_kind) {
      if (!hasCost) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['cost_pass_cents'],
          message: 'Enter what this cost before saving. Zero is a valid answer; blank is not.',
        });
      }
      if (input.event_year === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['event_year'],
          message: 'An event needs a year, so it can join a series.',
        });
      }
      if (input.occurred_on === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['occurred_on'],
          message: 'An event needs a date, or it can never be compared at a matched horizon.',
        });
      }
    } else if (hasCost) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['cost_pass_cents'],
        message: 'Only event kinds carry cost.',
      });
    }

    if (input.ends_on && input.occurred_on && input.ends_on < input.occurred_on) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ends_on'],
        message: 'The end date cannot precede the start date.',
      });
    }
  });

export type SourceInput = z.infer<typeof sourceSchema>;

// ---------------------------------------------------------------------------
// Bulk event logging
// ---------------------------------------------------------------------------

/**
 * Pick a source, check off everyone spoken to. Writes one touchpoint per person
 * with a shared group_key, and promotes any watchlist entries present — a
 * conversation at an event is a meeting.
 */
export const bulkEventLogSchema = z.object({
  source_id: uuid,
  occurred_at: nullableTimestamp,
  person_ids: z.array(uuid).min(1, 'Check off at least one person.'),
  substantive: checkbox,
  set_met_at_for_new: checkbox,
  summary: nullableText,
});

// ---------------------------------------------------------------------------
// Deals
// ---------------------------------------------------------------------------

export const dealSchema = z.object({
  id: nullableUuid,
  name: requiredText('A deal name', 200),
  counterparty_organization_id: nullableUuid,
  source_person_id: nullableUuid,
  source_organization_id: nullableUuid,
  stage: z.enum(DEAL_STAGE_VALUES).default('referred'),
  amount_cents: nullableCents,
  referred_on: nullableDate,
  closed_on: nullableDate,
  commission_terms: nullableText,
  commission_earned_cents: nullableCents,
  commission_paid_cents: nullableCents,
  note: nullableText,
});

// ---------------------------------------------------------------------------
// Quick capture
// ---------------------------------------------------------------------------

export const quickCaptureSchema = z.object({
  text: requiredText('Something to capture', 4000),
  personId: nullableUuid,
  capturedAt: nullableTimestamp,
});

export const contactStatusFilter = z.enum([...CONTACT_STATUS_VALUES, 'all'] as const);

// ---------------------------------------------------------------------------
// Form helpers
// ---------------------------------------------------------------------------

/** FormData to a plain object, collapsing repeated keys into arrays. */
export function formToObject(formData: FormData): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const key of new Set(formData.keys())) {
    const values = formData.getAll(key).map((v) => (v instanceof File ? v.name : v));
    // A key sent once is a scalar; sent more than once it is an array. Fields
    // that must always be arrays declare that in their schema via stringArray,
    // which accepts both shapes.
    result[key] = values.length > 1 ? values : values[0];
  }

  return result;
}

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

/** Turns a ZodError into something a form can render next to the offending field. */
export function toActionError(error: unknown): ActionResult<never> {
  if (error instanceof z.ZodError) {
    const flat = error.flatten();
    const first =
      Object.values(flat.fieldErrors).flat()[0] ?? flat.formErrors[0] ?? 'That input is not valid.';
    return {
      ok: false,
      error: first,
      fieldErrors: flat.fieldErrors as Record<string, string[]>,
    };
  }

  if (error instanceof Error) {
    return { ok: false, error: databaseErrorToMessage(error.message) };
  }

  return { ok: false, error: 'Something went wrong.' };
}

/**
 * Database constraint names are precise but unreadable. The constraint stays
 * the authority; this only decides what the operator sees when it fires.
 */
export function databaseErrorToMessage(raw: string): string {
  const map: Array<[RegExp, string]> = [
    [/people_uncontacted_requires_reason/, 'A watchlist entry needs a written reason.'],
    [
      /people_uncontacted_requires_identifier/,
      'A watchlist entry needs at least one identifier — LinkedIn, email, phone, or an organization.',
    ],
    [/people_uncontacted_has_no_met_at/, 'A watchlist entry cannot have a "met at" — you have not met them.'],
    [/people_active_requires_first_contact/, 'An active record needs a first-contact date.'],
    [/cannot be returned to the watchlist/, 'You cannot un-meet someone. An active record stays active.'],
    [/touchpoints are append-only/, 'Touchpoints cannot be edited. Log a correction instead.'],
    [/requires a cost breakdown/, 'Enter what this event cost before saving.'],
    [/requires event_year/, 'An event needs a year.'],
    [/requires occurred_on/, 'An event needs a date.'],
    [/must not carry cost/, 'Only event kinds carry cost.'],
    [/is not a known (\w+)/, 'That value is not in the list yet. Add it in Settings first.'],
    [/people_email_work_key|people_email_personal_key/, 'Someone already has that email address.'],
    [/people_linkedin_key/, 'Someone already has that LinkedIn profile.'],
    [/people_phone_mobile_key/, 'Someone already has that mobile number.'],
    [/organizations_name_key/, 'An organization with that name already exists.'],
    [/sources_name_year_key/, 'That event already exists for that year.'],
    [/duplicate key|unique constraint/, 'That already exists.'],
  ];

  for (const [pattern, message] of map) {
    if (pattern.test(raw)) return message;
  }

  return raw.replace(/^manifest:\s*/, '');
}

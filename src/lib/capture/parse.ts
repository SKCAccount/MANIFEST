import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
// zod/v4 rather than the classic namespace: the SDK's zodOutputFormat helper
// is typed against Zod 4's internals. Form validation in lib/validation.ts
// stays on the classic API; the two coexist in zod 3.25+.
import { z } from 'zod/v4';
import { TOUCH_CHANNEL_VALUES, TOUCH_DIRECTION_VALUES } from '../db/enums';
import type { CaptureDraft } from './shape';

/**
 * Quick capture: one free-text field, parsed into a proposed person,
 * organization, touchpoint and note. Target is under fifteen seconds from
 * thought to saved record.
 *
 * The model proposes; it never writes. Everything comes back as a draft the
 * operator confirms, because the alternative — a capture path that silently
 * creates records — is exactly how a curated rolodex turns into a junk drawer.
 *
 * Two hard rules encoded in the prompt below:
 *   - It may never propose contact_status. Promotion is the trigger's job.
 *   - It may never invent a fact. A blank field is correct; a plausible guess
 *     about someone's employer is not.
 */

const CAPTURE_SCHEMA = z.object({
  first_name: z.string().describe('Given name. Empty string if not stated.'),
  last_name: z.string().describe('Family name. Empty string if not stated.'),
  organization_name: z
    .string()
    .describe('Employer exactly as written. Empty string if not stated.'),
  position: z.string().describe('Job title as written. Empty string if not stated.'),
  city: z.string().describe('City only, no state. Empty string if not stated.'),

  channel: z
    .enum(TOUCH_CHANNEL_VALUES)
    .describe('How the interaction happened. Use "other" when genuinely unclear.'),
  direction: z
    .enum(TOUCH_DIRECTION_VALUES)
    .describe(
      'inbound = they contacted the operator. outbound = the operator contacted them. ' +
        'mutual = a two-way conversation, a meeting, or a call. Prefer mutual for anything conversational.',
    ),
  substantive: z
    .boolean()
    .describe(
      'True only for a real conversation with content worth remembering. ' +
        'A handshake, a card swap, or "said hello" is false.',
    ),
  summary: z
    .string()
    .describe('One sentence, past tense, in the operator\'s voice. Empty string if there is nothing to say.'),

  note: z
    .string()
    .describe(
      'A durable fact worth keeping separately from this conversation — a preference, ' +
        'a constraint, a warning. Empty string if the text contains none.',
    ),
  followup_title: z
    .string()
    .describe('A concrete next action, if one was stated. Empty string otherwise.'),
  followup_due_on: z
    .string()
    .describe('ISO date (YYYY-MM-DD) for the follow-up, if a date was stated. Empty string otherwise.'),

  specialties: z
    .array(z.string())
    .describe('Areas of expertise explicitly mentioned. Empty array if none.'),
  confidence: z
    .enum(['high', 'medium', 'low'])
    .describe('How confident you are that the person and interaction were read correctly.'),
});

// The schema and the shared CaptureDraft type must agree; this assignment
// fails to compile if they drift.
type SchemaShape = z.infer<typeof CAPTURE_SCHEMA>;
const _shapesAgree: (s: SchemaShape) => CaptureDraft = (s) => s;
void _shapesAgree;

const SYSTEM_PROMPT = `You extract structured records from a busy person's shorthand notes about
professional conversations. Your output is a *draft* that a human reviews before anything is saved.

Rules, in order of importance:

1. Never invent a fact. If the text does not state someone's employer, city, or title, return an
   empty string. A blank field is correct and expected. A plausible-sounding guess is a defect —
   this database is a record of real relationships and a wrong employer is worse than no employer.

2. Read direction carefully, because it has consequences. "She called me" and "he emailed asking
   about X" are inbound. "I reached out", "sent him a note", "messaged her on LinkedIn" are
   outbound. Anything conversational — a call, a meeting, coffee, a chat at a conference — is mutual.
   When the text describes a conversation without saying who started it, use mutual.

3. substantive means the conversation had content worth remembering later. A real discussion about
   a deal, a person's business, or a specific problem is substantive. "Met him at the booth",
   "swapped cards", "said hi" is not.

4. The summary is one sentence, past tense, written the way the operator would write it to himself.
   No preamble, no "The user met with". Just what happened.

5. A note is a durable fact that will still be true next year — a preference ("only free Tuesdays"),
   a constraint ("hates cold outreach"), a warning. It is not a summary of this conversation. Most
   captures have no note; return an empty string then.

Keep specialties to terms actually present in the text.`;

export type ParseResult =
  | { ok: true; draft: CaptureDraft }
  | { ok: false; error: string; reason: 'not_configured' | 'refused' | 'failed' };

/**
 * Parses one capture. Returns a structured failure rather than throwing, so
 * the capture UI can always fall back to the manual form — a note the operator
 * just typed must never be lost because a model call failed.
 */
export async function parseCapture(text: string): Promise<ParseResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      ok: false,
      reason: 'not_configured',
      error: 'Quick capture parsing needs ANTHROPIC_API_KEY. Use the full form instead.',
    };
  }

  const client = new Anthropic({ apiKey });

  try {
    const response = await client.messages.parse({
      model: 'claude-opus-5',
      max_tokens: 2000,
      system: SYSTEM_PROMPT,
      // Low effort: this is a short, well-specified extraction, and capture
      // has a fifteen-second budget.
      output_config: {
        effort: 'low',
        format: zodOutputFormat(CAPTURE_SCHEMA),
      },
      messages: [{ role: 'user', content: text }],
    });

    if (response.stop_reason === 'refusal') {
      return { ok: false, reason: 'refused', error: 'That capture could not be parsed. Use the full form.' };
    }

    const draft = response.parsed_output;
    if (!draft) {
      return { ok: false, reason: 'failed', error: 'Could not read that. Use the full form.' };
    }

    return { ok: true, draft: normalize(draft) };
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) {
      return { ok: false, reason: 'failed', error: 'Rate limited. Try again in a moment.' };
    }
    if (error instanceof Anthropic.APIError) {
      return { ok: false, reason: 'failed', error: `Parsing failed (${error.status}).` };
    }
    return { ok: false, reason: 'failed', error: 'Parsing failed. Use the full form.' };
  }
}

/**
 * Post-conditions the model is asked for but cannot be trusted to guarantee.
 * Cheap to enforce here, and each one prevents a bad record.
 */
function normalize(draft: CaptureDraft): CaptureDraft {
  const trimmed: CaptureDraft = {
    ...draft,
    first_name: draft.first_name.trim(),
    last_name: draft.last_name.trim(),
    organization_name: draft.organization_name.trim(),
    position: draft.position.trim(),
    city: draft.city.trim(),
    summary: draft.summary.trim(),
    note: draft.note.trim(),
    followup_title: draft.followup_title.trim(),
    followup_due_on: /^\d{4}-\d{2}-\d{2}$/.test(draft.followup_due_on) ? draft.followup_due_on : '',
    specialties: draft.specialties.map((s) => s.trim()).filter(Boolean),
  };

  // A meeting is two-way by definition, so an outbound meeting is a
  // contradiction — and one that would wrongly promote a watchlist entry.
  if (trimmed.channel === 'meeting' && trimmed.direction === 'outbound') {
    trimmed.direction = 'mutual';
  }

  // Nothing to say means nothing was substantive.
  if (trimmed.summary === '') {
    trimmed.substantive = false;
  }

  return trimmed;
}


'use server';

import { revalidatePath } from 'next/cache';
import { requireOperatorForAction, supabase } from '../auth';
import {
  bulkEventLogSchema,
  contactedTodaySchema,
  formToObject,
  logAttemptSchema,
  toActionError,
  touchpointSchema,
  type ActionResult,
} from '../validation';

function refresh(personId?: string) {
  revalidatePath('/');
  revalidatePath('/watchlist');
  revalidatePath('/geography');
  if (personId) revalidatePath(`/person/${personId}`);
}

/** The general form. Append-only: there is no updateTouchpoint counterpart. */
export async function logTouchpoint(formData: FormData): Promise<ActionResult> {
  try {
    await requireOperatorForAction();
    const input = touchpointSchema.parse(formToObject(formData));

    const db = await supabase();
    const { error } = await db.from('touchpoints').insert({
      person_id: input.person_id,
      occurred_at: input.occurred_at ?? new Date().toISOString(),
      channel: input.channel,
      direction: input.direction,
      substantive: input.substantive,
      subject: input.subject,
      summary: input.summary,
      outcome: input.outcome,
      source: input.source,
      source_id: input.source_id,
      group_key: input.group_key,
    });

    if (error) throw new Error(error.message);

    refresh(input.person_id);
    return { ok: true, data: undefined };
  } catch (error) {
    return toActionError(error);
  }
}

/**
 * One tap on a queue row.
 *
 * Defaults to a mutual call marked substantive, because that is what the
 * operator has almost always just done when they reach for this button — and
 * only a substantive touchpoint resets the cadence clock, which is the entire
 * point of pressing it. The summary is offered inline and never demanded.
 */
export async function contactedToday(formData: FormData): Promise<ActionResult> {
  try {
    await requireOperatorForAction();
    const input = contactedTodaySchema.parse(formToObject(formData));

    const db = await supabase();
    const { error } = await db.from('touchpoints').insert({
      person_id: input.person_id,
      occurred_at: new Date().toISOString(),
      channel: input.channel,
      direction: 'mutual',
      substantive: input.substantive,
      summary: input.summary,
      source: 'manual',
    });

    if (error) throw new Error(error.message);

    refresh(input.person_id);
    return { ok: true, data: undefined };
  } catch (error) {
    return toActionError(error);
  }
}

/**
 * Logs an outbound attempt against a watchlist entry without promoting it.
 *
 * The schema fixes direction to outbound and excludes 'meeting' from the
 * channels, so this cannot accidentally promote. That matters: an unanswered
 * LinkedIn message is evidence the operator tried, not evidence of a
 * relationship, and it must stay retrievable as context for the next attempt.
 */
export async function logAttempt(formData: FormData): Promise<ActionResult> {
  try {
    await requireOperatorForAction();
    const input = logAttemptSchema.parse(formToObject(formData));

    const db = await supabase();
    const { error } = await db.from('touchpoints').insert({
      person_id: input.person_id,
      occurred_at: input.occurred_at ?? new Date().toISOString(),
      channel: input.channel,
      direction: 'outbound',
      substantive: false,
      summary: input.summary,
      source: 'manual',
    });

    if (error) throw new Error(error.message);

    refresh(input.person_id);
    return { ok: true, data: undefined };
  } catch (error) {
    return toActionError(error);
  }
}

/**
 * Bulk event logging. One touchpoint per person sharing a group_key, written
 * atomically by fn_log_bulk_event.
 *
 * Returns which records were promoted, so the confirmation can say so — moving
 * three people off the watchlist in one pass is the most satisfying thing this
 * screen does and it should not happen silently.
 */
export async function logBulkEvent(
  formData: FormData,
): Promise<ActionResult<{ logged: number; promoted: number; metAtSet: number }>> {
  try {
    await requireOperatorForAction();

    const raw = formToObject(formData);
    const personIds = formData.getAll('person_ids').map(String).filter(Boolean);
    const input = bulkEventLogSchema.parse({ ...raw, person_ids: personIds });

    const db = await supabase();
    const { data, error } = await db.rpc('fn_log_bulk_event', {
      p_source_id: input.source_id,
      p_person_ids: input.person_ids,
      p_occurred_at: input.occurred_at ?? new Date().toISOString(),
      p_substantive: input.substantive,
      p_summary: input.summary,
      p_set_met_at: input.set_met_at_for_new,
    });

    if (error) throw new Error(error.message);

    const rows = (data ?? []) as unknown as Array<{ promoted: boolean; met_at_set: boolean }>;

    revalidatePath('/');
    revalidatePath('/watchlist');
    revalidatePath('/geography');
    revalidatePath('/sources');

    return {
      ok: true,
      data: {
        logged: rows.length,
        promoted: rows.filter((r) => r.promoted).length,
        metAtSet: rows.filter((r) => r.met_at_set).length,
      },
    };
  } catch (error) {
    return toActionError(error);
  }
}

/**
 * Corrections insert a superseding row rather than editing history.
 * v_contact_touchpoints hides the superseded one from every derived surface.
 */
export async function supersedeTouchpoint(formData: FormData): Promise<ActionResult> {
  try {
    await requireOperatorForAction();

    const raw = formToObject(formData);
    const input = touchpointSchema.parse(raw);
    const supersedesId = String(raw.supersedes_id ?? '');

    if (!supersedesId) throw new Error('Nothing to correct.');

    const db = await supabase();
    const { error } = await db.from('touchpoints').insert({
      person_id: input.person_id,
      occurred_at: input.occurred_at ?? new Date().toISOString(),
      channel: input.channel,
      direction: input.direction,
      substantive: input.substantive,
      subject: input.subject,
      summary: input.summary,
      outcome: input.outcome,
      source: 'manual',
      supersedes_id: supersedesId,
    });

    if (error) throw new Error(error.message);

    refresh(input.person_id);
    return { ok: true, data: undefined };
  } catch (error) {
    return toActionError(error);
  }
}

'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireOperatorForAction, supabase } from '../auth';
import { parseCapture } from '../capture/parse';
import { emptyDraft, type CaptureDraft } from '../capture/shape';
import { TOUCH_CHANNEL_VALUES, TOUCH_DIRECTION_VALUES } from '../db/enums';
import { normalizePhone } from '../phone';
import {
  formToObject,
  quickCaptureSchema,
  toActionError,
  type ActionResult,
} from '../validation';

const touchChannelSchema = z.enum(TOUCH_CHANNEL_VALUES);
const touchDirectionSchema = z.enum(TOUCH_DIRECTION_VALUES);

export type CaptureCandidate = {
  id: string;
  fullName: string;
  organizationName: string | null;
  contactStatus: 'active' | 'uncontacted';
  tier: string;
};

export type CaptureDraftResult = {
  draft: CaptureDraft;
  candidates: CaptureCandidate[];
  parseError: string | null;
};

/**
 * Step one of quick capture: parse the text and look for who it might be about.
 *
 * Nothing is written here. A capture that matches an existing person must
 * attach to that person rather than creating a second record for them — which
 * is why candidates come back with the draft and the operator picks.
 */
export async function draftCapture(text: string): Promise<ActionResult<CaptureDraftResult>> {
  try {
    await requireOperatorForAction();

    const trimmed = text.trim();
    if (trimmed === '') return { ok: false, error: 'Nothing to capture.' };

    const parsed = await parseCapture(trimmed);

    // A parse failure is not a capture failure. Hand back an empty draft with
    // the raw text as the summary so the operator can correct it by hand
    // rather than retyping.
    const draft: CaptureDraft = parsed.ok
      ? parsed.draft
      : emptyDraft(trimmed);

    const candidates = await findCandidates(draft);

    return {
      ok: true,
      data: { draft, candidates, parseError: parsed.ok ? null : parsed.error },
    };
  } catch (error) {
    return toActionError(error);
  }
}

async function findCandidates(draft: CaptureDraft): Promise<CaptureCandidate[]> {
  const name = [draft.first_name, draft.last_name].filter(Boolean).join(' ').trim();
  if (name === '') return [];

  const db = await supabase();

  // Search on the surname when there is one — "Marcus" matches too much, and a
  // first name alone is the case most likely to attach a note to the wrong
  // person.
  const term = draft.last_name.trim() || draft.first_name.trim();

  const { data } = await db
    .from('people')
    .select('id, full_name, contact_status, tier, organization:organizations(name)')
    .ilike('full_name', `%${term}%`)
    .limit(6);

  return (data ?? []).map((row) => ({
    id: row.id,
    fullName: row.full_name,
    organizationName:
      (row.organization as unknown as { name: string } | null)?.name ?? null,
    contactStatus: row.contact_status,
    tier: row.tier,
  }));
}

/**
 * Step two: write it.
 *
 * Either attaches to an existing person or creates a new active one via
 * fn_create_active_person, which refuses a touchpoint that would not establish
 * two-way contact. There is deliberately no path here that creates an
 * uncontacted record — the watchlist has its own entry point, and quick
 * capture is for conversations that already happened.
 */
export async function commitCapture(
  formData: FormData,
): Promise<ActionResult<{ personId: string; created: boolean }>> {
  try {
    await requireOperatorForAction();
    const raw = formToObject(formData);

    const existingPersonId = String(raw.person_id ?? '').trim();
    const firstName = String(raw.first_name ?? '').trim();
    const lastName = String(raw.last_name ?? '').trim();
    const organizationName = String(raw.organization_name ?? '').trim();
    const position = String(raw.position ?? '').trim() || null;
    const city = String(raw.city ?? '').trim() || null;
    const channel = touchChannelSchema.parse(raw.channel ?? 'other');
    const direction = touchDirectionSchema.parse(raw.direction ?? 'mutual');
    const substantive = raw.substantive === 'on' || raw.substantive === 'true';
    const summary = String(raw.summary ?? '').trim() || null;
    const note = String(raw.note ?? '').trim();
    const followupTitle = String(raw.followup_title ?? '').trim();
    const followupDueOn = String(raw.followup_due_on ?? '').trim();
    const phone = String(raw.phone_mobile ?? '').trim();
    const email = String(raw.email_work ?? '').trim();

    const db = await supabase();

    let organizationId: string | null = null;
    if (organizationName) {
      const { data: existingOrg } = await db
        .from('organizations')
        .select('id')
        .ilike('name', organizationName)
        .maybeSingle();

      if (existingOrg) organizationId = existingOrg.id;
      else {
        const { data: created, error } = await db
          .from('organizations')
          .insert({ name: organizationName })
          .select('id')
          .single();
        if (error) throw new Error(error.message);
        organizationId = created.id;
      }
    }

    let personId = existingPersonId;
    let created = false;

    if (personId) {
      // Existing person: append the touchpoint. If they were on the watchlist
      // and this is two-way contact, trg_first_contact promotes them.
      const { error } = await db.from('touchpoints').insert({
        person_id: personId,
        occurred_at: new Date().toISOString(),
        channel,
        direction,
        substantive,
        summary,
        source: 'manual',
      });
      if (error) throw new Error(error.message);
    } else {
      if (!firstName) throw new Error('A first name is required to create a new record.');

      const { data, error } = await db.rpc('fn_create_active_person', {
        p_person: {
          first_name: firstName,
          last_name: lastName || null,
          position,
          organization_id: organizationId,
          city,
          tier: 'C',
          email_work: email || null,
          phone_mobile: normalizePhone(phone) || null,
        },
        p_touchpoint: { channel, direction, substantive, summary },
      });

      if (error) throw new Error(error.message);
      personId = data as string;
      created = true;
    }

    if (note) {
      const { error } = await db
        .from('notes')
        .insert({ person_id: personId, category: 'professional', body: note });
      if (error) throw new Error(error.message);
    }

    if (followupTitle) {
      const dueOn =
        /^\d{4}-\d{2}-\d{2}$/.test(followupDueOn)
          ? followupDueOn
          : new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);

      const { error } = await db
        .from('followups')
        .insert({ person_id: personId, title: followupTitle, due_on: dueOn, status: 'open' });
      if (error) throw new Error(error.message);
    }

    revalidatePath('/');
    revalidatePath('/directory');
    revalidatePath('/rolodex');
    revalidatePath(`/person/${personId}`);

    return { ok: true, data: { personId, created } };
  } catch (error) {
    return toActionError(error);
  }
}

/**
 * Offline replay lands here rather than creating records directly.
 *
 * A capture written in a conference hall with no signal is replayed hours
 * later, when the operator is not looking at it. Creating a person from that
 * without review is exactly the bulk-entry failure the watchlist constraints
 * exist to prevent, so it becomes a pending staging record instead.
 */
export async function queueOfflineCapture(input: {
  text: string;
  personId: string | null;
  capturedAt: string | null;
}): Promise<ActionResult<{ staged: true }>> {
  try {
    await requireOperatorForAction();
    const parsed = quickCaptureSchema.parse(input);

    const draft = await parseCapture(parsed.text);

    const db = await supabase();
    const { error } = await db.from('staging_records').insert({
      kind: 'person_suggestion',
      status: 'pending',
      source: 'manual',
      confidence: draft.ok ? (draft.draft.confidence === 'high' ? 0.9 : draft.draft.confidence === 'medium' ? 0.6 : 0.3) : null,
      matched_person_id: parsed.personId,
      payload: {
        text: parsed.text,
        capturedAt: parsed.capturedAt,
        draft: draft.ok ? draft.draft : null,
        parseError: draft.ok ? null : draft.error,
      },
      note: 'Captured offline; replayed on reconnect.',
    });

    if (error) throw new Error(error.message);

    revalidatePath('/');
    return { ok: true, data: { staged: true } };
  } catch (error) {
    return toActionError(error);
  }
}

export async function pendingCaptureCount(): Promise<number> {
  const db = await supabase();
  const { count } = await db
    .from('staging_records')
    .select('id', { count: 'exact', head: true })
    .eq('kind', 'person_suggestion')
    .eq('status', 'pending');
  return count ?? 0;
}

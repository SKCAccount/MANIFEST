'use server';

import { revalidatePath } from 'next/cache';
import { requireOperatorForAction, supabase } from '../auth';
import {
  contentTouchSchema,
  createOrganizationSchema,
  dealSchema,
  favorSchema,
  followupSchema,
  formToObject,
  noteSchema,
  sourceSchema,
  toActionError,
  updateOrganizationSchema,
  type ActionResult,
} from '../validation';

// ---------------------------------------------------------------------------
// Organizations
// ---------------------------------------------------------------------------

export async function createOrganization(formData: FormData): Promise<ActionResult<{ id: string }>> {
  try {
    await requireOperatorForAction();
    const input = createOrganizationSchema.parse(formToObject(formData));

    const db = await supabase();
    const { data, error } = await db.from('organizations').insert(input).select('id').single();
    if (error) throw new Error(error.message);

    revalidatePath('/rolodex');
    return { ok: true, data: { id: data.id } };
  } catch (error) {
    return toActionError(error);
  }
}

export async function updateOrganization(formData: FormData): Promise<ActionResult> {
  try {
    await requireOperatorForAction();
    const { id, ...fields } = updateOrganizationSchema.parse(formToObject(formData));

    const db = await supabase();
    const { error } = await db.from('organizations').update(fields).eq('id', id);
    if (error) throw new Error(error.message);

    revalidatePath('/rolodex');
    revalidatePath(`/organization/${id}`);
    return { ok: true, data: undefined };
  } catch (error) {
    return toActionError(error);
  }
}

// ---------------------------------------------------------------------------
// Notes — durable facts, editable, permitted on uncontacted records
// ---------------------------------------------------------------------------

export async function saveNote(formData: FormData): Promise<ActionResult> {
  try {
    await requireOperatorForAction();
    const input = noteSchema.parse(formToObject(formData));

    const db = await supabase();
    const payload = {
      person_id: input.person_id,
      category: input.category,
      body: input.body,
      is_pinned: input.is_pinned,
    };

    const { error } = input.id
      ? await db.from('notes').update(payload).eq('id', input.id)
      : await db.from('notes').insert(payload);

    if (error) throw new Error(error.message);

    revalidatePath(`/person/${input.person_id}`);
    return { ok: true, data: undefined };
  } catch (error) {
    return toActionError(error);
  }
}

export async function deleteNote(formData: FormData): Promise<ActionResult> {
  try {
    await requireOperatorForAction();
    const id = String(formData.get('id') ?? '');
    const personId = String(formData.get('person_id') ?? '');

    const db = await supabase();
    const { error } = await db.from('notes').delete().eq('id', id);
    if (error) throw new Error(error.message);

    revalidatePath(`/person/${personId}`);
    return { ok: true, data: undefined };
  } catch (error) {
    return toActionError(error);
  }
}

// ---------------------------------------------------------------------------
// Followups — permitted on uncontacted records, which is how a trip gets worked
// ---------------------------------------------------------------------------

export async function saveFollowup(formData: FormData): Promise<ActionResult> {
  try {
    await requireOperatorForAction();
    const input = followupSchema.parse(formToObject(formData));

    const db = await supabase();
    const payload = {
      person_id: input.person_id,
      title: input.title,
      detail: input.detail,
      due_on: input.due_on,
      status: input.status,
      // The database refuses a done followup with no completion timestamp.
      completed_at: input.status === 'done' ? new Date().toISOString() : null,
    };

    const { error } = input.id
      ? await db.from('followups').update(payload).eq('id', input.id)
      : await db.from('followups').insert(payload);

    if (error) throw new Error(error.message);

    revalidatePath('/');
    revalidatePath('/geography');
    revalidatePath(`/person/${input.person_id}`);
    return { ok: true, data: undefined };
  } catch (error) {
    return toActionError(error);
  }
}

export async function completeFollowup(formData: FormData): Promise<ActionResult> {
  try {
    await requireOperatorForAction();
    const id = String(formData.get('id') ?? '');
    const personId = String(formData.get('person_id') ?? '');

    const db = await supabase();
    const { error } = await db
      .from('followups')
      .update({ status: 'done', completed_at: new Date().toISOString() })
      .eq('id', id);

    if (error) throw new Error(error.message);

    revalidatePath('/');
    revalidatePath(`/person/${personId}`);
    return { ok: true, data: undefined };
  } catch (error) {
    return toActionError(error);
  }
}

// ---------------------------------------------------------------------------
// Favors and content
// ---------------------------------------------------------------------------

/** Direction is from the operator's point of view: 'received' means they did him one. */
export async function logFavor(formData: FormData): Promise<ActionResult> {
  try {
    await requireOperatorForAction();
    const input = favorSchema.parse(formToObject(formData));

    const db = await supabase();
    const { error } = await db.from('favors').insert(input);
    if (error) throw new Error(error.message);

    revalidatePath('/');
    revalidatePath(`/person/${input.person_id}`);
    return { ok: true, data: undefined };
  } catch (error) {
    return toActionError(error);
  }
}

export async function logContentTouch(formData: FormData): Promise<ActionResult> {
  try {
    await requireOperatorForAction();
    const input = contentTouchSchema.parse(formToObject(formData));

    const db = await supabase();
    const { error } = await db.from('content_touches').insert(input);
    if (error) throw new Error(error.message);

    revalidatePath('/');
    revalidatePath(`/person/${input.person_id}`);
    return { ok: true, data: undefined };
  } catch (error) {
    return toActionError(error);
  }
}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

/**
 * Cost is stored once, here. Editing it moves every derived metric at once
 * because there is only one copy — no backfill, no denormalized cost on person
 * records.
 */
export async function saveSource(formData: FormData): Promise<ActionResult<{ id: string }>> {
  try {
    await requireOperatorForAction();
    const input = sourceSchema.parse(formToObject(formData));

    const db = await supabase();
    const payload = {
      event_name: input.event_name,
      event_year: input.event_year,
      kind: input.kind,
      occurred_on: input.occurred_on,
      ends_on: input.ends_on,
      city: input.city,
      state: input.state,
      url: input.url,
      attended: input.attended,
      // Non-event kinds must carry no cost at all, not zeroes.
      cost_pass_cents: input.is_event_kind ? input.cost_pass_cents : null,
      cost_travel_cents: input.is_event_kind ? input.cost_travel_cents : null,
      cost_lodging_cents: input.is_event_kind ? input.cost_lodging_cents : null,
      cost_meals_cents: input.is_event_kind ? input.cost_meals_cents : null,
      cost_other_cents: input.is_event_kind ? input.cost_other_cents : null,
      cost_note: input.cost_note,
      retro_note: input.retro_note,
    };

    const { data, error } = input.id
      ? await db.from('sources').update(payload).eq('id', input.id).select('id').single()
      : await db.from('sources').insert(payload).select('id').single();

    if (error) throw new Error(error.message);

    revalidatePath('/sources');
    revalidatePath(`/sources/${data.id}`);
    return { ok: true, data: { id: data.id } };
  } catch (error) {
    return toActionError(error);
  }
}

// ---------------------------------------------------------------------------
// Deals
// ---------------------------------------------------------------------------

export async function saveDeal(formData: FormData): Promise<ActionResult<{ id: string }>> {
  try {
    await requireOperatorForAction();
    const input = dealSchema.parse(formToObject(formData));

    const db = await supabase();
    const { id, ...payload } = input;

    const { data, error } = id
      ? await db.from('deals').update(payload).eq('id', id).select('id').single()
      : await db.from('deals').insert(payload).select('id').single();

    if (error) throw new Error(error.message);

    revalidatePath('/');
    if (input.source_person_id) revalidatePath(`/person/${input.source_person_id}`);
    return { ok: true, data: { id: data.id } };
  } catch (error) {
    return toActionError(error);
  }
}

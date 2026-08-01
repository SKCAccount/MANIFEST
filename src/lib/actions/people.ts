'use server';

import { revalidatePath } from 'next/cache';
import { requireOperatorForAction, supabase } from '../auth';
import { normalizePhone } from '../phone';
import {
  changeTierSchema,
  createActivePersonSchema,
  createWatchlistEntrySchema,
  formToObject,
  snoozeSchema,
  toActionError,
  updatePersonSchema,
  type ActionResult,
} from '../validation';

/**
 * Resolves the organization combobox: an existing id passes through, a typed
 * name creates the row inline. Organizations are a lookup, never a chore — the
 * operator never leaves the person form to create one.
 */
async function resolveOrganizationId(
  db: Awaited<ReturnType<typeof supabase>>,
  organizationId: string | null,
  newName: string | null,
): Promise<string | null> {
  if (organizationId) return organizationId;
  if (!newName) return null;

  // citext unique, so this collides case-insensitively as intended.
  const { data: existing } = await db
    .from('organizations')
    .select('id')
    .ilike('name', newName)
    .maybeSingle();

  if (existing) return existing.id;

  const { data, error } = await db
    .from('organizations')
    .insert({ name: newName })
    .select('id')
    .single();

  if (error) throw new Error(error.message);
  return data.id;
}

function refreshRelationshipSurfaces(personId?: string) {
  revalidatePath('/');
  revalidatePath('/directory');
  revalidatePath('/watchlist');
  revalidatePath('/geography');
  revalidatePath('/rolodex');
  if (personId) revalidatePath(`/person/${personId}`);
}

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

/**
 * Creates an active person and the touchpoint that establishes the
 * relationship, atomically. The database function rejects anything that would
 * not promote a watchlist entry, so this cannot produce an "active" record for
 * someone the operator has only emailed into the void.
 */
export async function createActivePerson(formData: FormData): Promise<ActionResult<{ id: string }>> {
  try {
    await requireOperatorForAction();
    const raw = formToObject(formData);

    const input = createActivePersonSchema.parse({
      ...raw,
      first_touchpoint: {
        channel: raw.tp_channel,
        direction: raw.tp_direction,
        occurred_at: raw.tp_occurred_at,
        substantive: raw.tp_substantive,
        summary: raw.tp_summary,
      },
    });

    const db = await supabase();
    const organizationId = await resolveOrganizationId(
      db,
      input.organization_id,
      input.new_organization_name,
    );

    const { data, error } = await db.rpc('fn_create_active_person', {
      p_person: {
        first_name: input.first_name,
        last_name: input.last_name,
        preferred_name: input.preferred_name,
        name_pronunciation: input.name_pronunciation,
        position: input.position,
        organization_id: organizationId,
        professional_function: input.professional_function,
        specialties: input.specialties,
        relationship_to_me: input.relationship_to_me,
        city: input.city,
        state: input.state,
        country: input.country,
        met_at_source_id: input.met_at_source_id,
        met_on: input.met_on,
        introduced_by_person_id: input.introduced_by_person_id,
        introduced_by_external: input.introduced_by_external,
        tier: input.tier,
        cadence_days_override: input.cadence_days_override,
        email_work: input.email_work,
        email_personal: input.email_personal,
        phone_mobile: normalizePhone(input.phone_mobile),
        phone_office: normalizePhone(input.phone_office),
        linkedin_url: input.linkedin_url,
        other_url: input.other_url,
        do_not_contact: input.do_not_contact,
        summary: input.summary,
        tags: input.tags,
      },
      p_touchpoint: {
        channel: input.first_touchpoint.channel,
        direction: input.first_touchpoint.direction,
        occurred_at: input.first_touchpoint.occurred_at,
        substantive: input.first_touchpoint.substantive,
        summary: input.first_touchpoint.summary,
        source_id: input.met_at_source_id,
      },
    });

    if (error) throw new Error(error.message);

    refreshRelationshipSurfaces(data as string);
    return { ok: true, data: { id: data as string } };
  } catch (error) {
    return toActionError(error);
  }
}

/**
 * Adds a watchlist entry. A distinct path from person creation, deliberately:
 * one person at a time, no multi-add, no paste-a-list, and a written reason
 * that cannot be skipped.
 */
export async function createWatchlistEntry(formData: FormData): Promise<ActionResult<{ id: string }>> {
  try {
    await requireOperatorForAction();
    const input = createWatchlistEntrySchema.parse(formToObject(formData));

    const db = await supabase();
    const organizationId = await resolveOrganizationId(
      db,
      input.organization_id,
      input.new_organization_name,
    );

    const { data, error } = await db
      .from('people')
      .insert({
        first_name: input.first_name,
        last_name: input.last_name,
        preferred_name: input.preferred_name,
        position: input.position,
        organization_id: organizationId,
        professional_function: input.professional_function,
        specialties: input.specialties,
        city: input.city,
        state: input.state,
        country: input.country,
        contact_status: 'uncontacted',
        watchlist_reason: input.watchlist_reason,
        watchlist_source: input.watchlist_source,
        watchlist_priority: input.watchlist_priority ?? null,
        watchlist_added_on: input.watchlist_added_on ?? new Date().toISOString().slice(0, 10),
        introduced_by_person_id: input.introduced_by_person_id,
        introduced_by_external: input.introduced_by_external,
        email_work: input.email_work,
        email_personal: input.email_personal,
        phone_mobile: normalizePhone(input.phone_mobile),
        phone_office: normalizePhone(input.phone_office),
        linkedin_url: input.linkedin_url,
        other_url: input.other_url,
        summary: input.summary,
        tags: input.tags,
      })
      .select('id')
      .single();

    if (error) throw new Error(error.message);

    refreshRelationshipSurfaces(data.id);
    return { ok: true, data: { id: data.id } };
  } catch (error) {
    return toActionError(error);
  }
}

// ---------------------------------------------------------------------------
// Editing
// ---------------------------------------------------------------------------

export async function updatePerson(formData: FormData): Promise<ActionResult<{ id: string }>> {
  try {
    await requireOperatorForAction();
    const input = updatePersonSchema.parse(formToObject(formData));

    const db = await supabase();
    const organizationId = await resolveOrganizationId(
      db,
      input.organization_id,
      input.new_organization_name,
    );

    // contact_status is absent on purpose. Promotion is the trigger's job, and
    // the reverse is refused outright.
    const { error } = await db
      .from('people')
      .update({
        first_name: input.first_name,
        last_name: input.last_name,
        preferred_name: input.preferred_name,
        name_pronunciation: input.name_pronunciation,
        position: input.position,
        organization_id: organizationId,
        professional_function: input.professional_function,
        specialties: input.specialties,
        relationship_to_me: input.relationship_to_me,
        city: input.city,
        state: input.state,
        country: input.country,
        tier: input.tier,
        met_at_source_id: input.met_at_source_id,
        met_on: input.met_on,
        introduced_by_person_id: input.introduced_by_person_id,
        introduced_by_external: input.introduced_by_external,
        cadence_days_override: input.cadence_days_override,
        cadence_paused_until: input.cadence_paused_until,
        email_work: input.email_work,
        email_personal: input.email_personal,
        phone_mobile: normalizePhone(input.phone_mobile),
        phone_office: normalizePhone(input.phone_office),
        linkedin_url: input.linkedin_url,
        other_url: input.other_url,
        do_not_contact: input.do_not_contact,
        watchlist_reason: input.watchlist_reason,
        watchlist_source: input.watchlist_source,
        watchlist_priority: input.watchlist_priority ?? null,
        summary: input.summary,
        tags: input.tags,
      })
      .eq('id', input.id);

    if (error) throw new Error(error.message);

    refreshRelationshipSurfaces(input.id);
    return { ok: true, data: { id: input.id } };
  } catch (error) {
    return toActionError(error);
  }
}

/** Trigger-logged to tier_history; the operator never maintains that record. */
export async function changeTier(formData: FormData): Promise<ActionResult> {
  try {
    await requireOperatorForAction();
    const input = changeTierSchema.parse(formToObject(formData));

    const db = await supabase();
    const { error } = await db.from('people').update({ tier: input.tier }).eq('id', input.person_id);
    if (error) throw new Error(error.message);

    refreshRelationshipSurfaces(input.person_id);
    return { ok: true, data: undefined };
  } catch (error) {
    return toActionError(error);
  }
}

/**
 * Pauses the cadence clock. Distinct from tier D: a paused person stays in
 * Geography and the Directory, they just stop appearing in the queue — which is
 * what "not now, but not archived" needs to mean.
 */
export async function snoozePerson(formData: FormData): Promise<ActionResult> {
  try {
    await requireOperatorForAction();
    const input = snoozeSchema.parse(formToObject(formData));

    const until = new Date();
    until.setDate(until.getDate() + input.days);

    const db = await supabase();
    const { error } = await db
      .from('people')
      .update({ cadence_paused_until: until.toISOString() })
      .eq('id', input.person_id);

    if (error) throw new Error(error.message);

    refreshRelationshipSurfaces(input.person_id);
    return { ok: true, data: undefined };
  } catch (error) {
    return toActionError(error);
  }
}

export async function archivePerson(formData: FormData): Promise<ActionResult> {
  try {
    await requireOperatorForAction();
    const personId = String(formData.get('person_id') ?? '');

    const db = await supabase();
    // Tier D is the archive. archived_at additionally removes them from the
    // Directory, for someone who should no longer be vouched for at all.
    const { error } = await db
      .from('people')
      .update({ tier: 'D', archived_at: new Date().toISOString() })
      .eq('id', personId);

    if (error) throw new Error(error.message);

    refreshRelationshipSurfaces(personId);
    return { ok: true, data: undefined };
  } catch (error) {
    return toActionError(error);
  }
}

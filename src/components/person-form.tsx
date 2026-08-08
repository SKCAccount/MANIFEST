'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import {
  Checkbox,
  OrganizationCombobox,
  PersonCombobox,
  PhoneField,
  SelectField,
  SpecialtyPicker,
  TaxonomyPicker,
  TextArea,
  TextField,
  type SpecialtyOption,
} from './form-controls';
import { TIER_VALUES, WATCH_PRIORITY_VALUES } from '@/lib/db/enums';
import { US_STATES, normalizeCountryName, normalizeUsState } from '@/lib/geo-data';
import type { ActionResult } from '@/lib/validation';

export type TaxonomyOption = { value: string; label: string };

export type PersonFormLookups = {
  organizations: Array<{ id: string; name: string }>;
  people: Array<{ id: string; full_name: string }>;
  sources: Array<{ id: string; display_name: string }>;
  /** United States first, then alphabetical. Stored value is the display name. */
  countries: Array<{ name: string; iso: string; code: string }>;
  functions: TaxonomyOption[];
  specialties: SpecialtyOption[];
  relationships: TaxonomyOption[];
  watchlistSources: TaxonomyOption[];
};

export type PersonDefaults = {
  id?: string;
  first_name?: string | null;
  last_name?: string | null;
  preferred_name?: string | null;
  name_pronunciation?: string | null;
  position?: string | null;
  organization_id?: string | null;
  professional_function?: string[];
  specialties?: string[];
  relationship_to_me?: string[];
  city?: string | null;
  state?: string | null;
  country?: string | null;
  tier?: string | null;
  met_at_source_id?: string | null;
  met_on?: string | null;
  introduced_by_person_id?: string | null;
  introduced_by_external?: string | null;
  email_work?: string | null;
  email_personal?: string | null;
  phone_mobile?: string | null;
  phone_office?: string | null;
  preferred_phone?: string | null;
  linkedin_url?: string | null;
  other_url?: string | null;
  do_not_contact?: boolean;
  summary?: string | null;
  cadence_days_override?: number | null;
  watchlist_reason?: string | null;
  watchlist_source?: string | null;
  watchlist_priority?: string | null;
};

type Props = {
  mode: 'create-active' | 'create-watchlist' | 'edit';
  lookups: PersonFormLookups;
  defaults?: PersonDefaults;
  action: (formData: FormData) => Promise<ActionResult<{ id: string }> | ActionResult<void>>;
};

export function PersonForm({ mode, lookups, defaults = {}, action }: Props) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [pending, startTransition] = useTransition();

  const isWatchlist = mode === 'create-watchlist';
  const isEdit = mode === 'edit';

  // The Country selection drives two things: whether State is a dropdown of US
  // states, and whether the phone fields show a country-code picker.
  const [country, setCountry] = useState(
    () => normalizeCountryName(defaults.country) ?? 'United States',
  );
  const [hasMobile, setHasMobile] = useState(Boolean(defaults.phone_mobile));
  const [hasOffice, setHasOffice] = useState(Boolean(defaults.phone_office));

  // The product-coverage list is led by what they do for a living.
  const [selectedFunctions, setSelectedFunctions] = useState<string[]>(
    defaults.professional_function ?? [],
  );

  function submit(formData: FormData) {
    setError(null);
    setFieldErrors({});
    startTransition(async () => {
      const result = await action(formData);
      if (!result.ok) {
        setError(result.error);
        setFieldErrors(result.fieldErrors ?? {});
        return;
      }
      const id = 'data' in result && result.data && 'id' in result.data ? result.data.id : defaults.id;
      router.push(id ? `/person/${id}` : '/rolodex');
      router.refresh();
    });
  }

  return (
    <form action={submit} className="space-y-6">
      {defaults.id ? <input type="hidden" name="id" value={defaults.id} /> : null}

      {error ? (
        <div className="rounded-md border border-overdue px-3 py-2 text-sm text-overdue" role="alert">
          {error}
        </div>
      ) : null}

      {/* ------------------------------------------------------------------ */}
      <Section title="Who">
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField name="first_name" label="First name" required defaultValue={defaults.first_name} error={fieldErrors.first_name} />
          <TextField name="last_name" label="Last name" defaultValue={defaults.last_name} />
          <TextField name="preferred_name" label="Goes by" defaultValue={defaults.preferred_name} />
          <TextField
            name="name_pronunciation"
            label="Pronunciation"
            defaultValue={defaults.name_pronunciation}
            placeholder="deh-LEE-see-oh"
          />
          <TextField name="position" label="Position" defaultValue={defaults.position} />
          <OrganizationCombobox organizations={lookups.organizations} defaultId={defaults.organization_id} />
        </div>
      </Section>

      {/* ------------------------------------------------------------------ */}
      {isWatchlist ? (
        <Section
          title="Why"
          hint="Required. This is what makes the watchlist worth having — and what stops it becoming a lead list."
        >
          <TextArea
            name="watchlist_reason"
            label="Why they are worth meeting"
            required
            rows={3}
            defaultValue={defaults.watchlist_reason}
            placeholder="Built a $40M shelf-stable brand without outside capital. Wants to buy the co-packer he uses."
            error={fieldErrors.watchlist_reason}
          />
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <SelectField
              name="watchlist_source"
              label="How you heard about them"
              includeBlank="—"
              options={lookups.watchlistSources}
              defaultValue={defaults.watchlist_source}
            />
            <SelectField
              name="watchlist_priority"
              label="Priority"
              includeBlank="—"
              options={WATCH_PRIORITY_VALUES.map((v) => ({ value: v, label: v }))}
              defaultValue={defaults.watchlist_priority}
            />
          </div>
        </Section>
      ) : null}

      {/* ------------------------------------------------------------------ */}
      <Section
        title="Classification"
        hint="What they do, which industries and products they cover, and what they are to you are different questions."
      >
        <div className="space-y-4">
          <TaxonomyPicker
            name="professional_function"
            label="Professional function"
            hint="What they do for a living. Usually one."
            options={lookups.functions}
            selected={defaults.professional_function}
            onSelectionChange={setSelectedFunctions}
          />
          <SpecialtyPicker
            options={lookups.specialties}
            selected={defaults.specialties}
            selectedFunctions={selectedFunctions}
          />
          {!isWatchlist ? (
            <TaxonomyPicker
              name="relationship_to_me"
              label="Relationship to me"
              hint="Retained service provider means you write them cheques — not merely that they are an accountant."
              options={lookups.relationships}
              selected={defaults.relationship_to_me}
            />
          ) : null}
        </div>
      </Section>

      {/* ------------------------------------------------------------------ */}
      <Section title="Where">
        <div className="grid gap-3 sm:grid-cols-3">
          <TextField name="city" label="City" defaultValue={defaults.city} />
          {country === 'United States' ? (
            <SelectField
              name="state"
              label="State"
              includeBlank="—"
              options={US_STATES.map((s) => ({ value: s, label: s }))}
              defaultValue={normalizeUsState(defaults.state)}
            />
          ) : (
            <TextField name="state" label="State / region" defaultValue={defaults.state} />
          )}
          <div>
            <label className="label" htmlFor="person-country">
              Country
            </label>
            <select
              id="person-country"
              name="country"
              value={country}
              onChange={(event) => setCountry(event.target.value)}
              className="field"
            >
              {lookups.countries.map((c) => (
                <option key={c.iso} value={c.name}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </Section>

      {/* ------------------------------------------------------------------ */}
      <Section
        title="How to reach them"
        hint={isWatchlist ? 'At least one identifier is required. A name with no handle is a note, not a record.' : undefined}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField name="email_work" label="Work email" type="email" defaultValue={defaults.email_work} error={fieldErrors.email_work} />
          <TextField name="email_personal" label="Personal email" type="email" defaultValue={defaults.email_personal} />
          <PhoneField
            name="phone_mobile"
            label="Mobile"
            defaultValue={defaults.phone_mobile}
            countryName={country}
            countries={lookups.countries}
            onHasValue={setHasMobile}
            hint="Digits only — formatting is automatic."
          />
          <PhoneField
            name="phone_office"
            label="Office"
            defaultValue={defaults.phone_office}
            countryName={country}
            countries={lookups.countries}
            onHasValue={setHasOffice}
          />
          <TextField
            name="linkedin_url"
            label="LinkedIn"
            defaultValue={defaults.linkedin_url}
            placeholder="linkedin.com/in/…"
            error={fieldErrors.linkedin_url}
          />
          <TextField name="other_url" label="Other link" defaultValue={defaults.other_url} />
        </div>

        {hasMobile && hasOffice ? (
          <fieldset className="mt-3">
            <legend className="label">Preferred number</legend>
            <div className="flex gap-4 text-sm">
              <label className="flex items-center gap-1.5">
                <input
                  type="radio"
                  name="preferred_phone"
                  value="mobile"
                  defaultChecked={defaults.preferred_phone === 'mobile'}
                />
                <span>Mobile</span>
              </label>
              <label className="flex items-center gap-1.5">
                <input
                  type="radio"
                  name="preferred_phone"
                  value="office"
                  defaultChecked={defaults.preferred_phone === 'office'}
                />
                <span>Office</span>
              </label>
            </div>
            <p className="mt-0.5 text-xs text-ink-faint">Optional — which number to reach them on first.</p>
          </fieldset>
        ) : null}
      </Section>

      {/* ------------------------------------------------------------------ */}
      <Section title="Provenance">
        <div className="grid gap-3 sm:grid-cols-2">
          <PersonCombobox
            name="introduced_by_person_id"
            label="Referred by"
            people={lookups.people}
            defaultId={defaults.introduced_by_person_id}
            defaultExternal={defaults.introduced_by_external}
          />

          {!isWatchlist ? (
            <>
              <SelectField
                name="met_at_source_id"
                label="Met at"
                includeBlank="—"
                options={lookups.sources.map((s) => ({ value: s.id, label: s.display_name }))}
                defaultValue={defaults.met_at_source_id}
              />
              <TextField name="met_on" label="Met on" type="date" defaultValue={defaults.met_on} error={fieldErrors.met_on} />
            </>
          ) : (
            <p className="self-end text-xs text-ink-faint">
              No “met at” — you have not met them anywhere yet.
            </p>
          )}
        </div>
      </Section>

      {/* ------------------------------------------------------------------ */}
      {!isWatchlist ? (
        <Section title="Cadence">
          <div className="grid gap-3 sm:grid-cols-3">
            <SelectField
              name="tier"
              label="Tier"
              options={TIER_VALUES.map((t) => ({
                value: t,
                label: `${t} — ${t === 'A' ? '45 days' : t === 'B' ? '90 days' : t === 'C' ? '180 days' : 'archived'}`,
              }))}
              defaultValue={defaults.tier ?? 'C'}
            />
            <TextField
              name="cadence_days_override"
              label="Override (days)"
              type="number"
              defaultValue={defaults.cadence_days_override?.toString()}
              hint="Leave blank to use the tier default."
            />
            <div className="self-end pb-1">
              <Checkbox
                name="do_not_contact"
                label="Do not contact"
                defaultChecked={defaults.do_not_contact}
                hint="Removes them from the queue and every export."
              />
            </div>
          </div>
        </Section>
      ) : null}

      {/* ------------------------------------------------------------------ */}
      {mode === 'create-active' ? (
        <Section
          title="The conversation that establishes this"
          hint="An active record needs two-way contact. If you have only reached out, add them to the watchlist and log the attempt there instead."
        >
          <div className="grid gap-3 sm:grid-cols-3">
            <SelectField
              name="tp_channel"
              label="Channel"
              options={['call', 'meeting', 'email', 'text', 'linkedin', 'event', 'other'].map((v) => ({
                value: v,
                label: v,
              }))}
              defaultValue="meeting"
            />
            <SelectField
              name="tp_direction"
              label="Direction"
              options={[
                { value: 'mutual', label: 'mutual — a conversation' },
                { value: 'inbound', label: 'inbound — they contacted you' },
                { value: 'outbound', label: 'outbound — you contacted them' },
              ]}
              defaultValue="mutual"
            />
            <TextField name="tp_occurred_at" label="When" type="date" />
          </div>
          <div className="mt-3">
            <TextArea name="tp_summary" label="What happened" rows={2} />
          </div>
          <div className="mt-2">
            <Checkbox name="tp_substantive" label="Substantive" hint="Only substantive touchpoints reset the cadence clock." />
          </div>
          {fieldErrors['first_touchpoint.direction'] ? (
            <p className="mt-2 text-xs text-overdue" role="alert">
              {fieldErrors['first_touchpoint.direction'][0]}
            </p>
          ) : null}
        </Section>
      ) : null}

      <Section title="Anything else">
        <TextArea name="summary" label="Summary" rows={2} defaultValue={defaults.summary} />
      </Section>

      <div className="flex items-center gap-2 border-t border-line pt-4">
        <button type="submit" disabled={pending} className="btn-primary px-4 py-2">
          {pending ? 'Saving…' : isEdit ? 'Save changes' : isWatchlist ? 'Add to watchlist' : 'Create record'}
        </button>
        <button type="button" onClick={() => router.back()} className="btn px-4 py-2">
          Cancel
        </button>
      </div>
    </form>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="text-sm font-semibold">{title}</h2>
      {hint ? <p className="mt-0.5 mb-3 text-xs text-ink-faint">{hint}</p> : <div className="mb-3" />}
      {children}
    </section>
  );
}

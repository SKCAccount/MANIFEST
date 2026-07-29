'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { SelectField, TextArea, TextField } from './form-controls';
import { saveSource } from '@/lib/actions/records';

export type SourceKindOption = { value: string; label: string; isEvent: boolean };

export type SourceDefaults = {
  id?: string;
  event_name?: string;
  event_year?: number | null;
  kind?: string;
  occurred_on?: string | null;
  ends_on?: string | null;
  city?: string | null;
  state?: string | null;
  url?: string | null;
  cost_pass_cents?: number | null;
  cost_travel_cents?: number | null;
  cost_lodging_cents?: number | null;
  cost_meals_cents?: number | null;
  cost_other_cents?: number | null;
  cost_note?: string | null;
  retro_note?: string | null;
};

const toDollars = (cents: number | null | undefined) =>
  cents === null || cents === undefined ? '' : (cents / 100).toFixed(2).replace(/\.00$/, '');

/**
 * Source form.
 *
 * The cost breakdown appears only for event kinds, and is required before save
 * for them. That is not a nicety: cost is stored exactly once, here, and every
 * event metric divides by it. A source saved without cost is an event that can
 * never be judged.
 */
export function SourceForm({
  kinds,
  defaults = {},
}: {
  kinds: SourceKindOption[];
  defaults?: SourceDefaults;
}) {
  const router = useRouter();
  const [kind, setKind] = useState(defaults.kind ?? kinds[0]?.value ?? '');
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [pending, startTransition] = useTransition();

  const isEventKind = kinds.find((k) => k.value === kind)?.isEvent ?? false;

  function submit(formData: FormData) {
    setError(null);
    setFieldErrors({});
    formData.set('is_event_kind', isEventKind ? 'on' : '');
    startTransition(async () => {
      const result = await saveSource(formData);
      if (!result.ok) {
        setError(result.error);
        setFieldErrors(result.fieldErrors ?? {});
        return;
      }
      router.push(`/sources/${result.data.id}`);
      router.refresh();
    });
  }

  return (
    <form action={submit} className="space-y-5">
      {defaults.id ? <input type="hidden" name="id" value={defaults.id} /> : null}

      {error ? (
        <div className="rounded-md border border-overdue px-3 py-2 text-sm text-overdue" role="alert">
          {error}
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <TextField
            name="event_name"
            label="Name"
            required
            defaultValue={defaults.event_name}
            placeholder="Broker Fest"
            hint="Without the year — the year is a separate field, which is what makes the series work."
            error={fieldErrors.event_name}
          />
        </div>
        <TextField
          name="event_year"
          label="Year"
          type="number"
          defaultValue={defaults.event_year?.toString()}
          error={fieldErrors.event_year}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className="label" htmlFor="source-kind">
            Kind
          </label>
          <select
            id="source-kind"
            name="kind"
            value={kind}
            onChange={(event) => setKind(event.target.value)}
            className="field"
          >
            {kinds.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <TextField name="occurred_on" label="Date" type="date" defaultValue={defaults.occurred_on} error={fieldErrors.occurred_on} />
        <TextField name="ends_on" label="Ends" type="date" defaultValue={defaults.ends_on} error={fieldErrors.ends_on} />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <TextField name="city" label="City" defaultValue={defaults.city} />
        <TextField name="state" label="State" defaultValue={defaults.state} />
        <TextField name="url" label="URL" defaultValue={defaults.url} />
      </div>

      {isEventKind ? (
        <fieldset className="card p-4">
          <legend className="px-1 text-sm font-semibold">What it cost</legend>
          <p className="mb-3 text-xs text-ink-faint">
            Required before save. Zero is a valid answer; blank is not. Editing this later moves
            every derived metric at once, because there is only one copy.
          </p>

          <div className="grid gap-3 sm:grid-cols-5">
            <TextField name="cost_pass_cents" label="Pass" defaultValue={toDollars(defaults.cost_pass_cents)} placeholder="0" error={fieldErrors.cost_pass_cents} />
            <TextField name="cost_travel_cents" label="Travel" defaultValue={toDollars(defaults.cost_travel_cents)} placeholder="0" />
            <TextField name="cost_lodging_cents" label="Lodging" defaultValue={toDollars(defaults.cost_lodging_cents)} placeholder="0" />
            <TextField name="cost_meals_cents" label="Meals" defaultValue={toDollars(defaults.cost_meals_cents)} placeholder="0" />
            <TextField name="cost_other_cents" label="Other" defaultValue={toDollars(defaults.cost_other_cents)} placeholder="0" />
          </div>

          <div className="mt-3">
            <TextField name="cost_note" label="Cost note" defaultValue={defaults.cost_note} />
          </div>
        </fieldset>
      ) : (
        <p className="text-xs text-ink-faint">
          {kinds.find((k) => k.value === kind)?.label} is not an event kind, so it carries no cost.
        </p>
      )}

      <TextArea name="retro_note" label="Retrospective" rows={2} defaultValue={defaults.retro_note} />

      <div className="flex items-center gap-2 border-t border-line pt-4">
        <button type="submit" disabled={pending} className="btn-primary px-4 py-2">
          {pending ? 'Saving…' : defaults.id ? 'Save changes' : 'Create source'}
        </button>
        <button type="button" onClick={() => router.back()} className="btn px-4 py-2">
          Cancel
        </button>
      </div>
    </form>
  );
}

'use client';

import { useId, useMemo, useState } from 'react';

/**
 * Form controls shared by the person form, the watchlist form and the source
 * form. All plain HTML inputs underneath — a server action reads them out of
 * FormData, so nothing here needs client state to submit.
 */

export function TextField({
  name,
  label,
  hint,
  type = 'text',
  defaultValue,
  placeholder,
  required,
  error,
}: {
  name: string;
  label: string;
  hint?: string;
  type?: string;
  defaultValue?: string | null;
  placeholder?: string;
  required?: boolean;
  error?: string[];
}) {
  const id = useId();
  return (
    <div>
      <label className="label" htmlFor={id}>
        {label}
        {required ? <span className="ml-0.5 text-overdue">*</span> : null}
      </label>
      <input
        id={id}
        name={name}
        type={type}
        defaultValue={defaultValue ?? ''}
        placeholder={placeholder}
        required={required}
        className="field"
        aria-invalid={error ? true : undefined}
      />
      {hint && !error ? <p className="mt-1 text-xs text-ink-faint">{hint}</p> : null}
      {error ? (
        <p className="mt-1 text-xs text-overdue" role="alert">
          {error[0]}
        </p>
      ) : null}
    </div>
  );
}

export function TextArea({
  name,
  label,
  hint,
  defaultValue,
  placeholder,
  rows = 3,
  required,
  error,
}: {
  name: string;
  label: string;
  hint?: string;
  defaultValue?: string | null;
  placeholder?: string;
  rows?: number;
  required?: boolean;
  error?: string[];
}) {
  const id = useId();
  return (
    <div>
      <label className="label" htmlFor={id}>
        {label}
        {required ? <span className="ml-0.5 text-overdue">*</span> : null}
      </label>
      <textarea
        id={id}
        name={name}
        rows={rows}
        defaultValue={defaultValue ?? ''}
        placeholder={placeholder}
        required={required}
        className="field"
        aria-invalid={error ? true : undefined}
      />
      {hint && !error ? <p className="mt-1 text-xs text-ink-faint">{hint}</p> : null}
      {error ? (
        <p className="mt-1 text-xs text-overdue" role="alert">
          {error[0]}
        </p>
      ) : null}
    </div>
  );
}

export function SelectField({
  name,
  label,
  options,
  defaultValue,
  hint,
  includeBlank,
}: {
  name: string;
  label: string;
  options: Array<{ value: string; label: string }>;
  defaultValue?: string | null;
  hint?: string;
  includeBlank?: string;
}) {
  const id = useId();
  return (
    <div>
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <select id={id} name={name} defaultValue={defaultValue ?? ''} className="field">
        {includeBlank ? <option value="">{includeBlank}</option> : null}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {hint ? <p className="mt-1 text-xs text-ink-faint">{hint}</p> : null}
    </div>
  );
}

/**
 * Organization combobox.
 *
 * Typing an existing name selects it; typing a new one creates it inline on
 * save. There is no organization form in the primary navigation, because
 * organizations are a lookup, never a chore.
 */
export function OrganizationCombobox({
  organizations,
  defaultId,
  defaultName,
}: {
  organizations: Array<{ id: string; name: string }>;
  defaultId?: string | null;
  defaultName?: string | null;
}) {
  const listId = useId();
  const initial = defaultId
    ? (organizations.find((o) => o.id === defaultId)?.name ?? '')
    : (defaultName ?? '');

  const [value, setValue] = useState(initial);

  const matched = useMemo(
    () => organizations.find((o) => o.name.toLowerCase() === value.trim().toLowerCase()),
    [organizations, value],
  );

  return (
    <div>
      <label className="label" htmlFor={`${listId}-input`}>
        Organization
      </label>
      <input
        id={`${listId}-input`}
        list={listId}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        className="field"
        placeholder="Start typing…"
        autoComplete="off"
      />
      <datalist id={listId}>
        {organizations.map((org) => (
          <option key={org.id} value={org.name} />
        ))}
      </datalist>

      {/* Exactly one of these carries a value, which is what the action expects. */}
      <input type="hidden" name="organization_id" value={matched?.id ?? ''} />
      <input type="hidden" name="new_organization_name" value={matched ? '' : value.trim()} />

      <p className="mt-1 text-xs text-ink-faint">
        {value.trim() === ''
          ? 'Optional.'
          : matched
            ? 'Existing organization.'
            : `"${value.trim()}" will be created.`}
      </p>
    </div>
  );
}

/**
 * Multi-select over a taxonomy domain.
 *
 * Renders as checkboxes rather than a select-multiple: on a phone, a
 * select-multiple is close to unusable, and these lists are short enough that
 * seeing every option is an advantage.
 */
export function TaxonomyPicker({
  name,
  label,
  hint,
  options,
  selected = [],
}: {
  name: string;
  label: string;
  hint?: string;
  options: Array<{ value: string; label: string }>;
  selected?: string[];
}) {
  const chosen = new Set(selected);

  return (
    <fieldset>
      <legend className="label">{label}</legend>
      {hint ? <p className="mb-1.5 text-xs text-ink-faint">{hint}</p> : null}
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => (
          <label
            key={option.value}
            className="cursor-pointer rounded-full border border-line px-2.5 py-1 text-xs
                       transition-colors has-checked:border-accent has-checked:bg-accent-soft
                       has-checked:font-medium has-checked:text-accent"
          >
            <input
              type="checkbox"
              name={name}
              value={option.value}
              defaultChecked={chosen.has(option.value)}
              className="sr-only"
            />
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Person lookup for referred-by. Searches the existing rolodex. */
export function PersonCombobox({
  name,
  label,
  hint,
  people,
  defaultId,
}: {
  name: string;
  label: string;
  hint?: string;
  people: Array<{ id: string; full_name: string }>;
  defaultId?: string | null;
}) {
  const listId = useId();
  const [value, setValue] = useState(
    defaultId ? (people.find((p) => p.id === defaultId)?.full_name ?? '') : '',
  );

  const matched = useMemo(
    () => people.find((p) => p.full_name.toLowerCase() === value.trim().toLowerCase()),
    [people, value],
  );

  return (
    <div>
      <label className="label" htmlFor={`${listId}-input`}>
        {label}
      </label>
      <input
        id={`${listId}-input`}
        list={listId}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        className="field"
        placeholder="Who introduced you?"
        autoComplete="off"
      />
      <datalist id={listId}>
        {people.map((person) => (
          <option key={person.id} value={person.full_name} />
        ))}
      </datalist>

      <input type="hidden" name={name} value={matched?.id ?? ''} />
      {/* Falls back to free text when the referrer is not in the rolodex. */}
      <input
        type="hidden"
        name="introduced_by_external"
        value={matched || value.trim() === '' ? '' : value.trim()}
      />

      <p className="mt-1 text-xs text-ink-faint">
        {hint ??
          (matched
            ? 'Records the introduction on their record automatically.'
            : value.trim() === ''
              ? 'Optional.'
              : 'Not in the rolodex — kept as a name only.')}
      </p>
    </div>
  );
}

export function Checkbox({
  name,
  label,
  hint,
  defaultChecked,
}: {
  name: string;
  label: string;
  hint?: string;
  defaultChecked?: boolean;
}) {
  const id = useId();
  return (
    <div>
      <label className="flex items-center gap-2 text-sm" htmlFor={id}>
        <input id={id} type="checkbox" name={name} defaultChecked={defaultChecked} />
        <span>{label}</span>
      </label>
      {hint ? <p className="mt-0.5 ml-6 text-xs text-ink-faint">{hint}</p> : null}
    </div>
  );
}

/** Submit button that reports its own pending state. */
export function SubmitButton({ children, pendingLabel }: { children: React.ReactNode; pendingLabel?: string }) {
  return (
    <button type="submit" className="btn-primary px-4 py-2">
      {children}
      <span className="sr-only">{pendingLabel}</span>
    </button>
  );
}

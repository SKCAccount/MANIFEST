'use client';

import { useEffect, useId, useMemo, useState } from 'react';

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

/**
 * Person lookup for referred-by. Searches the existing rolodex as you type;
 * a name that matches nobody is kept as text (`introduced_by_external`) — the
 * friend-of-a-friend case. Generally the referrer should already be in the
 * rolodex, so the lookup is the primary path and free text is the fallback.
 */
export function PersonCombobox({
  name,
  label,
  hint,
  people,
  defaultId,
  defaultExternal,
}: {
  name: string;
  label: string;
  hint?: string;
  people: Array<{ id: string; full_name: string }>;
  defaultId?: string | null;
  /** A referrer stored as a name only (not in the rolodex). */
  defaultExternal?: string | null;
}) {
  const listId = useId();
  const [value, setValue] = useState(
    defaultId ? (people.find((p) => p.id === defaultId)?.full_name ?? '') : (defaultExternal ?? ''),
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
        placeholder="Search the rolodex…"
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
            ? '✓ In the rolodex — the introduction is recorded on both records.'
            : value.trim() === ''
              ? 'Optional. Start typing to search everyone in the rolodex.'
              : 'Not in the rolodex — saved as a name only. Fine for a friend of a friend.')}
      </p>
    </div>
  );
}

/** The main country per shared calling code, so +1 renders as United States rather than the first alphabetical territory. */
const PRIMARY_ISO_BY_CODE: Record<string, string> = { '1': 'US', '7': 'RU', '44': 'GB', '61': 'AU', '64': 'NZ' };

/** Progressive US mask: "3125550114" renders as (312) 555-0114 while typing. */
function formatUsDigits(digits: string): string {
  if (digits.length === 0) return '';
  if (digits.length <= 3) return `(${digits}`;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
}

/**
 * Phone entry: digits only, with US numbers formatted (312) 555-0114 as they
 * are typed. The country-code picker appears only when the form's Country is
 * not the United States — or the stored number already carries a non-US code —
 * so an American contact never sees it. Submits bare digits for US numbers and
 * +<code><digits> otherwise; normalizePhone turns both into E.164 on the way in.
 */
export function PhoneField({
  name,
  label,
  hint,
  defaultValue,
  countryName,
  countries,
  onHasValue,
}: {
  name: string;
  label: string;
  hint?: string;
  defaultValue?: string | null;
  /** The form's Country selection; decides whether the code picker shows. */
  countryName: string;
  countries: Array<{ name: string; iso: string; code: string }>;
  onHasValue?: (has: boolean) => void;
}) {
  const id = useId();

  const isoForCountryName = (n: string) => countries.find((c) => c.name === n)?.iso ?? 'US';
  const codeOf = (iso: string) => countries.find((c) => c.iso === iso)?.code ?? '1';

  // Split a stored value — E.164, or unnormalized text — into code + digits.
  const initial = useMemo(() => {
    const raw = (defaultValue ?? '').trim();
    if (raw.startsWith('+')) {
      const rest = raw.slice(1).replace(/\D/g, '');
      const codes = [...new Set(countries.map((c) => c.code))].sort((a, b) => b.length - a.length);
      const code = codes.find((c) => rest.startsWith(c)) ?? '1';
      const iso = PRIMARY_ISO_BY_CODE[code] ?? countries.find((c) => c.code === code)?.iso ?? 'US';
      return { iso, digits: rest.slice(code.length) };
    }
    return { iso: isoForCountryName(countryName), digits: raw.replace(/\D/g, '') };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [ccIso, setCcIso] = useState(initial.iso);
  const [digits, setDigits] = useState(initial.digits);

  // A new Country selection re-defaults the code — but never rewrites a number
  // already entered.
  useEffect(() => {
    if (digits === '') setCcIso(isoForCountryName(countryName));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countryName]);

  const code = codeOf(ccIso);
  const isUs = countryName === 'United States' && code === '1';
  const submitted = digits === '' ? '' : isUs ? digits : `+${code}${digits}`;

  function update(next: string, max: number) {
    const cleaned = next.replace(/\D/g, '').slice(0, max);
    setDigits(cleaned);
    onHasValue?.(cleaned !== '');
  }

  return (
    <div>
      <label className="label" htmlFor={id}>
        {label}
      </label>
      {isUs ? (
        <input
          id={id}
          type="tel"
          inputMode="numeric"
          autoComplete="off"
          value={formatUsDigits(digits)}
          onChange={(event) => update(event.target.value, 10)}
          placeholder="(312) 555-0114"
          className="field"
        />
      ) : (
        <div className="flex gap-2">
          <select
            aria-label={`${label} country code`}
            value={ccIso}
            onChange={(event) => setCcIso(event.target.value)}
            className="field w-auto max-w-[45%] shrink-0"
          >
            {countries.map((c) => (
              <option key={c.iso} value={c.iso}>{`${c.name} +${c.code}`}</option>
            ))}
          </select>
          <input
            id={id}
            type="tel"
            inputMode="numeric"
            autoComplete="off"
            value={digits}
            onChange={(event) => update(event.target.value, 14)}
            placeholder="Digits only"
            className="field"
          />
        </div>
      )}
      <input type="hidden" name={name} value={submitted} />
      {hint ? <p className="mt-1 text-xs text-ink-faint">{hint}</p> : null}
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

import 'server-only';

/**
 * The country list for the person form, built once per process.
 *
 * Names come from Intl.DisplayNames (built into Node — no bundled list to
 * maintain) and calling codes from libphonenumber-js, which is already the
 * phone normalizer. The stored value is the display name — "United States",
 * never "US" — so the Geography screen groups on one spelling.
 *
 * United States first (the operator's own market), everything else
 * alphabetical.
 */

import { getCountries, getCountryCallingCode } from 'libphonenumber-js';

export type CountryOption = { name: string; iso: string; code: string };

let cache: CountryOption[] | null = null;

export function getCountryOptions(): CountryOption[] {
  if (cache) return cache;

  const display = new Intl.DisplayNames(['en'], { type: 'region' });
  const seen = new Set<string>();
  const all: CountryOption[] = [];

  for (const iso of getCountries()) {
    const name = display.of(iso) ?? iso;
    // A handful of territories share a display name; first one wins.
    if (seen.has(name)) continue;
    seen.add(name);
    all.push({ name, iso, code: getCountryCallingCode(iso) });
  }

  all.sort((a, b) => a.name.localeCompare(b.name));

  // United States first — the operator's own market.
  const usIndex = all.findIndex((c) => c.iso === 'US');
  const us = usIndex === -1 ? undefined : all.splice(usIndex, 1)[0];

  cache = us ? [us, ...all] : all;
  return cache;
}

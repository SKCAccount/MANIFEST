/**
 * Geography constants shared by the forms (client-safe — no server imports).
 *
 * Full names are the canonical stored values — "Illinois" never "IL",
 * "United States" never "USA" — so the Geography screen groups on exactly one
 * spelling. The maps below normalize what was typed before the dropdowns
 * existed, and anything pasted since.
 */

export const US_STATES = [
  'Alabama',
  'Alaska',
  'Arizona',
  'Arkansas',
  'California',
  'Colorado',
  'Connecticut',
  'Delaware',
  'District of Columbia',
  'Florida',
  'Georgia',
  'Hawaii',
  'Idaho',
  'Illinois',
  'Indiana',
  'Iowa',
  'Kansas',
  'Kentucky',
  'Louisiana',
  'Maine',
  'Maryland',
  'Massachusetts',
  'Michigan',
  'Minnesota',
  'Mississippi',
  'Missouri',
  'Montana',
  'Nebraska',
  'Nevada',
  'New Hampshire',
  'New Jersey',
  'New Mexico',
  'New York',
  'North Carolina',
  'North Dakota',
  'Ohio',
  'Oklahoma',
  'Oregon',
  'Pennsylvania',
  'Rhode Island',
  'South Carolina',
  'South Dakota',
  'Tennessee',
  'Texas',
  'Utah',
  'Vermont',
  'Virginia',
  'Washington',
  'West Virginia',
  'Wisconsin',
  'Wyoming',
] as const;

export const US_STATE_BY_ABBR: Record<string, string> = {
  AL: 'Alabama',
  AK: 'Alaska',
  AZ: 'Arizona',
  AR: 'Arkansas',
  CA: 'California',
  CO: 'Colorado',
  CT: 'Connecticut',
  DE: 'Delaware',
  DC: 'District of Columbia',
  FL: 'Florida',
  GA: 'Georgia',
  HI: 'Hawaii',
  ID: 'Idaho',
  IL: 'Illinois',
  IN: 'Indiana',
  IA: 'Iowa',
  KS: 'Kansas',
  KY: 'Kentucky',
  LA: 'Louisiana',
  ME: 'Maine',
  MD: 'Maryland',
  MA: 'Massachusetts',
  MI: 'Michigan',
  MN: 'Minnesota',
  MS: 'Mississippi',
  MO: 'Missouri',
  MT: 'Montana',
  NE: 'Nebraska',
  NV: 'Nevada',
  NH: 'New Hampshire',
  NJ: 'New Jersey',
  NM: 'New Mexico',
  NY: 'New York',
  NC: 'North Carolina',
  ND: 'North Dakota',
  OH: 'Ohio',
  OK: 'Oklahoma',
  OR: 'Oregon',
  PA: 'Pennsylvania',
  RI: 'Rhode Island',
  SC: 'South Carolina',
  SD: 'South Dakota',
  TN: 'Tennessee',
  TX: 'Texas',
  UT: 'Utah',
  VT: 'Vermont',
  VA: 'Virginia',
  WA: 'Washington',
  WV: 'West Virginia',
  WI: 'Wisconsin',
  WY: 'Wyoming',
};

/** "IL" → "Illinois", "illinois" → "Illinois"; anything unrecognized passes through unchanged. */
export function normalizeUsState(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;

  const byAbbr = US_STATE_BY_ABBR[trimmed.toUpperCase()];
  if (byAbbr) return byAbbr;

  const byName = US_STATES.find((s) => s.toLowerCase() === trimmed.toLowerCase());
  return byName ?? trimmed;
}

const COUNTRY_ALIASES: Record<string, string> = {
  US: 'United States',
  USA: 'United States',
  'U.S.': 'United States',
  'U.S.A.': 'United States',
  'UNITED STATES': 'United States',
  'UNITED STATES OF AMERICA': 'United States',
  AMERICA: 'United States',
  UK: 'United Kingdom',
  'U.K.': 'United Kingdom',
  GB: 'United Kingdom',
  'GREAT BRITAIN': 'United Kingdom',
  ENGLAND: 'United Kingdom',
};

/** "US" / "USA" / "usa" → "United States"; anything unrecognized passes through unchanged. */
export function normalizeCountryName(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  return COUNTRY_ALIASES[trimmed.toUpperCase()] ?? trimmed;
}

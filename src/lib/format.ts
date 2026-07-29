/**
 * Display formatting.
 *
 * Everything is stored in UTC and rendered in America/New_York. That is stated
 * once here so no component has to remember it — a touchpoint logged at 9pm on
 * the 4th must read as the 4th.
 */

import type { DevStage, Tier } from './db/enums';

export const TIME_ZONE = 'America/New_York';

const dateFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE,
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

const shortDateFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE,
  month: 'short',
  day: 'numeric',
});

const dateTimeFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE,
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  return dateFmt.format(toDate(value));
}

export function formatShortDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  return shortDateFmt.format(toDate(value));
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  return dateTimeFmt.format(toDate(value));
}

/** A bare `date` column is a calendar day, not an instant — parse it as local, not UTC. */
function toDate(value: string | Date): Date {
  if (value instanceof Date) return value;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date(value);
}

/** "3 days ago", "in 2 weeks". Used wherever the exact date matters less than the gap. */
export function formatRelative(value: string | Date | null | undefined): string {
  if (!value) return 'never';

  const days = Math.round((toDate(value).getTime() - Date.now()) / 86_400_000);
  const abs = Math.abs(days);

  if (abs === 0) return 'today';
  if (abs === 1) return days < 0 ? 'yesterday' : 'tomorrow';
  if (abs < 30) return days < 0 ? `${abs} days ago` : `in ${abs} days`;

  const months = Math.round(abs / 30.44);
  if (abs < 365) return days < 0 ? `${months} months ago` : `in ${months} months`;

  const years = (abs / 365.25).toFixed(1).replace(/\.0$/, '');
  return days < 0 ? `${years} years ago` : `in ${years} years`;
}

/** Integer cents in, dollars out. Money is never a float in this system. */
export function formatMoney(cents: number | string | null | undefined, options: { cents?: boolean } = {}): string {
  if (cents === null || cents === undefined || cents === '') return '—';

  const value = typeof cents === 'string' ? Number(cents) : cents;
  if (!Number.isFinite(value)) return '—';

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: options.cents ? 2 : 0,
    maximumFractionDigits: options.cents ? 2 : 0,
  }).format(value / 100);
}

/** Parses "4,200", "$4,200.00" or "4200" into integer cents. Returns null on anything else. */
export function parseMoneyToCents(input: string | null | undefined): number | null {
  if (input === null || input === undefined) return null;

  const cleaned = input.replace(/[$,\s]/g, '').trim();
  if (cleaned === '') return null;

  const value = Number(cleaned);
  if (!Number.isFinite(value) || value < 0) return null;

  return Math.round(value * 100);
}

export const STAGE_LABEL: Record<DevStage, string> = {
  card: 'Card',
  contact: 'Contact',
  active: 'Active',
  producing: 'Producing',
};

export const STAGE_DESCRIPTION: Record<DevStage, string> = {
  card: 'One touchpoint. Nothing since first contact.',
  contact: 'More than one touchpoint, nothing substantive since.',
  active: 'Substantive contact in the last twelve months.',
  producing: 'Has sourced a deal, made an introduction, or granted a favour.',
};

export const TIER_LABEL: Record<Tier, string> = {
  A: 'A · every 45 days',
  B: 'B · every 90 days',
  C: 'C · every 180 days',
  D: 'D · archived',
};

export function tierTextClass(tier: Tier | null | undefined): string {
  switch (tier) {
    case 'A':
      return 'text-tier-a';
    case 'B':
      return 'text-tier-b';
    case 'C':
      return 'text-tier-c';
    case 'D':
      return 'text-tier-d';
    default:
      return 'text-ink-faint';
  }
}

/** "40 days overdue" / "due in 5 days" / "not due". */
export function formatOverdue(daysOverdue: number | null | undefined): string {
  if (daysOverdue === null || daysOverdue === undefined) return 'no cadence';
  if (daysOverdue > 0) return `${daysOverdue} ${daysOverdue === 1 ? 'day' : 'days'} overdue`;
  if (daysOverdue === 0) return 'due today';
  return `due in ${Math.abs(daysOverdue)} ${Math.abs(daysOverdue) === 1 ? 'day' : 'days'}`;
}

/** Title-cases a snake_case enum value for display. */
export function humanize(value: string | null | undefined): string {
  if (!value) return '';
  return value
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export function fullName(person: { first_name?: string | null; last_name?: string | null; full_name?: string | null }): string {
  if (person.full_name) return person.full_name;
  return [person.first_name, person.last_name].filter(Boolean).join(' ');
}

/** A cents-per-contact figure, or an explicit dash when the denominator is zero. */
export function formatRatio(cents: number | string | null | undefined): string {
  if (cents === null || cents === undefined) return '—';
  return formatMoney(cents);
}

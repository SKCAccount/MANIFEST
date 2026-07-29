import type { TouchChannel, TouchDirection } from '../db/enums';

/**
 * The shape of a parsed capture, and the option lists the confirm form renders.
 *
 * Kept apart from parse.ts because that module is server-only — it holds the
 * API key path. The client needs the type and the dropdowns, not the parser.
 */

export type CaptureDraft = {
  first_name: string;
  last_name: string;
  organization_name: string;
  position: string;
  city: string;
  channel: TouchChannel;
  direction: TouchDirection;
  substantive: boolean;
  summary: string;
  note: string;
  followup_title: string;
  followup_due_on: string;
  specialties: string[];
  confidence: 'high' | 'medium' | 'low';
};

/** Channels the capture form offers, in the order the operator actually uses them. */
export const CAPTURE_CHANNELS: TouchChannel[] = [
  'call',
  'meeting',
  'email',
  'text',
  'linkedin',
  'event',
  'other',
];

export const CAPTURE_DIRECTIONS: TouchDirection[] = ['mutual', 'inbound', 'outbound'];

/** An empty draft, used when parsing is unavailable or fails. */
export function emptyDraft(summary: string): CaptureDraft {
  return {
    first_name: '',
    last_name: '',
    organization_name: '',
    position: '',
    city: '',
    channel: 'other',
    direction: 'mutual',
    substantive: true,
    summary,
    note: '',
    followup_title: '',
    followup_due_on: '',
    specialties: [],
    confidence: 'low',
  };
}

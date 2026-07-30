/**
 * Configuration diagnosis.
 *
 * These exist because "fetch failed" was, in practice, the first thing the
 * system ever said to its operator — and it says nothing about what to do.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { describeAuthError, supabaseConfigStatus } from '../../src/lib/config';

const ORIGINAL = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL };
});

describe('supabaseConfigStatus', () => {
  it('reports missing when nothing is set', () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    const status = supabaseConfigStatus();
    expect(status.ok).toBe(false);
    expect(status).toMatchObject({ reason: 'missing' });
  });

  it('names which variable is missing', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://real.supabase.co';
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    const status = supabaseConfigStatus();
    expect(status.ok).toBe(false);
    if (!status.ok) expect(status.detail).toMatch(/ANON_KEY/);
  });

  it('catches a placeholder project that would fail at request time', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://placeholder.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anything';

    const status = supabaseConfigStatus();
    expect(status.ok).toBe(false);
    expect(status).toMatchObject({ reason: 'placeholder' });
  });

  it('catches a malformed URL', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'not-a-url';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anything';

    expect(supabaseConfigStatus().ok).toBe(false);
  });

  it('accepts a real-looking project', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://abcdefghijkl.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.real';

    expect(supabaseConfigStatus()).toEqual({ ok: true });
  });
});

describe('describeAuthError', () => {
  const url = 'https://abcdefghijkl.supabase.co';

  it('translates a network failure into something actionable', () => {
    const message = describeAuthError('fetch failed', url);
    expect(message).toMatch(/abcdefghijkl\.supabase\.co/);
    expect(message).toMatch(/connection problem, not a sign-in problem/i);
    expect(message).toMatch(/npm run doctor/);
  });

  it('covers the other shapes Node reports for an unreachable host', () => {
    for (const raw of ['getaddrinfo ENOTFOUND abc.supabase.co', 'connect ECONNREFUSED 127.0.0.1:443']) {
      expect(describeAuthError(raw, url)).toMatch(/connection problem/i);
    }
  });

  it('explains a disabled signup rather than repeating the API wording', () => {
    const message = describeAuthError('Signups not allowed for otp', url);
    expect(message).toMatch(/disabled by design/i);
    expect(message).toMatch(/bootstrap:owner/);
  });

  it('explains an email rate limit and offers the dashboard route', () => {
    const message = describeAuthError('email rate limit exceeded', url);
    expect(message).toMatch(/Send magic link/);
  });

  it('explains an unallowlisted redirect', () => {
    const message = describeAuthError('redirect_to url is not allowed', url);
    expect(message).toMatch(/URL Configuration/);
  });

  it('passes anything it does not recognize through unchanged', () => {
    expect(describeAuthError('Invalid login credentials', url)).toBe('Invalid login credentials');
  });
});

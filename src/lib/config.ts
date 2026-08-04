/**
 * Configuration state, for surfaces that should explain themselves rather than
 * fail.
 *
 * The login form is the first thing anyone sees, and a form that accepts an
 * email and then reports "fetch failed" is indistinguishable from a bug in the
 * app. It is almost always one of three things: no `.env.local`, placeholder
 * values still in it, or a project that cannot be reached.
 */

export type ConfigStatus =
  | { ok: true }
  | { ok: false; reason: 'missing' | 'placeholder'; detail: string };

/** Hostnames that mean "nobody has filled this in yet". */
const PLACEHOLDER_HOSTS = ['placeholder.supabase.co', 'example.supabase.co', 'your-project.supabase.co'];

export function supabaseConfigStatus(): ConfigStatus {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  // Either key generation: legacy JWT anon keys, or the sb_publishable_ keys
  // new projects issue since Supabase's 2025 rename.
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !anonKey) {
    return {
      ok: false,
      reason: 'missing',
      detail: !url
        ? 'NEXT_PUBLIC_SUPABASE_URL is not set.'
        : 'Neither NEXT_PUBLIC_SUPABASE_ANON_KEY nor NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is set.',
    };
  }

  let host: string;
  try {
    host = new URL(url).host;
  } catch {
    return { ok: false, reason: 'placeholder', detail: `NEXT_PUBLIC_SUPABASE_URL is not a valid URL: ${url}` };
  }

  if (PLACEHOLDER_HOSTS.includes(host) || anonKey.startsWith('eyJplaceholder')) {
    return {
      ok: false,
      reason: 'placeholder',
      detail: `Still pointing at ${host}, which is not a real project.`,
    };
  }

  return { ok: true };
}

/**
 * Turns a Supabase auth error into something worth reading.
 *
 * `fetch failed` is what Node reports for every network-layer failure, which
 * covers a typo in the project URL, a project that is still provisioning, a
 * free-tier project paused after a week of inactivity, and an outbound
 * firewall. None of those are bugs in this app, and the raw message says none
 * of them.
 */
export function describeAuthError(message: string, url: string | undefined): string {
  const host = url ? safeHost(url) : 'the project URL';

  if (/fetch failed|ENOTFOUND|ECONNREFUSED|getaddrinfo|network/i.test(message)) {
    return (
      `Could not reach ${host}. That is a connection problem, not a sign-in problem — ` +
      `check the project URL in .env.local, confirm the project is running (free-tier projects ` +
      `pause after a week idle), then run \`npm run doctor\`.`
    );
  }

  if (/signups? not allowed|Signups not allowed for otp/i.test(message)) {
    return (
      'That address has no account. Signup is disabled by design — create the user in the ' +
      'Supabase dashboard under Authentication → Users → Add user, then run `npm run bootstrap:owner`.'
    );
  }

  if (/rate limit|too many requests/i.test(message)) {
    return (
      'Supabase rate-limited the email. Free-tier SMTP allows only a couple an hour — ' +
      'send the magic link from the dashboard instead: Authentication → Users → ⋯ → Send magic link.'
    );
  }

  if (/redirect|not allowed.*url/i.test(message)) {
    return (
      'The callback URL is not allowlisted. Supabase → Authentication → URL Configuration → ' +
      'add http://localhost:3000/auth/callback to Redirect URLs.'
    );
  }

  return message;
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return 'the project URL';
  }
}

import { redirect } from 'next/navigation';
import { currentOperator, supabase } from '@/lib/auth';
import { describeAuthError, supabaseConfigStatus } from '@/lib/config';

// The root layout's template appends "· MANIFEST"; repeating it here produced
// "Sign in · MANIFEST · MANIFEST".
export const metadata = { title: 'Sign in' };

type Props = { searchParams: Promise<{ next?: string; sent?: string; error?: string }> };

/**
 * Email and password, with a magic link as the fallback.
 *
 * Password is the primary path because it is the suite's convention — Kraken's
 * users already sign in that way — and because the magic-link-only flow ran
 * into the practical wall of free-tier SMTP: a couple of emails an hour, most
 * of them in spam, is real friction on every new device.
 *
 * The link stays as the recovery path: with signup disabled there is no
 * self-service reset, so "email me a link instead" is what gets the operator
 * back in after a forgotten password (then `npm run auth:set-password` sets a
 * new one). `enable_signup = false` on the hosted project means neither path
 * can create an account — an address that is not already provisioned simply
 * fails.
 *
 * When the app is not configured this renders setup instructions instead of
 * the form. A form that accepts an email and then fails is indistinguishable
 * from a bug; a form that is not there yet is self-explanatory.
 */
export default async function LoginPage({ searchParams }: Props) {
  const params = await searchParams;
  const config = supabaseConfigStatus();

  if (config.ok) {
    const operator = await currentOperator();
    if (operator) redirect('/');
  }

  async function signIn(formData: FormData) {
    'use server';

    const email = String(formData.get('email') ?? '')
      .trim()
      .toLowerCase();
    const password = String(formData.get('password') ?? '');
    const next = String(formData.get('next') ?? '/');

    if (!email) redirect('/login?error=Enter+your+email+address');
    if (!password) redirect(`/login?error=Enter+your+password&next=${encodeURIComponent(next)}`);

    const db = await supabase();
    const { error } = await db.auth.signInWithPassword({ email, password });

    if (error) {
      const readable = describeAuthError(error.message, process.env.NEXT_PUBLIC_SUPABASE_URL);
      redirect(`/login?error=${encodeURIComponent(readable)}&next=${encodeURIComponent(next)}`);
    }

    // Only ever redirect within this origin — an open redirect here would hand
    // a fresh session to whatever host the link pointed at.
    const destination = next.startsWith('/') && !next.startsWith('//') ? next : '/';
    redirect(destination);
  }

  async function sendLink(formData: FormData) {
    'use server';

    const email = String(formData.get('email') ?? '')
      .trim()
      .toLowerCase();
    const next = String(formData.get('next') ?? '/');

    if (!email) redirect('/login?error=Enter+your+email+address');

    const db = await supabase();
    const origin = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

    const { error } = await db.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: false,
        emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });

    if (error) {
      const readable = describeAuthError(error.message, process.env.NEXT_PUBLIC_SUPABASE_URL);
      redirect(`/login?error=${encodeURIComponent(readable)}`);
    }
    redirect('/login?sent=1');
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center px-6 py-16">
      <h1 className="font-mono text-2xl font-semibold tracking-tight">MANIFEST</h1>
      <p className="mt-2 text-sm text-ink-soft">Sea King Capital</p>

      {!config.ok ? (
        <div className="card mt-8 p-4 text-sm">
          <p className="font-medium">Not connected to a database yet.</p>
          <p className="mt-1 text-ink-soft">{config.detail}</p>

          <p className="mt-3 text-ink-soft">
            {config.reason === 'missing'
              ? 'Create a Supabase project and fill in .env.local:'
              : 'Replace the placeholder values in .env.local with a real project:'}
          </p>

          <pre className="mt-2 overflow-x-auto rounded-md border border-line bg-paper p-3 text-xs">
            {`cp .env.example .env.local\n# paste the project URL and keys, then:\nnpm run doctor`}
          </pre>

          <p className="mt-3 text-xs text-ink-faint">
            <code>npm run doctor</code> checks everything and names whatever is still missing. Full
            walkthrough in SETUP.md.
          </p>
        </div>
      ) : params.sent ? (
        <div className="card mt-8 p-4 text-sm">
          <p className="font-medium">Check your email.</p>
          <p className="mt-1 text-ink-soft">
            The link signs you in on this device and expires shortly.
          </p>
          <p className="mt-3 text-xs text-ink-faint">
            Nothing arriving? Free-tier Supabase allows only a couple of emails an hour and they
            often land in spam. Send one from the dashboard instead: Authentication → Users → ⋯ →
            Send magic link. Once in, <code>npm run auth:set-password</code> means never needing
            the email again.
          </p>
        </div>
      ) : (
        <form action={signIn} className="mt-8 space-y-4">
          <div>
            <label className="label" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              autoFocus
              required
              className="field"
              placeholder="derek@seakingcapital.com"
            />
          </div>
          <div>
            <label className="label" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className="field"
              placeholder="••••••••••••"
            />
          </div>
          <input type="hidden" name="next" value={params.next ?? '/'} />
          <button type="submit" className="btn-primary w-full">
            Sign in
          </button>

          {/* The recovery path. formAction skips the password requirement, so a
              forgotten password never locks the operator out — provided email
              still works, which is why the link flow is kept rather than
              removed. */}
          <button
            type="submit"
            formAction={sendLink}
            formNoValidate
            className="w-full text-center text-xs text-ink-faint hover:text-ink"
          >
            Email me a sign-in link instead
          </button>
        </form>
      )}

      {params.error ? (
        <p className="mt-4 text-sm text-overdue" role="alert">
          {params.error}
        </p>
      ) : null}
    </main>
  );
}

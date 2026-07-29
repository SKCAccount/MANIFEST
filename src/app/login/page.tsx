import { redirect } from 'next/navigation';
import { currentOperator, supabase } from '@/lib/auth';

export const metadata = { title: 'Sign in · MANIFEST' };

type Props = { searchParams: Promise<{ next?: string; sent?: string; error?: string }> };

/**
 * Magic link only. No password to leak, no signup, and `enable_signup = false`
 * in config.toml means an address that is not already provisioned simply never
 * receives a link.
 */
export default async function LoginPage({ searchParams }: Props) {
  const params = await searchParams;
  const operator = await currentOperator();
  if (operator) redirect('/');

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
      redirect(`/login?error=${encodeURIComponent(error.message)}`);
    }
    redirect('/login?sent=1');
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6 py-16">
      <h1 className="font-mono text-2xl font-semibold tracking-tight">MANIFEST</h1>
      <p className="mt-2 text-sm text-ink-soft">Sea King Capital</p>

      {params.sent ? (
        <div className="card mt-8 p-4 text-sm">
          <p className="font-medium">Check your email.</p>
          <p className="mt-1 text-ink-soft">
            The link signs you in on this device and expires shortly.
          </p>
        </div>
      ) : (
        <form action={sendLink} className="mt-8 space-y-4">
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
          <input type="hidden" name="next" value={params.next ?? '/'} />
          <button type="submit" className="btn-primary w-full">
            Send sign-in link
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

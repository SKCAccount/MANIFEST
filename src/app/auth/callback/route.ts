import { NextResponse, type NextRequest } from 'next/server';
import { supabase } from '@/lib/auth';

/** Exchanges the magic-link code for a session cookie, then returns the operator to where they were headed. */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/';

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=Missing+sign-in+code`);
  }

  const db = await supabase();
  const { error } = await db.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(error.message)}`);
  }

  // Only ever redirect within this origin — an open redirect here would hand a
  // fresh session to whatever host the link pointed at.
  const destination = next.startsWith('/') && !next.startsWith('//') ? next : '/';
  return NextResponse.redirect(`${origin}${destination}`);
}

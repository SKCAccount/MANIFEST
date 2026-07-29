/**
 * Refreshes the Supabase session cookie on every navigation.
 *
 * Server components cannot set cookies, so without this the operator would be
 * signed out whenever the access token expired mid-session — on a phone, that
 * is most of the time.
 */

import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

const PUBLIC_PATHS = ['/login', '/auth/callback', '/auth/signout'];

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Without configuration there is no session to refresh. Let the page render
  // and show its own "not configured" state rather than failing in middleware.
  if (!url || !anonKey) return response;

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet) => {
        for (const { name, value } of toSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of toSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // getUser() revalidates against the auth server, unlike getSession().
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  if (!user && !isPublic) {
    const login = request.nextUrl.clone();
    login.pathname = '/login';
    // Come back to where they were headed once signed in.
    login.searchParams.set('next', pathname + request.nextUrl.search);
    return NextResponse.redirect(login);
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Everything except static assets, the service worker and the icons —
     * those must stay reachable while signed out or the install prompt breaks.
     */
    '/((?!_next/static|_next/image|favicon.ico|sw.js|manifest.webmanifest|icons/).*)',
  ],
};

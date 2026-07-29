import { NextResponse, type NextRequest } from 'next/server';
import { supabase } from '@/lib/auth';

export async function POST(request: NextRequest) {
  const db = await supabase();
  await db.auth.signOut();
  return NextResponse.redirect(`${request.nextUrl.origin}/login`, { status: 303 });
}

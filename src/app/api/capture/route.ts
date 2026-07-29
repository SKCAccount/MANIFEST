import { NextResponse, type NextRequest } from 'next/server';
import { queueOfflineCapture } from '@/lib/actions/capture';
import { currentOperator } from '@/lib/auth';

/**
 * Replay endpoint for captures queued offline.
 *
 * The service worker and the page's reconnect handler both post here. It is
 * idempotent in the way that matters: a replayed capture becomes a *pending*
 * staging record, so a duplicate delivery costs the operator one dismissal
 * rather than a duplicate person.
 */
export async function POST(request: NextRequest) {
  const operator = await currentOperator();
  if (!operator) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Malformed request.' }, { status: 400 });
  }

  const { text, personId, capturedAt } = (body ?? {}) as {
    text?: string;
    personId?: string | null;
    capturedAt?: string | null;
  };

  const result = await queueOfflineCapture({
    text: String(text ?? ''),
    personId: personId ?? null,
    capturedAt: capturedAt ?? null,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ staged: true });
}

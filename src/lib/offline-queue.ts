/**
 * Offline-tolerant quick capture.
 *
 * The highest-value capture moment is standing in a conference hall with one
 * bar of signal, which is exactly when a network round trip fails. Captures are
 * written to IndexedDB first and posted afterwards, so the operator never loses
 * a note to a dead connection and never has to think about whether it saved.
 *
 * IndexedDB rather than localStorage because this survives a tab crash and does
 * not block the main thread. Entries are removed only once the server has
 * acknowledged them.
 */

const DB_NAME = 'manifest-offline';
const DB_VERSION = 1;
const STORE = 'pending_captures';

export type PendingCapture = {
  id?: number;
  /** The operator's raw text, exactly as typed. Never parsed client-side. */
  text: string;
  /** Optional person this was captured against, when captured from a person page. */
  personId?: string | null;
  capturedAt: string;
  attempts: number;
  lastError?: string | null;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE, mode);
        const request = run(transaction.objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        transaction.oncomplete = () => db.close();
      }),
  );
}

export async function enqueueCapture(entry: Omit<PendingCapture, 'id' | 'attempts'>): Promise<void> {
  await tx('readwrite', (store) => store.add({ ...entry, attempts: 0 } satisfies Omit<PendingCapture, 'id'>));
}

export async function pendingCaptures(): Promise<PendingCapture[]> {
  return tx('readonly', (store) => store.getAll() as IDBRequest<PendingCapture[]>);
}

export async function pendingCount(): Promise<number> {
  return tx('readonly', (store) => store.count());
}

async function removeCapture(id: number): Promise<void> {
  await tx('readwrite', (store) => store.delete(id));
}

async function recordFailure(entry: PendingCapture, message: string): Promise<void> {
  await tx('readwrite', (store) =>
    store.put({ ...entry, attempts: entry.attempts + 1, lastError: message }),
  );
}

export type FlushResult = { sent: number; failed: number; remaining: number };

/**
 * Replays everything queued. Safe to call repeatedly — an entry is only removed
 * once the server acknowledges it, and a failure leaves it in place with the
 * error recorded so it can be shown rather than silently retried forever.
 */
export async function flushCaptures(): Promise<FlushResult> {
  if (typeof indexedDB === 'undefined') return { sent: 0, failed: 0, remaining: 0 };

  const entries = await pendingCaptures();
  let sent = 0;
  let failed = 0;

  for (const entry of entries) {
    try {
      const response = await fetch('/api/capture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: entry.text,
          personId: entry.personId ?? null,
          capturedAt: entry.capturedAt,
        }),
      });

      if (!response.ok) {
        throw new Error(`Server returned ${response.status}`);
      }

      if (entry.id !== undefined) await removeCapture(entry.id);
      sent += 1;
    } catch (error) {
      failed += 1;
      await recordFailure(entry, error instanceof Error ? error.message : 'Unknown error');
    }
  }

  return { sent, failed, remaining: await pendingCount() };
}

/** Registers the service worker and wires reconnect-driven replay. */
export function initOfflineSupport(onFlush?: (result: FlushResult) => void): () => void {
  if (typeof window === 'undefined') return () => {};

  const flush = () => {
    void flushCaptures().then((result) => {
      if (result.sent > 0 || result.failed > 0) onFlush?.(result);
    });
  };

  if ('serviceWorker' in navigator) {
    void navigator.serviceWorker.register('/sw.js').catch(() => {
      // A failed registration costs offline shell loading, not correctness.
    });
    navigator.serviceWorker.addEventListener('message', (event: MessageEvent) => {
      if ((event.data as { type?: string })?.type === 'flush-captures') flush();
    });
  }

  window.addEventListener('online', flush);
  // Anything queued from a previous session goes out as soon as we load.
  flush();

  return () => window.removeEventListener('online', flush);
}

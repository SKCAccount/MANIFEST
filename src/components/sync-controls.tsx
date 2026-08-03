'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { disconnectGoogle, runSyncNow } from '@/lib/actions/sync';

/**
 * "Sync now", and disconnecting.
 *
 * The run reports its counts rather than a checkmark. A sync that saw four
 * hundred messages and wrote nothing is a completely different situation from
 * one that saw nothing at all, and both look like success — so the numbers are
 * the result, not decoration.
 */
export function SyncNowButton({ channel, label }: { channel: 'gmail' | 'gcal'; label: string }) {
  const router = useRouter();
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run() {
    setError(null);
    setResult(null);
    startTransition(async () => {
      const outcome = await runSyncNow(channel);
      if (!outcome.ok) {
        setError(outcome.error);
        return;
      }

      const { counts, complete, providerKind } = outcome.data;
      const written = (counts.inserted ?? 0) + (counts.superseded ?? 0);
      const parts = [
        `${written} written`,
        counts.unchanged ? `${counts.unchanged} unchanged` : null,
        counts.staged ? `${counts.staged} to review` : null,
        complete ? null : 'partial — cursor had expired',
        providerKind === 'fixture' ? 'fixture data' : null,
      ].filter(Boolean);

      setResult(parts.join(' · '));
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" onClick={run} disabled={pending} className="btn px-2.5 py-1.5 text-sm">
        {pending ? `Syncing ${label}…` : `Sync ${label} now`}
      </button>
      {result ? <span className="text-xs text-ink-soft">{result}</span> : null}
      {error ? <span className="text-xs text-overdue">{error}</span> : null}
    </div>
  );
}

export function DisconnectButton({ accountEmail }: { accountEmail: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="text-xs text-ink-faint hover:text-overdue"
      >
        Disconnect
      </button>
    );
  }

  return (
    <div className="text-xs">
      <p className="text-ink-soft">
        Disconnect {accountEmail}? Touchpoints already written stay; nothing new is read.
      </p>
      {/* Said plainly because it is the part people assume and get wrong: this
          drops the token from MANIFEST, it does not revoke the grant at
          Google's end. */}
      <p className="mt-1 text-ink-faint">
        This removes the token from MANIFEST. To revoke the grant itself, use{' '}
        <a
          href="https://myaccount.google.com/permissions"
          target="_blank"
          rel="noreferrer"
          className="text-accent hover:underline"
        >
          your Google account permissions
        </a>
        .
      </p>
      {error ? <p className="mt-1 text-overdue">{error}</p> : null}
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const outcome = await disconnectGoogle();
              if (!outcome.ok) setError(outcome.error);
              else router.refresh();
            })
          }
          className="btn px-2 py-1 text-xs"
        >
          Disconnect
        </button>
        <button type="button" onClick={() => setConfirming(false)} className="px-2 py-1 text-ink-faint">
          Cancel
        </button>
      </div>
    </div>
  );
}

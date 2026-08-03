import Link from 'next/link';
import { DisconnectButton, SyncNowButton } from '@/components/sync-controls';
import { requireOperator } from '@/lib/auth';
import { formatDateTime, formatRelative } from '@/lib/format';
import { getGoogleConnection, getRecentSyncRuns, getReviewQueueDepth, getSyncStatus } from '@/lib/queries';
import { syncConfig } from '@/lib/sync/config';
import { CALENDAR_SCOPE, GMAIL_SCOPE } from '@/lib/sync/google/provider';

export const metadata = { title: 'Sync' };

/**
 * Whether sync is working, and what it did.
 *
 * A background job with no surface is a job nobody trusts. The three questions
 * this answers, in the order they get asked: is it connected, did it run, and
 * what did it write. `v_sync_status` returns a row per channel whether or not
 * it has ever run, so "Calendar has never synced" is visible rather than being
 * an absent row nobody notices.
 */
export default async function SyncPage() {
  await requireOperator();

  const config = syncConfig();
  const [channels, runs, connection, reviewDepth] = await Promise.all([
    getSyncStatus(),
    getRecentSyncRuns(),
    getGoogleConnection(),
    getReviewQueueDepth(),
  ]);

  const google = config.ok ? config.config.google : null;
  const usingFixtures = google === null;

  return (
    <main className="py-6">
      <header className="mb-5 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Sync</h1>
          <p className="mt-1 text-sm text-ink-soft">Gmail and Calendar, into the timeline.</p>
        </div>
        {reviewDepth > 0 ? (
          <Link href="/review" className="btn-primary px-3 py-2 text-sm">
            {reviewDepth} to review
          </Link>
        ) : (
          <Link href="/review" className="btn px-3 py-2 text-sm">
            Review queue
          </Link>
        )}
      </header>

      {/* The most important thing on the page when it applies. A green run
          against invented data must never read as a green run against the real
          mailbox. */}
      {usingFixtures ? (
        <div className="card mb-4 border-warn/40 bg-warn/5 p-4">
          <p className="text-sm font-medium">Running against fixture data.</p>
          <p className="mt-1 text-sm text-ink-soft">
            No Google OAuth app is configured, so sync is replaying canned messages from{' '}
            <code className="font-mono text-xs">src/lib/sync/google/fixtures/</code>. Every screen
            below is real; the mail is not. Set <code className="font-mono text-xs">GOOGLE_CLIENT_ID</code>,{' '}
            <code className="font-mono text-xs">GOOGLE_CLIENT_SECRET</code> and{' '}
            <code className="font-mono text-xs">GOOGLE_REDIRECT_URI</code> in{' '}
            <code className="font-mono text-xs">.env.local</code> to connect a real account.
          </p>
        </div>
      ) : null}

      {!config.ok ? (
        <div className="card mb-4 border-overdue/40 bg-overdue/5 p-4">
          <p className="text-sm font-medium">Sync is refusing to run.</p>
          <p className="mt-1 text-sm text-ink-soft">{config.detail}</p>
        </div>
      ) : null}

      {/* Connection */}
      <section className="card mb-4 p-4">
        <h2 className="text-sm font-semibold">Google account</h2>

        {connection ? (
          <>
            <div className="mt-2 flex flex-wrap items-baseline gap-x-3">
              <span className="text-sm">{connection.account_email}</span>
              <span className="text-xs text-ink-faint">
                connected {formatRelative(connection.connected_at)}
              </span>
              <span className="ml-auto">
                <DisconnectButton accountEmail={connection.account_email} />
              </span>
            </div>

            {/* Scopes are shown because Google's consent screen lets someone
                grant one and not the other, and the symptom of a missing scope
                is a channel that fails every hour with a 403. */}
            <ul className="mt-2 space-y-0.5 text-xs">
              <ScopeRow label="Gmail (read-only)" granted={connection.scopes.includes(GMAIL_SCOPE)} />
              <ScopeRow
                label="Calendar (read-only)"
                granted={connection.scopes.includes(CALENDAR_SCOPE)}
              />
            </ul>

            {connection.last_refresh_error ? (
              <p className="mt-2 text-xs text-overdue">
                Last token refresh failed: {connection.last_refresh_error}
              </p>
            ) : null}
          </>
        ) : usingFixtures ? (
          <p className="mt-2 text-sm text-ink-soft">
            Not applicable while running on fixtures.
          </p>
        ) : (
          <div className="mt-2">
            <p className="text-sm text-ink-soft">
              No account connected. Sync reads mail and calendar read-only, and never writes to
              Google.
            </p>
            <a href="/api/google/connect" className="btn-primary mt-3 inline-flex px-3 py-2 text-sm">
              Connect Google
            </a>
          </div>
        )}
      </section>

      {/* Channels */}
      <section className="mb-4 grid gap-3 sm:grid-cols-2">
        {channels.map((channel) => {
          const counts = (channel.last_run_counts ?? {}) as Record<string, number>;
          const written = (counts.inserted ?? 0) + (counts.superseded ?? 0);

          return (
            <div key={channel.channel} className="card p-4">
              <div className="flex items-baseline gap-2">
                <h2 className="text-sm font-semibold">{channel.label}</h2>
                <StatusDot channel={channel} />
                {channel.last_run_provider === 'fixture' ? (
                  <span className="rounded-full border border-line px-1.5 py-px text-[10px] text-ink-faint">
                    fixture
                  </span>
                ) : null}
              </div>

              <p className="mt-1 text-sm text-ink-soft">
                {channel.never_run
                  ? 'Never run.'
                  : channel.in_flight
                    ? 'Running now.'
                    : channel.last_success_at
                      ? `Last succeeded ${formatRelative(channel.last_success_at)}.`
                      : 'Has run, but never succeeded.'}
              </p>

              {!channel.never_run && !channel.in_flight ? (
                <p className="mt-1 text-xs text-ink-faint">
                  {written} written · {counts.unchanged ?? 0} unchanged · {counts.staged ?? 0} to
                  review
                </p>
              ) : null}

              {channel.last_run_error ? (
                <p className="mt-2 text-xs text-overdue">{channel.last_run_error}</p>
              ) : null}

              <div className="mt-3">
                <SyncNowButton
                  channel={channel.channel as 'gmail' | 'gcal'}
                  label={channel.label}
                />
              </div>
            </div>
          );
        })}
      </section>

      {/* History */}
      <section className="card p-4">
        <h2 className="text-sm font-semibold">Recent runs</h2>
        {runs.length === 0 ? (
          <p className="mt-2 text-sm text-ink-soft">Nothing has run yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-line text-sm">
            {runs.map((run) => {
              const counts = (run.counts ?? {}) as Record<string, number>;
              return (
                <li key={run.id} className="flex flex-wrap items-baseline gap-x-2 py-2">
                  <span className="font-mono text-xs text-ink-faint">
                    {run.channel === 'gmail' ? 'gmail' : 'gcal '}
                  </span>
                  <span
                    className={
                      run.status === 'ok'
                        ? 'text-ink'
                        : run.status === 'running'
                          ? 'text-warn'
                          : 'text-overdue'
                    }
                  >
                    {run.status}
                  </span>
                  {run.provider_kind === 'fixture' ? (
                    <span className="text-[10px] text-ink-faint">fixture</span>
                  ) : null}
                  <span className="text-xs text-ink-faint">
                    {(counts.inserted ?? 0) + (counts.superseded ?? 0)} written
                  </span>
                  {run.error ? <span className="text-xs text-overdue">{run.error}</span> : null}
                  <span className="ml-auto text-xs text-ink-faint">
                    {formatDateTime(run.started_at)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}

function ScopeRow({ label, granted }: { label: string; granted: boolean }) {
  return (
    <li className={granted ? 'text-ink-soft' : 'text-overdue'}>
      {granted ? '✓' : '✗'} {label}
      {granted ? null : ' — not granted, so this channel cannot run'}
    </li>
  );
}

function StatusDot({
  channel,
}: {
  channel: { never_run: boolean; in_flight: boolean; is_stale: boolean | null; last_run_status: string | null };
}) {
  const tone = channel.never_run
    ? 'bg-line'
    : channel.in_flight
      ? 'bg-warn'
      : channel.last_run_status === 'error'
        ? 'bg-overdue'
        : channel.is_stale
          ? 'bg-warn'
          : 'bg-accent';

  const title = channel.never_run
    ? 'Never run'
    : channel.in_flight
      ? 'Running'
      : channel.last_run_status === 'error'
        ? 'Last run failed'
        : channel.is_stale
          ? 'No successful run in the last six hours'
          : 'Healthy';

  return <span className={`h-2 w-2 rounded-full ${tone}`} title={title} aria-label={title} />;
}

'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { changeTier, snoozePerson } from '@/lib/actions/people';
import { contactedToday, logAttempt } from '@/lib/actions/touchpoints';
import { saveFollowup, saveNote } from '@/lib/actions/records';
import { TIER_VALUES, type Tier } from '@/lib/db/enums';
import { tierTextClass } from '@/lib/format';

type Panel = 'none' | 'contacted' | 'attempt' | 'note' | 'followup';

/**
 * The actions bar on person detail.
 *
 * The watchlist variant offers "log an attempt" rather than "contacted today",
 * and the difference is not cosmetic: logging an attempt writes an outbound
 * touchpoint that deliberately does not promote the record. That is the
 * Colorado Springs case — an unanswered message is evidence you tried, not
 * evidence of a relationship.
 */
export function PersonActions({
  personId,
  isWatchlist,
  currentTier,
  doNotContact,
}: {
  personId: string;
  isWatchlist: boolean;
  currentTier: Tier;
  doNotContact: boolean;
}) {
  const router = useRouter();
  const [panel, setPanel] = useState<Panel>('none');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(action: (fd: FormData) => Promise<{ ok: boolean; error?: string }>, fd: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await action(fd);
      if (!result.ok) setError(result.error ?? 'Something went wrong.');
      else {
        setPanel('none');
        router.refresh();
      }
    });
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {isWatchlist ? (
          <>
            <button type="button" onClick={() => setPanel(panel === 'attempt' ? 'none' : 'attempt')} className="btn px-3 py-2 text-sm">
              Log an attempt
            </button>
            <button
              type="button"
              onClick={() => setPanel(panel === 'contacted' ? 'none' : 'contacted')}
              className="btn-primary px-3 py-2 text-sm"
            >
              Log first contact
            </button>
          </>
        ) : (
          <button
            type="button"
            disabled={doNotContact}
            onClick={() => setPanel(panel === 'contacted' ? 'none' : 'contacted')}
            className="btn-primary px-3 py-2 text-sm"
            title={doNotContact ? 'This person asked not to be contacted.' : undefined}
          >
            Contacted today
          </button>
        )}

        <button type="button" onClick={() => setPanel(panel === 'note' ? 'none' : 'note')} className="btn px-3 py-2 text-sm">
          Add note
        </button>
        <button type="button" onClick={() => setPanel(panel === 'followup' ? 'none' : 'followup')} className="btn px-3 py-2 text-sm">
          Add follow-up
        </button>

        {!isWatchlist ? (
          <>
            <details className="relative">
              <summary className="btn cursor-pointer list-none px-3 py-2 text-sm">Snooze</summary>
              <div className="card absolute z-10 mt-1 flex gap-1 p-1 shadow-lg">
                {[30, 60, 90].map((days) => (
                  <button
                    key={days}
                    type="button"
                    disabled={pending}
                    onClick={() => {
                      const fd = new FormData();
                      fd.set('person_id', personId);
                      fd.set('days', String(days));
                      run(snoozePerson, fd);
                    }}
                    className="btn px-2 py-1 text-xs"
                  >
                    {days}d
                  </button>
                ))}
              </div>
            </details>

            <details className="relative">
              <summary className="btn cursor-pointer list-none px-3 py-2 text-sm">Tier</summary>
              <div className="card absolute z-10 mt-1 flex gap-1 p-1 shadow-lg">
                {TIER_VALUES.map((tier) => (
                  <button
                    key={tier}
                    type="button"
                    disabled={pending || tier === currentTier}
                    onClick={() => {
                      const fd = new FormData();
                      fd.set('person_id', personId);
                      fd.set('tier', tier);
                      run(changeTier, fd);
                    }}
                    className={`btn px-2 py-1 font-mono text-xs ${tierTextClass(tier)} disabled:opacity-40`}
                  >
                    {tier}
                  </button>
                ))}
              </div>
            </details>
          </>
        ) : null}
      </div>

      {error ? (
        <p className="mt-2 text-xs text-overdue" role="alert">
          {error}
        </p>
      ) : null}

      {panel === 'contacted' ? (
        <form
          action={(fd) => {
            fd.set('person_id', personId);
            run(contactedToday, fd);
          }}
          className="card mt-3 space-y-2 p-3"
        >
          <div className="grid grid-cols-2 gap-2">
            <label className="text-sm">
              <span className="label">Channel</span>
              <select name="channel" defaultValue={isWatchlist ? 'meeting' : 'call'} className="field">
                {['call', 'meeting', 'email', 'text', 'event', 'other'].map((channel) => (
                  <option key={channel} value={channel}>
                    {channel}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-end gap-2 pb-2 text-sm">
              <input type="checkbox" name="substantive" defaultChecked />
              <span>Substantive</span>
            </label>
          </div>
          <textarea name="summary" rows={2} className="field" placeholder="What did you discuss? (optional)" />
          {isWatchlist ? (
            <p className="text-xs text-ink-faint">
              This is two-way contact, so it promotes them off the watchlist.
            </p>
          ) : null}
          <button type="submit" disabled={pending} className="btn-primary px-3 py-1.5 text-sm">
            {pending ? 'Saving…' : 'Log it'}
          </button>
        </form>
      ) : null}

      {panel === 'attempt' ? (
        <form
          action={(fd) => {
            fd.set('person_id', personId);
            run(logAttempt, fd);
          }}
          className="card mt-3 space-y-2 p-3"
        >
          <label className="block text-sm">
            <span className="label">Channel</span>
            <select name="channel" defaultValue="linkedin" className="field">
              {['linkedin', 'email', 'call', 'text', 'mail', 'social', 'other'].map((channel) => (
                <option key={channel} value={channel}>
                  {channel}
                </option>
              ))}
            </select>
          </label>
          <textarea name="summary" rows={2} className="field" placeholder="What did you send?" />
          <p className="text-xs text-ink-faint">
            An outbound attempt goes on the record and changes nothing else. They stay on the
            watchlist until they reply.
          </p>
          <button type="submit" disabled={pending} className="btn-primary px-3 py-1.5 text-sm">
            {pending ? 'Saving…' : 'Log attempt'}
          </button>
        </form>
      ) : null}

      {panel === 'note' ? (
        <form
          action={(fd) => {
            fd.set('person_id', personId);
            run(saveNote, fd);
          }}
          className="card mt-3 space-y-2 p-3"
        >
          <div className="grid grid-cols-2 gap-2">
            <label className="text-sm">
              <span className="label">Category</span>
              <select name="category" defaultValue="professional" className="field">
                {['professional', 'personal', 'preference', 'warning', 'mutual_interest', 'compliance'].map(
                  (category) => (
                    <option key={category} value={category}>
                      {category.replace('_', ' ')}
                    </option>
                  ),
                )}
              </select>
            </label>
            <label className="flex items-end gap-2 pb-2 text-sm">
              <input type="checkbox" name="is_pinned" />
              <span>Pin</span>
            </label>
          </div>
          <textarea
            name="body"
            rows={2}
            required
            className="field"
            placeholder="A durable fact — a preference, a constraint, a warning."
          />
          <button type="submit" disabled={pending} className="btn-primary px-3 py-1.5 text-sm">
            {pending ? 'Saving…' : 'Save note'}
          </button>
        </form>
      ) : null}

      {panel === 'followup' ? (
        <form
          action={(fd) => {
            fd.set('person_id', personId);
            run(saveFollowup, fd);
          }}
          className="card mt-3 space-y-2 p-3"
        >
          <input name="title" required className="field" placeholder="What needs doing?" />
          <input
            name="due_on"
            type="date"
            required
            defaultValue={new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10)}
            className="field"
          />
          <button type="submit" disabled={pending} className="btn-primary px-3 py-1.5 text-sm">
            {pending ? 'Saving…' : 'Save follow-up'}
          </button>
        </form>
      ) : null}
    </div>
  );
}

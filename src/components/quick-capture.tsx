'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useTransition,
} from 'react';
import { commitCapture, draftCapture, type CaptureCandidate } from '@/lib/actions/capture';
import { globalSearch, type SearchHit } from '@/lib/actions/search';
import { CAPTURE_CHANNELS, CAPTURE_DIRECTIONS, type CaptureDraft } from '@/lib/capture/shape';
import { enqueueCapture, initOfflineSupport } from '@/lib/offline-queue';
import { humanize, tierTextClass } from '@/lib/format';

type Mode = 'closed' | 'capture' | 'search';

type QuickCaptureApi = {
  openCapture: () => void;
  openSearch: () => void;
  close: () => void;
};

const QuickCaptureContext = createContext<QuickCaptureApi>({
  openCapture: () => {},
  openSearch: () => {},
  close: () => {},
});

export const useQuickCapture = () => useContext(QuickCaptureContext);

export function QuickCaptureProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<Mode>('closed');
  const [flushNotice, setFlushNotice] = useState<string | null>(null);

  const openCapture = useCallback(() => setMode('capture'), []);
  const openSearch = useCallback(() => setMode('search'), []);
  const close = useCallback(() => setMode('closed'), []);

  useEffect(() => {
    return initOfflineSupport((result) => {
      if (result.sent > 0) {
        setFlushNotice(
          `${result.sent} offline ${result.sent === 1 ? 'capture' : 'captures'} synced — review them in quick capture.`,
        );
        setTimeout(() => setFlushNotice(null), 8000);
      }
    });
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const meta = event.metaKey || event.ctrlKey;
      if (meta && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setMode('search');
      } else if (meta && event.key.toLowerCase() === 'j') {
        event.preventDefault();
        setMode('capture');
      } else if (event.key === 'Escape') {
        setMode('closed');
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <QuickCaptureContext.Provider value={{ openCapture, openSearch, close }}>
      {children}

      {flushNotice ? (
        <div
          role="status"
          className="card fixed bottom-20 left-1/2 z-50 -translate-x-1/2 px-4 py-2 text-sm shadow-lg sm:bottom-6"
        >
          {flushNotice}
        </div>
      ) : null}

      {mode !== 'closed' ? (
        <Overlay onClose={close}>
          {mode === 'capture' ? <CapturePanel onClose={close} /> : <SearchPanel onClose={close} />}
        </Overlay>
      ) : null}
    </QuickCaptureContext.Provider>
  );
}

function Overlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[8vh] backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="card w-full max-w-xl overflow-hidden shadow-2xl">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Quick capture
// ---------------------------------------------------------------------------

type Step = 'input' | 'confirm' | 'done';

function CapturePanel({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>('input');
  const [text, setText] = useState('');
  const [draft, setDraft] = useState<CaptureDraft | null>(null);
  const [candidates, setCandidates] = useState<CaptureCandidate[]>([]);
  const [selectedPersonId, setSelectedPersonId] = useState<string>('');
  const [parseError, setParseError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [queuedOffline, setQueuedOffline] = useState(false);
  const [savedPersonId, setSavedPersonId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function submitText() {
    const trimmed = text.trim();
    if (!trimmed) return;
    setError(null);

    // Offline: bank it locally and stop. The operator's note is safe and the
    // reconnect handler replays it into review.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      void enqueueCapture({ text: trimmed, capturedAt: new Date().toISOString() })
        .then(() => {
          setQueuedOffline(true);
          setStep('done');
        })
        .catch(() => setError('Could not save offline. Copy the text before closing.'));
      return;
    }

    startTransition(async () => {
      const result = await draftCapture(trimmed);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setDraft(result.data.draft);
      setCandidates(result.data.candidates);
      setParseError(result.data.parseError);
      setSelectedPersonId(result.data.candidates[0]?.id ?? '');
      setStep('confirm');
    });
  }

  function save(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await commitCapture(formData);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSavedPersonId(result.data.personId);
      setStep('done');
      router.refresh();
    });
  }

  if (step === 'done') {
    return (
      <div className="p-6 text-center">
        <p className="font-medium">
          {queuedOffline ? 'Saved offline.' : 'Captured.'}
        </p>
        <p className="mt-1 text-sm text-ink-soft">
          {queuedOffline
            ? 'It will sync and appear for review when you are back online.'
            : 'The touchpoint is on the record.'}
        </p>
        <div className="mt-4 flex justify-center gap-2">
          {savedPersonId ? (
            <Link href={`/person/${savedPersonId}`} onClick={onClose} className="btn-primary px-3 py-2 text-sm">
              Open record
            </Link>
          ) : null}
          <button
            type="button"
            onClick={() => {
              setStep('input');
              setText('');
              setDraft(null);
              setSavedPersonId(null);
              setQueuedOffline(false);
            }}
            className="btn px-3 py-2 text-sm"
          >
            Capture another
          </button>
          <button type="button" onClick={onClose} className="btn px-3 py-2 text-sm">
            Done
          </button>
        </div>
      </div>
    );
  }

  if (step === 'input') {
    return (
      <div className="p-4">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold">Quick capture</h2>
          <span className="text-xs text-ink-faint">Cmd+Enter to parse</span>
        </div>

        <textarea
          ref={inputRef}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              event.preventDefault();
              submitText();
            }
          }}
          rows={4}
          className="field resize-none"
          placeholder="Called Nina Okafor at Verdant — walked through their AR ageing, real facility opportunity in Q2. She only takes calls Tuesdays."
        />

        {error ? (
          <p className="mt-2 text-xs text-overdue" role="alert">
            {error}
          </p>
        ) : null}

        <div className="mt-3 flex items-center justify-between">
          <Link href="/watchlist/new" onClick={onClose} className="text-xs text-accent hover:underline">
            Add to watchlist instead →
          </Link>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="btn px-3 py-1.5 text-sm">
              Cancel
            </button>
            <button
              type="button"
              onClick={submitText}
              disabled={pending || text.trim() === ''}
              className="btn-primary px-3 py-1.5 text-sm"
            >
              {pending ? 'Reading…' : 'Parse'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <form action={save} className="max-h-[75vh] overflow-y-auto p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold">Confirm</h2>
        {draft?.confidence && draft.confidence !== 'high' ? (
          <span className="text-xs text-warn">Low confidence — check the fields</span>
        ) : null}
      </div>

      {parseError ? (
        <p className="mb-3 rounded-md border border-line bg-accent-soft/40 px-3 py-2 text-xs">
          {parseError} Your text is in the summary below.
        </p>
      ) : null}

      {candidates.length > 0 ? (
        <fieldset className="mb-3">
          <legend className="label">Who is this?</legend>
          <div className="space-y-1">
            {candidates.map((candidate) => (
              <label key={candidate.id} className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="person_id"
                  value={candidate.id}
                  checked={selectedPersonId === candidate.id}
                  onChange={() => setSelectedPersonId(candidate.id)}
                />
                <span className="font-medium">{candidate.fullName}</span>
                {candidate.organizationName ? (
                  <span className="text-ink-soft">{candidate.organizationName}</span>
                ) : null}
                {candidate.contactStatus === 'uncontacted' ? (
                  <span className="text-xs text-warn">on watchlist</span>
                ) : (
                  <span className={`font-mono text-xs ${tierTextClass(candidate.tier as never)}`}>
                    {candidate.tier}
                  </span>
                )}
              </label>
            ))}
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="radio"
                name="person_id"
                value=""
                checked={selectedPersonId === ''}
                onChange={() => setSelectedPersonId('')}
              />
              <span>Someone new</span>
            </label>
          </div>
        </fieldset>
      ) : (
        <input type="hidden" name="person_id" value="" />
      )}

      {selectedPersonId === '' ? (
        <div className="mb-3 grid grid-cols-2 gap-2">
          <Field name="first_name" label="First name" defaultValue={draft?.first_name} required />
          <Field name="last_name" label="Last name" defaultValue={draft?.last_name} />
          <Field name="organization_name" label="Organization" defaultValue={draft?.organization_name} />
          <Field name="position" label="Position" defaultValue={draft?.position} />
          <Field name="city" label="City" defaultValue={draft?.city} />
          <Field name="email_work" label="Email" type="email" />
        </div>
      ) : null}

      <div className="mb-3 grid grid-cols-2 gap-2">
        <div>
          <label className="label" htmlFor="capture-channel">
            Channel
          </label>
          <select
            id="capture-channel"
            name="channel"
            defaultValue={draft?.channel ?? 'call'}
            className="field"
          >
            {CAPTURE_CHANNELS.map((channel) => (
              <option key={channel} value={channel}>
                {humanize(channel)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="capture-direction">
            Direction
          </label>
          <select
            id="capture-direction"
            name="direction"
            defaultValue={draft?.direction ?? 'mutual'}
            className="field"
          >
            {CAPTURE_DIRECTIONS.map((direction) => (
              <option key={direction} value={direction}>
                {humanize(direction)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <label className="mb-3 flex items-center gap-2 text-sm">
        <input type="checkbox" name="substantive" defaultChecked={draft?.substantive ?? true} />
        <span>
          Substantive
          <span className="ml-1 text-xs text-ink-faint">— resets the cadence clock</span>
        </span>
      </label>

      <div className="mb-3">
        <label className="label" htmlFor="capture-summary">
          What happened
        </label>
        <textarea
          id="capture-summary"
          name="summary"
          defaultValue={draft?.summary}
          rows={2}
          className="field resize-none"
        />
      </div>

      <div className="mb-3">
        <label className="label" htmlFor="capture-note">
          Durable note <span className="normal-case">(optional)</span>
        </label>
        <input id="capture-note" name="note" defaultValue={draft?.note} className="field" />
      </div>

      <div className="mb-4 grid grid-cols-[1fr_auto] gap-2">
        <Field name="followup_title" label="Follow-up (optional)" defaultValue={draft?.followup_title} />
        <Field name="followup_due_on" label="Due" type="date" defaultValue={draft?.followup_due_on} />
      </div>

      {error ? (
        <p className="mb-2 text-xs text-overdue" role="alert">
          {error}
        </p>
      ) : null}

      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => setStep('input')} className="btn px-3 py-1.5 text-sm">
          Back
        </button>
        <button type="submit" disabled={pending} className="btn-primary px-3 py-1.5 text-sm">
          {pending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  );
}

function Field({
  name,
  label,
  defaultValue,
  type = 'text',
  required,
}: {
  name: string;
  label: string;
  defaultValue?: string;
  type?: string;
  required?: boolean;
}) {
  return (
    <div>
      <label className="label" htmlFor={`capture-${name}`}>
        {label}
      </label>
      <input
        id={`capture-${name}`}
        name={name}
        type={type}
        defaultValue={defaultValue}
        required={required}
        className="field"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

const MATCH_LABEL: Record<SearchHit['matchedOn'], string> = {
  name: 'name',
  organization: 'organization',
  specialty: 'specialty',
  note: 'note',
  watchlist_reason: 'watchlist',
  touchpoint: 'conversation',
};

function SearchPanel({ onClose }: { onClose: () => void }) {
  const [term, setTerm] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [active, setActive] = useState(0);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (term.trim().length < 2) {
      setHits([]);
      return;
    }
    // Debounced: the operator types faster than a round trip.
    const timer = setTimeout(() => {
      startTransition(async () => {
        setHits(await globalSearch(term));
        setActive(0);
      });
    }, 180);
    return () => clearTimeout(timer);
  }, [term]);

  function open(hit: SearchHit) {
    onClose();
    router.push(`/person/${hit.personId}`);
  }

  return (
    <div>
      <input
        ref={inputRef}
        value={term}
        onChange={(event) => setTerm(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setActive((i) => Math.min(i + 1, hits.length - 1));
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActive((i) => Math.max(i - 1, 0));
          } else if (event.key === 'Enter' && hits[active]) {
            event.preventDefault();
            open(hits[active]);
          }
        }}
        className="w-full border-b border-line bg-transparent px-4 py-3.5 text-base outline-none placeholder:text-ink-faint"
        placeholder="Search names, notes, conversations, watchlist reasons…"
      />

      <div className="max-h-[55vh] overflow-y-auto">
        {term.trim().length < 2 ? (
          <p className="px-4 py-6 text-center text-sm text-ink-faint">
            Search across everything — including what you wrote about people.
          </p>
        ) : hits.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-ink-faint">
            {pending ? 'Searching…' : 'Nothing found.'}
          </p>
        ) : (
          <ul>
            {hits.map((hit, index) => (
              <li key={`${hit.personId}-${hit.matchedOn}`}>
                <button
                  type="button"
                  onMouseEnter={() => setActive(index)}
                  onClick={() => open(hit)}
                  className={`w-full px-4 py-2.5 text-left ${index === active ? 'bg-accent-soft' : ''}`}
                >
                  <div className="flex items-baseline gap-2">
                    <span className="text-sm font-medium">{hit.fullName}</span>
                    {hit.subtitle ? (
                      <span className="text-xs text-ink-soft">{hit.subtitle}</span>
                    ) : null}
                    <span className="ml-auto text-[10px] tracking-wide text-ink-faint uppercase">
                      {MATCH_LABEL[hit.matchedOn]}
                    </span>
                  </div>
                  {hit.excerpt ? (
                    <p className="mt-0.5 line-clamp-2 text-xs text-ink-faint">{hit.excerpt}</p>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

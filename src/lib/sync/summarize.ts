import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
// zod/v4 rather than the classic namespace, matching lib/capture/parse.ts: the
// SDK's zodOutputFormat helper is typed against Zod 4's internals.
import { z } from 'zod/v4';
import type { ThreadDay } from './rollup';

/**
 * What a day of email says, in two sentences.
 *
 * The message body is never fetched — `live.ts` requests `format=metadata`, so
 * Gmail does not return one — which means everything here is built from the
 * subject line and Google's own ~200-character snippet. That is a real
 * constraint and worth stating plainly: the summary describes the opening of a
 * conversation, not its conclusion. A thread whose subject is "Quick question"
 * and whose snippet is "Do you have five minutes Thursday?" will summarize as
 * a request for time, even if what actually happened over the next eleven
 * messages was a term sheet.
 *
 * That is the deliberate trade. The alternative is holding the operator's
 * correspondence in a rolodex, and a database of private notes about people is
 * already the most sensitive thing this system owns without adding the contents
 * of every conversation to it. The Gmail permalink is stored instead, so the
 * real thread is one click away from the timeline for anyone who needs it.
 *
 * The second output matters more than the first. `substantive` decides whether
 * the day resets a cadence clock (v_person_recency runs next_due_at from the
 * last substantive touch) and whether it counts toward the Active rung of the
 * development ladder. Marking scheduling chatter substantive would quietly
 * convince the queue that a decaying relationship is being maintained — which
 * is the single failure this whole system exists to prevent.
 */

const THREAD_SUMMARY = z.object({
  summary: z
    .string()
    .describe(
      'At most two sentences, past tense, in the operator\'s own voice, describing what this ' +
        'exchange was about. No preamble. Empty string if the subject and snippets say nothing ' +
        'worth recording.',
    ),
  substantive: z
    .boolean()
    .describe(
      'True only when the exchange carried real content — a deal, a referral, a decision, a ' +
        'specific problem. Scheduling, acknowledgements, forwards and pleasantries are false.',
    ),
});

export type ThreadSummary = z.infer<typeof THREAD_SUMMARY>;

const SYSTEM_PROMPT = `You are summarizing one day of an email thread for a private relationship record
kept by the principal of a small investment firm. He will read your summary months later, on the way
into a call with this person, to remember what they last talked about.

You are given the subject line and short extracts. You are NOT given the message bodies, and you will
not be. Work only from what you have.

Rules, in order of importance:

1. Never state anything the subject and extracts do not support. If they are too thin to say what
   happened, return an empty summary. An empty summary is correct and expected; the permalink is
   stored alongside it and he can open the real thread. An invented detail about a deal is a defect
   of a different order — this record is what he trusts instead of his memory.

2. substantive means the exchange had content worth remembering later: a deal, a referral, an
   introduction, a decision, a specific business problem, a commitment. Set it false for scheduling
   ("does Thursday work"), acknowledgements ("thanks, got it"), forwards with no comment, out-of-office
   replies, and anything you cannot tell apart from those. False is the safe answer and the right one
   when you are unsure — this flag decides whether the system believes the relationship is being
   maintained, and a wrong true means it stops reminding him about someone who has gone quiet.

3. Two sentences at most, usually one. Write it the way he would write it to himself: "Asked whether
   Nordic writes US receivables directly; he does, through a New York branch since March." Not "The
   user and Henrik discussed..." and not "This email thread concerns...".

4. Direction is given to you. An outbound-only day is something he sent and nobody answered — say so
   plainly if that is what it is, and do not imply a reply that is not there.`;

export type SummaryResult =
  | { ok: true; summary: ThreadSummary }
  | { ok: false; reason: 'not_configured' | 'refused' | 'failed'; error: string };

/**
 * The no-key path, and the failure path, are the same path.
 *
 * Sync must not depend on the LLM. ANTHROPIC_API_KEY is optional throughout
 * this project — `npm run doctor` reports it as a warning, not a failure — and
 * a rate limit at 3am must not stop a night's mail from being recorded. So a
 * failed or absent summarizer degrades to the subject line, which is worse but
 * entirely usable, rather than dropping the touchpoint.
 *
 * substantive is false in the fallback, always. The flag drives cadence, and
 * defaulting it true because the model was unavailable would mean an outage
 * silently told the queue that every relationship touched that night was being
 * maintained. Under-reporting is recoverable — the operator logs a substantive
 * touchpoint by hand. Over-reporting hides someone until they are gone.
 */
export function fallbackSummary(day: ThreadDay): ThreadSummary {
  return { summary: day.subject.trim(), substantive: false };
}

export async function summarizeThreadDay(day: ThreadDay): Promise<SummaryResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      ok: false,
      reason: 'not_configured',
      error: 'ANTHROPIC_API_KEY is not set; synced touchpoints keep the subject line instead.',
    };
  }

  const client = new Anthropic({ apiKey });

  try {
    const response = await client.messages.parse({
      model: 'claude-opus-5',
      // Generous relative to the output, which is two sentences. On Opus 5
      // thinking is on by default and max_tokens caps thinking *plus* response
      // together, so sizing this to the visible answer would truncate it.
      max_tokens: 8000,
      system: [
        {
          type: 'text',
          text: SYSTEM_PROMPT,
          // Identical across every thread-day in a run, so it is worth caching
          // — a night's sync can be dozens of calls behind the same prefix.
          // Opus 5's minimum cacheable prefix is 512 tokens; below that this is
          // silently a no-op rather than an error, which is the right failure
          // mode for an optimization.
          cache_control: { type: 'ephemeral' },
        },
      ],
      output_config: {
        // A short, well-specified judgement. Higher effort buys nothing here and
        // this runs once per thread-day, so the cost multiplies.
        effort: 'low',
        format: zodOutputFormat(THREAD_SUMMARY),
      },
      messages: [{ role: 'user', content: renderPrompt(day) }],
    });

    if (response.stop_reason === 'refusal') {
      return { ok: false, reason: 'refused', error: 'The model declined to summarize that thread.' };
    }

    const parsed = response.parsed_output;
    if (!parsed) {
      return { ok: false, reason: 'failed', error: 'No structured output came back.' };
    }

    return { ok: true, summary: normalize(parsed) };
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) {
      return { ok: false, reason: 'failed', error: 'Rate limited.' };
    }
    if (error instanceof Anthropic.APIError) {
      return { ok: false, reason: 'failed', error: `Summarization failed (${error.status}).` };
    }
    return { ok: false, reason: 'failed', error: 'Summarization failed.' };
  }
}

function renderPrompt(day: ThreadDay): string {
  const direction =
    day.direction === 'mutual'
      ? 'Both sides wrote on this day.'
      : day.direction === 'inbound'
        ? 'They wrote; the operator did not reply on this day.'
        : 'The operator wrote; there was no reply on this day.';

  return [
    `Subject: ${day.subject || '(none)'}`,
    `Date: ${day.localDate}`,
    `Correspondent: ${day.displayName ? `${day.displayName} <${day.address}>` : day.address}`,
    `Messages that day: ${day.messageIds.length}`,
    direction,
    '',
    'Extracts, oldest first:',
    ...(day.snippets.length > 0 ? day.snippets.map((snippet) => `- ${snippet}`) : ['- (none)']),
  ].join('\n');
}

function normalize(summary: ThreadSummary): ThreadSummary {
  const text = summary.summary.trim();
  // Nothing worth saying means nothing was substantive. The model is asked for
  // this and mostly honours it; enforcing it here costs nothing and closes the
  // one combination that would be actively misleading.
  return { summary: text, substantive: text === '' ? false : summary.substantive };
}

/**
 * Summarizes a run's worth of thread-days.
 *
 * Bounded concurrency, and a hard ceiling on how many days get summarized at
 * all. Beyond the ceiling the rest fall back to their subject lines rather than
 * the run either stalling or spending without limit — a first sync over six
 * months of mail can produce several hundred thread-days, and there is no
 * version of that which should quietly become a large API bill overnight.
 *
 * If this ever needs to run at real volume, the Message Batches API is the
 * right answer — same model, half the token price, results within the hour,
 * which is well inside what a nightly cron can wait for. Kept synchronous here
 * because "Sync now" is a button the operator presses and watches.
 */
export async function summarizeAll(
  days: ThreadDay[],
  options: { concurrency?: number; max?: number } = {},
): Promise<Map<string, ThreadSummary>> {
  const concurrency = options.concurrency ?? 4;
  const max = options.max ?? 200;
  const results = new Map<string, ThreadSummary>();

  const queue = days.slice(0, max);
  const overflow = days.slice(max);
  for (const day of overflow) results.set(day.key, fallbackSummary(day));

  if (queue.length === 0) return results;

  // One probe first. If the key is missing or the model is unreachable, every
  // remaining call would fail the same way — there is no reason to make four
  // hundred of them to find that out.
  const probe = await summarizeThreadDay(queue[0]!);
  results.set(queue[0]!.key, probe.ok ? probe.summary : fallbackSummary(queue[0]!));

  if (!probe.ok && probe.reason === 'not_configured') {
    for (const day of queue.slice(1)) results.set(day.key, fallbackSummary(day));
    return results;
  }

  const remaining = queue.slice(1);
  const workers = Array.from({ length: Math.min(concurrency, remaining.length) }, async () => {
    for (;;) {
      const day = remaining.shift();
      if (!day) return;
      const result = await summarizeThreadDay(day);
      results.set(day.key, result.ok ? result.summary : fallbackSummary(day));
    }
  });

  await Promise.all(workers);
  return results;
}

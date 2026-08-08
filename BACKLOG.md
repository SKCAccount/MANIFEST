# MANIFEST — backlog

Ranked, with "done" stated per item. Bugs and next steps land here, not in
parting paragraphs. Established 2026-08-07 by the context session; the spec's
old Phase 4 (consent-gated mailing export) is **void**, not pending.

## Now

1. **Sign in on seaking — Derek, five minutes.** `npm run auth:set-password`
   (his own terminal; the script is TTY-only by design), then `npm run dev`
   and sign in at localhost:3000.
   *Why:* password sign-in has never succeeded on the deployed project
   (CLAUDE.md pitfall #1); everything else waits behind this.
   *Done:* the queue renders signed-in; `last_sign_in_at` on the auth user
   advances past 2026-06-20.

1a. **Apply migration 0023 on seaking — Derek, one paste.** The
   preferred-number column (2026-08-07 form nits). Paste the full contents of
   `supabase/migrations/0023_preferred_phone.sql` into the dashboard SQL
   editor (another browser if project pages render blank in Chrome), then
   record it: `insert into manifest.schema_migrations (version) values
   ('0023');` — if that insert errors, check the ledger's columns with
   `select * from manifest.schema_migrations limit 3;` and match them.
   Until applied, everything works except the Preferred choice isn't saved.
   *Done:* saving a person with a preference shows "— preferred" on their
   detail page.

2. **Enter the thirty most important relationships** — desktop, localhost,
   against seaking (decided 2026-08-07). Two paths on purpose: *Add a
   relationship* for someone already spoken to (needs the conversation that
   proves it); *Add to watchlist* for someone to meet (needs a written
   reason). Around the same time Derek sets `ANTHROPIC_API_KEY` in
   `.env.local` himself so quick capture can help (decision 19).
   *Done:* thirty real records; zero fixtures ever loaded on seaking.

3. **First judgment pass** — the SETUP.md step-10 table: queue usefulness,
   capture parse quality, a two-dimensional directory search, a warm-path
   suggestion, an attempt logged on a watchlist entry staying un-promoted.
   *Why:* these are the checks no test can make; they also produce the first
   real answers to the half-fix question (open question 4).
   *Done:* notes on what lied or annoyed, appended here.

## Next

4. **Google OAuth + first live sync** — strictly after the thirty (decision
   14). Create the OAuth app (SETUP.md §11), connect at `/sync`, then run
   `npm run sync` from a terminal and watch it. Treat it as a first run:
   `live.ts` has never received a real Google response — the Gmail history
   id, the Calendar sync token, and the `format=metadata` header set are the
   three places to expect surprises (README). Work `/review` down to empty.
   *Done:* both channels healthy in doctor; review queue empty; no wrong
   promotions (spot-check the watchlist survived).

5. **Suite S2 — the phone URL** (suite-side work, tracked here so no MANIFEST
   session is surprised). MANIFEST mounts at `/manifest` on the interim
   Netlify origin. This repo's share of it: the PWA re-scope checklist
   (suite-design §8.3 — `sw.js` path, `Service-Worker-Allowed` header,
   `start_url`, `scope`, both shortcut URLs, icon paths, `basePath` +
   `assetPrefix`), the two crons rewritten as Netlify scheduled functions
   (then delete `vercel.json`), and the `app_owners` self-row SELECT policy
   for the launcher (suite-design §4.3) as migration `0023+`.
   *Done:* Derek installs the PWA on his phone at the interim origin and the
   queue passes the hallway test there.

## Arc 4 — the proactive layer (the finish line)

"Finished enough" = these fire for real (Derek, 2026-08-07). Standing design
input, his words: "the learnings from the Gmail sync should be incorporated
into the proactive touchpoint suggestions" — the sync stream is nudge fuel,
not just history. Examples below are examples, not the full set.

6. **Introducer nudges.** Logging coffee with Steve (introduced by Julie)
   suggests reaching out to Julie, with an opener ("just got coffee with
   Steve…"). The introductions graph and auto-created intro rows already
   exist; the trigger-to-suggestion engine does not.
   *Done:* a logged touchpoint with an introducer in its lineage produces a
   suggestion Derek actually acts on.

7. **Content-to-audience matching.** A new Derek On Capital piece flags the
   contacts it fits — the reverse of today's per-person unsent-piece
   suggestion in the queue.
   *Done:* publishing a piece yields a shortlist he agrees with.

8. **Event ROI × deal dollars.** Compound the Sources ranking with deals from
   contacts met at each event: term-sheeted and funded counts and dollars.
   The primitives exist (deals carry `amount_cents` and stage; people carry
   the room they were met in); the event-level join is the work.
   *Done:* the Sources screen answers "which rooms produced funded deals,"
   at matched horizons like everything else.

9. **Deal attribution reshape.** From the pipeline-ish enum
   (referred/screening/diligence/docs/funded) to Derek's contact-usefulness
   funnel: **sent → term sheet issued (first quality test) → funded**, hit
   rate over volume — "a broker sending a ton of deals with zero that go to
   term sheet is not good." MANIFEST is not a deal-flow tracker; Kraken is.
   Decide the exact shape with the first real deal (CLAUDE.md open question
   1); migration `0023+` when it lands.
   *Done:* v_deal_sources speaks Derek's funnel, and entering a referred
   deal takes seconds.

10. **Value-score calibration.** The weights (30 funded / 20 intros / 15
    inbound / 15 substantive / 10 centrality / 10 favors / −8 reciprocity
    deficit) and tier bands (A ≥ 70, B ≥ 45, C ≥ 20) were set by a session,
    not by Derek. Review against real data once it exists; also decide
    whether "connections to capital" needs first-class scoring (open
    question 3).
    *Done:* Derek looks at the top-ten by value and agrees with the order.

## Before it ever happens

11. **Own-domains → own-addresses** — hard precondition of any second
    instance (Austin's). Both partners share seakingcapital.com;
    domain-grained direction would read colleague mail as the operator's own.
    Not urgent until a second instance is real; must land first (suite D11
    rider).

## Small

12. **Doctor copy bug:** against a hosted project with no Google config, the
    "Google connected" line says "n/a — running on fixtures"
    ([doctor.ts:303](scripts/doctor.ts)) — but hosted sync *refuses*; only
    local runs fixtures. The adjacent "Google OAuth app" line says it right.
    One-line fix.
13. Docs corrected 2026-08-07 by the context session: test count 324 → 325,
    LOCAL.md's edited-in-place note (forward-only since 2026-08-03), SETUP.md
    scratch-project banner, README "what is left" now points here. ✔ done

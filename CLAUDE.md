# MANIFEST — CLAUDE.md

Read this first, whole. It is what ambiguous requests get resolved against:
what the tool is for, what is settled, where it stands, how to work here.
[README.md](README.md) is the deep design record; this file is the map.
Written 2026-08-07 from the per-tool context session, with Derek's corrections.

---

## 1. What this is

Sea King Capital's deal flow runs on relationships — brokers, founders,
bankers, investors, mostly met in person. An unmanaged network decays by
accident: people go cold, follow-ups never happen, and nobody knows which
rooms were worth the money.

**MANIFEST is the system of record for Derek's professional network — and the
engine that works that network proactively.** It records everything: who
people are, what they do, how he knows them, when they last spoke, notes. It
says who matters most and whether he is keeping them close. And — the growth
direction, confirmed 2026-08-07 — it surfaces touchpoints he didn't think to
make: thank the introducer after the coffee their intro produced; send the new
Derek On Capital piece to the people it was practically written for. The
Gmail/Calendar stream feeds those suggestions (Derek: "the learnings from the
Gmail sync should be incorporated into the proactive touchpoint suggestions").

The primitives:

- A **person** is someone Derek has actually spoken to. A **watchlist entry**
  is someone he intends to meet, with a written reason. **Promotion requires
  two-way contact** — his own unanswered outreach never makes a relationship,
  and promotion does not undo.
- A **touchpoint** is one person, one channel, one operator-local day.
  Append-only; corrections supersede, never edit.
- A **source** is the room a relationship came from, with its cost. Rooms are
  ranked by what they produced — relationships that developed, and ultimately
  funded deals — at matched ages, never flattered by contact counts.
- **People are not commodities.** Relationship value (0–100) weighs funded
  deal dollars, intros received, inbound initiation, substantive contact,
  network centrality, favors. Tier (A–D) sets contact cadence; the queue is
  importance-weighted. People who bring real business are carefully managed so
  they never fall out of the loop.
- **Deals here are evidence about contacts, not a pipeline.** Kraken is the
  system of record for deals; MANIFEST records that a contact sent one,
  whether it reached a term sheet (the first test of quality), and whether it
  funded — because the question is "how useful has this contact been," and a
  broker with a high term-sheet hit rate on few deals beats one sending volume
  that goes nowhere. Value takes many forms: deal flow, referrals, connections
  to capital.

Every person, touchpoint, note, follow-up, introduction, favor, deal
attribution, event cost, and piece-of-content-sent flows through it. Nothing
here is a lead list, a CRM funnel, or a mailing list.

**Single operator: Derek, mostly on his phone.** Per-user by design — never
shared; a second person (Austin, someday) gets his own separate instance,
never a login to this one.

Derek is the founder, sole user, and a beginner developer. Favor explicit
clarity over cleverness. The tool is phone-first: judge every screen by the
ten-second hallway test — "who is overdue and what do I say."

### Vocabulary

| Say | Never | Because |
|---|---|---|
| person, relationship | lead, prospect | almost every record is someone he has actually spoken to |
| watchlist entry | pipeline, target list | intent to meet, with a written reason — not a funnel |
| touchpoint | activity, engagement | one person, one day, append-only |
| rolodex | CRM, campaign | no funnel, no bulk anything |
| deal attribution | deal tracking | Kraken tracks deals; MANIFEST scores the contact who sent them |
| operator | user(s) | there is exactly one |

---

## 2. Where it stands (2026-08-07, each point verified that day)

**Built, tested, deployed — never yet used.**

- Phases 0–3 complete: schema (24 migrations, all applied to seaking and
  recorded in the ledger as of 2026-08-08), the hand rolodex, Gmail and
  Calendar sync, event economics. 14 screens plus login and offline. **325
  tests pass** (`npm run ci`, run 2026-08-08 — needs no database, no Docker).
- Live on the combined **seaking** Supabase project (`oznvdznekexdgblmxwqr`)
  since 2026-08-03: `manifest` schema exposed, owner registered, 110 taxonomy
  values seeded, zero people. `npm run doctor` reads **Ready**.
- **Password sign-in has never succeeded on seaking.** `last_sign_in_at` on
  the sole auth user is 2026-06-20 — the email-confirm moment (re-verified
  2026-08-07 via the admin API). Derek has never gotten past the deployed
  login screen. The fix is his to run: `npm run auth:set-password` (TTY-only
  by design), then sign in at localhost:3000. Pitfall #1 tells the story.
- The app runs **locally only** (`npm run dev` against seaking). The web
  deploy happens at suite step **S2, on Netlify** (suite decision D15,
  2026-08-06); until then there is no phone URL. `vercel.json` is superseded
  by that decision — nobody deploys this to Vercel.
- **Sync is complete and has never spoken to Google.** Everything above the
  provider seam is shipping code run end-to-end in CI; `live.ts` is written
  from Google's docs and has never received a real response. No Google OAuth
  app exists yet — deliberate, until the thirty relationships are entered.
  Against a hosted database with no Google config, sync refuses to run
  (fixture mail must never touch real data).
- **Quick capture is the manual form**: `ANTHROPIC_API_KEY` deliberately unset
  until daily use starts (Derek, 2026-08-07). He adds the key to `.env.local`
  himself.
- The scoring machinery — relationship value, tiers and cadences, deal
  attribution views, event ROI at matched horizons — is **built**. The
  proactive layer (nudges, content-audience matching, event ROI × deal
  dollars) is **not built**; it is the finish line (decision 17, backlog
  Arc 4).
- The spec's old Phase 4 (consent-gated mailing export) is **void**, not
  pending.

---

## 3. Locked decisions

Reopen any of these deliberately and on the record — never by accident.
Superseded ones get marked, not deleted.

1. **Promotion requires two-way contact** (2026-07-29). Outbound-only never
   promotes; a meeting is two-way by definition; promotion does not undo.
   Enforced by trigger, not convention.
2. **Not a mailing list** (2026-08-01). The consent/subscription machinery was
   built, worked, and was removed: a rolodex that also holds a subscriber list
   invites treating it as one. No subscription, consent, suppression, or ESP
   state, ever. `content_touches` stays — one named person, one piece.
3. **Scope: Sea King Capital only** (Phase 0). Not Blaze Allen, not Sea King
   Solutions; `entity_scope` was dropped rather than left unused.
4. **Gmail sync reads all mail** (Phase 2). No label filter — a relationship
   missed because a message was unlabelled is the failure this system exists
   to prevent. The label escape hatch exists, unused.
5. **Sync never creates a person** (Phase 2). Unmatched addresses become one
   pending review row; rejection is permanent.
6. **A synced touchpoint is one person, one thread, one operator-local day**
   (Phase 2). Later same-day mail supersedes; the superseded reading stays in
   the log.
7. **Email bodies are never fetched** (Phase 2). Data minimization, not cost:
   the mailbox's full text never enters this database or the summarizer —
   subject + Google's snippet only, permalink one click away. Trade-off stated
   in README. Revisit deliberately if the proactive layer proves to need
   message content (open question 2).
8. **`manifest` schema on the shared seaking project; `app_owners` decides
   access** (2026-07-30). Being signed into the realm grants nothing here.
9. **Migrations forward-only since 2026-08-03**, recorded by hand in
   `manifest.schema_migrations`. **Never `supabase db push` against seaking**
   — the CLI ledger there belongs to Plunder. **Fixtures never touch seaking.**
10. **Authentication belongs to the suite realm, not to MANIFEST**
    (2026-08-03; reworded 2026-08-07 per Derek: "you will need to sign in once
    to access the Sea King Suite, and from there should not be prompted each
    time you access a tool"). One sign-in covers every tool you hold
    membership in — that is the suite's one-origin design
    (`../SEAKING-SUITE/suite-design.md` D3/D7/D8). MANIFEST's `/login` page
    exists only because it predates the shell; it signs you into the realm.
    Credential mechanics are realm convention: password primary, magic link
    demoted to recovery (free-tier SMTP is rate-limited and lands in spam).
11. **Per-user, forever** (suite D11, 2026-08-03). One instance per person; a
    second person gets a fresh instance, never a login here. Rider: before a
    second instance ever exists, `MANIFEST_OWN_DOMAINS` must become
    own-*addresses* — both partners share seakingcapital.com, and
    domain-grained direction would misread colleague mail (backlog 11).
12. **Deploy target is Netlify, at suite step S2** (D15, 2026-08-06). The two
    `vercel.json` crons become Netlify scheduled functions then.
13. **Event ranking sorts on cost per Active-or-better** (2026-08-03). Cost
    per contact is computed and shown and never decides order — it is
    trivially flattered by collecting business cards.
14. **Google OAuth waits until the thirty are entered** (reconfirmed
    2026-08-07). Sync against an empty rolodex sends essentially all mail to
    review.
15. **`src/lib/db/database.types.ts` is hand-written** (2026-08-01). Tooling
    guardrail, not product: `npm run db:types` overwrites it and collapses
    every type to `never`. Edit by hand; `tests/phase0/types.test.ts` catches
    drift.
16. **Identity: system of record + proactive engine** (Derek, 2026-08-07).
    §1's framing is his, corrected — not drafted-and-assumed.
17. **"Finished enough" means the nudges work** (Derek, 2026-08-07). Daily
    rolodex use is a milestone, not the finish line; finished is the proactive
    layer firing for real — introducer nudges, content-audience flags.
    Backlog Arc 4.
18. **The thirty are entered now, on desktop at localhost, against seaking**
    (Derek, 2026-08-07). The phone URL arrives with S2 regardless.
19. **`ANTHROPIC_API_KEY` gets set when daily use starts** (Derek,
    2026-08-07), by Derek, directly in `.env.local`.

---

## 4. Hard invariants

The first four are Derek's confirmed never-lines (2026-08-07); the rest are
enforced in code. Breaking any of these is never an acceptable side effect.

1. **No bulk send, ever.** No subscriber state, no suppression lists, no ESP
   export; sync skips 9-plus-recipient announcements; outreach is one person
   at a time.
2. **No invented data in the real database.** Fixture load refuses when real
   records exist; the fixture sync provider refuses non-local databases
   (`MANIFEST_ALLOW_FIXTURE_SYNC=1` is for scratch projects only); the capture
   LLM may never invent a fact — a blank field is correct, a plausible guess
   is a defect.
3. **Nobody else in this instance.** Private notes about real people, one
   reader. No second login, no shared rolodex; cross-instance sharing, if
   ever, is card-passing through review — contact fields only, never notes,
   tier, or history.
4. **Contact data stays put.** No export targets, no third-party sinks. The
   one third party that ever sees fragments is the Anthropic summarizer
   (subject + snippet, capture text) once the key is set.
5. **Touchpoints are append-only** — trigger-enforced against every role
   including `service_role`; merge's transaction-local escape hatch is the
   only exception.
6. **`MANIFEST_OWN_DOMAINS` gates sync.** Without it every sent message reads
   inbound, inbound promotes, and the whole watchlist flips active —
   irreversibly. Sync refuses to start rather than degrade.
7. **RLS deny-by-default via `app_owners`; every view runs
   `security_invoker`.** Tests assert both, plus that nothing leaks into
   `public`.
8. **Nothing indexable, embeddable, or referrer-leaking** (headers in
   `next.config.ts`); the service worker caches the app shell and never
   rolodex data.

---

## 5. How to work here

Derek's prompts run short — often because the finished picture is still
forming. That is not a spec to satisfy literally; it is the reason this
section exists.

- **Restate the outcome before building.** One sentence on what Derek is
  after — not the change he described — and what would make it *fully*
  addressed versus partly. **If those two differ, ask before building.** He
  has said he would rather answer than unwind.
- **Name the root cause before the fix.** Patching where the symptom shows
  instead of where it originates is sometimes right — but say so, and say why.
- **Report what was verified, per realm.** "Tested end-to-end," "typechecks
  and tests pass," and "written but not exercised" are different claims — and
  here there are two databases: **the local stack and seaking are separate
  auth realms and separate data.** Every verification statement names which
  one it ran against. An unqualified "works" caused pitfall #1.
- **Ambiguity is a question, not a coin flip.**
- **End every session with the next one to three steps, ranked, with
  reasoning** — in [BACKLOG.md](BACKLOG.md), not a parting paragraph.

Mechanics:

- `npm run ci` — typecheck, every migration applied to an in-process Postgres
  (PGlite), fixtures loaded, every view selected, 325 tests. No database, no
  Docker, no config. Run it before claiming anything about schema or logic.
- `npm run doctor` — read-only; checks env, connectivity, schema, owner,
  fixture and sync state against whichever project `.env.local` points at,
  and prints the fix per failure. First move when anything seems wrong.
- `.env.local` points at **seaking** today, with the local-stack block
  commented out beneath it. Swapping the comments swaps realms — say which is
  active whenever it matters, which is usually.
- Local full stack: [LOCAL.md](LOCAL.md) (`npx supabase start`; fixtures
  auto-load; magic links land at localhost:54324). Fresh hosted project:
  [SETUP.md](SETUP.md) — **scratch projects only**; the real deployment
  already exists and its rules are decision 9.
- Schema changes: a new numbered migration (`0025+`), applied to seaking over
  a direct connection, the SQL editor, or the management API — the Supabase
  CLI's stored login authorizes `api.supabase.com/v1/projects/<ref>/database/query`,
  which is how `0023`–`0024` went in (2026-08-08) — then appended to
  `manifest.schema_migrations` (`version`, `name`, `applied_at`) by hand.
  CI rejects edits to merged migrations.
- Reading a server-rendered page without a browser:
  `scripts/dev-session.ts` mints a signed-in cookie for curl. Local only, by
  assertion.
- Context/docs sessions do no feature work; bugs found go to BACKLOG.md.

---

## 6. Pitfalls — burned once, documented

1. **"Sign-in works" was recorded while sign-in was impossible on the deployed
   project** (found 2026-08-07; suite discovery §6.1). The local stack and
   seaking are separate auth realms; a password set on one does nothing on the
   other; `.env.local` carries both configs with one commented out. The claim
   was verified against local and read as global — Derek never got past the
   deployed login screen. Rules: name the realm in every verification;
   `last_sign_in_at` via the admin API is proof a sign-in actually happened;
   `npm run doctor` before diagnosing.
2. **PostgREST infers an upsert arbiter only from a *total* unique index**
   (Phase 2). Two partial indexes worked against the PGlite store adapter and
   failed against real PostgREST — exactly the drift the two adapters risk.
   When the store contract changes, run the real path, not only the tests.
3. **PostgREST `like` against a uuid column matches nothing, silently**
   (Phase 2). Doctor's fixture check reported zero forever. Cast first:
   `id::text`.
4. **`max_tokens` caps thinking plus response together on Opus-class models**
   (Phase 2). A budget sized to the visible answer truncated long captures
   into no structured output at all. The capture call runs 8000 tokens at low
   effort.
5. **Next.js inlines `NEXT_PUBLIC_*` only for verbatim static property
   access** (2026-08-03). A dynamic `process.env[name]` ships `undefined` to
   the browser with no error anywhere. `src/lib/db/client.ts` spells every
   lookup literally.
6. **Free-tier Supabase SMTP allows a couple of emails an hour and lands most
   in spam** (2026-08-03). Why magic-link-only failed and password became
   primary. `npm run auth:set-password` is the reliable path; a
   dashboard-sent link is the reliable email fallback.
7. **`docker: command not found` from `supabase start` usually means the
   daemon is not running, not PATH** (2026-08-01). Start Docker Desktop, wait
   for the whale, retry. The genuine PATH case: reopen the terminal.

---

## 7. Reading order

1. This file.
2. [README.md](README.md) — the design record: the promotion rule, sync
   design, every build decision with its why, acceptance criteria.
3. [BACKLOG.md](BACKLOG.md) — ranked, with "done" stated per item.
4. [SETUP.md](SETUP.md) / [LOCAL.md](LOCAL.md) — setup paths only.
5. Suite context, read-only from here: `../SEAKING-SUITE/README.md` (standing
   constraints), `discovery.md` §6–§6.1 (MANIFEST's estate entry and the
   sign-in correction), `suite-design.md` §8.3, §10, §11 (PWA re-scope, what
   MANIFEST owes the suite, the S-track). **Never edit suite docs from a
   MANIFEST session** — carry contradictions back to a suite session.
6. `git log` — the commit bodies here are design documents; the richest
   history source in the repo.

---

## 8. Open questions

1. **Deal attribution shape** (2026-08-07). Derek's funnel is
   sent → term sheet issued → funded, per contact — "this is not a deal flow
   tracker," and the current `deal_stage` pipeline enum
   (referred/screening/diligence/docs/funded) mis-fits it. Reshape when the
   first real deal is entered (backlog 9).
2. **Will the nudge arc need message bodies?** Decision 7 locks
   metadata-only; nudge quality may someday argue otherwise. Decide
   deliberately then, not by drift.
3. **"Connections to capital" as a scored value form** — intros and favors
   cover pieces of it; whether it needs first-class representation in the
   value score is open (backlog 10).
4. **The half-fix question is deferred** — Derek: "can't answer, have never
   successfully accessed the tool yet." Re-ask once real use has generated
   real requests.

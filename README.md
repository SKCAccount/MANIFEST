# MANIFEST

A rolodex for the principal of Sea King Capital LLC. Not a CRM funnel, not a lead database, not a cold outreach machine, and **not a mailing list**.

Almost every record is a real person the operator has actually spoken to. The system exists to keep that network from decaying by accident, to make it searchable in ways LinkedIn is not, and to reveal which relationships and which rooms are genuinely producing.

Everything here is addressed to one person at a time. There is no subscription state, no consent ledger, no suppression list and no bulk export, because there is no bulk send — see [§11](#11--settled-and-outstanding).

---

## Status

**Phase 0 (Foundation), Phase 1 (The rolodex) and Phase 2 (Sync) are complete and verified.** Nothing is deployed: there is no hosted project yet, and the schema has only ever been applied locally and to the test harness.

Phase 1 is a shippable product on its own: fully usable by hand, with zero integrations. Phase 2 adds Gmail and Calendar without changing that — sync writes touchpoints and never creates a person.

| | |
|---|---|
| Migrations | 22, applying clean from empty |
| Tables | 19, plus `app_owners` for RLS |
| Views | 21 |
| Functions | 33 — 23 callable, 10 trigger |
| Enums | 15 |
| Screens | 14, plus the login and offline pages — queue, person, directory, watchlist, geography, rolodex, sources, review, sync |
| Fixtures | 25 people — 20 active, 5 uncontacted |
| Schema | `manifest` — one schema per system on a shared database |
| Tests | 317 passing |

**Phase 2 runs against fixtures.** There are no Google credentials for this project yet, so sync is complete but has never spoken to Google. Everything above the transport — matching, direction, rollup, promotion, idempotency, correction, staging — is real code exercised end to end by `npm run ci`; the live HTTP client is written and unexercised. See [§ Sync, without Google](#sync-without-google).

**What is left.** Phase 3 is event economics on the Sources screen — the data behind it is already being recorded. Phase 4, as this repository described it, was a consent-gated export to a mailing platform; that is now out of scope rather than pending, so unless something else is added it is void. Neither has been started.

```bash
npm install
npm run ci        # typecheck + migration verification + tests — needs no database
```

`npm run ci` runs entirely locally: it applies every migration to an in-process Postgres, loads the fixtures, and selects from every view. No Supabase project and no Docker required.

**To run the app locally** (Docker, full stack on your machine, no email limits): [LOCAL.md](LOCAL.md).
**To run it against a hosted Supabase project**: [SETUP.md](SETUP.md).
Either way, `npm run doctor` checks your progress and names whatever is missing.

---

## Verifying with no database at all

The acceptance criteria are almost entirely database-level assertions — a constraint that only *looks* correct is worth nothing. So the test harness runs **PGlite**: Postgres 18 compiled to WASM, in-process. Same planner, same constraint machinery, same plpgsql, no Docker daemon. `npm run ci` therefore works on a clean checkout with nothing installed and nothing configured.

Two things hosted Supabase provides that PGlite does not are created by `tests/helpers/prelude.sql`: the `auth` schema with `auth.uid()`, and the `anon` / `authenticated` / `service_role` roles. Nothing else is stubbed, and that file never touches a real database.

This is not a substitute for running against the real instance before you rely on it, but it means CI catches a broken migration on every push rather than on deploy.

---

## Sync, without Google

Phase 2 has no credentials yet, so Google sits behind an interface with two implementations. `LiveGoogleProvider` makes the real calls. `FixtureGoogleProvider` replays canned payloads from `src/lib/sync/google/fixtures/`. `resolveProvider()` picks the fixture one whenever `GOOGLE_CLIENT_ID` is unset, and **everything above that seam is the code that ships** — the phase 2 suite runs the real `runGmailSync` and `runCalendarSync` against a real Postgres with real triggers and asserts on what lands in the tables.

The fixtures are batched, and the batches are points in time rather than pages. That is what makes the important case reachable: batch 0 contains an outbound note to a watchlist entry, batch 1 contains his reply the same afternoon, and the second run has to notice that the day it already recorded now means something different. `getThread` deliberately will not show a message from a batch that has not arrived yet — a fixture that leaked tomorrow's reply would make that test pass by never producing an outbound-only day at all.

Every run records `provider_kind`, and the Sync screen leads with a banner when it is `fixture`. A green run against invented mail must never read as a green run against the real mailbox.

**What this does not prove.** `live.ts` is written from Google's documentation and has never received a real response. The pipeline is correct given well-formed input; nothing here can show the input will be well-formed. Treat the first live run as a first run — the Gmail history id, the Calendar sync token, and the `format=metadata` header set are the three places to expect surprises.

```bash
npm run sync            # both channels, once, printing what each did
npm run sync gmail      # or calendar
```

---

## Layout

```
supabase/
  migrations/       0001–0022, numbered; immutable once applied anywhere real
  config.toml       local stack; [api] schemas exposes `manifest`
  seed.sql          fixtures — development and test only
src/
  app/              App Router — one directory per screen
    api/cron/       the scheduled runs, behind CRON_SECRET
    api/google/     OAuth connect + callback
  components/       queue row, person form, timeline, quick capture, bulk logging,
                    review item, sync controls
  lib/
    actions/        server actions (people, touchpoints, records, capture, search, sync)
    queries.ts      server-component reads
    validation.ts   Zod schemas for every mutation
    capture/        LLM parse (server-only) + shared draft shape
    sync/           Phase 2 — see below
    db/             enums, hand-written types, three clients
    phone.ts        E.164 normalization, matching the database backstop
    offline-queue.ts IndexedDB capture queue + service-worker wiring
public/
  sw.js             app-shell only — no rolodex data is ever cached
tests/
  helpers/          PGlite harness, prelude, fixture ids, SyncStore adapter
  phase0/           schema acceptance
  phase1/           validation units + Phase 1 acceptance
  phase2/           classification units + Gmail and Calendar acceptance
  unit/
scripts/
  doctor.ts             names whatever is missing from your setup
  bootstrap-owner.ts    creates the auth user and registers it in app_owners
  fixtures.ts           load / clear the 25 demo people
  sync.ts               runs a sync channel from the terminal
  verify-migrations.ts  applies every migration to a throwaway database
```

`src/lib/sync/` is split by what each piece is allowed to touch, and the split is load-bearing:

```
address.ts     parsing and normalizing an email address        pure
classify.ts    direction, machine senders, blast detection     pure
rollup.ts      messages → one touchpoint per person-day        pure
config.ts      env reads, and the refusal to run without them  pure
store.ts       the database operations sync performs           interface
store-supabase.ts   ...over PostgREST                          production
gmail.ts       the Gmail run                                   provider + store only
calendar.ts    the Calendar run                                provider + store only
backfill.ts    history for a person just accepted from review  provider + store only
summarize.ts   subject + snippet → two sentences               server-only
google/        the interface, the live client, the fixtures    server-only (live)
```

The runners import a provider and a store and nothing else — no `serviceClient`, no `server-only`. That is what lets `tests/helpers/sync-store.ts` hand them a PGlite-backed store and run the shipping code against real triggers with no Docker and no network.

**Migrations are edited in place, not superseded, until something real depends on them.** The numbering rule protects databases that have already applied a migration; no such database exists yet. When the mailing-list machinery came out, `0001`, `0005`, `0009`, `0015`, `0016` and `0019` were rewritten rather than followed by a migration that dropped what `0009` had just created. Phase 2 did the same to `0001` (a new `staging_kind` value) and `0006` (an `external_url` column, and a narrowed unique index) rather than adding an `ALTER` that would have had to be read alongside the original forever. Once there is a hosted project, that stops being true and changes go forward-only.

**Do not run `npm run db:types`.** `src/lib/db/database.types.ts` is written by hand. It exports named row types — `PeopleRow`, `SourceMetricsRow`, `PathToRow` — that `supabase gen types` does not produce, and running the script overwrites the file and collapses every table and view to `never`. The guard is `tests/phase0/types.test.ts`, which introspects the live schema and fails if the hand-written types drift from it. Edit the file, then let CI check it.

---

## The one rule everything else hangs off

A person is either `active` or `uncontacted`, and **promotion requires two-way contact**.

`contact_status` flips to `active` only on a touchpoint whose direction is `inbound` or `mutual`, or whose channel is `meeting`. A meeting is two-way by definition. An outbound-only attempt is logged against the record and changes nothing else.

This is enforced by trigger (`trg_first_contact`), and it is what makes Gmail sync correct with no special handling: an outbound email promotes nothing, and their reply promotes them. A LinkedIn message to someone in Colorado Springs that goes unanswered stays exactly what it was — a watchlist entry with an attempt on the record.

Phase 2 needed no code for that rule. It only had to get `direction` right, which is why `MANIFEST_OWN_DOMAINS` is the one setting sync refuses to start without: with no own-domains, every message the operator sent reads as inbound, every one of them qualifies, and the whole watchlist promotes on his own unanswered effort. That does not undo — `trg_people_validate` forbids an active record from going back to the watchlist — so the variable is checked before a run begins rather than degraded around.

Uncontacted people are quarantined from `v_queue`, `v_never_followed_up`, `v_directory`, `v_relationship_value`, `v_reciprocity`, `v_tier_mismatch`, and every `fn_source_metrics` denominator. The filter is written into each view definition rather than left to callers.

---

## Notes on the build

Decisions made while implementing, worth knowing before touching the schema.

**Sync idempotency key includes `person_id`.** §5.5 specifies a unique index on `(source, external_id)`, but §7.3 has one calendar event writing one row per external attendee — all sharing that event id. As written the second attendee would be rejected. The index is `(source, external_id, person_id)`, which preserves idempotency and supports group rows.

**Event sources also require `occurred_on`.** §5.4 requires cost and year for event kinds. Horizon-matched comparison measures every event at the same age, and `days_since_event` is displayed beside every present-day ratio — neither is possible without a date. Enforced alongside the other two.

**`channel = 'system'` is a ledger entry, not contact.** Job-change rows are written automatically so the timeline explains itself, but a job change is a fact about a person, not contact with them. `v_contact_touchpoints` excludes them (and superseded rows), and every recency, stage, ratio and event calculation reads that view rather than the table. Without this, a job change would silently reset a cadence clock and push a Card to Contact.

**The stage ladder is measured from `first_contact_at`, not from the first row in the log.** A watchlist entry with two unanswered outbound attempts that finally replies is a **Card** — one real interaction — not a Contact. Counting the attempts would credit the relationship for the operator's own unanswered effort. (This was caught by a test, not by design.)

**Watchlist metadata survives promotion.** `watchlist_reason` and friends are not cleared when someone is promoted. "I wanted to meet this person because X, and now I have" is signal worth keeping; the UI simply stops showing it.

**Cost requirements are trigger-enforced, not `CHECK`-enforced.** Whether a kind belongs to the event family lives in `taxonomies` (`meta->>'family' = 'event'`), and a `CHECK` constraint cannot read another table. This keeps the event family extensible: adding "Summit" as an event kind is an insert, and the cost requirement follows automatically.

**Append-only is enforced three ways.** Privileges revoked from `authenticated` and `anon`, no update/delete RLS policy, and `trg_touchpoints_append_only` which blocks it for every role including `service_role`. The single escape hatch is a transaction-local setting used by merge and merge-reversal, which have to reassign a loser's touchpoints.

**Views are `security_invoker = on`.** Without it a view executes as its owner and quietly bypasses RLS on its base tables, which would leave each "active only" filter as the sole thing between a caller and the whole table. A test asserts no view is missing it.

**Value bands.** §6.3's "+0.8 if computed value exceeds assigned tier" needs a mapping the spec does not give. `fn_tier_for_value` uses A ≥ 70, B ≥ 45, C ≥ 20, else D. `v_tier_mismatch` keeps the spec's explicit thresholds (C/D above 60, A below 20).

**"An unsent Derek On Capital piece"** is derived from `content_touches` — the distinct set of titles already sent to someone *is* the library — so it needs no seventeenth table. Note that this survived the mailing-list removal on purpose: `content_touches` records that the operator sent one named person one piece, which is outreach, not distribution.

**`v_path_to` is bounded to uncontacted targets.** Materializing paths for every person against every person is quadratic. The view covers the watchlist (which is what the Watchlist and Geography screens join against); `fn_path_to(person_id)` handles any single target.

**`v_deal_sources_org`** was added alongside `v_deal_sources`, since §6.13 asks for the roll-up "per person and organization" and one view cannot have two grains.

**The mailing-list machinery was built and then removed.** The spec modelled consent from day one — a `subscriptions` table with per-list status and consent evidence, an email-keyed `suppressions` table, a `consent_status` enum, and a `region_code` on every person to drive CAN-SPAM / CASL / GDPR jurisdiction. All of it worked. None of it belonged: MANIFEST manages outreach to people the operator already knows, and a rolodex that also holds a subscriber list invites someone to treat the rolodex as a subscriber list. So the tables, both enums, the region column and the `missing_region` data-quality check are gone.

`region` went with them because its only consumer was the compliance gate. Geography is `city` / `state` / `country`, which is what the Geography screen has always grouped on; a `us`/`eu`/`apac` bucket that nothing read would have become a field that eventually gets filled in wrong — the same reasoning that dropped `entity_scope`. What survived is `do_not_contact`, which is a fact about a person rather than list state, and `content_touches`.

### Phase 2

**One synced touchpoint is one thread, one person, one operator-local day.** Per message was the obvious alternative and is wrong three ways: `fn_person_stage` counts touchpoints, so two emails would make anyone a Contact; `touch_count_365d` feeds relationship value, so whoever emails in bursts would outrank whoever the operator actually meets; and a person's timeline — the thing read on the way into a call — would become unreadable. The day boundary is `fn_local_date`'s, so a message at 9pm on the 4th belongs to the 4th, and `rollup.ts` imports `TIME_ZONE` from the one place that defines it rather than restating it.

**A later message the same day supersedes rather than duplicates.** A note sent at 9am is an outbound attempt; the reply at 4pm makes that day a two-way exchange. That is not an edit to what happened at 9am, it is a better-informed record of the day — so sync inserts a correction with `supersedes_id` set, exactly as a manual correction would, and the superseded reading stays visible in the log explaining why the record was not promoted sooner.

This forced a change to `touchpoints_external_key`, which is now narrowed to `supersedes_id is null`. A correction necessarily shares the external id of the row it corrects, so without that predicate, append-only correction and sync idempotency were mutually exclusive. What the index still guarantees is the thing that matters: a re-run cannot insert a second original.

**Rather than reconcile, re-derive.** When a thread is touched again, sync fetches the whole thread (`threads.get`, one call, metadata only) and rebuilds the affected days from it. The alternative — merging new messages against a remembered summary of the old ones — has a whole class of bug that this simply does not have, because there is no "what did we think yesterday" state to get wrong. `sync_messages` therefore records only *whether a message has been seen*, not what it said.

**The body is never fetched, not merely never stored.** Every `messages.get` asks for `format=metadata` with an explicit header allowlist, so Gmail does not return one. The summarizer works from the subject line and Google's own ~200-character snippet, which is a real limitation worth stating: a thread titled "Quick question" summarizes as a request for time even if what actually happened over eleven messages was a term sheet. The permalink is stored, so the real thread is one click from the timeline.

**`substantive` defaults to false on every degraded path.** It decides whether a day resets a cadence clock. Defaulting it true when the summarizer is unavailable would mean an outage silently told the queue that every relationship touched that night was being looked after. Under-reporting is recoverable by hand; over-reporting hides someone until they are gone.

**Sync never creates a person.** An address it cannot match becomes one pending `staging_records` row keyed on the address itself, so a vendor who emails weekly accumulates evidence in a single row dismissed once, rather than generating an item every week. Rejection is permanent — `fn_sync_stage_person` will not reopen a resolved record — which is what makes dismissing the newsletter address a one-time cost.

**Inbound counts only the sender; outbound counts every external recipient.** The asymmetry is deliberate. Being CC'd alongside someone is not contact with them, and because inbound qualifies for promotion, counting other recipients would promote everyone who appeared on one introduction email. Above eight external recipients an outbound message is an announcement rather than correspondence and is skipped entirely — the surest way to turn a rolodex into a mailing list would be to let one "we've moved offices" email write forty touchpoints.

**Gmail's own categorisation is reused rather than re-derived.** Google has already decided a message is a marketing blast, and writing a worse heuristic here would be strictly worse. `CATEGORY_UPDATES` is deliberately not filtered: it holds receipts, but also a good deal of genuine one-to-one mail from small senders.

**Calendar is the channel that can promote.** `channel = 'meeting'` qualifies regardless of direction, so every rule there is about whether the person was actually in the room: cancelled events, future events, and declined attendees write nothing; `needsAction` on a past meeting is unknowable from the API and becomes a review item rather than being guessed either way; and above twelve external attendees it is an event, not a meeting, and is left to the Sources screen and bulk logging where the operator says who he actually spoke to.

**`google_credentials` withholds its own token columns from the operator.** A refresh token is a standing grant to read an entire mailbox that cannot be revoked from inside this app. RLS is row-level and cannot express "everything but these two columns", so the restriction is a column grant: `authenticated` gets SELECT on the metadata and on nothing else. The Sync screen can say who is connected and when the last refresh failed; no query it can make returns the credential. Writes are service-role only.

**`sync_messages` uses one `NULLS NOT DISTINCT` unique index, not two partial ones.** The partial pair was the first shape, and it worked against the PGlite test adapter and failed against real PostgREST — an upsert can only infer its arbiter from a *total* unique index. That is exactly the drift the two store adapters exist to risk, and it was caught by running the thing rather than by a test. One total index keeps both write paths honest.

### Namespacing

**MANIFEST owns the `manifest` schema, not `public`.** This database is intended to host Kraken, Plunder, Harpoon, Deepwatch and MANIFEST side by side. Most of MANIFEST's 17 tables and 15 enums carry names another business system would plausibly want — `people`, `organizations`, `notes`, `sources`, `deals`, and the `tier` and `deal_stage` enums among them. Table collisions are a merge conflict; **enum collisions are worse**, because Postgres types are schema-scoped and there is no way for two systems to both define `tier` in `public`. So each system owns a schema, `public` holds only the shared extensions, and `tests/phase0/namespacing.test.ts` fails if anything leaks back. Authorization is per-system too: `manifest.app_owners` decides who reads the rolodex, so shared auth across systems does not imply shared access.

---

## §11 — settled and outstanding

**Settled.**

- **Scope: Sea King Capital only.** Not Blaze Allen, not Sea King Solutions. The spec's proposed `entity_scope` tag was therefore dropped rather than left in place unused — a scoping dimension nobody filters on is a field that eventually gets filled in wrong. `tags` remains as the unconstrained escape valve it was always meant to be.
- **Own domain: `seakingcapital.com`.** Single domain, set in `MANIFEST_OWN_DOMAINS`. This is what Phase 2 sync uses to decide which side of a thread is the operator — and therefore which touchpoints are inbound, which is what drives promotion.
- **Gmail scope: all mail.** `MANIFEST_GMAIL_LABEL` stays empty. Higher recall and higher noise, chosen deliberately: a label is a thing to maintain forever, and a relationship missed because a message was unlabelled is the failure this system exists to prevent. Full history per person is also what the eventual relationship summaries read from. The escape hatch is wired and applied client-side — the incremental path reads `users.history.list`, which takes no label filter, so filtering there is the only way the rule holds on both the incremental and backfill paths.
- **No mailing list.** MANIFEST manages outreach to people the operator actually knows, one at a time. It is not a newsletter tool, so it holds no subscription, consent or suppression state, and the ESP question the spec left open is void rather than deferred. `content_touches` stays: "I sent this person this piece" is a record of one-to-one outreach and feeds the queue's talking-point suggestion. Sending to a list, if it ever happens, is a different tool's job.

**Still open.**

Nothing. Both of the spec's §11 questions are resolved above.

---

## Acceptance

### Phase 0 — Foundation

Each is asserted by a test:

- [x] Migrations run clean from empty
- [x] All views return
- [x] Touchpoint `UPDATE` rejected at the database level
- [x] Event-kind sources reject null cost or year
- [x] An uncontacted record without a reason is rejected
- [x] A phone-only uncontacted record is accepted
- [x] An outbound touchpoint against an uncontacted person does **not** promote it
- [x] An inbound one does
- [x] Setting `introduced_by_person_id` creates the matching `introductions` row
- [x] CI runs `tsc --noEmit` plus migration verification

Phase 1 builds the rolodex: manual CRUD, the queue, person detail, directory, watchlist, geography, quick capture, bulk event logging, search. It is a shippable product on its own, and the spec is explicit that the 30 most important relationships should be hand-entered before Phase 2 begins.

### Phase 2 — Sync

Each is asserted by a test in `tests/phase2/`, running the shipping `runGmailSync` and `runCalendarSync` against a real Postgres:

- [x] An outbound email writes a touchpoint and promotes nobody
- [x] Their reply the same day rewrites that day as mutual — by superseding, not editing — and promotes them
- [x] Only the correction shows as contact; the superseded reading stays in the log
- [x] One thread across two days is two touchpoints, each read from its own day's messages
- [x] An address matching nobody becomes one pending suggestion and no touchpoint
- [x] The review queue offers the person the display name matches and the organization the domain matches
- [x] A re-run writes nothing, and still writes nothing when the message ledger is deleted and every day is recomputed
- [x] A rejected suggestion is not resurrected by a later run
- [x] Machine senders, marketing labels, internal-only mail, and nine-recipient announcements are all skipped
- [x] A calendar meeting writes one touchpoint per attendee who was there, sharing a group key
- [x] Declined attendees, cancelled events and future events write nothing
- [x] An attendee who never answered the invitation becomes a review item rather than a guess
- [x] `MANIFEST_OWN_DOMAINS` unset stops the run rather than inverting every direction

Not asserted, and not assertable here: that Google's real responses match the shapes `live.ts` expects.

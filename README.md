# MANIFEST

A rolodex for the principal of Sea King Capital LLC. Not a CRM funnel, not a lead database, not a cold outreach machine.

Almost every record is a real person the operator has actually spoken to. The system exists to keep that network from decaying by accident, to make it searchable in ways LinkedIn is not, and to reveal which relationships and which rooms are genuinely producing.

---

## Status

**Phase 0 (Foundation) is complete and verified.** Phases 1–4 are not started.

| | |
|---|---|
| Migrations | 18, applying clean from empty |
| Tables | 18, plus `app_owners` for RLS |
| Views / functions | 19 views, 14 functions |
| Fixtures | 25 people — 20 active, 5 uncontacted |
| Tests | 173 passing |

```bash
npm install
npm run ci        # typecheck + migration verification + tests
```

`npm run db:verify` applies every migration to an empty Postgres, loads the fixtures, and selects from every view.

---

## Verifying without Docker

The Phase 0 acceptance criteria are almost entirely database-level assertions — a constraint that only *looks* correct is worth nothing. This machine has no Docker and no local Postgres, so the test harness runs **PGlite**: Postgres 18 compiled to WASM, in-process. Same planner, same constraint machinery, same plpgsql.

Two things hosted Supabase provides that PGlite does not are created by `tests/helpers/prelude.sql`: the `auth` schema with `auth.uid()`, and the `anon` / `authenticated` / `service_role` roles. Nothing else is stubbed, and that file never touches a real database.

This is not a substitute for running against the real instance before Phase 1 ships, but it means CI catches a broken migration on every push rather than on deploy.

---

## Layout

```
supabase/
  migrations/       0001–0018, numbered and immutable once merged
  seed.sql          fixtures — development and test only
  config.toml       single account, magic link, signup disabled
src/lib/
  db/enums.ts       the closed sets, mirrored once in TypeScript
  db/database.types.ts
  db/client.ts      browser / server / service clients
  phone.ts          E.164 normalization, matching the database backstop
tests/
  helpers/          PGlite harness, prelude, fixture ids
  phase0/           acceptance tests
  unit/
scripts/
  verify-migrations.ts
```

---

## The one rule everything else hangs off

A person is either `active` or `uncontacted`, and **promotion requires two-way contact**.

`contact_status` flips to `active` only on a touchpoint whose direction is `inbound` or `mutual`, or whose channel is `meeting`. A meeting is two-way by definition. An outbound-only attempt is logged against the record and changes nothing else.

This is enforced by trigger (`trg_first_contact`), and it is what makes Gmail sync correct with no special handling: an outbound email promotes nothing, and their reply promotes them. A LinkedIn message to someone in Colorado Springs that goes unanswered stays exactly what it was — a watchlist entry with an attempt on the record.

Uncontacted people are quarantined from `v_queue`, `v_never_followed_up`, `v_directory`, `v_relationship_value`, `v_reciprocity`, `v_tier_mismatch`, every `fn_source_metrics` denominator, and every export. The filter is written into each view definition rather than left to callers.

---

## Notes on the build

Decisions made while implementing, worth knowing before Phase 1.

**Sync idempotency key includes `person_id`.** §5.5 specifies a unique index on `(source, external_id)`, but §7.3 has one calendar event writing one row per external attendee — all sharing that event id. As written the second attendee would be rejected. The index is `(source, external_id, person_id)`, which preserves idempotency and supports group rows.

**Event sources also require `occurred_on`.** §5.4 requires cost and year for event kinds. Horizon-matched comparison measures every event at the same age, and `days_since_event` is displayed beside every present-day ratio — neither is possible without a date. Enforced alongside the other two.

**`channel = 'system'` is a ledger entry, not contact.** Job-change rows are written automatically so the timeline explains itself, but a job change is a fact about a person, not contact with them. `v_contact_touchpoints` excludes them (and superseded rows), and every recency, stage, ratio and event calculation reads that view rather than the table. Without this, a job change would silently reset a cadence clock and push a Card to Contact.

**The stage ladder is measured from `first_contact_at`, not from the first row in the log.** A watchlist entry with two unanswered outbound attempts that finally replies is a **Card** — one real interaction — not a Contact. Counting the attempts would credit the relationship for the operator's own unanswered effort. (This was caught by a test, not by design.)

**Watchlist metadata survives promotion.** `watchlist_reason` and friends are not cleared when someone is promoted. "I wanted to meet this person because X, and now I have" is signal worth keeping; the UI simply stops showing it.

**Cost requirements are trigger-enforced, not `CHECK`-enforced.** Whether a kind belongs to the event family lives in `taxonomies` (`meta->>'family' = 'event'`), and a `CHECK` constraint cannot read another table. This keeps the event family extensible: adding "Summit" as an event kind is an insert, and the cost requirement follows automatically.

**Append-only is enforced three ways.** Privileges revoked from `authenticated` and `anon`, no update/delete RLS policy, and `trg_touchpoints_append_only` which blocks it for every role including `service_role`. The single escape hatch is a transaction-local setting used by merge and merge-reversal, which have to reassign a loser's touchpoints.

**Views are `security_invoker = on`.** Without it a view executes as its owner and quietly bypasses RLS on its base tables, which would leave each "active only" filter as the sole thing between a caller and the whole table. A test asserts no view is missing it.

**Value bands.** §6.3's "+0.8 if computed value exceeds assigned tier" needs a mapping the spec does not give. `fn_tier_for_value` uses A ≥ 70, B ≥ 45, C ≥ 20, else D. `v_tier_mismatch` keeps the spec's explicit thresholds (C/D above 60, A below 20).

**"An unsent Derek On Capital piece"** is derived from `content_touches` — the distinct set of titles already sent to someone *is* the library — so it needs no nineteenth table.

**`v_path_to` is bounded to uncontacted targets.** Materializing paths for every person against every person is quadratic. The view covers the watchlist (which is what the Watchlist and Geography screens join against); `fn_path_to(person_id)` handles any single target.

**`v_deal_sources_org`** was added alongside `v_deal_sources`, since §6.13 asks for the roll-up "per person and organization" and one view cannot have two grains.

---

## §11 — settled and outstanding

**Settled.**

- **Scope: Sea King Capital only.** Not Blaze Allen, not Sea King Solutions. The spec's proposed `entity_scope` tag was therefore dropped rather than left in place unused — a scoping dimension nobody filters on is a field that eventually gets filled in wrong. `tags` remains as the unconstrained escape valve it was always meant to be.
- **Own domain: `seakingcapital.com`.** Single domain, set in `MANIFEST_OWN_DOMAINS`. This is what Phase 2 sync uses to decide which side of a thread is the operator — and therefore which touchpoints are inbound, which is what drives promotion.

**Still open.**

1. **Gmail scope** (blocks Phase 2). All mail, or a labelled subset? Wired as `MANIFEST_GMAIL_LABEL`, empty meaning all. All-mail is higher recall and higher noise; a label is deliberate but needs maintaining.
2. **Target ESP** (blocks Phase 4). Column naming in the export should match whatever it is. Nothing depends on it before then.

---

## Phase 1 entry criteria

Phase 0 is done when all of the below hold. They do, and each is asserted by a test:

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

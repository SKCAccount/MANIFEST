# Sea King Suite — identity, authorization, and consolidation

**Status: DRAFT for review by Derek and Austin. Nothing in §6 onward gets built until this document is agreed.**

Drafted 2026-08-03. This is the design for bringing Kraken, Plunder, MANIFEST, and later Harpoon and Deepwatch onto one Supabase project with one sign-in, where what a signed-in person can do in each tool is decided by that tool's own permissioning — and nothing else.

Two systems already live on the combined project, so parts of this document describe running reality rather than proposal. Those parts are marked **[LIVE]**. Everything else is **[PROPOSED]** or **[OPEN]**, and the open items are collected in §11.

---

## 0. Decision summary

| # | Decision | State |
|---|---|---|
| D1 | One Supabase project (`seaking`, ref `oznvdznekexdgblmxwqr`) hosts every system | **[LIVE]** — `manifest` + `plunder` schemas are there today |
| D2 | One schema per system; `public` stays empty of system objects | **[LIVE]** for MANIFEST and Plunder; Kraken moves at port |
| D3 | One auth realm; email + password primary, magic link as recovery; signup disabled; all provisioning admin-driven | **[LIVE]** |
| D4 | Being signed in grants nothing anywhere: every system keeps its own membership surface, deny-by-default | **[LIVE]** in MANIFEST (`app_owners`) and Kraken (`users` + RLS); generalized in §4 |
| D5 | Role vocabularies are per-system; there is no global role enum | **[PROPOSED]** |
| D6 | No `supabase db push` against the combined project — per-system migration ledgers | **[LIVE]** for MANIFEST (`manifest.schema_migrations`); Kraken adopts at port |
| D7 | Sign-in-once across tools via a session cookie scoped to `.seakingcapital.com` subdomains | **[PROPOSED]** — depends on §8 hosting answers |
| D8 | MANIFEST is per-user: one instance per person, never a shared rolodex | **[DECIDED]** 2026-08-03; second instance deferred until Austin wants one |
| D9 | Kraken ports by parallel-build and cutover; production untouched until verification passes | **[PROPOSED]** — runbook in §6 |
| D10 | Kraken's manager scoping model under the suite | **[OPEN]** — two options in §4.3, needs Derek |

---

## 1. What exists today

### 1.1 The combined project — `seaking` [LIVE]

- Ref `oznvdznekexdgblmxwqr`, free tier, org "Sea King Capital LLC" (`aoytetldnnjsqwnthrix`).
- Schemas: `manifest` (deployed 2026-08-03, empty of people, forward-only migrations, own ledger), `plunder` (~3.5k rows: an event-scraping/scoring pipeline — `events`, `event_sources`, `event_scores`, `runs`, `reviews`, `sources`, …), `public` (empty of system objects, by design).
- Exposed schemas: `public, graphql_public, plunder, manifest`.
- Auth: one user (Derek, `00401dc7-…`), signup **disabled**, `http://localhost:3000/auth/callback` allowlisted, password set via `npm run auth:set-password`.
- API keys: new-generation (`sb_publishable_…` / `sb_secret_…`). The MANIFEST codebase reads both key-name generations; any system can put either value in its legacy-named env var, since the clients treat the key as an opaque string.
- `supabase_migrations.schema_migrations` holds Plunder's CLI history (26 rows). It is frozen history: the Supabase CLI cannot serve multiple repos on one project, which is what D6 exists to solve.

### 1.2 Kraken — "SKC Servicing Engine" [LIVE, standalone]

Production PO-financing / AR-factoring system of record. Repo `github.com/SKCAccount/KRAKEN` (local clone: `C:\Users\stink\Claude Projects\KRAKEN`). Its own Supabase project, ref `ucfyfnwkxzryywuomool`.

What matters for this design, verified against the repo:

- **Stack**: pnpm monorepo; `apps/manager` (internal, Next), `apps/client-portal` (external-facing, Next — login, forgot-password, consent, advance requests), `apps/jobs` (README stub only). 166 timestamped, forward-only migrations. Event-sourced ledger (`ledger_events` append-only) with materialized projections. Its `CLAUDE.md` carries non-negotiable invariants and a "decisions already locked" section — this design defers to those inside Kraken's own boundary.
- **Auth**: email + password (portal includes self-service forgot-password, which sends email). `packages/auth` provides session helpers; middleware does session refresh only — enforcement lives in RLS.
- **The house rule, stated in Kraken's own migrations**: *"RLS is the authority and the app layer is convenience."* This design adopts that rule suite-wide.
- **Roles** (`public.user_role` enum): `admin_manager`, `operator`, `client`, plus `investor` and `creditor` as documented stubs. `users.id` references `auth.users(id)`; client-role users are bound to a `client_id` (CHECK-enforced: client ⇔ client_id, others ⇔ null). Stub junction tables exist for investor/creditor access.
- **Client scoping is live, not aspirational**: `user_client_access (user_id, client_id, granted_by)` exists and is enforced — the 2026-07-17 hardening migration closed the last unscoped write policies, so **manager-tier access is grant-scoped per client today**, with one deliberate exception (client INSERT precedes the creator's self-grant; the self-grant runs service-role). Operators additionally read four admin-documented reference tables; their writes are admin-only.
- **Beyond Postgres**: a storage bucket (`po_uploads`), seven edge functions (`plaid-sync`, `gl-audit`, `weekly-digest`, `aged-out-warning`, `insurance-claim-deadlines`, `projection-drift-check`, `state-of-default-reminder`) plus `_shared`, and a `public.invoke_edge_job` function — implying pg_cron schedules invoke those functions. Plaid means **third-party credentials live in that project's secrets**.
- **Schema qualification**: 17 migrations hard-qualify `public.` (mostly on views/matviews and `invoke_edge_job`) — a port cannot simply replay migrations under a different `search_path`; it needs a qualification rewrite (§6).

### 1.3 Plunder [LIVE data, unknown code]

Data lives in the `plunder` schema as described above. **No user/membership tables exist in the schema** — whatever runs it authenticates as service role or a direct connection, and there is no UI authorization surface yet. The code location, the runner (the `runs` table has 643 rows but `cron.job` is empty — so something external drives it), and its production cadence are **[OPEN §11]**.

### 1.4 Harpoon, Deepwatch [UNKNOWN]

A `harpoon-queue` Docker container runs on Derek's machine, so Harpoon exists as software. Nothing else is known about either system. They get schemas and membership tables when they arrive; nothing in this design blocks on them.

### 1.5 MANIFEST [LIVE]

Deployed to `seaking` 2026-08-03. Single-owner by deep design (first-person semantics, global dedupe keys, private notes). Phone-first; next operational steps are a Vercel deploy (queue on the phone, cron sync) and the Google OAuth app. Its `README.md` documents the per-system ledger and the no-`db push` rule.

---

## 2. Goals and non-goals

**Goals**

1. Sign in once; each tool decides what you see by its own permissioning.
2. External users (Kraken's clients, later investors/creditors) live safely in the same auth realm without any possibility of reaching other systems.
3. Kraken moves onto the combined project with production continuity — parallel build, verified cutover, rollback at every step until retirement.
4. Conventions that let five systems share one database without stepping on each other: schemas, ledgers, naming, secrets.
5. MANIFEST stays personal per D8.

**Non-goals**

- A central ACL or global role table. Authorization stays per-system on purpose: one tool's permissioning mistake must not open another, and the blast radius of a bad policy stays inside its schema.
- An external IdP / SSO product. Supabase auth is the realm; revisit only if a third party ever requires SAML/OIDC.
- Cross-system data integration (e.g. Kraken client ↔ MANIFEST person). Explicitly out of scope; if ever wanted, it happens by explicit exchange, not shared tables.
- Merging rolodexes (D8).

---

## 3. Identity architecture

### 3.1 One realm, four user classes

All humans authenticate against `seaking`'s GoTrue. The population:

| Class | Examples | Provisioned by | Systems they may hold membership in |
|---|---|---|---|
| Partners | Derek, Austin | each other | any |
| Staff | Kraken operators / admin managers | partners | Kraken only, unless deliberately added elsewhere |
| External — client | portal users of Kraken clients | admin managers (grant-scoped) | Kraken only, bound to their `client_id` |
| External — investor / creditor | future | partners | Kraken only (stub tables), bound to their entity |

**Invariant: a row in `auth.users` means "may attempt sign-in" and nothing more.** Every capability comes from a per-system membership row. There is deliberately no "suite member" concept.

### 3.2 Sign-in mechanics

- Email + password primary; magic link retained as recovery (already MANIFEST's shape; already Kraken's shape minus the link). Signup disabled at the realm level; `shouldCreateUser: false` on every OTP call as belt-and-braces.
- Password management: self-service reset stays available to portal users (Kraken's forgot-password flow — it is customer-facing and must keep working). Partners/staff use it too, or the admin-API script.
- **Email delivery becomes production-critical the day Kraken's portal moves** — free-tier SMTP (a couple of messages an hour) cannot serve customer password resets. Custom SMTP (Resend/SES/postmark) on `seaking` is a **hard prerequisite of the Kraken cutover** (§6, K-gate 4). Inventory of current SMTP config on `ucfy` is [OPEN §11].

### 3.3 Sign-in-once across apps [PROPOSED]

A Supabase session cookie is host-scoped by default, so separate apps on separate subdomains each ask for a login even against the same realm. The fix is configuration, not architecture: every app sets its auth cookie with `domain: '.seakingcapital.com'` (via `cookieOptions` in `@supabase/ssr`), so a session minted by any tool is presented to all of them. Localhost dev is unaffected (no domain attribute locally).

Consequences to accept explicitly:

- Any subdomain app can read the session. That is the feature — and it means **every subdomain must be a first-party app we run**. No vendor tools, preview deployments of third-party code, or user-generated content on `*.seakingcapital.com`.
- Sign-out must clear the domain cookie (one tool's sign-out signs out all — correct for a suite).
- Apps still enforce authorization independently; presenting a session to MANIFEST as a portal user yields nothing (D4).

JWT custom claims (embedding per-system roles in the token) are **deferred**: they save one indexed read per request at the cost of coupling every system to a shared token hook and token-lifetime staleness on role changes. The DB lookup is the current pattern in both live systems and is fast enough.

---

## 4. Authorization model

### 4.1 The universal pattern

Each system owns, inside its schema:

1. **A membership surface** — `manifest.app_owners` (one row = the owner), `kraken.users` (+ `user_client_access`), future `plunder.members`, etc.
2. **SECURITY DEFINER helper functions with pinned `search_path`** — `fn_is_owner()`, `is_manager()`, `current_user_client_ids()` — so policies read cleanly and the definer-function shadowing attack is closed. (Both live systems already do the pinning or must at port: Kraken's helpers currently live unqualified in `public` and get moved + pinned in K1.)
3. **RLS on every table, deny-by-default** — a table without a policy is unreachable, not public. MANIFEST enforces this by looping over `pg_tables` at migration time; Kraken states it as the house rule. Suite-wide test: *for every system schema, a signed-in user with no membership row reads zero rows and writes nothing, under the publishable key.* This test runs against every system in CI-equivalent form after the port (§6 verification).
4. **Its own migration ledger** `{system}.schema_migrations` — RLS on, zero policies, zero grants: invisible to every API role; only deploy tooling on a direct connection touches it.

### 4.2 Per-system role vocabularies (D5)

| System | Roles | Meaning |
|---|---|---|
| Kraken | `admin_manager`, `operator`, `client`, `investor` (stub), `creditor` (stub) | as today — unchanged by the port |
| MANIFEST | owner (a membership row, no enum) | per-instance; exactly one row per instance |
| Plunder | `partner` (proposed) | full access; membership table arrives with its first UI |
| Harpoon / Deepwatch | `partner` (proposed) | same |

"Partner" deliberately does not exist as a Kraken role. Derek and Austin appear in Kraken as `admin_manager` rows like anyone else — what makes them partners is which *other* systems they hold membership in. This keeps Kraken's role enum meaning exactly what its 166 migrations already assume.

### 4.3 Kraken manager scoping — the one open model question (D10)

Current, verified behavior: **all manager-tier users, including admin managers, see and write only clients they hold `user_client_access` grants for** (post-hardening). Derek's stated intent was "a Manager sees assigned clients; an admin still sees it all."

Two ways to reconcile:

- **(a) Keep universal grant-scoping** and make "admin sees all" true operationally: partners/admins get a grant row per client, and a trigger auto-grants designated users on client creation. Pros: no schema change, keeps the hardened posture (every read is grant-auditable), no new tier to reason about. Cons: "all" is maintained rather than intrinsic.
- **(b) Introduce an unscoped tier** (either a new role above `admin_manager`, or an `is_unscoped` flag) whose policies skip the grant predicate. Pros: matches the stated mental model literally. Cons: reopens exactly the class of unscoped-write policy the 2026-07-17 hardening spent a migration closing; every future policy must handle the bypass correctly, forever.

**Recommendation: (a).** The hardening migration's history is an argument from experience: unscoped tiers are where Kraken's own review found its gaps. [OPEN §11 — Derek decides.]

### 4.4 External users, stated as tests

- A `client` user's session presented to Plunder, MANIFEST, Harpoon, Deepwatch: zero rows, zero writes — guaranteed by the absence of membership rows plus deny-by-default, i.e. by *nothing needing to be done*. This must stay true by construction, and the §4.1(3) probe suite asserts it per schema.
- A `client` user inside Kraken: bound to their `client_id` exactly as today. The port changes their world by one thing only — a re-login.

---

## 5. Platform conventions

### 5.1 Schemas and naming

- One schema per system: `kraken`, `plunder`, `manifest`, later `harpoon`, `deepwatch`. `public` holds shared extensions only.
- Enums are schema-scoped — `kraken.user_role` and any future `plunder.user_role` cannot collide. This is the original reason for the whole convention.
- **Project-global namespaces need prefixes** (schemas don't cover them):
  - Storage buckets: `kraken-po-uploads` (rename at port; bucket names are project-wide).
  - Edge functions: `kraken-plaid-sync`, `kraken-gl-audit`, … (function slugs are project-wide).
  - Cron job names in `cron.job`: `kraken-…`.
  - Secrets: `KRAKEN_PLAID_CLIENT_ID`, etc.
- Realtime channels, if ever used, follow the same prefix rule.

### 5.2 Migrations and deploys (D6)

- **Nobody runs `supabase db push` against `seaking`, ever.** The CLI's single ledger belongs to Plunder's frozen history.
- Each repo applies its own migrations over a direct connection (or the dashboard SQL channel) and appends to `{system}.schema_migrations`. MANIFEST's runner pattern exists and is documented in its README; Kraken's port includes writing an equivalent (§6 K1) — its repo keeps its own timestamped files, unchanged in form.
- Migration files are forward-only in every system (Kraken always was; MANIFEST since 2026-08-03).

### 5.3 Keys and the shared-blast-radius truth

One project means **one set of service-tier credentials spans every schema**. RLS guards the user path; nothing guards a leaked secret key. This is the real price of consolidation and it should be written down, not waved at:

- Secret keys never leave server-side env (`.env.local` locally, host env in deployment). No `NEXT_PUBLIC_` spelling exists for them anywhere in any repo.
- **Mint one named secret key per app** (`manifest-app`, `kraken-manager`, `kraken-portal`, `kraken-jobs`) — the new key system allows several, so a suspected leak revokes one app's key without a suite-wide rotation, and access logs attribute by key.
- Accepted residual risk: a compromised server environment of any app exposes all schemas. Mitigations considered and rejected: separate projects (kills sign-in-once and re-fragments the suite), schema-scoped keys (Supabase doesn't offer them). Revisit if Supabase ships finer-grained keys.
- The publishable key is shared and public by design; RLS is its entire security model — which is why §4.1(3) is an invariant and not a preference.

### 5.4 Free-tier reality

Current usage (37 MB DB, 0 storage) fits comfortably. The port adds Kraken's data and storage — inventory its sizes in K0 and check against 500 MB DB / 1 GB storage / 5 GB egress. Custom SMTP (§3.2) is required regardless of tier. If any ceiling approaches, one Pro project ($25/mo) is the entire fix; the design doesn't change.

---

## 6. Kraken port runbook [PROPOSED]

Each phase ends in a **gate**: verification passes or the phase repeats. Production Kraken on `ucfy` keeps running until K6. Rollback before K6 is always "flip env back."

**K0 — inventory and freeze list.** Full dump of `ucfy` (schema, data, `auth.users` + identities, storage objects). Written inventory: edge-function secrets (Plaid at minimum), `cron.job` rows, SMTP config, deployed app hosts + their env vars, storage object count/size, DB size. Output: a checklist with owners.
**Gate:** dump restores cleanly into a scratch database; inventory reviewed by Derek.

**K1 — schema transform.** Rewrite `public` → `kraken` for the 166-migration lineage. Because 17 migrations hard-qualify `public.`, the transform is scripted (qualification rewrite + replay into a scratch schema), then **validated by structural diff** against the `ucfy` original (tables, columns, constraints, indexes, functions, triggers, policies — count and definition parity). Helper functions move into `kraken` with pinned `search_path`. Create `kraken.schema_migrations`, seeded with the 166 versions.
**Gate:** structural diff clean; Kraken's own test suite (if runnable against a database) passes against the scratch.

**K2 — data and auth port.** Restore data into `kraken.*` on `seaking`. Copy `auth.users` + `auth.identities` preserving UUIDs and password hashes — except Derek (and Austin if present), whose rows already exist on `seaking`: their old IDs are remapped to the existing ones by scripted FK rewrite (`users`, `user_client_access.granted_by`, audit/event actor columns — enumerated from the FK graph, not by grep). All sessions invalidate; users re-log-in once (comms note to clients).
**Gate:** row-count parity per table; ledger invariants hold (Kraken's projection rebuild produces identical balances on both sides); login works for a partner, an operator, and a test client user.

**K3 — storage and functions.** `kraken-po-uploads` bucket + objects + storage policies. Edge functions deployed under prefixed names with secrets re-provisioned; `cron.job` rows recreated with prefixed names pointing at the new slugs.
**Gate:** an upload round-trips from the portal build pointed at `seaking`; each cron function runs once manually and succeeds.

**K4 — realm config.** Custom SMTP live on `seaking`. Portal + manager redirect URLs allowlisted. Cookie-domain change (§3.3) merged in Kraken's apps behind env.
**Gate:** password reset email delivers to an external address in seconds, not hours.

**K5 — parallel verification and cutover.** Staging deploys of manager + portal pointed at `seaking` run alongside production; the §4.1(3) RLS probe suite runs per schema; the D10 decision is implemented and probed. Cutover = env swap on the production apps (URL + keys — legacy env names carry new-format values without code changes). Old project stays untouched.
**Gate:** Derek uses staging-manager for a real working session; a real client completes a portal session on staging; sign-in-once verified across MANIFEST + manager on subdomains.

**K6 — retirement.** After an agreed soak (suggest 2–4 weeks), final dump of `ucfy`, archive the dump offline, delete the project. The freed slot is headroom.

MANIFEST is untouched by all of this except K5's shared-cookie verification. Plunder is untouched, full stop.

---

## 7. MANIFEST in the suite

Already conformant (it defined half the conventions). Suite-relevant specifics:

- Second instance (Austin): deferred. When wanted: fresh schema from the same migration lineage, his own `app_owners` row, his own Gmail connection. **Prerequisite regardless of timing:** sync's `MANIFEST_OWN_DOMAINS` becomes own-*addresses* — both partners share `seakingcapital.com`, and domain-grained direction reads Derek's outbound (Austin cc'd) as Austin's own. Tracked in MANIFEST, small, must land before instance two exists.
- Cross-instance sharing, if ever: card-passing through the existing staging/review flow — contact fields only, never notes/tier/history.
- Fixture data can never reach `seaking`: the fixture sync provider refuses non-local databases, and fixtures were never loaded.

---

## 8. Hosting and domains [OPEN]

Proposed shape, pending §11 answers on current reality:

| App | Domain (proposed) | Hosting |
|---|---|---|
| Kraken manager | `manager.seakingcapital.com` | wherever it runs today (unknown) |
| Kraken client portal | `portal.seakingcapital.com` | same question |
| MANIFEST | `manifest.seakingcapital.com` | Vercel (its cron config assumes it) |
| Plunder UI (future) | `plunder.seakingcapital.com` | — |

All on apex subdomains to make §3.3 work. MANIFEST's Vercel deploy can proceed before the rest of this document settles — it only needs its own subdomain and env.

---

## 9. Sequencing

1. **This document agreed** (Derek + Austin on D10, §8, §11).
2. MANIFEST Vercel deploy (independent; do anytime).
3. K0–K1 (no production risk at any point).
4. K2–K4 on `seaking` (still no production risk — Kraken prod untouched).
5. K5 cutover on an agreed date with a client-comms note (re-login).
6. Soak → K6.
7. Plunder membership table + UI whenever Plunder grows one; Harpoon/Deepwatch as they arrive, each: schema, ledger, membership table, prefix conventions.

---

## 10. Risks

| Risk | Mitigation |
|---|---|
| Shared service-tier credentials across schemas | Named key per app; server-only env; accept documented residual (§5.3) |
| External users in the shared realm | Deny-by-default + per-schema probe suite (§4.1); nothing else to get right |
| Cookie widened to `.seakingcapital.com` | First-party apps only on subdomains; suite-wide sign-out; probe in K5 |
| Free-tier email ceiling vs. customer password resets | Custom SMTP as a K4 hard gate |
| Schema rewrite subtly diverges from `ucfy` | Structural diff gate + projection-parity gate (K1/K2) |
| ID remap misses an FK on Derek/Austin rows | Remap driven by the FK graph, not grep; parity counts per table |
| Two repos, one database, human error in deploys | Per-system ledgers; `db push` ban documented in both repos; deploy runners refuse when ledger and directory disagree |
| Dashboard project pages blank in Derek's Chrome | Known workaround (platform API via session); not a blocker, but worth testing another browser / reporting to Supabase |
| Supabase CLI conveniences lost (types gen, db diff) | `db:types` works read-only per schema (Kraken already generates against `--schema public`, becomes `--schema kraken`); diffing happens against scratch databases in CI, not prod |

---

## 11. Open questions

**For Derek (gate §9 step 1):**

1. **D10** — Kraken scoping model: (a) universal grant-scoping with auto-grants for partners, or (b) an unscoped admin tier? (Recommendation: a.)
2. Where do Kraken's manager and portal run today (host, domains, who holds the env vars)?
3. Current SMTP configuration on `ucfy` — is customer email already on a real provider?
4. Where is Plunder's code, and what runs its pipeline (the `runs` table is written by *something* — a laptop cron? a worker somewhere?)? Does it need to keep running through all of this?
5. What are Harpoon and Deepwatch (stack, state, where the `harpoon-queue` container comes from)?
6. Client-comms preference for the K5 re-login (email from you, portal banner, both?).
7. Soak window before `ucfy` deletion (suggest 2–4 weeks).
8. Does Austin review this document too before build (recommended — D8 and §4.2 concern him directly)?

**Design debts acknowledged, not blocking:**

- MANIFEST own-addresses change (before Austin's instance).
- Plunder membership + UI authorization (before any Plunder UI).
- JWT claims optimization (only if per-request role reads ever show up in latency).
- `apps/jobs` is a stub; if it becomes real, it gets a named secret key and lives in the same conventions.

---

## Appendix A — evidence index

| Claim | Where verified |
|---|---|
| Grant-scoping enforced, incl. admin writes | `KRAKEN/supabase/migrations/20260717120001_rls_admin_scope_hardening.sql` |
| "RLS is the authority" house rule | same file, header comment |
| Five roles incl. stubs; client_id CHECK | `KRAKEN/supabase/migrations/20260423120002_reference_tables.sql`, `packages/auth/src/roles.ts` |
| Helpers unqualified in `public` | `KRAKEN/supabase/migrations/20260423120007_rls_policies.sql` |
| 17 migrations hard-qualify `public.` | `grep -rl "public\." KRAKEN/supabase/migrations` |
| Edge functions + Plaid | `KRAKEN/supabase/functions/` |
| Portal self-service reset | `KRAKEN/apps/client-portal/src/app/forgot-password/` |
| Plunder schema contents, empty `public` | live inspection of `seaking`, 2026-08-03 |
| MANIFEST conventions | `manifest/README.md`, migrations `0017`, `0020`–`0022` |

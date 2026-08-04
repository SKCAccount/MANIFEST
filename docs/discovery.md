# Sea King estate — discovery

**The master process file.** Per Derek, 2026-08-03: *"before we proceed, we need to do discovery on each of the existing projects … this is not something we can just assume and build."* This document records what was actually found, with evidence for every claim. [suite-design.md](suite-design.md) holds the decisions; this file holds the facts those decisions must be revised against — §9 lists where discovery has already contradicted the draft design.

**How this file is maintained:** every claim carries its evidence (a path, a query, a DNS record). Anything not yet verified is tagged **[UNVERIFIED]**. Anything needing Derek/Austin is tagged **[ASK]**. New findings append to the discovery log (§11) with a date. Nothing gets deleted — superseded findings get struck through with the correction beside them.

---

## 1. Estate map

Nine systems/artifacts found. Three were previously unknown to the suite conversation entirely.

| System | What it is | Code | Production | Data | Status |
|---|---|---|---|---|---|
| **Kraken** | PO-financing / AR-factoring system of record | `SKCAccount/KRAKEN`; working copy `sea-king-capital-servicing-engine` | **Netlify ×2**: `app.seakingcapital.com` (manager), `portal.seakingcapital.com` (client portal) | Supabase `ucfy…` (own project), 21 MB | **Live, early** — 3 users, 5 ledger events, 8 daily crons, production Plaid |
| **Plunder** | Event sourcing & scoring engine for BD ("find rooms dense with qualified buyers") | `SKCAccount/PLUNDER`, local `plunder/` | **GitHub Actions cron** (nightly chain + Monday digest) | `seaking` → `plunder` schema, ~3.5k rows | Live; ran 2026-08-03 10:16 UTC |
| **MANIFEST** | Derek's personal rolodex | this repo | local dev today; Vercel pending | `seaking` → `manifest` schema | Deployed 2026-08-03, empty, awaiting first entries |
| **Harpoon** | Award-triggered govcon origination agent | `SKCAccount/HARPOON`, local `harpoon/` | **Local Docker** (`harpoon-queue`, 127.0.0.1:8010) + weekly Windows task | SQLite in Docker volume | Live locally; deliberate PII containment |
| **Deepwatch** | Deterministic conditional document-assembly engine (deals) | local `deepwatch/` — **git repo with NO remote** | none | filesystem (`corpus/`, `deals/`, `out/`) | Active July; single-machine only ⚠ |
| **seaking** (platform) | The combined Supabase project | — | ref `oznvdznekexdgblmxwqr` | schemas: `manifest`, `plunder`, empty `public` | Live; 1 auth user; signup off |
| `seaking-accountingevent-crm` | Atomic CRM fork (React + Supabase) with inbox-scan for in-person events | `SKCAccount/seaking-event-crm` | unknown | unknown | Last commit 2026-06-26 — **[ASK]** retired? Overlaps Plunder (events) + MANIFEST (CRM) |
| `sea-king-app` | React/Vite + Supabase starter | local only, no remote found | none apparent | local config only | **[ASK]** abandoned prototype? |
| `seakingcapital-website` | Marketing site | `SKCAccount/seakingcapital-website` | **GoDaddy cPanel** (apex A 208.109.29.159) | static | Live. **DNS for the whole cookie-domain plan lives at GoDaddy** |

---

## 2. Kraken — deep findings

### 2.1 Code and repo state

- Monorepo `sea-king-command`: `apps/manager`, `apps/client-portal`, `apps/jobs` (**README stub only**), 13 packages, 166 timestamped forward-only migrations, event-sourced ledger + projections. `CLAUDE.md` (515 lines) carries non-negotiable invariants and a **"Decisions already locked"** section this suite work must defer to inside Kraken's boundary.
- **The working copy is ahead of origin**: local HEAD 2026-07-20 (*"docs(auth): switch password-reset email to the token_hash flow"*) vs origin 2026-07-17. Unpushed auth-relevant work exists. **[ASK]** push before any port work baselines the repo.
- Overnight-review harness (`overnight-review.ps1`, session logs) — same pattern exists in Plunder. These are review sessions, not runtime.

### 2.2 Auth & authorization (verified in migrations)

- Email + password; portal has self-service forgot-password (token_hash flow per the unpushed commit).
- Roles ×5: `admin_manager`, `operator`, `client` (+`investor`, `creditor` stubs). `users.id → auth.users(id)`; client ⇔ `client_id` CHECK.
- **Grant-scoping is live for every manager tier** via `user_client_access` (2026-07-17 hardening closed the last unscoped policies; client-INSERT + service-role self-grant is the one designed exception). House rule stated in that migration: *"RLS is the authority and the app layer is convenience."*
- RLS helper functions live **unqualified in `public`** — they move + get pinned `search_path` at port.

### 2.3 Production reality (read 2026-08-03 via dashboard session, read-only)

| Fact | Value | Evidence |
|---|---|---|
| Hosting | Netlify ×2: `skckraken.netlify.app` ← `app.seakingcapital.com`; `skcportal.netlify.app` ← `portal.seakingcapital.com` | DNS CNAMEs + `ucfy` auth allowlist (exactly those four hosts) |
| DB size | 21 MB | `pg_database_size` |
| Users | `admin_manager:1 operator:1 client:1` — **one real external client user exists** | `public.users` group by |
| Ledger | `ledger_events: 5` rows; `audit_log: 67` | `pg_stat_user_tables` |
| Storage | 4 buckets: `payment-uploads(31)`, `po-uploads(18)`, `invoice-uploads(10)`, `advance-request-attachments(0)` — **3 more buckets than the repo grep suggested** | `storage.buckets` join objects |
| pg_cron | 8 jobs: `daily-fee-accrual 06:00`, `projection-drift-check 07:30`, `gl-audit 07:45`, `plaid-sync 08:00`, `aged-out-warning-email 11:30`, `insurance-claim-deadlines 12:00`, `state-of-default-reminder monthly`, `weekly-digest-email Mon 12:00` | `cron.job` |
| CLI migrations applied | **166 = repo count exactly** (parity ✓) | `supabase_migrations.schema_migrations` |
| Plaid | `PLAID_ENV=production` in manager env — **live bank connections** | working-copy `.env.local` (names + this value only) |
| App email | `RESEND_API_KEY` in portal env — app-layer email is on Resend | working-copy `.env.local` names |
| Auth email (SMTP) | **NOT configured** — password resets for the real client ride Supabase built-in free-tier email **today** | `SMTP_HOST` empty in auth config |
| Signup | **OPEN** (`DISABLE_SIGNUP: false`) on a production financial realm | auth config |
| Edge functions | Repo has 7 function dirs + `_shared`; platform functions endpoint returned **empty**. How the `-email` crons deliver, and whether functions are deployed at all, is **[UNVERIFIED]** — pin down `invoke_edge_job`'s definition and each cron job's `command` at K0 | repo tree vs platform API |
| Secrets | Project secrets exist; names not enumerable through the tooling used (redacted) — inventory at K0 from dashboard | platform secrets endpoint |

### 2.4 Flags (found, not fixed — nothing was changed on `ucfy`)

1. **Open signup on production.** Stray signups get no `users` row → no data (deny-by-default holds), but a public financial system accepting signups is at minimum hygiene debt. **[ASK]** intentional (invite flow dependency?) or oversight — if oversight, fix on `ucfy` now, independent of any port.
2. **No custom SMTP** while a real client can request password resets. Pre-existing risk, not port-introduced. Candidate for fixing on `ucfy` immediately.
3. Unpushed working-copy commits (2.1).
4. `apps/jobs` is a stub — no runtime to port.

---

## 3. Plunder — deep findings

- **What it is** (its own README): nightly engine finding in-person events "dense with qualified buyers," scoring for relevance/accessibility/cost, review dashboard for the keep/skip decision. Active: last commit 2026-07-30 (specialty-finance sources), last run **2026-08-03 10:16 UTC**, 643 runs total, 959 events scored.
- **Architecture**: `apps/worker` (Node/tsx CLI — the nightly entrypoint), `apps/dashboard` (React/Vite review UI), `packages/{core,db,ingest,config}`. DB client pins `schema: 'plunder'` — it adopted the suite convention independently.
- **The runner is GitHub Actions cron** (README M11: "GitHub Actions cron drives the nightly chain and the Monday digest"). Nightly chain: `worker run --all && worker score && worker detect`. **Consequence: GitHub repo secrets hold a direct database credential (`PLUNDER_DATABASE_URL`) to `seaking`** plus `DEEPSEEK_API_KEY`. The suite's secrets map (§8) must include GitHub Actions as a credential holder.
- **Dashboard runs locally** (Vite dev; no deployment found) against `VITE_PLUNDER_SUPABASE_URL` + anon key.
- **Migrations**: 10, in-app tracker `plunder._migrations` (`0001_init` → `0010_factoring_abl_category`). Its CLI history is the frozen `supabase_migrations` (26 rows).

### 3.1 ⚠ The headline security finding of this discovery

Verified live on `seaking`, 2026-08-03:

- `anon`: **zero grants** on `plunder.*` — the publishable key alone reads nothing. ✓
- `authenticated`: **ALL privileges** (SELECT…TRUNCATE), and every data table's single policy is `FOR ALL TO authenticated USING (true) WITH CHECK (true)`.

**Meaning: any signed-in user of the seaking realm has full read/write on all Plunder data.** Today the realm contains exactly one user (Derek), so there is no live exposure — but the entire Kraken port plan brings staff and **external client users** into this realm. The moment the second human can sign in, Plunder is open to them.

This is the deny-by-default violation §4 of the design doc treats as the cardinal rule, present in production. It was invisible from the code review (the policies live in Plunder's migrations, applied long ago) and surfaced only by inspecting the live database — which is exactly the argument for this discovery process.

**Gate (proposed, not built): `plunder.members` + membership-checked policies must land before any second user exists in the seaking realm** — i.e., strictly before Kraken's K2. Recorded as a design-doc correction (§9).

---

## 4. Harpoon — findings

- **What it is**: "Award-triggered govcon origination agent" (its pyproject). Python. Watches government contract awards (`SAM_API_KEY` = SAM.gov) and originates outreach: search + verifier providers, **Twilio** (SID + auth token), **its own Gmail OAuth** (client id/secret/refresh token), LLM keys (`ANTHROPIC_API_KEY`, `DEEPSEEK_API_KEY`), `DOC_ENGINE_WEBHOOK_URL` (→ almost certainly Deepwatch integration — **[UNVERIFIED]**), `ALLOW_THIRD_PARTY_PII` + `HARPOON_DRY_RUN` flags.
- **Runtime**: Docker compose. `harpoon-queue` (up 15h, healthy, restart unless-stopped) = "the always-on half: approval queue, pipeline board, lead pages, Run panel" — **bound to 127.0.0.1:8010 deliberately: "This database holds lead PII; do not expose it on the LAN."** A `harpoon-scheduler` service exists behind a compose profile and is **not running**. A Windows scheduled task **"Harpoon Warmup"** runs `python -m harpoon.cli warmup` **weekly** (last: 2026-08-03 09:30, exit 0).
- **Data**: SQLite at `/var/lib/harpoon` (Docker volume `harpoon_harpoon-db`) — not on Supabase at all. Backup story **[UNVERIFIED]**.
- **Secrets hygiene**: the Google OAuth `client_secret_*.json` in the repo dir **is gitignored** ✓; live secrets are injected via compose env.
- **Suite relevance**: no shared auth surface today (localhost UI, single operator). Its future in the one-sign-in world (does the queue UI ever leave localhost?) is an [ASK] for the design doc revision. Docs are rich (`WORKFLOWS.md`, `apis.md`, capability letter) — read before designing anything for it.

## 5. Deepwatch — findings

- "Deterministic conditional document assembly engine" — assembles deal documents from fragments/corpus with conditional logic (FOREACH, draft gating, bounded enumeration per its build log). Renamed SENTINEL → DEEPWATCH 2026-07-12. Python, venv-bound.
- **Git repo with no remote, clean tree, local-only.** One disk failure loses the entire system. Highest-priority operational flag outside Kraken. **[ASK]**: push to `SKCAccount/DEEPWATCH`.
- Integration hypothesis: Harpoon's `DOC_ENGINE_WEBHOOK_URL` points at it (capability letters for govcon outreach). **[UNVERIFIED]** — confirm from Harpoon config values or docs.

## 6. MANIFEST — reference

Fully documented in this repo ([README](../README.md)). Deployed to `seaking` 2026-08-03; forward-only; per-system ledger; fixture-sync guard; password auth. Pending: Vercel deploy, Google OAuth app, first thirty relationships. Suite-relevant: it defined the membership pattern (`app_owners`) and the ledger convention the other systems adopt.

## 7. The seaking platform project — reference

Ref `oznvdznekexdgblmxwqr`, named `seaking` (renamed from `plunder` 2026-08-03). Schemas `manifest` + `plunder` + empty `public`; exposed: `public, graphql_public, plunder, manifest`. Auth realm: 1 user, signup disabled, localhost callback allowlisted, new-generation API keys. Frozen `supabase_migrations` = Plunder CLI history (26). Known platform quirk: project-scoped dashboard pages render blank in Derek's Chrome; org pages fine; workaround = platform API via session.

---

## 8. Cross-cutting maps

### 8.1 Where credentials live (the real secret-sprawl inventory)

| Holder | Holds |
|---|---|
| Netlify (site env ×2) | `ucfy` URL + anon + **service_role**, Plaid production creds (manager), Resend key (portal) — **[UNVERIFIED: enumerate at K0 from Netlify UI]** |
| GitHub Actions (`SKCAccount/PLUNDER` secrets) | **direct Postgres URL to `seaking`**, DeepSeek key |
| Local `.env.local` files (this machine) | everything above in dev form, incl. production Plaid values and both projects' service keys |
| Docker compose env (harpoon) | Twilio, Gmail OAuth pair + refresh token, SAM, search/verifier, LLM keys |
| Supabase `ucfy` secrets store | present; names not yet enumerated **[UNVERIFIED]** |
| Windows Task Scheduler | none (invokes venv python only) ✓ |

### 8.2 Scheduler map (what runs unattended, where)

| Trigger | System | What |
|---|---|---|
| pg_cron on `ucfy` ×8 | Kraken | fee accrual, drift check, gl-audit, plaid-sync, notice emails, digest |
| GitHub Actions cron | Plunder | nightly chain + Monday digest |
| Windows Task "Harpoon Warmup" weekly | Harpoon | `harpoon.cli warmup` |
| (dormant compose profile) | Harpoon | `harpoon-scheduler` |
| (pending) Vercel cron | MANIFEST | gmail hourly / gcal 4-hourly per `vercel.json` |

### 8.3 Email map

| Path | Used by | State |
|---|---|---|
| Supabase built-in SMTP on `ucfy` | Kraken auth mail (incl. client password resets) | **free-tier limits, live today** ⚠ |
| Resend (app-layer) | Kraken portal notifications | key present in portal env |
| Supabase built-in on `seaking` | MANIFEST magic-link recovery | fine while single-user |
| Kraken cron `-email` jobs | delivery mechanism **[UNVERIFIED]** (edge functions? pg_net→Resend?) | resolve at K0 |
| Harpoon Gmail OAuth | its own outreach sending | separate from everything above |

### 8.4 Domains (GoDaddy DNS, verified by resolution)

`seakingcapital.com` A→208.109.29.159 (GoDaddy site) · `www` CNAME apex · `app` → skckraken.netlify.app · `portal` → skcportal.netlify.app · `manager`/`kraken` → no records. MANIFEST's future subdomain: **[ASK]** (`manifest.` proposed).

---

## 9. Corrections this discovery forces on suite-design.md

To be applied in the design-doc revision **after** Derek reviews this file — recorded here first so the doc and the facts never silently diverge:

1. **§8 Hosting table is wrong**: manager lives at `app.` (not `manager.`), both Kraken apps are **Netlify** (not unknown/Vercel). Cutover = Netlify env swap; allowlist must add the two Netlify hostnames on `seaking`.
2. **New hard gate before K2**: Plunder membership + real policies (§3.1). The current design doc treats Plunder authorization as "arrives with its first UI" — discovery shows it must arrive **before Kraken's users do**.
3. **K-runbook additions**: 4 storage buckets (not 1); pg_cron jobs are 8 with exact schedules to re-create; Plaid is production (key rotation/cutover choreography needed); email-delivery mechanism resolution; secrets enumeration from Netlify + Supabase dashboards.
4. **§3.2 SMTP**: not just a K4 gate — it is a live deficiency on `ucfy` today; candidate for immediate fix independent of the port.
5. **Signup open on `ucfy`** production realm — resolve intent, likely close now.
6. **Estate is bigger than the doc knew**: Harpoon (local, PII-deliberate, Twilio/Gmail/SAM), Deepwatch (un-remoted!), the CRM experiment, `sea-king-app`, the GoDaddy-hosted site (where DNS lives). The design doc's §1.4 "unknown" sections get real content.
7. **GitHub Actions as credential holder** for `seaking` joins the key-management story (§5.3).

## 10. Consolidated [ASK] list for Derek (and Austin)

1. §3.1 Plunder policy gate — agree it blocks any second realm user? (Recommended: yes, hard gate.)
2. `ucfy` open signup — intentional or close it now?
3. Custom SMTP on `ucfy` now (Resend is already in the family) — proceed ahead of any port?
4. Deepwatch: push to a private `SKCAccount` remote this week? (One-command fix to a single-point-of-failure.)
5. Kraken working copy's unpushed commits — push?
6. `seaking-accountingevent-crm` and `sea-king-app` — retired? If yes, archive the repos and note it here; if no, they join the suite inventory properly.
7. Harpoon's future re: shared sign-in — does its queue UI stay localhost-forever (fine), or eventually join the suite's web surface?
8. Netlify account: who owns it, and can I get read access to enumerate both sites' env vars at K0?
9. MANIFEST subdomain choice (`manifest.seakingcapital.com`?) — needed for the Vercel deploy + GoDaddy DNS entry.
10. Austin's review of this file + the design doc.

## 11. Discovery log

- **2026-08-03 (this session)** — Local estate sweep (`Claude Projects` dir, Docker, Task Scheduler, DNS). Identified all nine systems; found Plunder/Harpoon/Deepwatch code local; identified Kraken working copy (ahead of origin). Read Kraken auth stack + hardening migration; corrected two prior beliefs (grant-scoping is live; roles are five). Read `ucfy` production read-only via dashboard session: DB size/users/crons/buckets/migration parity/auth config; found open signup + missing SMTP; functions-deploy question opened. Read `seaking` live: Plunder migrations, run recency, **RLS policy audit → §3.1 finding**. Nothing was modified on either project during discovery.

**Still to examine (next discovery sessions):** Kraken `CLAUDE.md` "Decisions already locked" + `ARCHITECTURE.md` full read into a Kraken context appendix · Plunder GitHub Actions workflow file (exact schedule, secret names) · Harpoon `WORKFLOWS.md`/`apis.md` + confirm Deepwatch webhook integration · Deepwatch docs pass · `ucfy` cron job `command` bodies + `invoke_edge_job` definition + secrets names · Netlify env enumeration [needs #8 above] · the two experiment repos' disposition.

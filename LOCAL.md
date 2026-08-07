# Running MANIFEST locally

The whole stack on your machine: Postgres, the API layer, auth, Studio, and a
local inbox that catches magic links. No cloud project, no email limits, no
spam folder.

Two prerequisites you install once, then four commands.

---

## Prerequisites

Docker Desktop needs WSL2, which needs a reboot and admin rights. This is the
only part that is genuinely a chore.

**Docker Desktop must be *running*, not merely installed.** `supabase start`
talks to the daemon, not the binary, and reports
`docker: command not found` when the daemon is absent — which reads like a PATH
problem and usually is not. Launch Docker Desktop and wait for its whale icon to
settle before continuing. If `docker` really is unknown in your terminal after
installing, reopen the terminal: the installer adds
`C:\Program Files\Docker\Dockeresourcesin` to PATH, and a shell opened
beforehand will not have it.

**1. WSL2** — in an *Administrator* PowerShell:

```powershell
wsl --install
```

Reboot when it asks. It installs Ubuntu by default, which is fine and unused —
Docker just needs the WSL2 kernel.

**2. Docker Desktop:**

```powershell
winget install Docker.DockerDesktop
```

Launch it once after installing and leave it running. `docker info` should
succeed before you continue.

---

## Start it

```bash
npx supabase start
```

First run pulls several containers — a few minutes. After that it takes
seconds. It prints a block of URLs and keys; keep it visible for the next step.

Migrations in `supabase/migrations/` are applied automatically, and `seed.sql`
is loaded too — so you get the 25 demo people without asking. That is the right
default locally and the wrong one in production, which is why the hosted path
never loads them (see [SETUP.md](SETUP.md)).

## Point the app at it

```bash
cp .env.example .env.local
```

Fill in from what `supabase start` printed:

```
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<the "anon key" it printed>
SUPABASE_SERVICE_ROLE_KEY=<the "service_role key" it printed>
MANIFEST_OWNER_EMAIL=derek@seakingcapital.com
NEXT_PUBLIC_SITE_URL=http://localhost:3000
MANIFEST_OWN_DOMAINS=seakingcapital.com
CRON_SECRET=<any long random string>
```

`MANIFEST_OWN_DOMAINS` is the one sync will not start without. It is how sync
decides which side of a thread is you, and therefore which touchpoints are
inbound — and inbound is what promotes a watchlist entry to an active
relationship. Left empty, every message you sent would read as inbound and the
whole watchlist would promote on your own unanswered mail, which does not undo.
Sync refuses to run rather than risk it.

`ANTHROPIC_API_KEY` is optional — without it quick capture falls back to the
manual form and synced touchpoints keep their subject line instead of a
summary. Everything else is unchanged.

The `GOOGLE_*` variables are optional too, and locally you probably want them
empty: sync then replays the fixtures in `src/lib/sync/google/fixtures/`, which
is enough to exercise every screen without going through Google's OAuth
verification. Every run made that way is recorded as `provider_kind = 'fixture'`
and the Sync screen leads with a banner saying so.

```bash
npm run doctor
```

Everything should be green except the owner, which is the next step.

## Create yourself and sign in

```bash
npm run bootstrap:owner
```

Against a local stack this creates the auth user *and* registers it in
`manifest.app_owners` — the table every RLS policy checks. Doing it before you
first sign in avoids the confusing version of this, where you sign in
successfully and stare at an empty rolodex.

(Against a hosted project the same command refuses to create the user, because
signup there is disabled by design and a script quietly undoing that would be
worse than an extra step.)

```bash
npm run dev
```

Two ways in, both fine locally:

- **Password** — `npm run auth:set-password` once (typing hidden, set through
  the admin API), then sign in normally.
- **Magic link** — "Email me a sign-in link instead" on the login page, then
  open **[localhost:54324](http://localhost:54324)** and click the link waiting
  there. It never touches a real inbox.

---

## What you get

| | |
|---|---|
| App | [localhost:3000](http://localhost:3000) |
| Sync status, and the Google connect button | [localhost:3000/sync](http://localhost:3000/sync) |
| Whatever sync could not place | [localhost:3000/review](http://localhost:3000/review) |
| Studio — browse and edit tables directly | [localhost:54323](http://localhost:54323) |
| Inbox — every outbound email, incl. magic links | [localhost:54324](http://localhost:54324) |
| API | `http://127.0.0.1:54321` |
| Postgres | `postgresql://postgres:postgres@127.0.0.1:54322/postgres` |

In Studio, switch the schema selector from `public` to **`manifest`** — `public`
is deliberately empty.

## Day-to-day

```bash
npx supabase stop            # containers down, data kept
npx supabase start           # back up where you left off
npx supabase db reset        # wipe, re-apply migrations, reload fixtures
```

`db reset` is the one to reach for after pulling schema changes. It is
destructive and local-only. Migrations have been **forward-only since
2026-08-03** — the edit-in-place era an earlier version of this note described
is over — so a reset simply re-applies the full numbered set from empty and
reloads the fixtures, which is the sure way to bring a local stack current.

```bash
npm run sync                 # both channels once, printing what each did
npm run sync gmail           # or calendar
```

Against the fixtures, the first run writes three email touchpoints and two
meeting touchpoints and leaves two addresses for review; the second run writes
one more — the correction that turns Henrik Sorensen's outbound-only day into a
two-way exchange and promotes him off the watchlist. That sequence is the whole
of Phase 2 in miniature, and it is what `/sync` and `/review` are for.

## Reading a page from the terminal

Every screen is behind auth, so `curl` gets a redirect to the login page. When
you want the rendered HTML — checking what a server component actually produced,
without a browser — mint a session first:

```bash
COOKIE=$(npx tsx --env-file-if-exists=.env.local scripts/dev-session.ts)
curl -s -H "Cookie: $COOKIE" http://localhost:3000/sources
```

It sets a password on the local auth user and signs in with it, so it refuses to
run against anything but a local URL. The cookie names come from driving the same
`@supabase/ssr` client the app uses rather than from guessing at its storage key.

## Clearing the demo data

The 25 fixtures are invented people. Before you enter a real relationship:

```bash
npm run fixtures:clear
```

`npm run doctor` always tells you how many of your records are fixtures.

---

## Moving to the shared hosted project later

The local stack and the hosted project run the same migrations, so moving is
mostly configuration:

1. Create the project, then `npx supabase link --project-ref <ref>` and
   `npm run db:push`.
2. Expose the schema: **Project Settings → Data API → Exposed schemas** — add
   `manifest`. Without this, PostgREST cannot see any of it and every screen
   returns nothing.
3. Turn signup **off** (`enable_signup = false`) and create your user from the
   dashboard instead. Local convenience should not become a hosted door.
4. `npm run bootstrap:owner` against the hosted keys.
5. Do **not** load the fixtures.

Each additional system — Kraken, Plunder, Harpoon, Deepwatch — gets its own
schema in the same project, its own migrations, and its own entry in the exposed
schemas list. They share one Postgres and one auth provider; being signed in
does not by itself grant access to any of them, because each keeps its own
owner table.

---

## When something is wrong

| Symptom | Cause |
|---|---|
| `docker: command not found` from `supabase start` | Usually the daemon, not PATH: Docker Desktop is installed but not launched. Start it, wait for the whale to settle, retry. |
| `docker` unknown in your terminal | Reopen the terminal — the installer's PATH change does not reach shells opened before it. |
| `supabase start` hangs or errors | Docker Desktop is not running. `docker info` first. |
| Port already allocated | Something else holds 54321–54324. `npx supabase stop` then start again. |
| "Not connected to a database yet" on the login page | `.env.local` missing or still placeholder. |
| Signed in, everything empty | `npm run bootstrap:owner` |
| `relation "people" does not exist` | The client is looking at `public`. The schema is `manifest` — check `[api] schemas` in config.toml. |
| Studio shows no tables | Switch the schema selector to `manifest`. |
| Magic link never arrives | It did — it is at [localhost:54324](http://localhost:54324), not in your real inbox. |
| `sync_runs does not exist` | The stack is still on an older migration set. `npx supabase db reset` — a push will not pick up migrations that were edited in place. |
| Sync refuses to start | `MANIFEST_OWN_DOMAINS` is unset. It is the one setting sync will not run without. |
| `/sync` shows a fixture banner | Expected locally. No `GOOGLE_CLIENT_ID`, so it is replaying canned mail rather than reading a mailbox. |

`npm run ci` needs none of this and passes on its own — 325 tests against an
in-process Postgres, including the whole Phase 2 pipeline against the fixture
provider. If CI is green and the local stack misbehaves, the difference is
configuration, not logic.

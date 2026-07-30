# Running MANIFEST locally

The whole stack on your machine: Postgres, the API layer, auth, Studio, and a
local inbox that catches magic links. No cloud project, no email limits, no
spam folder.

Two prerequisites you install once, then four commands.

---

## Prerequisites

Docker Desktop needs WSL2, which needs a reboot and admin rights. This is the
only part that is genuinely a chore.

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
```

`ANTHROPIC_API_KEY` is optional — without it quick capture falls back to the
manual form and everything else is unchanged.

```bash
npm run doctor
```

Everything should be green except the owner, which is the next step.

## Create yourself and sign in

Local signup is enabled (`config.toml`), so the app can create the user itself —
no dashboard step. Start the app and request a link:

```bash
npm run dev
```

Open [localhost:3000](http://localhost:3000), enter your address, submit. Then
open the local inbox at **[localhost:54324](http://localhost:54324)** and click
the link in the message waiting there.

You are now signed in and looking at an **empty** rolodex. That is expected:

```bash
npm run bootstrap:owner
```

RLS grants access only to users registered in `manifest.app_owners`, and this is
what registers you. Reload, and the fixtures appear.

---

## What you get

| | |
|---|---|
| App | [localhost:3000](http://localhost:3000) |
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

`db reset` is the one to reach for after changing a migration. It is destructive
and local-only.

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
| `supabase start` hangs or errors | Docker Desktop is not running. `docker info` first. |
| Port already allocated | Something else holds 54321–54324. `npx supabase stop` then start again. |
| "Not connected to a database yet" on the login page | `.env.local` missing or still placeholder. |
| Signed in, everything empty | `npm run bootstrap:owner` |
| `relation "people" does not exist` | The client is looking at `public`. The schema is `manifest` — check `[api] schemas` in config.toml. |
| Studio shows no tables | Switch the schema selector to `manifest`. |
| Magic link never arrives | It did — it is at [localhost:54324](http://localhost:54324), not in your real inbox. |

`npm run ci` needs none of this and passes on its own — 253 tests against an
in-process Postgres. If CI is green and the local stack misbehaves, the
difference is configuration, not logic.

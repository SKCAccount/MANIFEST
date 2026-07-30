# Getting MANIFEST running

Nine steps, about fifteen minutes. `npm run doctor` checks your progress at any
point and tells you what is missing — run it whenever you are unsure.

There is no Docker requirement. The test suite runs against an in-process
Postgres; this guide is for the real instance you will actually use.

---

## 1. Create a Supabase project

[supabase.com/dashboard](https://supabase.com/dashboard) → **New project**.

- Region: closest to you.
- Save the database password somewhere — you need it in step 4 and it is not
  recoverable from the dashboard afterwards.

**Make two projects if you want to look around before committing.** One scratch
project for the 25 demo people, one clean project for your real relationships.
The free tier allows two. Mixing invented people into a real rolodex is the one
thing this system must never do, and the fixture scripts refuse to help you do
it — but separate projects make it impossible rather than merely awkward.

## 2. Fill in `.env.local`

```bash
cp .env.example .env.local
```

From **Project Settings → Data API**, copy the Project URL. From **Project
Settings → API Keys**, copy the `anon` key and the `service_role` key:

```
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
SUPABASE_SERVICE_ROLE_KEY=<service_role key>
MANIFEST_OWNER_EMAIL=derek@seakingcapital.com
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

`ANTHROPIC_API_KEY` is optional. Without it quick capture falls back to the
manual form and everything else works unchanged.

`.env.local` is gitignored. The `service_role` key bypasses row-level security —
it belongs in that file and nowhere else.

```bash
npm run doctor      # should show the four env vars green, schema missing
```

## 3. Allowlist the callback URL

**Authentication → URL Configuration:**

- Site URL: `http://localhost:3000`
- Redirect URLs: add `http://localhost:3000/auth/callback`

Skip this and the magic link will send successfully and then refuse to sign you
in, which is a confusing ten minutes.

## 4. Push the schema

```bash
npx supabase login
npx supabase link --project-ref <ref>     # the ref is in your project URL
npm run db:push
```

`db:push` applies migrations `0001`–`0019`. It does **not** load the fixtures —
`seed.sql` is deliberately separate, so a production push can never insert
invented people.

```bash
npm run doctor      # schema, taxonomies and views should now be green
```

## 5. Create your auth user

Signup is disabled by design (`config.toml`: `enable_signup = false`), so this
is a deliberate manual step rather than something an unknown address can do.

**Authentication → Users → Add user:**

- Email: your own address
- Tick **Auto Confirm User**

## 6. Register yourself as the owner

```bash
npm run bootstrap:owner
```

This writes your auth user id into `app_owners`, which is what every RLS policy
checks. **Without it you can sign in successfully and see a completely empty
rolodex** — the most confusing possible failure, which is why it gets its own
command.

```bash
npm run doctor      # everything green
```

## 7. Start the app

```bash
npm run dev
```

Open [localhost:3000](http://localhost:3000), enter your address, and follow the
emailed link.

**If the email does not arrive:** Supabase's built-in SMTP is rate-limited to a
couple of messages an hour on the free tier and lands in spam more often than
not. The reliable path while testing is **Authentication → Users → ⋯ → Send
magic link**, or generate a link straight from the dashboard.

## 8. Load the demo data — scratch project only

```bash
npm run fixtures:load
```

25 people across two contact statuses, four events, all four development
stages, and a three-link referral chain. Enough to see every screen do something
real.

The API cannot execute arbitrary SQL, so this needs a direct connection. Either:

```bash
npx supabase db reset --linked        # destructive: re-applies migrations + seed
```

or, using the connection string from **Project Settings → Database**:

```bash
psql "<connection string>" -f supabase/seed.sql
```

Then, before your first real record:

```bash
npm run fixtures:clear
```

That removes exactly the fixture rows — they all carry recognizable id prefixes
— and leaves anything you have entered alone. `npm run doctor` always tells you
which of your records are fixtures.

## 9. Enter your thirty most important relationships

This is the actual test, and the spec is explicit that it comes before Phase 2.
Two entry paths, deliberately different:

- **Add a relationship** (`/person/new`) — someone you have spoken to. Requires
  the conversation that established it. The database rejects an "active" record
  whose touchpoint would not prove two-way contact.
- **Add to watchlist** (`/watchlist/new`) — someone you intend to meet. Requires
  a written reason and one identifier. One person at a time, no paste-a-list.
  The tedium is the feature.

Once you have a dozen records in, the things worth checking are the ones no test
can judge:

| Try | What you are judging |
|---|---|
| Queue on your phone | Ten seconds to "who is overdue and what do I say"? Is the opener useful or noise? |
| Cmd+J, describe a real conversation | Under fifteen seconds end to end? Does the parse get direction right? |
| Directory: a function + a specialty | Does the two-dimensional answer actually match who you would name? |
| Geography: a city you are travelling to | Is the warm-path suggestion someone you would really ask? |
| Log an attempt on a watchlist entry | Confirm they stay on the watchlist and out of the Directory. |

---

## When something is wrong

`npm run doctor` first. It checks env, connectivity, schema, views, auth user,
owner registration and fixture state, and prints the next action for each.

| Symptom | Cause |
|---|---|
| `fetch failed` on the sign-in form | The app cannot reach the project URL. Wrong URL in `.env.local`, project still provisioning, or a free-tier project paused after a week idle. Not a sign-in problem. |
| "Not connected to a database yet" | No `.env.local`, or it still holds placeholder values. The page tells you which. |
| Signed in, every screen empty | `app_owners` has no row for you → `npm run bootstrap:owner` |
| Magic link signs you out again | Callback URL not allowlisted (step 3) |
| No magic link email | Free-tier SMTP limit — send it from the dashboard instead |
| `relation "people" does not exist` | Migrations not pushed → `npm run db:push` |
| A screen 500s on a view | A migration applied partially → `npm run db:push` again |
| "not a known specialty" on save | The value is not in `taxonomies` yet — add it there first |

Before reporting a bug in the app, `npm run ci` confirms the schema and logic
are sound locally (234 tests, migrations applied to an empty database). If CI is
green and the deployed instance misbehaves, the difference is configuration.

# Getting MANIFEST running on a hosted Supabase project

**Want it fully local instead?** [LOCAL.md](LOCAL.md) — Docker, whole stack on
your machine, magic links caught in a local inbox. Better for testing.

Eleven steps, about twenty minutes — the last one connects Gmail and Calendar
and is deliberately left until after you have entered real relationships.
`npm run doctor` checks your progress at any point and tells you what is
missing — run it whenever you are unsure.

There is no Docker requirement. The test suite runs against an in-process
Postgres; this guide is for the real instance you will actually use.

---

## 1. Create a Supabase project

[supabase.com/dashboard](https://supabase.com/dashboard) → **New project**.

- Region: closest to you.
- Save the database password somewhere — you need it in step 5 and it is not
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
MANIFEST_OWN_DOMAINS=seakingcapital.com
CRON_SECRET=<any long random string>
```

`MANIFEST_OWN_DOMAINS` is required before sync will run at all — it is how sync
tells which side of a thread is you, and therefore which touchpoints are
inbound. Inbound promotes a watchlist entry to an active relationship, so with
this empty the entire watchlist would promote on your own unanswered mail, and
an active record can never be returned to the watchlist. Sync refuses to start
rather than degrade.

`ANTHROPIC_API_KEY` is optional. Without it quick capture falls back to the
manual form and synced touchpoints keep their subject line instead of a summary.

The `GOOGLE_*` variables are optional. Leave them empty and sync replays the
fixtures in `src/lib/sync/google/fixtures/` instead of reading a real mailbox —
useful for confirming the screens work before going through Google's OAuth
verification. See step 11.

`.env.local` is gitignored. The `service_role` key bypasses row-level security —
it belongs in that file and nowhere else.

```bash
npm run doctor      # should show the env vars green, schema missing
```

## 3. Expose the `manifest` schema

**Project Settings → Data API → Exposed schemas** — add `manifest`.

MANIFEST owns its own schema rather than `public`, so the other systems
(Kraken, Plunder, Harpoon, Deepwatch) can share this project without colliding.
Skip this and the API cannot see any of it: you will sign in fine and every
screen will return nothing.

## 4. Allowlist the callback URL

**Authentication → URL Configuration:**

- Site URL: `http://localhost:3000`
- Redirect URLs: add `http://localhost:3000/auth/callback`

Skip this and the magic link will send successfully and then refuse to sign you
in, which is a confusing ten minutes.

## 5. Push the schema

```bash
npx supabase login
npx supabase link --project-ref <ref>     # the ref is in your project URL
npm run db:push
```

`db:push` applies migrations `0001`–`0022`. It does **not** load the fixtures —
`seed.sql` is deliberately separate, so a production push can never insert
invented people.

```bash
npm run doctor      # schema, taxonomies and views should now be green
```

## 6. Create your auth user

Signup is disabled by design (`config.toml`: `enable_signup = false`), so this
is a deliberate manual step rather than something an unknown address can do.

**Authentication → Users → Add user:**

- Email: your own address
- Tick **Auto Confirm User**

## 7. Register yourself as the owner

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

## 8. Start the app

```bash
npm run dev
```

Open [localhost:3000](http://localhost:3000), enter your address, and follow the
emailed link.

**If the email does not arrive:** Supabase's built-in SMTP is rate-limited to a
couple of messages an hour on the free tier and lands in spam more often than
not. The reliable path while testing is **Authentication → Users → ⋯ → Send
magic link**, or generate a link straight from the dashboard.

## 9. Load the demo data — scratch project only

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

## 10. Enter your thirty most important relationships

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

## 11. Connect Gmail and Calendar

Do this **after** step 10, not before. Sync is worth far more against a rolodex
that already knows thirty people: every address it recognises becomes a
touchpoint, and every one it does not becomes a review item. Connect it to an
empty database and essentially all of your mail lands in the review queue.

In the [Google Cloud console](https://console.cloud.google.com/apis/credentials):

1. Create an OAuth 2.0 Client ID, type **Web application**.
2. Add `https://<your-domain>/api/google/callback` as an authorised redirect URI
   (and `http://localhost:3000/api/google/callback` for local work).
3. Enable the **Gmail API** and the **Google Calendar API**.
4. On the consent screen, add the scopes `gmail.readonly` and
   `calendar.readonly`. MANIFEST never writes to Google and asks for nothing
   else.

Then fill in `.env.local` and connect:

```
GOOGLE_CLIENT_ID=<client id>
GOOGLE_CLIENT_SECRET=<client secret>
GOOGLE_REDIRECT_URI=http://localhost:3000/api/google/callback
```

Open `/sync` and press **Connect Google**. The fixture banner disappears once a
real account is attached.

**The first run reaches back six months and is the long one.** Run it from a
terminal where you can watch it rather than waiting on a cron:

```bash
npm run sync
```

Then work `/review` down to empty. Every address there is one sync deliberately
refused to guess at, and each one you resolve teaches it a person it will
recognise from then on. Attaching an address also pulls in that person's earlier
correspondence, so a record you confirm does not start blank.

Scheduled runs are in `vercel.json` — hourly for Gmail, every four hours for
Calendar — and are rejected unless `CRON_SECRET` is set in the deployment's
environment.

---

## When something is wrong

`npm run doctor` first. It checks env, connectivity, schema, views, auth user,
owner registration and fixture state, and prints the next action for each.

| Symptom | Cause |
|---|---|
| `fetch failed` on the sign-in form | The app cannot reach the project URL. Wrong URL in `.env.local`, project still provisioning, or a free-tier project paused after a week idle. Not a sign-in problem. |
| "Not connected to a database yet" | No `.env.local`, or it still holds placeholder values. The page tells you which. |
| Signed in, every screen empty | `app_owners` has no row for you → `npm run bootstrap:owner` |
| Magic link signs you out again | Callback URL not allowlisted (step 4) |
| No magic link email | Free-tier SMTP limit — send it from the dashboard instead |
| `relation "people" does not exist` | Either migrations are not pushed (`npm run db:push`), or the `manifest` schema is not exposed to the API (step 3). |
| A screen 500s on a view | A migration applied partially → `npm run db:push` again |
| "not a known specialty" on save | The value is not in `taxonomies` yet — add it there first |
| Sync refuses to start | `MANIFEST_OWN_DOMAINS` is unset. It is the one setting sync will not run without — see step 2. |
| Sync says "fixture data" | No `GOOGLE_CLIENT_ID`. It is replaying canned messages, not reading your mailbox (step 11). |
| Scheduled runs never fire | `CRON_SECRET` unset in the deployment. `/api/cron/*` fails closed. |
| A channel says "not granted" beside a scope | Google's consent screen lets you approve one API and not the other. Reconnect and tick both. |
| Everything landed in `/review` | Sync matches on email address only, so it recognises nobody until the rolodex has addresses on file. This is why step 11 comes after step 10. |
| A synced day looks wrong | The summary comes from the subject line and Gmail's ~200-character snippet — the body is never fetched. Use "Open in Gmail" on the timeline entry. |

Before reporting a bug in the app, `npm run ci` confirms the schema and logic
are sound locally (317 tests, migrations applied to an empty database). If CI is
green and the deployed instance misbehaves, the difference is configuration.

# Run Civic Pulse locally: end-to-end guide

This guide takes you from a fresh checkout to a running app you can sign in to, with every step in order. It is written for Windows and PowerShell.

**What you will have at the end:** the app running at `http://localhost:3000`, connected to your own Supabase project, with one administrator who can sign in, manage accounts and households, and create and preview votes.

**What the app can do today (be clear on scope):** sign-in with an emailed code, accounts and household register administration, vote drafts with a resident preview (both PUBLIC and PRIVATE), the vote lifecycle (activation, early completion, cancellation, automatic completion at the deadline), **resident voting screens** (your votes, ballot, review, changeable PUBLIC response until closure, immutable PRIVATE submission, recovery from an unclear outcome), **live aggregate PUBLIC results and completed results**, **CSV/PDF downloads**, administrator **participation** and **audit history**, automatic **retention** clean-up, encrypted **backups** with a tested local restore, a **health** route and **maintenance mode** (see [OPERATIONS.md](./OPERATIONS.md)). Public privacy/contact pages, discovery metadata and optional contact/Google integrations are also implemented. Code gaps (including trusted-client-IP enforcement), production configuration, approvals and external verification still block launch; see [LAUNCH_AUDIT.md](./LAUNCH_AUDIT.md) and [PILOT_READINESS.md](./PILOT_READINESS.md).

---

## 1. What you need

| Need | Notes |
|---|---|
| Windows with PowerShell | Commands below are PowerShell. |
| **Node.js 24** and npm 10+ | The project requires `>=24 <25`. A portable copy works: unzip it and put its folder on `PATH` per session (step 2). |
| A free **Supabase** account | You will create a project. Use a **disposable** project for development: created users cannot be deleted afterwards by design (see section 11). |
| An inbox you can read | For sign-in codes (step 8). A Gmail test account works. |
| Optional: PostgreSQL **17** (portable is fine) | Only for the database integration tests (section 10). Use 17, the version Supabase runs; 18 behaves differently. |
| Optional: Docker | Only if you prefer the fully local Supabase stack (`supabase start`). This guide uses a hosted project instead because it needs no Docker or admin rights. |

You do **not** need to install Git, Docker or admin rights to follow this guide.

---

## 2. Open a shell and put Node on PATH

Each PowerShell window starts fresh, so repeat this in every new window (skip it if Node 24 is installed system-wide):

```powershell
$env:PATH = "C:\Users\<you>\Apps\Portable\node-v24.22.1;" + $env:PATH
cd C:\Users\<you>\Apps\Local-Dev\arp-civic-pulse
node --version    # should print v24.x
npm --version
```

---

## 3. Install dependencies

```powershell
npm install
```

If your network performs TLS inspection (common on corporate laptops) and `npm install` or the app fails with certificate errors, see section 10 ("Corporate TLS").

---

## 4. Create a Supabase project

1. Sign in at <https://supabase.com/dashboard> and choose **New project**.
2. Name it (for example `civic-pulse-dev`), pick a region near you, and set a **database password**. Save the password in a password manager. Never paste it into chat or commit it.
3. Wait until the project finishes provisioning.

### 4.1 Collect the values you need

You will copy these into `.env.local` in step 5. Dashboard labels move around over time; look for these names:

| Value | Where to find it |
|---|---|
| Project URL | **Project Settings → API** (looks like `https://<ref>.supabase.co`) |
| Publishable key | **Project Settings → API Keys** (a key starting `sb_publishable_`, or the legacy `anon` key) |
| Secret key | Same page (a key starting `sb_secret_`, or the legacy `service_role` key). **Server-only. Never expose it.** |
| Session pooler connection string | **Connect** button → **Session pooler** (looks like `postgresql://postgres.<ref>:<password>@<host>:5432/postgres`) |

Use the **session pooler** string, not the direct one: the direct connection is IPv6-only on many networks.

### 4.2 Configure Authentication

In **Authentication** (names may vary slightly):

1. **Sign In / Providers → Email:** keep Email enabled. **Turn off "Allow new users to sign up"** (Supabase Auth sign-up stays off; administrators create accounts, and resident self-registration at `/register` creates identities through the server's privileged Auth client, which this setting does not block).
2. **Email OTP length: 6.** The app asks for a six-digit code.
3. **URL Configuration:** set **Site URL** to `http://localhost:3000`.
4. Email delivery: see step 8. The built-in email service cannot carry a code, so read that step before you try to sign in.

---

## 5. Create `.env.local`

Copy the example and fill it in. `.env.local` is ignored by Git; never commit it.

```powershell
Copy-Item .env.example .env.local
notepad .env.local
```

Fill in:

```dotenv
APP_ORIGIN=http://localhost:3000
LOG_LEVEL=info

NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable or anon key>
SUPABASE_SERVICE_ROLE_KEY=<secret or service_role key>
RATE_LIMIT_HMAC_KEY=<at least 32 random characters>

# Needed only for migrations and the live tests (not read by the running app):
LIVE_DATABASE_URL=postgresql://postgres.<ref>:<password>@<host>:5432/postgres
LIVE_TEST_EMAIL=<your test inbox address, for the live tests only>
```

Generate a good `RATE_LIMIT_HMAC_KEY`:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Important details:

- `APP_ORIGIN` must **exactly** match the address in your browser. If you browse to `http://localhost:3000`, use that; `127.0.0.1` is a different origin and will fail the app's security check ("Your page has expired. Reload it and try again.").
- `NEXT_PUBLIC_*` values are visible to browsers. Only the publishable key belongs there. The secret key and `LIVE_DATABASE_URL` are server-side only.
- If your database password contains special characters, URL-encode them in the connection string.

For an authorized developer's **read-only setup review without an app login**,
set the separate `CONFIG_DATABASE_URL` in the ignored environment/secret store
and run `npm run ops -- config-check`. It requires approved operator database
access and verified remote TLS, never just a public Supabase key. It reports
RWA configuration and aggregate setup counts without changing records or
exposing resident details. Its environment check enforces production shape, so
local HTTP origins intentionally fail that check; this does not mean local
development is broken. See [Operations](./OPERATIONS.md#read-only-rwa-configuration-inspection)
for permissions, output/exit semantics and checks that remain manual.

To try **App Support Access** locally, add an optional `APP_SUPPORT_EMAIL=<a
synthetic address>` to `.env.local` and apply the `20261112100000` migration. The
variable alone grants nothing; sign in as a local RWA Admin, open RWA Settings and
turn App Support Access on to create the household-free, read-only support
profile, then turn it off to suspend it. See
[Operations](./OPERATIONS.md#app-support-access-developer-help-rwa-controlled).

### 5.1 Optional public contact and Google integrations

The public `/sign-in`, `/privacy` and `/contact` pages are server-rendered.
`/register` (resident self-registration) is also public but `noindex` and not in
the sitemap; it needs the `20261109100000` migration and creates only suspended,
ineligible records.
The footer's **User Guide** opens `/user-guide.html` without sign-in. The guide
generator runs before `npm run dev` and `npm run build`, publishing a standalone
HTML copy with embedded synthetic screenshots. Edit the Markdown guide rather
than the generated public file; run `node scripts/docs/render.mjs` to regenerate
it while a development server is already running. The technical guide remains
repository-only. This help page is no-indexed and is not part of the sitemap.
`/robots.txt`, `/sitemap.xml` and `/opengraph-image` use `APP_ORIGIN`; verify that
their canonical URLs match your local address. Member and admin routes remain
no-indexed and are not listed in the sitemap.

Leave these optional `.env.example` settings blank for ordinary local work:

| Setting | When needed |
|---|---|
| `RESEND_API_KEY` | Server-only contact-email credential, separate from Supabase OTP SMTP |
| `CONTACT_EMAIL_FROM` | Bare sender email on a verified Resend domain |
| `CONTACT_EMAIL_TO` | Controlled administrator/test inbox; never use a production recipient for synthetic tests |
| `GOOGLE_ANALYTICS_ID` | Optional GA4 `G-...` identifier, public information pages only after opt-in |
| `GOOGLE_SITE_VERIFICATION` | Google HTML verification token, not the complete meta tag |

Configure all three contact settings together or startup validation fails. With
all three blank, `/contact` explicitly says online contact is not available.
Never use a fake key to send real requests or paste secrets into chat. Tests use
synthetic settings with intercepted providers. A provider acceptance response
is not proof of inbox receipt.

Analytics is off by default and never tracks sign-in, voting or administration.
If enabling it, disable all GA4 Enhanced Measurement and advertising features;
check refusal, opt-in and withdrawal. Public-to-auth links intentionally load a
new document so an executed Google script does not survive into sign-in.
Restart development after changing settings; production needs matching build
and runtime settings plus a rebuild. Real delivery, provider approval and Google
property verification are separate steps in
[Deployment](./DEPLOYMENT.md#public-site-integrations).

---

## 6. Create the database schema

The schema (tables, security rules, guarded routines) lives in `supabase/migrations`. Apply it to your project with the Supabase CLI, which is already a project dev tool, using the connection string from step 4.1. First load `.env.local` into the current shell (values never appear on the command line):

```powershell
Get-Content .env.local | ForEach-Object { if ($_ -match '^\s*([A-Z_]+)=(.*)$') { Set-Item "env:$($matches[1])" $matches[2].Trim() } }

# Review what would be applied, then apply it:
npx supabase db push --db-url $env:LIVE_DATABASE_URL --dry-run
npx supabase db push --db-url $env:LIVE_DATABASE_URL --yes
```

You should see the migrations listed (`20261024100000` through `20261026100000`) and `Finished supabase db push.` The lifecycle migration also schedules a Supabase Cron job (`civic-pulse-complete-due-votes`, once a minute) when `pg_cron` is available, which it is on Supabase.

> `supabase link` needs a management token with extra permissions and is not required. `db push --db-url` is enough.

---

## 7. Set up the RWA and the first administrator

There is no default password, and self-registration never creates administrators, so the first administrator is created by a short, audited setup procedure.

### 7.1 Create the administrator's sign-in identity

In the Supabase dashboard: **Authentication → Users → Add user → Create new user.** Enter the administrator's email address, **tick "Auto Confirm User"**, and create it. Copy the user's **UID** (a UUID).

### 7.2 Run the setup SQL

In the dashboard open **SQL Editor** and run, replacing the placeholders:

```sql
-- Name and time zone of your RWA (deadlines are entered and shown in this zone).
select app_private.deployment_initialize_settings('My Society RWA', 'Asia/Kolkata');

-- Makes the user from step 7.1 an enabled administrator.
select app_private.deployment_bootstrap_admin('<auth user UID>', 'Asha Admin');
```

Each procedure writes an audit event. `deployment_initialize_settings` can only be run once.

Additional committee accounts use the Accounts page's exclusive management-role
selector. A household is optional for `rwa-readonly`; assign one only if that
observer should also vote through it. The account must still be explicitly
enabled. Role assignment is admin-only and does not create or transfer voting
entitlement.

> If the SQL Editor reports that it cannot run `app_private` functions, run the same two statements with any PostgreSQL client connected through `LIVE_DATABASE_URL` (for example the `psql` that ships with the portable PostgreSQL).

### 7.3 Policy approvals (needed to activate a vote)

Activation requires the seven policy approvals (A1-A7) and every retention period to be recorded, so until they are the preview shows the blocker "Policy approvals and retention periods are not all recorded". **Real approvals must be recorded by the people who actually approve them**; the procedures are in `supabase/README.md`.

To try activation on a **disposable development project only**, you can record clearly marked *fixture* approvals. They are not real approvals, and must never be copied to a real deployment. In the SQL Editor, replace `<admin UID>` with the administrator's UID from step 7.1:

```sql
select app_private.deployment_record_policy_approval(k, 'fixture-v1', now(), '<admin UID>', 'FIXTURE ONLY (development)', 'APPROVED')
from unnest(array['A1','A2','A3','A4','A5','A6','A7']) as k;

select app_private.deployment_set_retention(365, 365, 365, 30, 90);
```

---

## 8. Make sign-in codes arrive

The app signs people in with a **six-digit code**. Supabase's built-in email service is restricted to authorized project-team recipients and has low sending limits; use custom SMTP for staging delivery to app users. Configure the OTP template explicitly rather than relying on a default magic-link email. You have two options.

### Option A: custom SMTP (needed for real emailed codes)

1. In Brevo, verify a sender you control. Prefer an authenticated domain you own. A verified personal Gmail sender was accepted for this disposable staging setup, but Brevo warns against freemail domains; it is not production sender-domain approval.
2. In Brevo **Settings → SMTP & API → SMTP**, obtain the SMTP Login and generate a dedicated Standard SMTP key. Complete provider identity verification yourself. The SMTP Login may differ from the account email. The password is the **SMTP key**, not a Brevo API key, account password or Gmail app password.
3. In Supabase **Authentication → Emails → SMTP Settings**, enable custom SMTP and set host `smtp-relay.brevo.com`, port `465` (TLS), username = Brevo SMTP Login, password = SMTP key, sender email = the verified sender, and sender name = `Civic Pulse`. Save and reload to confirm persistence. Enter credentials directly into the provider dashboard, never chat, Git, Vercel or application environment files.
4. In **Emails → Templates → Magic link or OTP**, set subject `Your Civic Pulse sign-in code` and use [the repository OTP template](../supabase/templates/magic_link.html), whose essential variable is `{{ .Token }}` rather than `{{ .ConfirmationURL }}`. Verify the saved template, not just its preview.
5. Test using an existing project **Authentication → Users** identity with an enabled application profile. A Supabase dashboard login and a Brevo sender are not app accounts. Code requests use `shouldCreateUser=false`; unknown addresses receive the same generic app acknowledgement but no sign-in code. Provision normal residents through the app and use the audited setup/provisioning routines for authorized administrators, never grant admin merely to enable email.
6. Confirm actual inbox receipt, enter the newest code in the app, and verify sign-in. Provider acceptance alone is not delivery evidence. The 28 October staging test passed with six-digit OTPs, the existing one-hour expiry and 30 emails/hour; these unchanged provider settings are not production policy/capacity approval. Check Brevo account/key limits and rotate the SMTP key before its expiry or inactivity revocation.

Direct Gmail SMTP is a separate development-only alternative: host `smtp.gmail.com`, port `465`, Gmail username and a Google app password after enabling 2-Step Verification. Do not mix those credentials with Brevo's SMTP host.

### Option B: skip email for development

You can mint the same code the email would contain with the Auth admin API (no email is sent). Run this from the project folder after loading `.env.local` (step 6), using the administrator's email:

```powershell
node --input-type=module -e "import { createClient } from '@supabase/supabase-js'; const a = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }); const r = await a.auth.admin.generateLink({ type: 'magiclink', email: process.argv[1] }); console.log(r.data?.properties?.email_otp ?? r.error?.message)" admin@example.com
```

It prints six digits. Use the email of a user that **already exists** (for example the administrator from step 7.1): the admin API creates an Auth user if the address is unknown. Treat the secret key as a password and use this on a development project only.

> Codes are single-use and expire. Requesting a new code invalidates earlier ones.

---

## 9. Run the app

```powershell
npm run dev
```

Wait for `Ready`, then open **<http://localhost:3000>** (use `localhost`, matching `APP_ORIGIN`).

If port 3000 is busy, either stop whatever uses it or run `npm run dev -- --port 3100` and change `APP_ORIGIN` to `http://localhost:3100`, then restart.

### 9.1 Sign in

1. You land on **Sign in**. Enter the administrator's email and choose **Send Sign-In Code**. The screen always says "If this address can sign in, a code may arrive shortly" so it never reveals who is registered.
2. Enter the six-digit code from your inbox (Option A) or from the script (Option B) and choose **Verify and Sign In**.
3. You arrive on **Votes** with a header showing **Households, Accounts, Manage Votes** (administrators only) and, on the right of the tabs, **Sign Out**.

### 9.2 A guided first walkthrough

The approved visual style now covers all screen families, with unchanged actions
and voting rules. For this rollout the User Guide/images/HTML are intentionally
frozen: run a direct Next build/dev command rather than npm's guide-regeneration
hooks. Set `PLAYWRIGHT_PRESERVE_GUIDE=1` and run
`npx playwright test tests/e2e/visual-rollout.spec.ts --project=chromium --workers=1`
for public checks; add the existing `LIVE_AUTH=1` disposable-project opt-in and
verified CA setup for admin/resident journeys. This test writes only to temporary
`test-results/` output, not `docs/images` or published guide files.

Votes now follows the approved concept. Verify the three totals against the
signed-in fixture's own entitlements (not the whole RWA); filter cards and confirm
those totals stay unchanged. Record a PUBLIC response, verify real aggregate
turnout and its live-results link, and confirm PRIVATE candidates never appear
in the list. Status links, type menu, history and Cancelled/Clear retain discovery
and pagination. The existing focused `--grep "Platinum and Obsidian"` capture
creates these actual synthetic states and refreshes the guide; no migration is
required. All unavailable-data states must remain explicit rather than zero-filled.

The header appearance icon offers Light (Platinum), Dark (Obsidian) and System
(default). Verify persistence after reload, live device changes in System,
keyboard/Escape behavior, invalid/blocked local storage and light print output.
Only `civic-pulse-theme` is persisted; it is not an account setting or ballot data.
Browser fonts are served locally by Next after build-time font preparation.
Run `npx playwright test tests/e2e/theme.spec.ts --project=chromium` for the public
theme checks. The opted-in `--grep "Platinum and Obsidian"` documentation capture
uses the verified disposable fixture project for actual Votes/Accounts pictures.

For tabular onboarding review, open **Accounts** (Residents is the default role),
filter Suspended and select valid rows on the current page. **Enable Selected**
allows sign-in; **Make Eligible** separately changes assigned-flat eligibility
for future votes. Select All Roles explicitly to include administrators, whose
enable confirmation carries a management-access warning. Changing page/filters
clears selection. Use the existing reviewed schema; this UI adds no migration.
To review residents who registered themselves at `/register`, also set **Source**
to **Self-registered**; their flats start ineligible, so use **Make Eligible** as
well as **Enable Selected** once you have checked them.
The focused screenshot/browser command is
`npx playwright test -c playwright.docs.config.ts --grep "bulk account review"`,
with the documented disposable-project opt-ins and verified CA configuration.

For bulk onboarding, open **Households -> Import CSV**, download the template,
use synthetic names/emails and explicit `true`/`false` eligibility, then check
and confirm ready rows. Review each imported account before enabling it. For
scheduled opening, use **Schedule Vote** on a ready preview, enter an opening
before closure in the configured RWA time zone, and confirm the immediate freeze.
Check the resident summary/countdown and pre-opening **Return to Draft** with a
reason. These workflows require the reviewed `20261106100000` and
`20261107100000` migrations; apply only to an independently verified disposable
environment using section 6. Do not point fixtures or captures at production.

Follow this to see every built feature:

1. **Accounts → Add account.** Create a resident (name + email) and, in the same form, choose their household (for example `A-101`; when Settings → Default Households is set, pick it from the list) and tick **Eligible to vote**. Tick **Enable account now** to skip step 2. New accounts otherwise start **Suspended**.
2. **Accounts →** open the resident and choose **Enable Account** (confirm in the dialog). A resident can only be enabled once they have a household; an account created without one can be given one from its own page (**Household** section).
3. Repeat steps 1-2 for a few residents.
5. **Manage Votes → New Vote.** Choose **PUBLIC** (a question with options) or **PRIVATE** (an election with offices and candidates) and **Create Draft**.
6. In the editor fill in the five sections: voting type, details, ballot, electorate (search and tick households), and deadline (entered in your RWA's time zone; you see how residents will read it). **Save Draft.**
7. Choose **Preview Ballot** to see exactly what residents will see: the privacy notice, the deadline with its time zone, and the unselected choices (PRIVATE votes show built-in **NOTA (None of the Above)** per office). The preview lists anything still blocking activation, with a link to fix each.
8. Try editing the same draft in two browser tabs and saving in both: the second save is refused with "Someone saved a newer version of this draft", and you can keep your changes on top of the latest version without losing either person's work.
9. **Activate it** (needs step 7.3, a complete draft, at least one eligible household with an enabled representative, and a future deadline). On a ready preview, choose **Activate Vote** and confirm. Type, ballot, electorate and representatives are now frozen (only the deadline can still be moved, see step 12): the editor is gone and the vote page shows its lifecycle (activated time, deadline).
10. **Vote as a resident.** Sign out, then sign in as one of the residents in the electorate (with Option B in section 8 you get their code from the Auth admin API). **Votes** lists the vote with its deadline in the RWA's time zone and a **Not voted** badge. Open it, read the privacy notice, choose an option (nothing is pre-selected; a PRIVATE vote has **NOTA (None of the Above)** for every office), choose **Review Selections**, check the summary (use **Back** to change it), then **Submit Vote**. PUBLIC choices can be changed again until closure; PRIVATE submissions remain final. Choices are not kept in the page after acknowledgement, the address or browser storage.
11. **Watch participation (administrator).** On an activated vote page choose **Participation** to see which households have submitted (never what they chose) and filter by submitted / not submitted. **Audit History** (header) lists administrative actions, newest first, with filters.
12. **End it:** on an active vote choose **Complete Vote Early** or **Cancel Vote**. Each needs a written reason, is final, and is recorded. If you leave the deadline to pass instead, the vote is completed automatically (normally within a minute by Supabase Cron) and records the deadline, not the moment it was processed, as its end time. There is no way to reopen a finished vote. While a vote is still active, **Change Deadline** moves its closing time later or earlier (at least 5 minutes ahead, with a written reason recorded in the audit trail).
13. **See the results.** During an active PUBLIC poll, residents in its electorate and administrators can open **View Live Results** for aggregate turnout and option counts; the page refreshes about every 10 seconds and never shows individual choices. During an active PRIVATE election, members can open **View Live Turnout** for aggregate count/percentage only; admins may additionally use the separate participation page to identify households for follow-up, without seeing choices. Candidate and NOTA totals remain hidden until completion. After completion, authorised viewers can open **View Results**: turnout (with the denominator), candidate and NOTA bars showing each count out of the eligible households with its percentage, and ties spelled out. NOTA is counted separately and never wins; the highest-count candidate wins even if NOTA has more votes. **Download CSV** and **Download PDF** give the same completed numbers (and, for PUBLIC, the complete named list). The PDF is a printable A4 copy; if a name contains characters outside Latin, Greek, Cyrillic and Devanagari the PDF refuses rather than dropping them, and the CSV still works. A cancelled vote shows **Cancelled; results not valid.** and offers nothing to download.

---

## 10. Run the tests (optional)

| What | Command | Needs |
|---|---|---|
| Format, types, lint | `npm run format:check`, `npm run typecheck`, `npm run lint` | Nothing extra |
| Unit tests | `npm test` | Nothing extra |
| Production build | `npm run build` | `.env.local` loaded |
| Real-database tests | `npm run test:integration` | A throwaway local PostgreSQL (below) |
| Hosted-Supabase tests | `npm run test:live` | `.env.local` loaded; a disposable project |
| Browser tests | `npx playwright test --project=chromium` | `npx playwright install chromium` once; add `LIVE_AUTH=1` for the signed-in specs |

**Integration tests** need a disposable **PostgreSQL 17** server (the version Supabase runs; never a shared or production one). One-time setup of a throwaway cluster, then start it in its own window or as a background process (do not use `pg_ctl -w`, which can hang a shell):

```powershell
$bin  = "C:\Users\<you>\Apps\Portable\postgresql-17.11-5\pgsql\bin"
$data = "C:\Users\<you>\Apps\Portable\temp\cp-pgdata17"
& "$bin\initdb.exe" -D $data -U supabase_admin -A trust -E UTF8      # once
& "$bin\postgres.exe" -D $data -p 54399 -c listen_addresses=127.0.0.1 -c max_connections=60
```

Then, in another window (Node on PATH, project folder):

```powershell
$env:INTEGRATION_DATABASE_URL = "postgres://supabase_admin@127.0.0.1:54399/postgres"
npm run test:integration
```

Each test file creates and drops its own database. Stop the server with `Ctrl+C` in its window when you are done. Trust authentication is acceptable only because the server listens on `127.0.0.1` and holds nothing but throwaway test databases.

Two optional extras for the integration suite: set `PG_BIN_DIR` to the same `bin` folder (so the encrypted backup and restore rehearsal in `tests/integration/restore.test.ts` can run `pg_dump` and `pg_restore`; without it that file is skipped), and, for the 100-concurrent-user capacity test, start the server with `-c max_connections=300` instead of `60` and run `npm run test:load` on its own (`tests/load/db-capacity.test.ts`; it needs about 120 connections and is kept out of the normal integration run so it cannot starve the timing-sensitive tests).

**Browsers:** the same specs run in Firefox and WebKit (`npx playwright install firefox webkit`, then `--project=firefox` or `--project=webkit`). Two keyboard steps are skipped in the automated WebKit build and must be checked on real Safari (see [PILOT_READINESS.md](./PILOT_READINESS.md)).

**Browser tests:** install Playwright's own Chromium once with `npx playwright install chromium`. On managed Windows machines, policy can close Microsoft Edge shortly after Playwright starts it; the bundled Chromium avoids that. The signed-in specs create users in your project and need `LIVE_AUTH=1`:

The shared browser fixture database helper verifies remote TLS/hostname identity.
Download the database CA from the Supabase dashboard SSL settings, as explained
in the [provider guidance](https://supabase.com/docs/guides/platform/ssl-enforcement),
and set `PGSSLROOTCERT` to its PEM/CRT path in the test shell. The Windows system
trust store alone may not include this CA; do not disable certificate checks.

The local `.certs` folder at the repository root is excluded from Git and Vercel
deployment uploads. Place the dashboard-provided database CA there as
`supabase-db-ca.crt` (not a server certificate or private key). From the repository
root, configure the current PowerShell session before database scripts/tests:

```powershell
$env:PGSSLROOTCERT = Join-Path (Get-Location).Path ".certs\supabase-db-ca.crt"
```

The folder is local-only and is not included in clones; recreate it with
`New-Item -ItemType Directory -Force .certs` if needed. No certificate is supplied
by the repository. This setting does not configure ordinary Supabase HTTPS calls;
continue using Windows/Node system trust for those.

For focused documentation capture, also set `DOC_SCREENSHOTS=1` and run
`npx playwright test -c playwright.docs.config.ts --grep "bulk import and scheduled opening"`.
Stop another dev server in the same checkout first. Use only a confirmed
disposable project with reviewed migrations, synthetic data and image redaction;
see the technical guide for capture details and cleanup boundaries.

```powershell
$env:LIVE_AUTH = "1"
npx playwright test --project=chromium --workers=1
```

Do not run the live and browser suites repeatedly back to back: they sign in many times and Supabase's hosted Auth will answer "Too many requests" (HTTP 429) for several minutes. Wait and retry.

---

## 11. Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `node` / `npm` not recognised | Node is not on `PATH` in this window. Repeat step 2. |
| "Your page has expired. Reload it and try again." | The address in your browser does not exactly match `APP_ORIGIN` (`localhost` vs `127.0.0.1`, or a different port). Fix `APP_ORIGIN` and restart `npm run dev`. |
| Server will not start, mentions environment variables | A required value is missing or malformed in `.env.local` (for example `RATE_LIMIT_HMAC_KEY` shorter than 32 characters). The error names the setting. |
| Sign-in says "If this address can sign in…" but no email comes | Expected for unregistered addresses. For a registered one: custom SMTP is not set up (step 8) or the email is in spam. Use Option B to confirm the rest works. |
| The email has a link but no six-digit code | The Magic Link template was not replaced (step 8, Option A, point 3). |
| "The code is invalid or has expired" | Codes are single-use and short-lived; request a new one and use only the latest. |
| "Too many requests" | Supabase Auth or the app's own rate limit. Wait a few minutes. Repeated test runs trigger it. |
| Sign-in works but pages say "not found" | The signed-in user is not an enabled administrator. Re-check step 7.2. |
| Certificate errors (`SELF_SIGNED_CERT_IN_CHAIN`, `unable to get local issuer certificate`) | Corporate TLS inspection. Simplest on Node 24: `$env:NODE_USE_SYSTEM_CA = "1"` in the same shell, so Node trusts the Windows certificate store (the Supabase CLI already does). Otherwise export your organisation's root certificate to a `.pem` file and set `$env:NODE_EXTRA_CA_CERTS = "C:\path\root.pem"` (Node tools) and `$env:SSL_CERT_FILE = "C:\path\root.pem"` (the Supabase CLI). Never disable certificate verification. |
| `db push` cannot connect | Use the **session pooler** string (step 4.1), URL-encode special characters in the password, and check your network allows outbound port 5432. |
| Playwright: "browser has been closed" | Edge closed by policy; use `npx playwright install chromium` and run without `PLAYWRIGHT_CHROMIUM_CHANNEL=msedge`. |
| Port 3000 in use | See the note in step 9. |

---

## 12. Housekeeping and safety

- **Secrets:** never commit `.env.local`, paste keys or the database password into chat, tickets or screenshots, or put a secret in a `NEXT_PUBLIC_*` variable. If a secret leaks, rotate it in the Supabase dashboard (**Project Settings → Database / API Keys**).
- **Use a disposable project for development.** Accounts, profiles and audit events cannot be deleted through the app by design. When you are finished, delete the Supabase project (or reset it) and revoke any access token you created.
- **Use synthetic data** (fake names, test mailboxes) while developing.
- **Stopping:** press `Ctrl+C` in the window running `npm run dev`.
- **Later phases** (voting by residents, results, exports, retention, backups) are not implemented. Do not run a real vote with this build.

For the design and requirements behind all of this, see `docs/PRD.md`, `docs/ARCHITECTURE.md`, `docs/DATABASE.md`, `docs/API.md` and `supabase/README.md`.

# CAP Uniform Inspection Tracker

A GitHub-Pages-ready uniform inspection form and reporting dashboard for Civil Air Patrol cadets.

## What is included

- CAPID, cadet name, grade, and editable inspection date
- Cadet grade list from C/AB through C/Col
- Five scored categories:
  - Personal Appearance
  - Garments
  - Accoutrements
  - Footwear
  - Military Bearing
- 0/1/2 scoring: Needs Improvement / Satisfactory / Excellent
- Automatic overall scoring and pass/fail
- Individual cadet history with score trend chart
- Unit dashboard with pass rate, average score, category averages, rating distribution, recent activity, and trend notes
- CSV export for one cadet or all inspections
- Printable individual history report
- Administrator / Inspector roles
- Admin screen to create additional users
- Bulk Entry worksheet for entering an entire group on one inspection date
- Administrator-editable passing and Excellent thresholds
- Demo mode using browser localStorage
- Supabase mode using Auth, Postgres, RLS, and an Edge Function for secure user creation
- GitHub Actions workflow for GitHub Pages deployment

## Default scoring rules (editable in Administration)

### Airmen: C/AB through C/SrA

| Total | Overall | Passing |
|---:|---|---|
| 0-3 | Needs Improvement | No |
| 4-5 | Satisfactory | Yes |
| 6-10 | Excellent | Yes |

### NCOs and Officers: C/SSgt through C/Col

| Total | Overall | Passing |
|---:|---|---|
| 0-4 | Needs Improvement | No |
| 5-7 | Satisfactory | Yes |
| 8-10 | Excellent | Yes |

The browser displays the result live. Administrators can change the passing and Excellent thresholds from the Administration tab. In Supabase mode, those thresholds are stored in `grading_rules`, and the database trigger independently recalculates the total, rating, and pass/fail before saving.

---

# Fastest test: Demo mode

The project ships in demo mode. No server or database setup is necessary.

Default demo credentials:

- **Username:** `admin@cap.local`
- **Password:** `CAPinspect2026!`

Demo mode lets you create additional demo users from the Users tab. Demo passwords are SHA-256 hashed before storage, but this is **not intended as real security** because all demo data is stored only in that browser's localStorage. Different computers/browsers will not share demo data.

You can test by opening `index.html`, or publish the folder to GitHub Pages as-is.

---

# Shared database setup: Supabase

Use this when you want multiple evaluators/devices to share the same inspections. **You do not need to manually build the schema in the Supabase Table Editor.**

## Automated setup (recommended on Windows)

1. Create an empty Supabase project and wait for it to finish initializing.
2. Make sure Node.js 20 or newer is installed.
3. Double-click `setup-supabase.bat`.
4. Enter the Supabase project reference when prompted.
5. Complete the Supabase CLI login/link prompts.
6. Paste the project's browser-safe **Publishable key** when requested.

The setup program automatically:

- initializes the local Supabase CLI configuration if needed;
- applies every SQL migration in `supabase/migrations/`;
- creates the tables, triggers, RLS policies, indexes, and default grading rules;
- deploys the protected `create-user` Edge Function; and
- writes `config.js` so the web app uses the shared Supabase database.

Supabase's migration system records which migrations have already run, so later schema updates can be added as new migration files and applied with `supabase db push` instead of rebuilding the database.

## First administrator

After the automated setup finishes, go to **Supabase > Authentication > Users** and create your first email/password user. The included database trigger automatically creates that user's application profile and makes the **first user Administrator**. No SQL statement is required.

After you sign into the web app as that administrator, use **Administration > Add User** for later Inspector or Administrator accounts.

## Manual/CLI alternative

If you prefer commands, from the project root run:

```bash
npx supabase init
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push
npx supabase functions deploy create-user
```

Then edit `config.js` with your Project URL and Publishable key. Never place the service-role/secret key in `config.js` or `index.html`.

---

# Publish on GitHub Pages

## Option A: Included GitHub Actions workflow

1. Create a GitHub repository.
2. Put all project files in the repository root.
3. Commit and push to the `main` branch.
4. In GitHub repository **Settings > Pages**, set the source to **GitHub Actions**.
5. The included `.github/workflows/pages.yml` deploys the site on each push to `main`.

Your project site will normally be available at:

`https://YOUR-USERNAME.github.io/YOUR-REPOSITORY/`

## Option B: Deploy from a branch

Because this is plain HTML/CSS/JavaScript, you can also configure GitHub Pages to deploy directly from the repository root on the `main` branch. The included `.nojekyll` file prevents unwanted Jekyll processing.

---

# User roles

## Inspector

- Sign in
- Create/update cadet roster information during an inspection
- Record inspections
- View all cadet inspection history
- View dashboard/statistics
- Export reports
- Correct inspections that they personally entered

## Administrator

Everything an Inspector can do, plus:

- Create additional users
- View authorized user list
- Change Airman and NCO/Officer inspection scoring thresholds
- Correct any inspection
- Database policies allow administrative deletion if you later add a delete interface

---

# Data model

## Grading Rules

Two rows hold the editable standards for `airman` and `nco_officer`: minimum passing score and minimum Excellent score.

## Cadets

Current roster identity:

- CAPID
- Name
- Current Grade

## Inspections

Historical inspection rows preserve the grade used on that inspection date, so promoting a cadet later does not change old scoring history.

Stored fields include:

- Inspection date
- Cadet reference
- Grade at inspection
- Airman vs. NCO/Officer scoring group
- Five individual category scores
- Server-calculated total score
- Server-calculated overall rating
- Server-calculated pass/fail
- Evaluator
- Optional notes
- Created timestamp

---

# Statistics currently included

The unit dashboard calculates:

- Total inspections
- Number of unique cadets inspected
- Average total score
- Overall pass rate
- Average score by each of the five inspection categories
- Lowest-scoring / strongest improvement area
- Overall rating distribution
- Monthly average score trend
- Number of inspections in the last 30 days
- Comparison of the newer half of inspection history vs. the older half
- Fifteen most recent inspections

Each cadet report includes:

- Current grade and CAPID
- Number of inspections
- Average score
- Pass rate
- Latest score/result
- Historical score chart
- Full inspection-by-inspection table
- CSV export
- Print-friendly report

---

# Security notes

Even though this project is intended for testing, the Supabase version is structured so that:

- the service-role key is never sent to the browser;
- users must authenticate before reading or changing inspection data;
- Postgres Row Level Security controls data access;
- only an administrator can invoke the user-creation operation successfully;
- inspection totals/results are recalculated in the database rather than trusting the browser.

I did **not** add custom field-level encryption for CAPID/name because it would complicate searching and reporting without adding much value to this test application. If this moves beyond testing, you can add stronger data-retention rules, audit logging, MFA, and any CAP/local privacy requirements you decide are appropriate.

---

# Project files

```text
cap-uniform-inspection-tracker/
├── .github/workflows/pages.yml
├── icons/
│   ├── icon-192.png
│   ├── icon-512.png
│   └── icon-maskable-512.png
├── supabase/
│   ├── functions/create-user/index.ts
│   ├── migrations/
│   │   ├── 20260825170000_cap_uniform_tracker.sql
│   │   └── 20260826021000_pwa_offline_sync.sql
│   └── schema.sql
├── .nojekyll
├── app.js
├── offline-store.js
├── service-worker.js
├── manifest.webmanifest
├── config.example.js
├── config.js
├── index.html
├── PWA-UPGRADE.md
├── upgrade-pwa.bat
├── upgrade-pwa.ps1
├── README.md
├── setup-supabase.bat
├── setup-supabase.ps1
└── styles.css
```


---

## Offline Android / PWA mode

This project now includes an installable Progressive Web App (PWA) mode for Android tablets. Inspections are saved to IndexedDB on the device first and then synchronized with Supabase when connectivity is available.

For an **existing working GitHub Pages + Supabase installation**, read [PWA-UPGRADE.md](PWA-UPGRADE.md) and use `upgrade-pwa.bat`. The upgrade adds the `client_uuid` database field used to make synchronization retry-safe without overwriting your existing `config.js`.

Key PWA files:

- `manifest.webmanifest`
- `service-worker.js`
- `offline-store.js`
- `icons/`
- `supabase/migrations/20260826021000_pwa_offline_sync.sql`

The first login on a tablet must be online. After that, the cached user can choose **Continue Offline** from the login screen. Individual and Bulk inspections can be entered without internet. When connectivity returns while the app is open, pending inspections are synchronized automatically; **Sync Now** is also available in the header.

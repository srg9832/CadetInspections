# CAP Uniform Inspection Tracker — Offline PWA Upgrade

This version turns the existing GitHub Pages application into an installable, offline-capable Progressive Web App (PWA).

## What it does

- The application shell is cached by a service worker so it opens without internet after the first successful online load.
- Cadets, inspection history, grading rules, and the last authorized user are cached in IndexedDB on the tablet.
- Every new inspection is written to the tablet **first**.
- If Supabase is reachable, queued inspections synchronize immediately.
- If there is no internet, inspections remain marked **pending** and synchronize the next time the app is open with connectivity.
- A unique `client_uuid` is assigned before upload so a retry cannot create duplicate inspections.
- Individual Entry and Bulk Entry both use the same local-first queue.
- Reports can use the cached roster/history while offline.
- Administration changes and user creation remain online-only so all devices share one authoritative configuration.

## Upgrade your existing working GitHub/Supabase installation

### 1. Back up `config.js`

Your existing GitHub repository already has the correct Supabase URL and publishable key. Keep that file.

The provided **PWA upgrade ZIP intentionally does not contain `config.js`**, so extracting it over your existing project will not replace your working Supabase configuration.

### 2. Extract the PWA upgrade files into your existing project

Allow Windows to replace `index.html`, `app.js`, and any other matching application files.

New files include:

- `offline-store.js`
- `service-worker.js`
- `manifest.webmanifest`
- `icons/`
- `supabase/migrations/20260826021000_pwa_offline_sync.sql`
- `upgrade-pwa.bat`
- `upgrade-pwa.ps1`

### 3. Apply the one database upgrade

Double-click:

`upgrade-pwa.bat`

Enter your Supabase project reference when requested. For your current project, this is the 20-character project ID shown in the Supabase dashboard URL.

The script will:

1. Sign in to the Supabase CLI.
2. Link the folder to the project.
3. Run `supabase db push`.
4. Add the `client_uuid` field/unique constraint used to prevent duplicate offline-sync uploads.
5. Redeploy `create-user` with `--no-verify-jwt`.

It does **not** overwrite `config.js`.

### 4. Commit and push the updated files to GitHub

Your existing GitHub Pages workflow will deploy the PWA automatically.

### 5. Open the website once while online

On each Android tablet:

1. Open the GitHub Pages site in Chrome while connected to the internet.
2. Sign in normally.
3. Wait until the header shows **Online · synced**.
4. Open Reports once if you want to verify the roster/history cache is populated.

The first online visit is important because it caches the application files and local data on that tablet.

### 6. Install the app on Android

If Chrome provides the install prompt, use the **Install App** button in the application header. You can also use Chrome's menu and choose **Install app** or **Add to Home screen**.

The installed app launches in its own standalone window without the normal browser toolbar.

## Offline workflow

When the tablet has no connection:

1. Open **CAP Inspections** from the Android home screen.
2. The login window appears.
3. If this tablet has previously signed in online, choose **Continue Offline as [user]**.
4. Enter Individual or Bulk inspections normally.
5. Press Submit.
6. The header shows how many inspections are waiting to synchronize.

When the internet returns while the app is open, it automatically attempts synchronization. You can also press **Sync Now**.

## Important operating behavior

### First-ever login on a tablet requires internet

The app does not store a user's Supabase password. A tablet must authenticate successfully at least once before offline continuation is available.

### Do not clear Chrome/app storage if unsynced inspections exist

Pending inspections live in IndexedDB on that tablet until Supabase confirms they were received. Clearing site data, uninstalling the PWA, or factory-resetting the tablet can remove unsynced records.

Before clearing storage, make sure the header says:

`Online · synced`

### Grading rules

The current grading rules are cached for offline inspections. Changing grading thresholds in Administration requires internet. When pending inspections later sync, the Supabase database trigger recalculates the official result using the authoritative database rules.

### Reports

Reports use the locally cached roster and history if the server cannot be reached. The Administration tab includes **Refresh Offline Cache** to manually update the tablet's local copy while online.

## Files involved

- `index.html` — application GUI, PWA manifest registration, sync status controls.
- `app.js` — login, inspection workflow, synchronization engine, reports.
- `offline-store.js` — IndexedDB local database.
- `service-worker.js` — caches the application for offline startup.
- `manifest.webmanifest` — Android/install metadata.
- `icons/` — installed-app icons.
- `20260826021000_pwa_offline_sync.sql` — adds the idempotent offline synchronization UUID.

## Updating the PWA later

When application files change, increment `CACHE_VERSION` near the top of `service-worker.js`. On the next online launch the browser installs the new service worker and replaces the old application cache.

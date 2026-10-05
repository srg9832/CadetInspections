# Supabase backend moved

Uniform Inspections no longer has a standalone Supabase schema.

Production now uses the shared **CAP Applications** backend (project ref `vosvdkkuiijywwmqzdiu`) together with CAP Schedule, Leadership Feedback, and Drill Test Manager.

The former standalone schema/migrations and `create-user` Edge Function were removed from this repository after the 2026-10 migration. They remain available in Git history, and the old Supabase project is intentionally being kept intact as a rollback/archive copy.

Shared backend schema and Edge Function source are maintained in the `srg9832/CAPSchedule` repository under `supabase/`.

-- PWA/offline synchronization support.
-- Each tablet-generated inspection receives a UUID before it is synchronized.
-- The unique constraint makes retries idempotent, preventing duplicate inspection
-- rows if connectivity drops after Supabase receives a request but before the
-- tablet receives the response.

alter table public.inspections
  add column if not exists client_uuid uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'inspections_client_uuid_key'
      and conrelid = 'public.inspections'::regclass
  ) then
    alter table public.inspections
      add constraint inspections_client_uuid_key unique (client_uuid);
  end if;
end;
$$;

create index if not exists inspections_client_uuid_lookup_idx
  on public.inspections (client_uuid);

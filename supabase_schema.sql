create extension if not exists "pgcrypto";

drop table if exists public.bookings;

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  items jsonb not null,
  service_minutes integer not null,
  internal_buffer integer not null default 0,
  total_block integer not null,
  therapist text not null,
  date date not null,
  slot text not null,
  customer_name text not null,
  phone text not null,
  line_name text,
  first_visit text,
  note text,
  status text not null default 'pending'
);

alter table public.bookings enable row level security;

create policy "bookings_insert" on public.bookings for insert to anon with check (true);
create policy "bookings_select" on public.bookings for select to anon using (true);
create policy "bookings_update" on public.bookings for update to anon using (true) with check (true);
create policy "bookings_delete" on public.bookings for delete to anon using (true);

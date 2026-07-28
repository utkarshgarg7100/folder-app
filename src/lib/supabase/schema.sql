-- Run this once in the Supabase dashboard's SQL Editor for your project.
-- (Project -> SQL Editor -> New query -> paste this file -> Run.)

create table public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  email      text not null,
  created_at timestamptz not null default now()
);

create table public.saved_reports (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  file_name   text not null,
  doctor      text,
  clinic      text,
  report_date text, -- as printed on the document; not normalized/parsed
  created_at  timestamptz not null default now()
);

create table public.saved_results (
  id               uuid primary key default gen_random_uuid(),
  saved_report_id  uuid not null references public.saved_reports (id) on delete cascade,
  user_id          uuid not null references public.profiles (id) on delete cascade,
  test_name        text not null,
  value            text not null,
  unit             text,
  reference_range  text,
  status           text not null check (status in ('in_range', 'out_of_range', 'unclear')),
  note             text,
  created_at       timestamptz not null default now()
);

create index saved_results_user_test_idx
  on public.saved_results (user_id, test_name, created_at);

-- Auto-create a profiles row whenever a new Supabase auth user is created,
-- so saved_reports/saved_results always have a valid profiles row to
-- reference for a signed-in user.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Row Level Security: every table is scoped to auth.uid() so route handlers
-- never need to write their own authorization checks beyond "is there a
-- session".
alter table public.profiles enable row level security;
alter table public.saved_reports enable row level security;
alter table public.saved_results enable row level security;

create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);

create policy "saved_reports_select_own" on public.saved_reports
  for select using (auth.uid() = user_id);
create policy "saved_reports_insert_own" on public.saved_reports
  for insert with check (auth.uid() = user_id);
create policy "saved_reports_delete_own" on public.saved_reports
  for delete using (auth.uid() = user_id);

create policy "saved_results_select_own" on public.saved_results
  for select using (auth.uid() = user_id);
create policy "saved_results_insert_own" on public.saved_results
  for insert with check (auth.uid() = user_id);
create policy "saved_results_delete_own" on public.saved_results
  for delete using (auth.uid() = user_id);

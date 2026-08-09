-- Enable RLS
alter table public.stories enable row level security;
alter table public.articles enable row level security;

-- Drop existing policies if any
drop policy if exists "Allow public read-only access to stories" on public.stories;
drop policy if exists "Allow public read-only access to articles" on public.articles;

-- Create read-only policies for anon and authenticated users
create policy "Allow public read-only access to stories"
  on public.stories for select
  using (true);

create policy "Allow public read-only access to articles"
  on public.articles for select
  using (true);

-- No insert/update/delete policies are created.
-- This defaults to deny for all roles except postgres and service_role.
-- Edge Functions and backend processes MUST use the service_role key to write to these tables.

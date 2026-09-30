-- Blog schema for SINSERITA
-- Posts are authored by admins (Supabase Auth users). Public can read only
-- published posts; authenticated admins manage their own posts. The MCP server
-- writes via the service-role key, which bypasses RLS.

create table if not exists public.blog_posts (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  excerpt text,
  content text not null default '',
  cover_image text,
  tags text[] not null default '{}',
  status text not null default 'draft' check (status in ('draft', 'published')),
  author_id uuid references auth.users(id) on delete set null,
  -- Marks posts created programmatically through the MCP server.
  source text not null default 'admin' check (source in ('admin', 'mcp')),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists blog_posts_status_published_idx
  on public.blog_posts (status, published_at desc);

alter table public.blog_posts enable row level security;

-- Public (anon + authenticated) can read only published posts.
drop policy if exists "blog_posts_select_published" on public.blog_posts;
create policy "blog_posts_select_published" on public.blog_posts
  for select
  using (status = 'published');

-- Authenticated admins can read all of their own posts (incl. drafts).
drop policy if exists "blog_posts_select_own" on public.blog_posts;
create policy "blog_posts_select_own" on public.blog_posts
  for select
  to authenticated
  using (auth.uid() = author_id);

-- Authenticated admins can insert posts they own.
drop policy if exists "blog_posts_insert_own" on public.blog_posts;
create policy "blog_posts_insert_own" on public.blog_posts
  for insert
  to authenticated
  with check (auth.uid() = author_id);

-- Authenticated admins can update their own posts.
drop policy if exists "blog_posts_update_own" on public.blog_posts;
create policy "blog_posts_update_own" on public.blog_posts
  for update
  to authenticated
  using (auth.uid() = author_id)
  with check (auth.uid() = author_id);

-- Authenticated admins can delete their own posts.
drop policy if exists "blog_posts_delete_own" on public.blog_posts;
create policy "blog_posts_delete_own" on public.blog_posts
  for delete
  to authenticated
  using (auth.uid() = author_id);

-- Keep updated_at fresh.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists blog_posts_set_updated_at on public.blog_posts;
create trigger blog_posts_set_updated_at
  before update on public.blog_posts
  for each row
  execute function public.set_updated_at();

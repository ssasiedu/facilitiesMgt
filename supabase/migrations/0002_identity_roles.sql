-- 0002_identity_roles.sql : roles, profiles, zones and the helper functions that every
-- RLS policy and workflow function depends on.
--
-- A profile is the application's idea of a person. It is separate from auth.users so that
-- demo and historical staff can exist without a login (profiles.user_id is null, is_demo
-- marks seeded rows). Signing up links the Auth user to a waiting profile with the same
-- email, otherwise a new profile is created.

create table if not exists public.roles (
  code text primary key,
  name text not null,
  description text,
  sort_order int not null default 0
);

create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users(id) on delete set null,
  full_name text not null default '',
  email text,
  phone text,
  avatar_url text,
  is_active boolean not null default true,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
create unique index if not exists profiles_email_uq on public.profiles (lower(email)) where email is not null;
create index if not exists profiles_user_idx on public.profiles (user_id);
create index if not exists profiles_active_idx on public.profiles (is_active) where archived_at is null;
create index if not exists profiles_name_trgm on public.profiles using gin (full_name extensions.gin_trgm_ops);

create table if not exists public.user_roles (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role_code text not null references public.roles(code) on update cascade,
  created_at timestamptz not null default now(),
  primary key (profile_id, role_code)
);
create index if not exists user_roles_role_idx on public.user_roles (role_code);

create table if not exists public.zones (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  regions text[] not null default '{}',
  districts text[] not null default '{}',
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create table if not exists public.user_zones (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  zone_id uuid not null references public.zones(id) on delete cascade,
  primary key (profile_id, zone_id)
);
create index if not exists user_zones_zone_idx on public.user_zones (zone_id);

-- =====================================================================================
-- Core helpers
-- =====================================================================================

-- updated_at maintenance. 0014 attaches this to every table that has the column.
create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- Ghana phone numbers are stored as 233XXXXXXXXX. Accepts 024..., +233..., 233...,
-- 00233... and bare 9-digit forms. Anything else is returned as its digits so the form
-- layer can reject it rather than the database silently mangling it.
create or replace function public.normalize_phone(p text) returns text
language plpgsql immutable as $$
declare d text;
begin
  if p is null then return null; end if;
  d := regexp_replace(p, '[^0-9]', '', 'g');
  if d = '' then return null; end if;
  if left(d, 5) = '00233' then d := substr(d, 3); end if;
  if left(d, 3) = '233' and length(d) = 12 then return d; end if;
  if left(d, 1) = '0' and length(d) = 10 then return '233' || substr(d, 2); end if;
  if length(d) = 9 then return '233' || d; end if;
  return d;
end $$;

-- The signed-in user's profile id. Used by policies, defaults and workflow functions.
create or replace function public.current_profile_id() returns uuid
language sql stable security definer set search_path = public as $$
  select p.id from public.profiles p
   where p.user_id = auth.uid() and p.is_active and p.archived_at is null
$$;

-- Does the caller hold this role? Super Admin passes every check.
create or replace function public.has_role(p_role text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from public.user_roles ur
      join public.profiles p on p.id = ur.profile_id
     where p.user_id = auth.uid() and p.is_active and p.archived_at is null
       and (ur.role_code = p_role or ur.role_code = 'super_admin')
  )
$$;

create or replace function public.has_any_role(p_roles text[]) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from public.user_roles ur
      join public.profiles p on p.id = ur.profile_id
     where p.user_id = auth.uid() and p.is_active and p.archived_at is null
       and (ur.role_code = any(p_roles) or ur.role_code = 'super_admin')
  )
$$;

-- Literal role check, with no Super Admin shortcut. Policies use it to answer
-- "is this person *only* a zonal officer?", where the shortcut would widen access.
create or replace function public.has_exact_role(p_role text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from public.user_roles ur
      join public.profiles p on p.id = ur.profile_id
     where p.user_id = auth.uid() and p.is_active and p.archived_at is null
       and ur.role_code = p_role
  )
$$;

create or replace function public.my_roles() returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(ur.role_code order by ur.role_code), '{}')
    from public.user_roles ur
    join public.profiles p on p.id = ur.profile_id
   where p.user_id = auth.uid() and p.is_active and p.archived_at is null
$$;

create or replace function public.my_zone_ids() returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(uz.zone_id), '{}')
    from public.user_zones uz
    join public.profiles p on p.id = uz.profile_id
   where p.user_id = auth.uid()
$$;

-- True when the statement comes straight from the browser through PostgREST, rather than
-- from inside a SECURITY DEFINER workflow function (where current_user is the function
-- owner) or from a trusted server-side caller such as service_role or pg_cron.
-- The column guards in 0016 use it to block edits that must go through an RPC.
create or replace function public.is_direct_client() returns boolean
language sql stable as $$
  select current_user in ('authenticated', 'anon')
$$;

-- Raise a permission error unless the caller holds one of these roles.
--
-- There are three kinds of caller:
--   * a signed-in user (auth.uid() is set): their roles are checked, always;
--   * an anonymous browser request: refused;
--   * a trusted server-side caller with no JWT — pg_cron, an Edge Function using the
--     service-role key, seed.sql, a migration: allowed through, because there is no user
--     to check and these callers are already inside the trust boundary.
-- A signed-in user is still checked inside a SECURITY DEFINER function, because the JWT
-- claims travel with the session even though current_user becomes the function's owner.
create or replace function public.require_role(p_roles text[]) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then
    if public.is_direct_client() then
      raise exception 'You are not signed in' using errcode = 'insufficient_privilege';
    end if;
    return;
  end if;
  if public.current_profile_id() is null then
    raise exception 'Your account is not active. Ask a Super Admin to re-activate it.'
      using errcode = 'insufficient_privilege';
  end if;
  if not public.has_any_role(p_roles) then
    raise exception 'Permission denied: this action needs one of these roles: %',
      array_to_string(p_roles, ', ') using errcode = 'insufficient_privilege';
  end if;
end $$;

-- =====================================================================================
-- Link a new Auth user to its profile
-- =====================================================================================
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_profile uuid;
begin
  -- an invited or demo profile may already be waiting on this email address
  select id into v_profile
    from public.profiles
   where user_id is null and email is not null and lower(email) = lower(new.email)
   order by is_demo
   limit 1;

  if v_profile is not null then
    update public.profiles
       set user_id = new.id,
           full_name = case when coalesce(full_name, '') = ''
                            then coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1))
                            else full_name end,
           is_active = true,
           updated_at = now()
     where id = v_profile;
  else
    insert into public.profiles (user_id, email, full_name)
    values (new.id, new.email,
            coalesce(new.raw_user_meta_data->>'full_name', split_part(coalesce(new.email, ''), '@', 1)))
    on conflict (user_id) do nothing;
  end if;

  -- roles named on the invite (invite-user Edge Function puts them in user metadata)
  if new.raw_user_meta_data ? 'roles' then
    insert into public.user_roles (profile_id, role_code)
    select p.id, r.code
      from public.profiles p
      join public.roles r on r.code = any (
        select jsonb_array_elements_text(new.raw_user_meta_data->'roles'))
     where p.user_id = new.id
    on conflict do nothing;
  end if;

  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

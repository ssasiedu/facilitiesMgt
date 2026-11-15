-- 0021: let a Super Admin hand a new user a temporary password.
--
-- Email invitations are not always practical: a client may have no working inbox on the day, or
-- may simply be standing next to you. A Super Admin can now set a password directly (through the
-- invite-user Edge Function, which holds the service-role key) and read it out. The account is
-- then marked as needing a password of the user's own, so the shared one is short-lived and the
-- admin does not keep knowing it.

alter table public.profiles
  add column if not exists must_change_password boolean not null default false;

comment on column public.profiles.must_change_password is
  'Set when an administrator issues a temporary password. Cleared when the user sets their own.';

/* The user clears their own flag after changing their password. They may only ever clear it for
   themselves, and the function cannot set it — only an administrator can, through the Edge
   Function — so this cannot be used to force the prompt on somebody else. */
create or replace function public.clear_must_change_password() returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.current_profile_id() is null then
    raise exception 'You are not signed in' using errcode = 'insufficient_privilege';
  end if;
  update public.profiles set must_change_password = false where id = public.current_profile_id();
end $$;

grant execute on function public.clear_must_change_password() to authenticated;

-- 0026: a test email, so a failure can be diagnosed from the screen rather than guessed at.
--
-- There was a test for SMS but none for email, which left "the emails keep failing" with nowhere
-- to look. This queues one through the ordinary path, so whatever the provider says lands in
-- notifications.error next to every other delivery.

create or replace function public.send_test_email(p_email text, p_subject text default null, p_message text default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_company text;
begin
  perform public.require_role(array['super_admin']);

  if p_email is null or p_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Enter a valid email address';
  end if;

  select company_name into v_company from public.company_settings where id = 1;

  insert into public.notifications (event_code, channel, recipient_name, recipient_email, recipient_type, subject, body, profile_id)
  values (
    'test', 'email', 'Test', lower(trim(p_email)), 'staff',
    coalesce(nullif(p_subject, ''), 'Test email from ' || coalesce(v_company, 'the system')),
    coalesce(nullif(p_message, ''),
      'This is a test email from ' || coalesce(v_company, 'the system') || '.' || chr(10) || chr(10) ||
      'If it reached you, email delivery is working.'),
    public.current_profile_id())
  returning id into v_id;

  return v_id;
end $$;

revoke all on function public.send_test_email(text, text, text) from public;
grant execute on function public.send_test_email(text, text, text) to authenticated;

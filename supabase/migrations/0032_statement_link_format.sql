-- 0032: let a statement link choose its format.
--
-- Review item 5, the customer-facing half. The by-invoice statement is most useful to the person
-- who owes the money, so the link that goes out to them can carry either format. Existing links
-- have no format stored and read as the account statement, which is what they were sent as.

/* Adding a defaulted parameter makes a second function rather than replacing the first, and a
   three-argument call would still bind to the old one — so the format would be ignored for every
   caller that had not been changed. The original is dropped explicitly. */
drop function if exists public.create_statement_link(uuid, date, date);

create or replace function public.create_statement_link(
  p_customer_id uuid, p_from date, p_to date, p_format text default 'account'
) returns text
language plpgsql security definer set search_path = public as $$
declare v_token text; v_format text;
begin
  perform public.require_role(array['accountant','manager','sales_exec']);

  v_format := case lower(coalesce(p_format, 'account')) when 'by_invoice' then 'by_invoice' else 'account' end;

  insert into public.public_links (doc_type, customer_id, params)
  values ('statement', p_customer_id, jsonb_build_object('from', p_from, 'to', p_to, 'format', v_format))
  returning token into v_token;

  return rtrim((select public_app_url from public.company_settings where id = 1), '/') || '/p/statement/' || v_token;
end $$;

revoke all on function public.create_statement_link(uuid, date, date, text) from public;
grant execute on function public.create_statement_link(uuid, date, date, text) to authenticated;

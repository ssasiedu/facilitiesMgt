-- supabase/tests/acceptance.sql
-- Database acceptance tests (README section 8). Run on a fresh project AFTER migrations + seed.sql:
--   psql "$DATABASE_URL" -f supabase/tests/acceptance.sql      (or paste into the SQL editor)
-- Everything runs inside one transaction and is ROLLED BACK at the end, so no data is left behind.
-- Each check raises an error on failure and prints "PASS ..." notices on success.

begin;

-- ---------- helpers: act as a signed-in user (simulates the JWT PostgREST would set) ----------
create or replace function pg_temp.login(p_email text) returns void language plpgsql as $$
declare v_uid uuid;
begin
  execute 'reset role';
  select id into v_uid from auth.users where email = p_email;
  perform set_config('request.jwt.claim.sub', v_uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create or replace function pg_temp.logout() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', '', true);
  perform set_config('request.jwt.claims', '', true);
end $$;
grant execute on function pg_temp.login(text), pg_temp.logout() to authenticated;
create table pg_temp.t (k text primary key, v uuid);
grant all on pg_temp.t to authenticated;

-- ---------- setup (as the database owner) ----------
do $$
declare r record; v_pid uuid; v_uid uuid;
begin
  for r in select * from (values
    ('t.manager1@test.local', 'Test Manager One', '0244000001', array['manager']),
    ('t.manager2@test.local', 'Test Manager Two', '0244000002', array['manager']),
    ('t.ops1@test.local', 'Test Ops Officer', '0244000003', array['ops_officer']),
    ('t.acc1@test.local', 'Test Accountant', '0244000004', array['accountant']),
    ('t.zonal1@test.local', 'Test Zonal One', '0244000005', array['zonal_officer']),
    ('t.zonal2@test.local', 'Test Zonal Two', '0244000006', array['zonal_officer']),
    ('t.driver1@test.local', 'Test Driver One', '0244000007', array['driver']),
    ('t.fleet1@test.local', 'Test Fleet Manager', '0244000008', array['fleet_manager'])) as x(email, name, phone, roles) loop
    insert into auth.users (id, email) values (gen_random_uuid(), r.email) returning id into v_uid;
    select id into v_pid from public.profiles where user_id = v_uid;
    update public.profiles set full_name = r.name, phone = r.phone where id = v_pid;
    insert into public.user_roles (profile_id, role_code) select v_pid, unnest(r.roles);
  end loop;
  insert into public.zones (name) values ('Test Zone A') on conflict do nothing;
  insert into public.user_zones (profile_id, zone_id) select p.id, z.id from public.profiles p, public.zones z where p.email like 't.zonal%' and z.name = 'Test Zone A';
  insert into public.customers (customer_type, first_name, last_name, phone, email, payment_terms_days, zone_id)
    values ('individual', 'Ama', 'Tester', '0244123456', 'ama@test.local', 14, (select id from public.zones where name = 'Test Zone A')) returning id into v_pid;
  insert into pg_temp.t values ('cust', v_pid);
  insert into public.customers (customer_type, first_name, last_name, phone) values ('individual', 'Yaw', 'Other', '0207000111') returning id into v_pid;
  insert into pg_temp.t values ('cust2', v_pid);
  insert into public.customers (customer_type, company_name, company_phone, company_email, payment_terms_days) values ('company', 'Company A Ltd', '0302000001', 'ap@companya.test', 30) returning id into v_pid;
  insert into pg_temp.t values ('companyA', v_pid);
  insert into public.customer_contacts (customer_id, name, phone, email, receives_invoices, is_primary) values (v_pid, 'Kofi Billing', '0244999888', 'billing@companya.test', true, true);
  insert into public.customers (customer_type, company_name, company_phone, payment_terms_days) values ('company', 'Company B Ltd', '0302000002', 30) returning id into v_pid;
  insert into pg_temp.t values ('companyB', v_pid);
  insert into public.employees (full_name, role_type, phone, licence_no, licence_class, licence_expiry, daily_rate, profile_id)
    values ('Test Driver One', 'driver', '0244000007', 'DL-1', 'C', current_date + 365, 180, (select id from public.profiles where email = 't.driver1@test.local')) returning id into v_pid;
  insert into pg_temp.t values ('driver1', v_pid);
  insert into public.trucks (registration_no, fleet_code, truck_type, capacity_litres, assigned_driver_id) values ('TEST-1001-26', 'TST-CES-1', 'cesspit_emptier', 10000, v_pid) returning id into v_pid;
  insert into pg_temp.t values ('truck1', v_pid);
  insert into public.trucks (registration_no, fleet_code, truck_type, capacity_litres) values ('TEST-1002-26', 'TST-CES-2', 'cesspit_emptier', 10000) returning id into v_pid;
  insert into pg_temp.t values ('truck2', v_pid);
  insert into public.trucks (registration_no, fleet_code, truck_type, capacity_litres) values ('TEST-1003-26', 'TST-WAT-1', 'water_tanker', 9000) returning id into v_pid;
  insert into pg_temp.t values ('truck3', v_pid);
  raise notice 'PASS setup';
end $$;

-- ---------- 4. Job order flow with a GH₵ 1,000 job ----------
select pg_temp.login('t.ops1@test.local');
do $$
declare v_job uuid; v_res jsonb;
begin
  insert into public.job_orders (customer_id, execution_date, site_address, channel, officer_id)
  values ((select v from pg_temp.t where k = 'cust'), current_date, 'Test site, East Legon', 'call_in', public.current_profile_id()) returning id into v_job;
  insert into public.job_order_lines (job_order_id, service_id, quantity, unit_price) values (v_job, (select id from public.services where code = 'CES'), 1, 1000);
  insert into public.job_order_assignments (job_order_id, kind, truck_id) values (v_job, 'truck', (select v from pg_temp.t where k = 'truck1'));
  assert (select agreed_amount from public.job_orders where id = v_job) = 1000, 'agreed amount should be 1000';
  assert (select count(*) from public.job_order_assignments where job_order_id = v_job and kind = 'driver') = 1, 'driver should be filled from the truck';
  v_res := public.submit_job_order(v_job);
  assert (select status from public.job_orders where id = v_job) = 'pending_approval', 'job should be pending approval';
  insert into pg_temp.t values ('job1', v_job);
  -- console bypass attempt: status cannot be changed directly
  begin
    update public.job_orders set status = 'approved' where id = v_job;
    raise exception 'direct status change should fail';
  exception when others then
    if sqlerrm = 'direct status change should fail' then raise; end if;
  end;
  begin
    perform public.approve_job_order(v_job);
    raise exception 'ops officer must not approve';
  exception when insufficient_privilege then null; end;
  raise notice 'PASS submit + guards (ops cannot approve, cannot change status directly)';
end $$;

select pg_temp.login('t.manager1@test.local');
do $$
declare v_job uuid := (select v from pg_temp.t where k = 'job1'); v_inv uuid; v_own uuid;
begin
  perform public.approve_job_order(v_job);
  select invoice_id into v_inv from public.job_orders where id = v_job;
  assert (select status from public.invoices where id = v_inv) = 'issued', 'invoice should be Issued – not yet due';
  assert (select total from public.invoices where id = v_inv) = 1000, 'invoice total 1000';
  assert exists (select 1 from public.journal_entries e where e.source_id = v_inv and e.event_code = 'job_approved'
    and exists (select 1 from public.journal_lines l join public.accounts a on a.id = l.account_id where l.entry_id = e.id and a.code = '1100' and l.debit = 1000)
    and exists (select 1 from public.journal_lines l join public.accounts a on a.id = l.account_id where l.entry_id = e.id and a.code = '2100' and l.credit = 1000)),
    'journal Dr AR 1000 / Cr Deferred Revenue 1000';
  assert (select count(*) from public.notifications where related_id = v_job and event_code like 'job_approved%' and channel = 'sms') = 3, '3 SMS queued (customer, driver, officer)';
  insert into pg_temp.t values ('inv1', v_inv);
  -- segregation of duties: manager cannot approve a job they raised
  insert into public.job_orders (customer_id, execution_date) values ((select v from pg_temp.t where k = 'cust2'), current_date + 30) returning id into v_own;
  insert into public.job_order_lines (job_order_id, service_id, quantity, unit_price) values (v_own, (select id from public.services where code = 'JAN'), 1, 300);
  perform public.submit_job_order(v_own);
  begin
    perform public.approve_job_order(v_own);
    raise exception 'raiser must not approve';
  exception when insufficient_privilege then null; end;
  raise notice 'PASS approve: invoice issued, Dr AR/Cr Deferred 1000, 3 SMS queued; raiser cannot approve own job';
end $$;

-- start is disabled before the execution date
select pg_temp.login('t.ops1@test.local');
do $$
declare v_job uuid;
begin
  insert into public.job_orders (customer_id, execution_date) values ((select v from pg_temp.t where k = 'cust2'), current_date + 2) returning id into v_job;
  insert into public.job_order_lines (job_order_id, service_id, quantity, unit_price) values (v_job, (select id from public.services where code = 'CES'), 1, 500);
  insert into public.job_order_assignments (job_order_id, kind, truck_id) values (v_job, 'truck', (select v from pg_temp.t where k = 'truck2'));
  perform public.submit_job_order(v_job);
  insert into pg_temp.t values ('job_future', v_job);
end $$;
select pg_temp.login('t.manager1@test.local');
select public.approve_job_order((select v from pg_temp.t where k = 'job_future'));
select pg_temp.login('t.ops1@test.local');
do $$
begin
  begin
    perform public.start_job_order((select v from pg_temp.t where k = 'job_future'));
    raise exception 'start before execution date must fail';
  exception when others then
    if sqlerrm like 'start before%' then raise; end if;
    assert sqlerrm like 'This job can only be started from%', sqlerrm;
  end;
  raise notice 'PASS Start disabled before the execution date';
end $$;

-- on the execution date: service-today SMS, then start and complete
select pg_temp.logout();
select public.job_service_today();
do $$
declare v_job uuid := (select v from pg_temp.t where k = 'job1');
begin
  assert (select count(*) from public.notifications where related_id = v_job and event_code like 'service_today%' and channel = 'sms') = 2, 'service today SMS to customer and driver';
  raise notice 'PASS service-today SMS queued';
end $$;

select pg_temp.login('t.ops1@test.local');
do $$
declare v_job uuid := (select v from pg_temp.t where k = 'job1'); v_inv uuid := (select v from pg_temp.t where k = 'inv1');
begin
  perform public.start_job_order(v_job, 5.6037, -0.1870);
  assert (select status from public.trucks where id = (select v from pg_temp.t where k = 'truck1')) = 'on_job', 'truck should be On Job';
  perform public.complete_job_order(v_job, 'Ama Tester', null, 'All good',
    jsonb_build_array(jsonb_build_object('category', 'labour', 'description', 'Loader', 'quantity', 2, 'unit_cost', 100),
                      jsonb_build_object('category', 'fuel', 'description', 'Diesel', 'quantity', 20, 'unit_cost', 15.5)));
  perform pg_temp.logout();  -- the Ops Officer cannot read journals; check the results as the owner
  assert (select status from public.job_orders where id = v_job) = 'completed', 'job completed';
  assert (select due_date from public.invoices where id = v_inv) = current_date + 14, 'due date = completion + payment terms';
  assert (select status from public.invoices where id = v_inv) = 'due', 'invoice now Due';
  assert exists (select 1 from public.journal_entries e where e.source_id = v_job and e.event_code = 'job_completed'
    and exists (select 1 from public.journal_lines l join public.accounts a on a.id = l.account_id where l.entry_id = e.id and a.code = '2100' and l.debit = 1000)
    and exists (select 1 from public.journal_lines l join public.accounts a on a.id = l.account_id where l.entry_id = e.id and a.code = '4050' and l.credit = 1000)),
    'journal Dr Deferred 1000 / Cr Service (cesspit) revenue 1000';
  assert exists (select 1 from public.notifications where related_id = v_job and event_code = 'job_completed' and channel = 'sms' and body like '%is now due%'), 'completion SMS queued';
  assert (select status from public.trucks where id = (select v from pg_temp.t where k = 'truck1')) = 'on_road', 'truck back On-Road';
  raise notice 'PASS complete: revenue recognised, due date set, completion SMS queued';
end $$;

select pg_temp.login('t.acc1@test.local');
do $$
declare v_res jsonb; v_inv uuid := (select v from pg_temp.t where k = 'inv1'); v_cust uuid := (select v from pg_temp.t where k = 'cust'); r record; v_dr numeric; v_cr numeric;
begin
  v_res := public.record_payment(v_cust, 600, 'mtn_momo', current_date, 'MOMO-TX-1', null, null);
  assert v_res ->> 'receipt_no' like 'RCP-%', 'receipt created';
  assert exists (select 1 from public.notifications where related_id = (v_res->>'receipt_id')::uuid and channel = 'sms' and body like '%/p/survey/%'), 'SMS with survey link';
  assert exists (select 1 from public.notifications where related_id = (v_res->>'receipt_id')::uuid and channel = 'email' and body like '%/p/survey/%'), 'email with survey link';
  assert (select status from public.invoices where id = v_inv) = 'partially_paid', 'invoice partially paid';
  assert (select balance from public.invoices where id = v_inv) = 400, 'balance 400';
  select sum(debit) filter (where doc_type = 'invoice'), sum(credit) filter (where doc_type = 'payment') into v_dr, v_cr from public.rpt_customer_statement(v_cust, current_date - 30, current_date);
  assert v_dr = 1000 and v_cr = 600, 'statement debit 1000 credit 600';
  assert (select balance from public.rpt_customer_statement(v_cust, current_date - 30, current_date) order by txn_date desc, balance limit 1) = 400, 'statement balance 400';
  assert (select sum(debit) = sum(credit) from public.rpt_trial_balance(current_date)), 'trial balance balances';
  insert into pg_temp.t values ('pay1_invitation', (v_res->>'survey_invitation_id')::uuid);
  -- second payment
  v_res := public.record_payment(v_cust, 400, 'cash', current_date, null, null, jsonb_build_array(jsonb_build_object('invoice_id', v_inv, 'amount', 400)));
  assert (select status from public.invoices where id = v_inv) = 'paid', 'invoice paid';
  assert (select status from public.job_orders where id = (select v from pg_temp.t where k = 'job1')) = 'closed', 'job closed';
  -- posted payment cannot be edited
  update public.payments set amount = 1 where id = (v_res->>'payment_id')::uuid;   -- RLS: no update policy, nothing changes
  assert (select amount from public.payments where id = (v_res->>'payment_id')::uuid) = 400, 'posted payment must not change';
  raise notice 'PASS payments: receipt, survey link, partial 400, statement, trial balance, paid -> job closed';
end $$;

-- ---------- 3. Truck rules ----------
select pg_temp.logout();
do $$
begin
  begin
    insert into public.truck_bookings (truck_id, job_order_id, period)
    values ((select v from pg_temp.t where k = 'truck2'), (select v from pg_temp.t where k = 'job_future'),
            public.span_of(current_date + 1, current_date + 3, null, null));
    raise exception 'overlap must fail';
  exception when exclusion_violation then null; end;
  raise notice 'PASS overlapping truck booking refused by the database';
end $$;

-- ---------- 3b. The same truck, twice in one day, at different times ----------
do $$
declare v_truck uuid; v_job uuid; v_day date := current_date + 45; n int;
begin
  select v into v_truck from pg_temp.t where k = 'truck1';
  select v into v_job from pg_temp.t where k = 'job_future';

  insert into public.truck_bookings (truck_id, job_order_id, period)
  values (v_truck, v_job, public.span_of(v_day, v_day, time '11:00', time '14:00'));

  -- the afternoon is still free, which is the whole point
  insert into public.truck_bookings (truck_id, job_order_id, period)
  values (v_truck, v_job, public.span_of(v_day, v_day, time '15:00', time '16:00'));

  -- and so is the hour between them, because the range is half open
  insert into public.truck_bookings (truck_id, job_order_id, period)
  values (v_truck, v_job, public.span_of(v_day, v_day, time '14:00', time '15:00'));

  begin
    insert into public.truck_bookings (truck_id, job_order_id, period)
    values (v_truck, v_job, public.span_of(v_day, v_day, time '13:00', time '13:30'));
    raise exception 'a genuine overlap must still fail';
  exception when exclusion_violation then null; end;

  begin
    insert into public.truck_bookings (truck_id, job_order_id, period)
    values (v_truck, v_job, public.span_of(v_day, v_day, null, null));
    raise exception 'a whole-day booking over existing jobs must fail';
  exception when exclusion_violation then null; end;

  select count(*) into n from public.get_truck_availability(v_day, v_day, null, null, time '16:00', time '17:30')
  where truck_id = v_truck and available;
  assert n = 1, 'the picker must offer the truck in the free slot after 16:00';

  select count(*) into n from public.get_truck_availability(v_day, v_day, null, null, time '12:00', time '13:00')
  where truck_id = v_truck and available;
  assert n = 0, 'the picker must not offer the truck during a booked slot';

  select count(*) into n from public.get_truck_availability(v_day, v_day, null, null)
  where truck_id = v_truck and available;
  assert n = 0, 'with no times the whole day is wanted, and the day is taken';

  delete from public.truck_bookings where truck_id = v_truck and lower(period)::date = v_day;
  raise notice 'PASS one truck takes several jobs a day; real overlaps still refused';
end $$;

select pg_temp.login('t.fleet1@test.local');
do $$
declare v_res jsonb;
begin
  v_res := public.set_truck_status((select v from pg_temp.t where k = 'truck2'), 'off_road', 'breakdown', current_date + 10, 'Gearbox failure');
  assert (v_res->>'flagged')::int = 1, 'one future job flagged';
  assert (select needs_reassignment from public.job_orders where id = (select v from pg_temp.t where k = 'job_future')), 'future job flagged';
  raise notice 'PASS Off-Road flags future jobs';
end $$;
select pg_temp.logout();
do $$
begin
  assert exists (select 1 from public.in_app_notifications n join public.profiles p on p.id = n.profile_id where p.email = 't.ops1@test.local' and n.title like 'Reassign truck%'), 'officer notified in-app';
  assert exists (select 1 from public.notifications where event_code = 'truck_off_road' and related_id = (select v from pg_temp.t where k = 'job_future')), 'officer SMS queued';
  assert not (select available from public.get_truck_availability(current_date, current_date + 5, 'cesspit_emptier') where truck_id = (select v from pg_temp.t where k = 'truck2')), 'Off-Road truck not available in picker';
  raise notice 'PASS officer notified; Off-Road truck disabled in picker';
end $$;
select pg_temp.login('t.ops1@test.local');
do $$
declare v_job uuid;
begin
  insert into public.job_orders (customer_id, execution_date) values ((select v from pg_temp.t where k = 'cust2'), current_date + 4) returning id into v_job;
  insert into public.job_order_lines (job_order_id, service_id, quantity, unit_price) values (v_job, (select id from public.services where code = 'CES'), 1, 900);
  insert into public.job_order_assignments (job_order_id, kind, truck_id) values (v_job, 'truck', (select v from pg_temp.t where k = 'truck2'));
  begin
    perform public.submit_job_order(v_job);
    raise exception 'off-road truck submit must fail';
  exception when others then
    if sqlerrm = 'off-road truck submit must fail' then raise; end if;
    assert sqlerrm like '%Off-Road%', sqlerrm;
  end;
  -- wrong truck type
  delete from public.job_order_assignments where job_order_id = v_job;
  insert into public.job_order_assignments (job_order_id, kind, truck_id) values (v_job, 'truck', (select v from pg_temp.t where k = 'truck3'));
  begin
    perform public.submit_job_order(v_job);
    raise exception 'wrong truck type must fail';
  exception when others then
    if sqlerrm = 'wrong truck type must fail' then raise; end if;
    assert sqlerrm like '%needs cesspit emptier%', sqlerrm;
  end;
  raise notice 'PASS Off-Road truck and wrong truck type cannot be used';
end $$;

-- ---------- 2. Roles ----------
select pg_temp.logout();
insert into public.tasks (officer_id, task_type_id, title, planned_date)
select p.id, (select id from public.task_types where code = 'mmda_visit'), 'Visit for ' || p.full_name, current_date from public.profiles p where p.email in ('t.zonal1@test.local', 't.zonal2@test.local');
select pg_temp.login('t.zonal1@test.local');
do $$
begin
  assert (select count(*) from public.invoices) = 0, 'zonal officer must not read invoices';
  assert (select count(*) from public.payments) = 0, 'zonal officer must not read payments';
  assert (select count(*) from public.journal_entries) = 0, 'zonal officer must not read journals';
  assert (select count(*) from public.tasks) = 1, 'zonal officer sees only own tasks';
  assert not exists (select 1 from public.tasks t join public.profiles p on p.id = t.officer_id where p.email = 't.zonal2@test.local'), 'cannot read other officer tasks';
  update public.tasks set title = 'hacked' where officer_id <> public.current_profile_id();
  assert not exists (select 1 from public.tasks where title = 'hacked'), 'cannot update other officer tasks';
  begin
    perform public.rpt_trial_balance(current_date);
    raise exception 'zonal must not run finance reports';
  exception when insufficient_privilege then null; end;
  raise notice 'PASS Zonal officer: no finance access, only own tasks';
end $$;
select pg_temp.login('t.driver1@test.local');
do $$
begin
  assert (select count(*) from public.job_orders) = (select count(*) from public.job_orders j where public.is_assigned_to_job(j.id)), 'driver sees only assigned jobs';
  assert (select count(*) from public.job_orders) >= 1, 'driver sees own job';
  assert (select count(*) from public.get_my_jobs(current_date - 1, current_date + 7)) >= 1, 'driver mobile view lists own jobs';
  assert (select count(*) from public.customers) = 0, 'driver cannot read customers';
  raise notice 'PASS Driver sees only own jobs';
end $$;

-- ---------- 5. Recurring contract: Company A pays GH₵ 100 a month for 12 months ----------
select pg_temp.login('t.ops1@test.local');
do $$
declare v_k uuid; v_k2 uuid; v_start date := date_trunc('month', current_date)::date;
begin
  insert into public.contracts (customer_id, contract_type, title, start_date, end_date, billing_frequency, amount_per_period, billing_day, payment_terms_days, taxable, service_id)
  values ((select v from pg_temp.t where k = 'companyA'), 'recurring', 'Office cleaning', v_start, (v_start + interval '12 months' - interval '1 day')::date, 'monthly', 100, 1, 30, true,
          (select id from public.services where code = 'JAN')) returning id into v_k;
  perform public.submit_contract(v_k);
  insert into public.contracts (customer_id, contract_type, title, start_date, end_date, billing_frequency, amount_per_period, billing_day, payment_terms_days, service_id)
  values ((select v from pg_temp.t where k = 'companyB'), 'recurring', 'Office cleaning B', v_start, (v_start + interval '12 months' - interval '1 day')::date, 'monthly', 100, 1, 30,
          (select id from public.services where code = 'JAN')) returning id into v_k2;
  perform public.submit_contract(v_k2);
  insert into pg_temp.t values ('contractA', v_k), ('contractB', v_k2);
end $$;
select pg_temp.login('t.manager1@test.local');
select public.approve_contract((select v from pg_temp.t where k = 'contractA'));
select public.approve_contract((select v from pg_temp.t where k = 'contractB'));
select pg_temp.logout();
do $$
declare n1 int; n2 int; v_k uuid := (select v from pg_temp.t where k = 'contractA');
begin
  n1 := public.generate_recurring_invoices(current_date);
  n2 := public.generate_recurring_invoices(current_date);
  assert (select count(*) from public.invoices where contract_id = v_k) = 1, 'exactly one invoice for contract A';
  assert n2 = 0, 'second run creates nothing';
  assert (select total from public.invoices where contract_id = v_k) = 100, 'invoice 100';
  assert exists (select 1 from public.journal_entries e join public.invoices i on i.id = e.source_id where i.contract_id = v_k and e.event_code = 'contract_invoice'
     and exists (select 1 from public.journal_lines l join public.accounts a on a.id = l.account_id where l.entry_id = e.id and a.code = '4100' and l.credit = 100)), 'Dr AR / Cr Contract revenue 100';
  assert (select count(*) from public.notifications n join public.invoices i on i.id = n.related_id where i.contract_id = v_k and n.event_code = 'recurring_invoice' and n.channel = 'sms') = 1, 'SMS queued';
  assert (select count(*) from public.notifications n join public.invoices i on i.id = n.related_id where i.contract_id = v_k and n.event_code = 'recurring_invoice' and n.channel = 'email') = 1, 'email queued';
  raise notice 'PASS recurring billing idempotent; email and SMS queued';
end $$;
select pg_temp.login('t.ops1@test.local');
insert into public.contract_supplies (contract_id, cost_item_id, quantity) values ((select v from pg_temp.t where k = 'contractA'), (select id from public.cost_items where code = 'CON-DIS'), 0.5);
insert into public.contract_labour (contract_id, role_description, actual_wage_amount) values ((select v from pg_temp.t where k = 'contractA'), 'Cleaners', 30);
insert into public.contract_supplies (contract_id, cost_item_id, quantity) values ((select v from pg_temp.t where k = 'contractB'), (select id from public.cost_items where code = 'CON-DIS'), 1);
do $$
begin
  begin
    insert into public.contract_supplies (contract_id, cost_item_id, quantity, unit_cost) values ((select v from pg_temp.t where k = 'contractA'), (select id from public.cost_items where code = 'CON-DIS'), 1, 1);
    raise exception 'unit cost override must fail for ops';
  exception when insufficient_privilege then null; end;
end $$;
select pg_temp.login('t.manager1@test.local');
do $$
declare r record;
begin
  select * into r from public.v_contract_monthly_profitability where contract_id = (select v from pg_temp.t where k = 'contractA') and month = date_trunc('month', current_date)::date;
  assert r.revenue = 100 and r.direct_cost = 90 and r.gross_profit = 10 and r.margin_pct = 10, format('expected GP 10 / 10%%, got %s / %s', r.gross_profit, r.margin_pct);
  select * into r from public.v_contract_monthly_profitability where contract_id = (select v from pg_temp.t where k = 'contractB') and month = date_trunc('month', current_date)::date;
  assert r.is_loss and r.gross_profit = -20, 'contract B month flagged as a loss';
  assert exists (select 1 from public.in_app_notifications n where n.profile_id = public.current_profile_id() and n.title like 'Loss-making month:%'), 'manager alerted';
  raise notice 'PASS contract profitability: GP 10 at 10%%; GH₵120 supplies -> loss + manager alert';
end $$;

-- ---------- 6. Estimator ----------
select pg_temp.login('t.ops1@test.local');
do $$
declare v_e uuid; e public.estimates; v_job uuid;
begin
  insert into public.estimates (customer_id, service_id, title, site, target_margin_pct, overhead_pct, contingency_pct, proposed_price)
  values ((select v from pg_temp.t where k = 'cust2'), (select id from public.services where code = 'CES'), 'Cesspit emptying', 'Test site', 25, 10, 5, 100) returning id into v_e;
  perform public.apply_estimate_template(v_e, (select default_template_id from public.services where code = 'CES'));
  update public.estimates set target_margin_pct = 25, overhead_pct = 10, contingency_pct = 5, proposed_price = 100 where id = v_e;
  select * into e from public.estimates where id = v_e;
  assert e.total_cost > 100 and e.price_warning = 'below_cost', 'red warning when price below cost';
  assert e.recommended_price = round(e.total_cost / (1 - 0.25), 2), 'recommended = total cost / (1 - margin)';
  assert e.total_cost = e.direct_cost + round(e.direct_cost * 0.10, 2) + round(e.direct_cost * 0.05, 2), 'total cost = direct + overhead + contingency';
  update public.estimates set proposed_price = e.recommended_price where id = v_e;
  assert public.submit_estimate(v_e) = 'approved', 'estimate at target margin approves itself';
  v_job := public.convert_estimate_to_job(v_e, current_date);
  assert (select estimate_id from public.job_orders where id = v_job) = v_e and (select converted_job_id from public.estimates where id = v_e) = v_job, 'link kept both ways';
  insert into pg_temp.t values ('est', v_e), ('estjob', v_job);
  raise notice 'PASS estimator: warning, recommended price, conversion keeps link';
end $$;
select pg_temp.logout();
do $$
declare v_job uuid := (select v from pg_temp.t where k = 'estjob');
begin
  insert into public.job_order_actual_costs (job_order_id, category, description, quantity, unit_cost) values (v_job, 'labour', 'Loaders', 2, 100);
  assert (select sum(actual) from public.v_estimate_vs_actual where estimate_id = (select v from pg_temp.t where k = 'est')) = 200, 'variance view shows actual cost';
  raise notice 'PASS estimate vs actual variance';
end $$;

-- ---------- 7. Survey ----------
select pg_temp.logout();
do $$
declare v_token text; v_res jsonb; v_inv uuid := (select v from pg_temp.t where k = 'pay1_invitation'); q record; v_ans jsonb := '[]'::jsonb;
begin
  select token into v_token from public.survey_invitations where id = v_inv;
  assert (public.get_public_survey(v_token) ->> 'state') = 'open', 'link opens';
  for q in select sq.* from public.survey_questions sq join public.survey_invitations si on si.survey_id = sq.survey_id where si.id = v_inv loop
    v_ans := v_ans || jsonb_build_object('question_id', q.id, 'rating', case q.question_type when 'star' then 2 when 'nps' then 5 end,
      'text_value', case when q.question_type = 'text' then 'Team arrived late' end);
  end loop;
  v_res := public.submit_survey_response(v_token, v_ans);
  assert (v_res->>'low')::boolean, 'low score detected';
  assert exists (select 1 from public.followup_tasks where source_type = 'survey_response' and status = 'open'), 'manager follow-up created';
  begin
    perform public.submit_survey_response(v_token, v_ans);
    raise exception 'second response must fail';
  exception when others then if sqlerrm = 'second response must fail' then raise; end if; end;
  raise notice 'PASS survey: opens without login, one response only, low score -> follow-up';
end $$;

-- ---------- 9b. Every report runs ----------
-- A report that only fails when it is opened is a report nobody tests. Each one is executed here
-- so a planner error such as an ambiguous column cannot reach the Reports page unnoticed.
do $$
declare n bigint;
begin
  select count(*) into n from public.rpt_profit_and_loss(current_date - 365, current_date);
  select count(*) into n from public.rpt_balance_sheet(current_date);
  select count(*) into n from public.rpt_trial_balance(current_date);
  select count(*) into n from public.rpt_general_ledger((select id from public.accounts order by code limit 1), current_date - 365, current_date);
  select count(*) into n from public.rpt_cash_flow(current_date - 365, current_date);
  select count(*) into n from public.rpt_ar_aging(current_date);
  select count(*) into n from public.rpt_ap_aging(current_date);
  select count(*) into n from public.rpt_tax_summary(current_date - 365, current_date);
  select count(*) into n from public.rpt_expenses_by_category(current_date - 365, current_date);
  raise notice 'PASS all nine financial reports execute';
end $$;

-- ---------- 10. Security: every table has RLS ----------
do $$
begin
  assert not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity), 'a table without RLS';
  assert (select sum(debit) = sum(credit) from public.rpt_trial_balance(current_date)), 'trial balance balances at the end';
  raise notice 'PASS every public table has RLS enabled; trial balance balances';
end $$;

-- ---------- 11. Configurable lists, and Open -> Due -> Overdue ----------
do $$
declare v_cust uuid; v_inv_open uuid; v_inv_due uuid; v_inv_late uuid; n int;
begin
  -- one default per list, so a form never has to choose between two
  begin
    insert into public.list_options (category, value, label, numeric_value, is_default)
    values ('payment_terms', 'net_120', '120 days', 120, true);
    assert false, 'a second default payment term was allowed';
  exception when unique_violation then null;
  end;

  -- an option is archived, never deleted, so records already using it still read correctly
  update public.list_options set archived_at = now() where category = 'customer_sector' and value = 'other';
  assert not exists (select 1 from public.list_options
    where category = 'customer_sector' and value = 'other' and archived_at is null), 'archived option still offered';
  update public.list_options set archived_at = null where category = 'customer_sector' and value = 'other';

  select id into v_cust from public.customers limit 1;

  insert into public.invoices (customer_id, issue_date, due_date, status, subtotal, taxable_amount, tax_total, total, balance)
  values (v_cust, current_date, current_date + 10, 'issued', 100, 100, 0, 100, 100) returning id into v_inv_open;
  insert into public.invoices (customer_id, issue_date, due_date, status, subtotal, taxable_amount, tax_total, total, balance)
  values (v_cust, current_date - 7, current_date, 'issued', 100, 100, 0, 100, 100) returning id into v_inv_due;
  insert into public.invoices (customer_id, issue_date, due_date, status, subtotal, taxable_amount, tax_total, total, balance)
  values (v_cust, current_date - 30, current_date - 3, 'issued', 100, 100, 0, 100, 100) returning id into v_inv_late;

  n := public.job_mark_overdue();

  assert (select status from public.invoices where id = v_inv_open) = 'issued', 'an invoice not yet due left Open';
  assert (select status from public.invoices where id = v_inv_due) = 'due', 'an invoice due today reads Due';
  assert (select status from public.invoices where id = v_inv_late) = 'overdue', 'an invoice past its date reads Overdue';

  raise notice 'PASS lists keep one default and archive rather than delete; invoices run Open -> Due -> Overdue';
end $$;

rollback;

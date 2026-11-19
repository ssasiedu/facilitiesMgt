-- 0022: book a truck or a crew member by time of day, not by whole days.
--
-- A tanker that empties one site between 11:00 and 14:00 is free at 15:00. Until now a booking
-- covered whole days, so the second job of the day was refused as a double booking. Bookings now
-- carry a timestamp range and the overlap rule works on that, so the same truck takes as many jobs
-- in a day as the clock allows.
--
-- The range is half-open, [start, end): a job ending at 14:00 and one starting at 14:00 do not
-- overlap. Leaving the times blank books the whole day, which is what every existing job did, so
-- nothing already in the system changes meaning.
--
-- The server runs in UTC, which is Ghana time, so a date plus a local time needs no conversion.

-- ---------------------------------------------------------------- times on the job order
alter table public.job_orders
  add column if not exists start_time time,
  add column if not exists end_time   time;

comment on column public.job_orders.start_time is 'Local start. Null means the job holds its trucks and crew for the whole day.';
comment on column public.job_orders.end_time is 'Local end. Must be after start_time on a single-day job.';

do $$ begin
  alter table public.job_orders add constraint job_orders_times_chk check (
    (start_time is null and end_time is null)
    or (start_time is not null and end_time is not null
        and (coalesce(end_date, execution_date) > execution_date or end_time > start_time))
  );
exception when duplicate_object then null; end $$;

-- Fill the new columns from the free-text window where it was written as HH:MM-HH:MM.
update public.job_orders
set start_time = substring(time_window from '(\d{1,2}:\d{2})')::time,
    end_time   = substring(time_window from '\d{1,2}:\d{2}\s*[-–—to]+\s*(\d{1,2}:\d{2})')::time
where start_time is null
  and time_window ~ '\d{1,2}:\d{2}\s*[-–—to]+\s*\d{1,2}:\d{2}'
  and substring(time_window from '\d{1,2}:\d{2}\s*[-–—to]+\s*(\d{1,2}:\d{2})')::time
      > substring(time_window from '(\d{1,2}:\d{2})')::time;

/* time_window is still what the SMS templates, the PDFs and the driver's screen read, so it is
   kept in step with the two columns rather than being left to drift. */
create or replace function public.trg_job_order_time_window() returns trigger
language plpgsql as $$
begin
  if new.start_time is not null and new.end_time is not null then
    new.time_window := to_char(new.start_time, 'HH24:MI') || '–' || to_char(new.end_time, 'HH24:MI');
  end if;
  return new;
end $$;

drop trigger if exists trg_job_orders_time_window on public.job_orders;
create trigger trg_job_orders_time_window before insert or update of start_time, end_time
  on public.job_orders for each row execute function public.trg_job_order_time_window();



create or replace function public.span_of(p_from date, p_to date, p_start time, p_end time)
returns tstzrange language sql immutable set search_path = public as $$
  select tstzrange(
    (p_from + coalesce(p_start, time '00:00'))::timestamptz,
    case when p_start is null or p_end is null
         then (coalesce(p_to, p_from) + 1 + time '00:00')::timestamptz   -- whole days
         else (coalesce(p_to, p_from) + p_end)::timestamptz end,
    '[)')
$$;

/* The span a job holds its truck and crew for. One place, so the availability list, the checks at
   submission and the booking written at approval can never disagree with each other. */
create or replace function public.job_order_span(p_job_id uuid) returns tstzrange
language sql stable set search_path = public as $$
  select public.span_of(j.execution_date, j.end_date, j.start_time, j.end_time)
  from public.job_orders j where j.id = p_job_id
$$;

-- The day-by-day calendar view reads period, so it has to stand aside while the column changes
-- type. It is rebuilt below, with a day now counting as taken only when a booking covers all of it.
drop view if exists public.v_truck_availability;

-- ---------------------------------------------------------------- bookings carry a timestamp range
do $$
declare v_opc text;
begin
  -- btree_gist gives the equality half of the constraint for uuid; find it wherever it was installed.
  select quote_ident(n.nspname) || '.' || quote_ident(oc.opcname) into v_opc
  from pg_opclass oc join pg_am am on am.oid = oc.opcmethod join pg_namespace n on n.oid = oc.opcnamespace
  where am.amname = 'gist' and oc.opcintype = 'uuid'::regtype limit 1;
  if v_opc is null then raise exception 'btree_gist is not installed, so bookings cannot be constrained'; end if;

  if (select atttypid from pg_attribute
      where attrelid = 'public.truck_bookings'::regclass and attname = 'period') = 'daterange'::regtype then

    alter table public.truck_bookings drop constraint if exists truck_bookings_no_overlap;
    alter table public.employee_bookings drop constraint if exists employee_bookings_no_overlap;
    alter table public.truck_bookings drop constraint if exists truck_bookings_period_chk;
    alter table public.employee_bookings drop constraint if exists employee_bookings_period_chk;
    drop index if exists public.truck_bookings_period_idx;
    drop index if exists public.employee_bookings_period_idx;

    -- An existing whole-day booking becomes midnight to midnight, covering exactly the days it did.
    alter table public.truck_bookings
      alter column period type tstzrange
      using tstzrange((lower(period))::timestamptz, (upper(period))::timestamptz, '[)');
    alter table public.employee_bookings
      alter column period type tstzrange
      using tstzrange((lower(period))::timestamptz, (upper(period))::timestamptz, '[)');

    alter table public.truck_bookings add constraint truck_bookings_period_chk
      check (not isempty(period) and lower(period) is not null and upper(period) is not null);
    alter table public.employee_bookings add constraint employee_bookings_period_chk
      check (not isempty(period) and lower(period) is not null and upper(period) is not null);

    execute format('alter table public.truck_bookings add constraint truck_bookings_no_overlap ' ||
      'exclude using gist (truck_id %s with =, period with &&) where (active)', v_opc);
    execute format('alter table public.employee_bookings add constraint employee_bookings_no_overlap ' ||
      'exclude using gist (employee_id %s with =, period with &&) where (active)', v_opc);
  end if;
end $$;

create or replace view public.v_truck_availability as
select t.id as truck_id, t.registration_no, t.fleet_code, t.truck_type, t.status, t.off_road_reason,
  t.expected_return_date, d.d::date as day,
  (select j.job_no from public.truck_bookings b join public.job_orders j on j.id = b.job_order_id
   where b.truck_id = t.id and b.active and b.period && tstzrange(d.d::date::timestamptz, (d.d::date + 1)::timestamptz, '[)')
   order by lower(b.period) limit 1) as booked_job_no,
  (select b.job_order_id from public.truck_bookings b
   where b.truck_id = t.id and b.active and b.period && tstzrange(d.d::date::timestamptz, (d.d::date + 1)::timestamptz, '[)')
   order by lower(b.period) limit 1) as booked_job_id,
  case
    when t.status = 'off_road' and (t.expected_return_date is null or d.d::date < t.expected_return_date) then false
    -- a part-day booking leaves the rest of the day open, so only a booking covering the whole day takes it
    when exists (select 1 from public.truck_bookings b where b.truck_id = t.id and b.active
                   and b.period @> tstzrange(d.d::date::timestamptz, (d.d::date + 1)::timestamptz, '[)')) then false
    else true
  end as available
from public.trucks t
cross join generate_series((current_date - 7)::timestamptz, (current_date + 60)::timestamptz, interval '1 day') d(d)
where t.archived_at is null;

grant select on public.v_truck_availability to authenticated;

create index if not exists truck_bookings_period_idx on public.truck_bookings using gist (period) where active;
create index if not exists employee_bookings_period_idx on public.employee_bookings using gist (period) where active;

-- Existing bookings predate the times, so align them with the job they belong to.
update public.truck_bookings b set period = public.job_order_span(b.job_order_id)
where b.active and b.job_order_id is not null and b.period <> public.job_order_span(b.job_order_id);
update public.employee_bookings b set period = public.job_order_span(b.job_order_id)
where b.active and b.job_order_id is not null and b.period <> public.job_order_span(b.job_order_id);

-- ---------------------------------------------------------------- availability, by the clock
drop function if exists public.get_truck_availability(date, date, text, uuid);

create or replace function public.get_truck_availability(
  p_from date, p_to date, p_type text default null, p_exclude_job uuid default null,
  p_start time default null, p_end time default null)
returns table (truck_id uuid, registration_no text, fleet_code text, truck_type text, status text, off_road_reason text,
  expected_return_date date, driver_id uuid, driver_name text, capacity text, bookings jsonb, available boolean, reason text)
language sql stable security definer set search_path = public as $$
  with want as (select public.span_of(p_from, p_to, p_start, p_end) as span)
  select t.id, t.registration_no, t.fleet_code, t.truck_type, t.status, t.off_road_reason, t.expected_return_date,
    e.id, e.full_name,
    case when t.capacity_litres is not null then trim(to_char(t.capacity_litres, 'FM999,999')) || ' L'
         when t.capacity_cabins is not null then t.capacity_cabins || ' cabins' else null end,
    -- every booking that touches the day range, so the officer can see the gaps as well as the clashes
    coalesce((select jsonb_agg(jsonb_build_object(
                'job_id', j.id, 'job_no', j.job_no, 'customer', j.customer_name,
                'from', lower(b.period), 'to', upper(b.period),
                'clashes', b.period && (select span from want)) order by lower(b.period))
              from public.truck_bookings b join public.job_orders j on j.id = b.job_order_id
              where b.truck_id = t.id and b.active and b.job_order_id is distinct from p_exclude_job
                and b.period && tstzrange((p_from)::timestamptz, (coalesce(p_to, p_from) + 1)::timestamptz, '[)')), '[]'::jsonb),
    (t.status <> 'off_road' and not exists (
       select 1 from public.truck_bookings b where b.truck_id = t.id and b.active
         and b.period && (select span from want) and b.job_order_id is distinct from p_exclude_job)),
    case when t.status = 'off_road'
           then 'Off-Road: ' || replace(t.off_road_reason, '_', ' ') || coalesce(' until ' || public.date_text(t.expected_return_date), '')
         when exists (select 1 from public.truck_bookings b where b.truck_id = t.id and b.active
                        and b.period && (select span from want) and b.job_order_id is distinct from p_exclude_job)
           then 'Already booked: ' || (
             select string_agg(j.job_no || ' ' || to_char(lower(b.period), 'HH24:MI') || '–' || to_char(upper(b.period), 'HH24:MI'), ', ' order by lower(b.period))
             from public.truck_bookings b join public.job_orders j on j.id = b.job_order_id
             where b.truck_id = t.id and b.active and b.period && (select span from want)
               and b.job_order_id is distinct from p_exclude_job)
         else null end
  from public.trucks t left join public.employees e on e.id = t.assigned_driver_id
  where t.archived_at is null and (p_type is null or t.truck_type = p_type)
    and (public.has_any_role(array['ops_officer','sales_exec','manager','fleet_manager','executive','accountant']) or auth.uid() is null)
  order by (t.status = 'off_road'), t.registration_no
$$;

grant execute on function public.get_truck_availability(date, date, text, uuid, time, time) to authenticated;
grant execute on function public.span_of(date, date, time, time) to authenticated;
grant execute on function public.job_order_span(uuid) to authenticated;

-- ---------------------------------------------------------------- the checks and the booking
-- Copied from 0013 with the day range swapped for the span. Everything else is unchanged:
-- the overlap tests read `b.period && v_period` either way, so only the type beneath them moves.

create or replace function public._check_job_order(p_job_id uuid) returns text[]
language plpgsql security definer set search_path = public as $$
declare j public.job_orders; c public.customers; v_warn text[] := '{}'; v_req text[]; r record; v_period tstzrange; v_errors text[] := '{}';
begin
  select * into j from public.job_orders where id = p_job_id;
  select * into c from public.customers where id = j.customer_id;
  v_period := public.span_of(j.execution_date, j.end_date, j.start_time, j.end_time);
  if c.status = 'blacklisted' then raise exception 'Customer % is blacklisted', c.display_name; end if;
  if c.archived_at is not null then raise exception 'Customer % is archived', c.display_name; end if;
  if not exists (select 1 from public.job_order_lines where job_order_id = p_job_id) then raise exception 'Add at least one service line'; end if;
  if j.agreed_amount <= 0 then raise exception 'The agreed amount must be greater than zero'; end if;
  if c.credit_limit > 0 and public.customer_outstanding(c.id) + j.agreed_amount > c.credit_limit then
    v_warn := v_warn || ('Customer is over the credit limit of GH₵ ' || public.money_text(c.credit_limit) || ' (outstanding GH₵ ' || public.money_text(public.customer_outstanding(c.id)) || ')');
  end if;
  select array_agg(distinct s.required_truck_type) filter (where s.requires_truck and s.required_truck_type is not null) into v_req
  from public.job_order_lines l join public.services s on s.id = l.service_id where l.job_order_id = p_job_id;
  if exists (select 1 from public.job_order_lines l join public.services s on s.id = l.service_id where l.job_order_id = p_job_id and s.requires_truck)
     and not exists (select 1 from public.job_order_assignments where job_order_id = p_job_id and kind = 'truck') then
    v_errors := v_errors || 'This service needs a truck. Assign one.'::text;
  end if;
  for r in select t.* from public.job_order_assignments a join public.trucks t on t.id = a.truck_id where a.job_order_id = p_job_id and a.kind = 'truck' loop
    if r.status = 'off_road' then v_errors := v_errors || ('Truck ' || r.registration_no || ' is Off-Road'); end if;
    if r.archived_at is not null then v_errors := v_errors || ('Truck ' || r.registration_no || ' is archived'); end if;
    if v_req is not null and array_length(v_req, 1) > 0 and not (r.truck_type = any(v_req)) then
      v_errors := v_errors || ('Truck ' || r.registration_no || ' is a ' || replace(r.truck_type, '_', ' ') || '; the service needs ' || replace(array_to_string(v_req, ' or '), '_', ' '));
    end if;
    if exists (select 1 from public.truck_bookings b where b.truck_id = r.id and b.active and b.period && v_period and b.job_order_id <> p_job_id) then
      v_errors := v_errors || ('Truck ' || r.registration_no || ' is already booked: ' ||
        (select string_agg(jj.job_no || ' (' || public.date_text(lower(b.period)::date) || ' ' || to_char(lower(b.period), 'HH24:MI') || '–' || to_char(upper(b.period), 'HH24:MI') || ')', ', ') from public.truck_bookings b join public.job_orders jj on jj.id = b.job_order_id
         where b.truck_id = r.id and b.active and b.period && v_period and b.job_order_id <> p_job_id));
    end if;
    if exists (select 1 from public.job_order_assignments a2 join public.job_orders j2 on j2.id = a2.job_order_id
               where a2.truck_id = r.id and a2.kind = 'truck' and j2.id <> p_job_id and j2.status = 'pending_approval'
                 and public.span_of(j2.execution_date, j2.end_date, j2.start_time, j2.end_time) && v_period) then
      v_warn := v_warn || ('Truck ' || r.registration_no || ' is also on another job awaiting approval for these dates');
    end if;
  end loop;
  for r in select e.* , a.kind from public.job_order_assignments a join public.employees e on e.id = a.employee_id where a.job_order_id = p_job_id and a.kind in ('driver','crew') loop
    if r.status <> 'active' then v_errors := v_errors || (r.full_name || ' is not active'); end if;
    if r.kind = 'driver' and (r.licence_expiry is null or r.licence_expiry < coalesce(j.end_date, j.execution_date)) then
      v_errors := v_errors || ('Driver ' || r.full_name || ' has no valid licence for the job dates');
    end if;
    if exists (select 1 from public.employee_bookings b where b.employee_id = r.id and b.active and b.period && v_period and b.job_order_id <> p_job_id) then
      v_errors := v_errors || (r.full_name || ' is already booked: ' ||
        (select string_agg(jj.job_no, ', ') from public.employee_bookings b join public.job_orders jj on jj.id = b.job_order_id
         where b.employee_id = r.id and b.active and b.period && v_period and b.job_order_id <> p_job_id));
    end if;
  end loop;
  if array_length(v_errors, 1) > 0 then raise exception '%', array_to_string(v_errors, E'\n') using errcode = 'P0001'; end if;
  return v_warn;
end $$;

create or replace function public.submit_job_order(p_job_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare j public.job_orders; v_warn text[];
begin
  perform public.require_role(array['ops_officer','sales_exec','manager']);
  select * into j from public.job_orders where id = p_job_id for update;
  if not found then raise exception 'Job order not found'; end if;
  if j.status <> 'draft' then raise exception 'Only draft job orders can be submitted (current status: %)', j.status; end if;
  perform public.recalc_job_order(p_job_id);
  v_warn := public._check_job_order(p_job_id);
  update public.job_orders set status = 'pending_approval', submitted_at = now(), rejection_reason = null,
    credit_warning = exists (select 1 from unnest(v_warn) w where w like 'Customer is over the credit limit%'), needs_reassignment = false
  where id = p_job_id;
  perform public.notify_role('manager', 'Job ' || j.job_no || ' awaiting approval', coalesce(j.customer_name, '') || ' – ' || public.date_text(j.execution_date), '/jobs/' || j.id, 'info', 'job-submit-' || j.id || '-' || now()::text);
  return jsonb_build_object('status', 'pending_approval', 'warnings', to_jsonb(v_warn));
end $$;

create or replace function public._job_vars(p_job_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('job_no', j.job_no, 'customer_name', j.customer_name,
    'service', coalesce((select string_agg(s.name, ', ' order by l.sort_order) from public.job_order_lines l join public.services s on s.id = l.service_id where l.job_order_id = j.id), ''),
    'date', public.date_text(j.execution_date), 'time_window', coalesce(j.time_window, ''),
    'site', coalesce(j.site_address, '') || coalesce(' (' || j.digital_address || ')', ''),
    'truck_reg', coalesce((select string_agg(t.registration_no, ', ') from public.job_order_assignments a join public.trucks t on t.id = a.truck_id where a.job_order_id = j.id and a.kind = 'truck'), ''),
    'driver_name', coalesce((select string_agg(e.full_name, ', ') from public.job_order_assignments a join public.employees e on e.id = a.employee_id where a.job_order_id = j.id and a.kind = 'driver'), ''),
    'driver_phone', coalesce((select string_agg(e.phone, ', ') from public.job_order_assignments a join public.employees e on e.id = a.employee_id where a.job_order_id = j.id and a.kind = 'driver'), ''),
    'officer_name', coalesce((select full_name from public.profiles where id = coalesce(j.officer_id, j.raised_by)), ''),
    'amount', public.money_text(j.agreed_amount),
    'invoice_no', coalesce((select invoice_no from public.invoices where id = j.invoice_id), ''),
    'invoice_link', coalesce(public.invoice_link(j.invoice_id), ''))
  from public.job_orders j where j.id = p_job_id
$$;

create or replace function public.approve_job_order(p_job_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare j public.job_orders; c public.customers; v_inv uuid; v_period tstzrange; r record; s public.company_settings; v_warn text[]; v_sms int;
begin
  perform public.require_role(array['manager']);
  s := public.app_settings();
  select * into j from public.job_orders where id = p_job_id for update;
  if not found then raise exception 'Job order not found'; end if;
  if j.status <> 'pending_approval' then raise exception 'Only job orders pending approval can be approved (current status: %)', j.status; end if;
  if s.segregation_of_duties and j.raised_by = public.current_profile_id() then
    raise exception 'Segregation of duties: you raised this job order, so another manager must approve it' using errcode = '42501';
  end if;
  perform public.recalc_job_order(p_job_id);
  v_warn := public._check_job_order(p_job_id);
  select * into j from public.job_orders where id = p_job_id;
  select * into c from public.customers where id = j.customer_id;
  v_period := public.span_of(j.execution_date, j.end_date, j.start_time, j.end_time);
  begin
    for r in select truck_id from public.job_order_assignments where job_order_id = p_job_id and kind = 'truck' loop
      insert into public.truck_bookings (truck_id, job_order_id, period) values (r.truck_id, p_job_id, v_period);
    end loop;
    for r in select distinct employee_id from public.job_order_assignments where job_order_id = p_job_id and kind in ('driver','crew') loop
      insert into public.employee_bookings (employee_id, job_order_id, period) values (r.employee_id, p_job_id, v_period);
    end loop;
  exception when exclusion_violation then
    raise exception 'A truck or staff member on this job is already booked for that time. Change the time, reassign, and resubmit.' using errcode = '23P01';
  end;
  -- invoice for the agreed amount: "Issued – not yet due", revenue deferred until completion
  insert into public.invoices (source, customer_id, customer_name, job_order_id, contract_id, issue_date, notes)
  values ('job', j.customer_id, c.display_name, j.id, j.contract_id, current_date, 'Job order ' || j.job_no) returning id into v_inv;
  insert into public.invoice_lines (invoice_id, service_id, description, quantity, unit_price, discount, taxable, sort_order)
  select v_inv, l.service_id, coalesce(nullif(l.description, ''), s2.name), l.quantity, l.unit_price, l.discount, l.taxable, l.sort_order
  from public.job_order_lines l join public.services s2 on s2.id = l.service_id where l.job_order_id = p_job_id;
  perform public._issue_invoice(v_inv, 'job_approved', true, null);
  update public.job_orders set status = 'approved', approved_by = public.current_profile_id(), approved_at = now(), invoice_id = v_inv where id = p_job_id;
  v_sms := public._job_messages(p_job_id, 'job_approved', true, true, true);
  perform public.notify_profile(j.raised_by, 'Job ' || j.job_no || ' approved', 'Scheduled for ' || public.date_text(j.execution_date), '/jobs/' || j.id, 'success');
  return jsonb_build_object('status', 'approved', 'invoice_id', v_inv, 'sms_queued', v_sms, 'warnings', to_jsonb(v_warn));
end $$;

create or replace function public.reject_job_order(p_job_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare j public.job_orders;
begin
  perform public.require_role(array['manager']);
  if coalesce(btrim(p_reason), '') = '' then raise exception 'A rejection reason is required'; end if;
  select * into j from public.job_orders where id = p_job_id for update;
  if j.status <> 'pending_approval' then raise exception 'Only job orders pending approval can be rejected'; end if;
  update public.job_orders set status = 'draft', rejection_reason = p_reason where id = p_job_id;
  insert into public.job_order_status_history (job_order_id, from_status, to_status, note) values (p_job_id, 'pending_approval', 'rejected', p_reason);
  perform public.queue_notification('job_rejected_officer', 'sms', p.full_name, p.phone, null, public._job_vars(p_job_id) || jsonb_build_object('reason', p_reason, 'officer_name', p.full_name),
    null, p.id, 'officer', 'job_order', p_job_id) from public.profiles p where p.id = j.raised_by;
  perform public.notify_profile(j.raised_by, 'Job ' || j.job_no || ' rejected', p_reason, '/jobs/' || j.id, 'danger');
end $$;

create or replace function public.start_job_order(p_job_id uuid, p_lat numeric default null, p_lng numeric default null) returns void
language plpgsql security definer set search_path = public as $$
declare j public.job_orders; r record;
begin
  perform public.require_role(array['ops_officer','manager']);
  select * into j from public.job_orders where id = p_job_id for update;
  if not found then raise exception 'Job order not found'; end if;
  if j.status <> 'approved' then raise exception 'Only approved job orders can be started (current status: %)', j.status; end if;
  if current_date < j.execution_date then raise exception 'This job can only be started from % onwards', public.date_text(j.execution_date); end if;
  if j.needs_reassignment then raise exception 'Reassign the Off-Road truck before starting'; end if;
  update public.job_orders set status = 'in_progress', started_at = now(), started_by = public.current_profile_id(), start_lat = p_lat, start_lng = p_lng where id = p_job_id;
  for r in select truck_id from public.job_order_assignments where job_order_id = p_job_id and kind = 'truck' loop
    perform public._apply_truck_status(r.truck_id, 'on_job', null, null, 'On job ' || j.job_no);
  end loop;
end $$;

-- p_actuals: [{category, cost_item_id, employee_id, description, quantity, unit_cost, stock_location_id}]
create or replace function public.complete_job_order(p_job_id uuid, p_signoff_name text, p_signature_path text default null,
  p_notes text default null, p_actuals jsonb default '[]'::jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare j public.job_orders; i public.invoices; c public.customers; a jsonb; r record; v_lines jsonb := '[]'::jsonb; v_deferred numeric;
  v_net numeric; v_done numeric := 0; v_cnt int; v_k int := 0; v_amt numeric; v_due date;
begin
  perform public.require_role(array['ops_officer','manager']);
  select * into j from public.job_orders where id = p_job_id for update;
  if not found then raise exception 'Job order not found'; end if;
  if j.status <> 'in_progress' then raise exception 'Only jobs in progress can be completed (current status: %)', j.status; end if;
  if coalesce(btrim(p_signoff_name), '') = '' then raise exception 'Customer sign-off name is required'; end if;
  for a in select * from jsonb_array_elements(coalesce(p_actuals, '[]'::jsonb)) loop
    insert into public.job_order_actual_costs (job_order_id, category, cost_item_id, employee_id, description, quantity, unit_cost, stock_location_id)
    values (p_job_id, a->>'category', nullif(a->>'cost_item_id', '')::uuid, nullif(a->>'employee_id', '')::uuid, coalesce(a->>'description', 'Actual cost'),
      coalesce((a->>'quantity')::numeric, 1), coalesce((a->>'unit_cost')::numeric, 0), nullif(a->>'stock_location_id', '')::uuid);
  end loop;
  select * into c from public.customers where id = j.customer_id;
  select * into i from public.invoices where id = j.invoice_id for update;
  v_due := current_date + coalesce(c.payment_terms_days, 7);
  if i.id is not null and i.revenue_deferred then
    -- recognise what is still deferred for this invoice (net of any credit notes), line by line
    select coalesce(sum(jl.credit - jl.debit), 0) into v_deferred from public.journal_lines jl
      where jl.invoice_id = i.id and jl.account_id = public.rule_credit('job_approved');
    v_net := i.total - i.tax_total;
    select count(*) into v_cnt from public.invoice_lines where invoice_id = i.id;
    if v_deferred > 0 then
      for r in select il.*, s.revenue_account_id as svc_acct from public.invoice_lines il left join public.services s on s.id = il.service_id where il.invoice_id = i.id order by il.sort_order, il.id loop
        v_k := v_k + 1;
        v_amt := case when v_k = v_cnt then v_deferred - v_done else round(v_deferred * r.line_total / nullif(v_net, 0), 2) end;
        v_done := v_done + v_amt;
        v_lines := v_lines
          || jsonb_build_object('account_id', public.rule_debit('job_completed'), 'debit', v_amt, 'description', 'Recognise ' || i.invoice_no, 'customer_id', i.customer_id, 'job_order_id', j.id, 'service_id', r.service_id, 'invoice_id', i.id)
          || jsonb_build_object('account_id', coalesce(r.revenue_account_id, r.svc_acct, public.rule_credit('job_completed')), 'credit', v_amt, 'description', coalesce(r.description, 'Service revenue'), 'customer_id', i.customer_id, 'job_order_id', j.id, 'service_id', r.service_id, 'invoice_id', i.id);
      end loop;
      perform public._post_journal(current_date, 'Revenue recognised – job ' || j.job_no, 'job_order', j.id, 'job_completed', v_lines);
    end if;
    update public.invoices set revenue_deferred = false, revenue_recognised_at = now(), due_date = v_due where id = i.id;
    perform public.refresh_invoice_status(i.id);
  end if;
  update public.job_orders set status = 'completed', completed_at = now(), completed_by = public.current_profile_id(),
    signoff_name = p_signoff_name, signature_path = p_signature_path, completion_notes = p_notes where id = p_job_id;
  for r in select truck_id from public.job_order_assignments where job_order_id = p_job_id and kind = 'truck' loop
    if not exists (select 1 from public.job_order_assignments a2 join public.job_orders j2 on j2.id = a2.job_order_id
                   where a2.truck_id = r.truck_id and a2.kind = 'truck' and j2.status = 'in_progress' and j2.id <> p_job_id) then
      perform public._apply_truck_status(r.truck_id, 'on_road', null, null, 'Completed ' || j.job_no);
    end if;
  end loop;
  perform public._job_messages(p_job_id, 'job_completed', true, false, false);
  if i.id is not null then perform public.refresh_invoice_status(i.id); end if; -- closes the job if already paid
  return jsonb_build_object('status', (select status from public.job_orders where id = p_job_id), 'due_date', v_due);
end $$;

create or replace function public.cancel_job_order(p_job_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare j public.job_orders; i public.invoices; v_cn uuid; r record;
begin
  perform public.require_role(array['manager']);
  if coalesce(btrim(p_reason), '') = '' then raise exception 'A cancellation reason is required'; end if;
  select * into j from public.job_orders where id = p_job_id for update;
  if j.status in ('completed','closed','cancelled') then raise exception 'A % job order cannot be cancelled', j.status; end if;
  if j.invoice_id is not null then
    select * into i from public.invoices where id = j.invoice_id;
    if i.total - i.amount_credited > 0 then
      v_cn := public._issue_credit_note(i.id, i.total - i.amount_credited, 'Job ' || j.job_no || ' cancelled: ' || p_reason);
    end if;
  end if;
  update public.truck_bookings set active = false where job_order_id = p_job_id;
  update public.employee_bookings set active = false where job_order_id = p_job_id;
  for r in select truck_id from public.job_order_assignments where job_order_id = p_job_id and kind = 'truck' loop
    if (select status from public.trucks where id = r.truck_id) = 'on_job' then perform public._apply_truck_status(r.truck_id, 'on_road', null, null, 'Cancelled ' || j.job_no); end if;
  end loop;
  update public.job_orders set status = 'cancelled', cancel_reason = p_reason, cancelled_at = now() where id = p_job_id;
  perform public.notify_profile(j.raised_by, 'Job ' || j.job_no || ' cancelled', p_reason, '/jobs/' || j.id, 'warning');
  return jsonb_build_object('status', 'cancelled', 'credit_note_id', v_cn);
end $$;

create or replace function public.hold_job_order(p_job_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare j public.job_orders;
begin
  perform public.require_role(array['manager']);
  if coalesce(btrim(p_reason), '') = '' then raise exception 'A reason is required'; end if;
  select * into j from public.job_orders where id = p_job_id for update;
  if j.status not in ('draft','pending_approval','approved') then raise exception 'Only draft, pending or approved jobs can be put on hold'; end if;
  update public.job_orders set held_from_status = status, status = 'on_hold', hold_reason = p_reason where id = p_job_id;
end $$;

create or replace function public.resume_job_order(p_job_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare j public.job_orders;
begin
  perform public.require_role(array['manager']);
  select * into j from public.job_orders where id = p_job_id for update;
  if j.status <> 'on_hold' then raise exception 'Job order is not on hold'; end if;
  update public.job_orders set status = coalesce(held_from_status, 'draft'), held_from_status = null where id = p_job_id;
end $$;

-- Replace a truck on an approved/pending job (e.g. after the original went Off-Road)
create or replace function public.reassign_job_truck(p_job_id uuid, p_old_truck uuid, p_new_truck uuid) returns void
language plpgsql security definer set search_path = public as $$
declare j public.job_orders; t public.trucks; v_period tstzrange;
begin
  perform public.require_role(array['ops_officer','manager']);
  select * into j from public.job_orders where id = p_job_id for update;
  if j.status not in ('draft','pending_approval','approved','on_hold') then raise exception 'Trucks can only be changed before the job starts'; end if;
  select * into t from public.trucks where id = p_new_truck;
  if t.status = 'off_road' then raise exception 'Truck % is Off-Road', t.registration_no; end if;
  v_period := public.span_of(j.execution_date, j.end_date, j.start_time, j.end_time);
  update public.job_order_assignments set truck_id = p_new_truck where job_order_id = p_job_id and kind = 'truck' and truck_id = p_old_truck;
  if not found then raise exception 'That truck is not on this job'; end if;
  if j.status in ('approved','on_hold') then
    update public.truck_bookings set active = false where job_order_id = p_job_id and truck_id = p_old_truck;
    begin
      insert into public.truck_bookings (truck_id, job_order_id, period) values (p_new_truck, p_job_id, v_period);
    exception when exclusion_violation then
      raise exception 'Truck % is already booked for these dates', t.registration_no using errcode = '23P01';
    end;
  end if;
  if not exists (select 1 from public.job_order_assignments a join public.trucks tt on tt.id = a.truck_id where a.job_order_id = p_job_id and a.kind = 'truck' and tt.status = 'off_road') then
    update public.job_orders set needs_reassignment = false, reassignment_note = null where id = p_job_id;
  end if;
end $$;

-- Driver mobile view: only the jobs assigned to the signed-in driver
create or replace function public.get_my_jobs(p_from date default current_date, p_to date default current_date + 7)
returns table (id uuid, job_no text, status text, execution_date date, end_date date, time_window text, customer_name text, customer_phone text,
  site_address text, digital_address text, site_lat numeric, site_lng numeric, instructions text, services text, trucks text, officer_name text, officer_phone text)
language sql stable security definer set search_path = public as $$
  select j.id, j.job_no, j.status, j.execution_date, j.end_date, j.time_window, j.customer_name,
    coalesce(ct.phone, c.phone, c.company_phone), j.site_address, j.digital_address, j.site_lat, j.site_lng, j.instructions,
    (select string_agg(s.name, ', ') from public.job_order_lines l join public.services s on s.id = l.service_id where l.job_order_id = j.id),
    (select string_agg(t.registration_no, ', ') from public.job_order_assignments a join public.trucks t on t.id = a.truck_id where a.job_order_id = j.id and a.kind = 'truck'),
    p.full_name, p.phone
  from public.job_orders j
  join public.customers c on c.id = j.customer_id
  left join public.customer_contacts ct on ct.id = j.contact_id
  left join public.profiles p on p.id = coalesce(j.officer_id, j.raised_by)
  where j.status in ('approved','in_progress','completed','closed')
    and coalesce(j.end_date, j.execution_date) >= p_from and j.execution_date <= p_to
    and exists (select 1 from public.job_order_assignments a join public.employees e on e.id = a.employee_id
                where a.job_order_id = j.id and a.kind in ('driver','crew') and e.profile_id = public.current_profile_id())
  order by j.execution_date, j.time_window
$$;

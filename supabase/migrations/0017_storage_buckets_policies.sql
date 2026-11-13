-- 0017_storage_buckets_policies.sql : private buckets (read through signed URLs) and one public branding bucket.
-- Path conventions:
--   customer-documents/{customer_id}/{type}/{file}     job-photos/{job_order_id}/{kind}/{file}
--   fleet-documents/{truck_id}/{file}                  expense-receipts/{bill_or_expense_id}/{file}
--   task-evidence/{officer_profile_id}/{task_id}/{file} contracts/{contract_id}/{file}      branding/{file}

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('customer-documents', 'customer-documents', false, 5242880, array['image/jpeg','image/png','application/pdf']),
  ('job-photos', 'job-photos', false, 5242880, array['image/jpeg','image/png']),
  ('fleet-documents', 'fleet-documents', false, 5242880, array['image/jpeg','image/png','application/pdf']),
  ('expense-receipts', 'expense-receipts', false, 5242880, array['image/jpeg','image/png','application/pdf']),
  ('task-evidence', 'task-evidence', false, 5242880, array['image/jpeg','image/png','application/pdf']),
  ('contracts', 'contracts', false, 10485760, array['image/jpeg','image/png','application/pdf']),
  ('branding', 'branding', true, 2097152, array['image/jpeg','image/png','image/svg+xml','image/webp'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.storage_folder_uuid(p_name text, p_index int default 1) returns uuid
language plpgsql immutable as $$
begin
  return (storage.foldername(p_name))[p_index]::uuid;
exception when others then
  return null;
end $$;
grant execute on function public.storage_folder_uuid to authenticated;

do $$
declare
  r record;
begin
  for r in select policyname from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'fm\_%' loop
    execute format('drop policy if exists %I on storage.objects', r.policyname);
  end loop;
end $$;

-- customer documents: anyone who can see the customer can read; customer staff can write
create policy fm_custdocs_select on storage.objects for select to authenticated
  using (bucket_id = 'customer-documents' and public.can_see_customer(public.storage_folder_uuid(name)));
create policy fm_custdocs_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'customer-documents' and public.can_see_customer(public.storage_folder_uuid(name))
              and public.has_any_role(array['manager','ops_officer','sales_exec','zonal_officer']));
create policy fm_custdocs_delete on storage.objects for delete to authenticated
  using (bucket_id = 'customer-documents' and public.has_any_role(array['manager','ops_officer','sales_exec']));

-- job photos and signatures
create policy fm_jobphotos_select on storage.objects for select to authenticated
  using (bucket_id = 'job-photos' and (public.has_any_role(array['manager','ops_officer','sales_exec','accountant','fleet_manager','executive'])
         or public.is_assigned_to_job(public.storage_folder_uuid(name))));
create policy fm_jobphotos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'job-photos' and (public.has_any_role(array['manager','ops_officer','sales_exec'])
              or public.is_assigned_to_job(public.storage_folder_uuid(name))));

-- fleet documents
create policy fm_fleetdocs_select on storage.objects for select to authenticated
  using (bucket_id = 'fleet-documents' and public.has_any_role(array['fleet_manager','manager','ops_officer','executive']));
create policy fm_fleetdocs_write on storage.objects for insert to authenticated
  with check (bucket_id = 'fleet-documents' and public.has_any_role(array['fleet_manager']));
create policy fm_fleetdocs_delete on storage.objects for delete to authenticated
  using (bucket_id = 'fleet-documents' and public.has_any_role(array['fleet_manager']));

-- expense receipts
create policy fm_receipts_select on storage.objects for select to authenticated
  using (bucket_id = 'expense-receipts' and public.has_any_role(array['accountant','manager','executive','fleet_manager']));
create policy fm_receipts_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'expense-receipts' and public.has_any_role(array['accountant','fleet_manager']));

-- task evidence: officers in their own folder, managers everywhere
create policy fm_evidence_select on storage.objects for select to authenticated
  using (bucket_id = 'task-evidence' and (public.has_any_role(array['manager','executive']) or public.storage_folder_uuid(name) = public.current_profile_id()));
create policy fm_evidence_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'task-evidence' and (public.has_any_role(array['manager']) or public.storage_folder_uuid(name) = public.current_profile_id()));

-- signed contracts
create policy fm_contracts_select on storage.objects for select to authenticated
  using (bucket_id = 'contracts' and public.has_any_role(array['manager','ops_officer','sales_exec','accountant','executive']));
create policy fm_contracts_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'contracts' and public.has_any_role(array['manager','ops_officer','sales_exec','accountant']));

-- branding (public read)
create policy fm_branding_select on storage.objects for select to anon, authenticated using (bucket_id = 'branding');
create policy fm_branding_insert on storage.objects for insert to authenticated with check (bucket_id = 'branding' and public.has_role('super_admin'));
create policy fm_branding_update on storage.objects for update to authenticated using (bucket_id = 'branding' and public.has_role('super_admin'));
create policy fm_branding_delete on storage.objects for delete to authenticated using (bucket_id = 'branding' and public.has_role('super_admin'));

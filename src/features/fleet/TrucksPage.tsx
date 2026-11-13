import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Wrench } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { hasAny } from '@/lib/permissions';
import { useEmployees, toOptions } from '@/lib/lookups';
import { formatDate, formatNumber, humanize } from '@/lib/format';
import { truckSchema, TRUCK_TYPES } from '@/lib/schemas';
import { CrudPage, type CrudField } from '@/components/ui/CrudPage';
import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { enumOptions } from '@/components/ui/Select';
import { TruckStatusModal } from './TruckStatusModal';
import type { Column } from '@/components/ui/DataTable';
import type { Tables } from '@/types/database';

type Row = Tables<'trucks'> & { driver: { full_name: string } | null };

/** Fleet list (spec 4.5). Status changes go through set_truck_status so history is kept. */
export default function TrucksPage() {
  const { roles } = useAuth();
  const canManage = hasAny(roles, 'fleet_manager');
  const { data: drivers } = useEmployees();
  const [statusTruck, setStatusTruck] = useState<Row | null>(null);

  const fields: CrudField[] = [
    { name: 'registration_no', label: 'Registration number', required: true, placeholder: 'GT 4521-21' },
    { name: 'fleet_code', label: 'Fleet code', placeholder: 'CES-01' },
    { name: 'truck_type', label: 'Type', type: 'select', required: true, options: enumOptions(TRUCK_TYPES) },
    { name: 'make', label: 'Make' },
    { name: 'model', label: 'Model' },
    { name: 'year', label: 'Year', type: 'number' },
    { name: 'capacity_litres', label: 'Capacity (litres)', type: 'number', step: '0.001', hint: 'Tankers and cesspit emptiers' },
    { name: 'capacity_cabins', label: 'Capacity (cabins)', type: 'number', hint: 'Cabin carriers' },
    { name: 'chassis_no', label: 'Chassis number' },
    { name: 'fuel_type', label: 'Fuel', type: 'select', options: enumOptions(['diesel', 'petrol', 'other']) },
    { name: 'odometer_km', label: 'Odometer (km)', type: 'number', step: '0.1' },
    { name: 'assigned_driver_id', label: 'Assigned driver', type: 'select',
      options: toOptions((drivers ?? []).filter((d) => d.role_type === 'driver'), (d) => d.full_name) },
  ];

  const columns: Column<Row>[] = [
    { key: 'reg', header: 'Registration', sort: 'registration_no',
      render: (r) => <Link to={`/fleet/trucks/${r.id}`} className="font-medium text-brand-700 hover:underline">{r.registration_no}</Link>,
      exportValue: (r) => r.registration_no },
    { key: 'code', header: 'Fleet code', sort: 'fleet_code', render: (r) => r.fleet_code ?? '—', exportValue: (r) => r.fleet_code },
    { key: 'type', header: 'Type', sort: 'truck_type', render: (r) => humanize(r.truck_type), exportValue: (r) => r.truck_type },
    { key: 'capacity', header: 'Capacity', render: (r) => (r.capacity_litres ? `${formatNumber(r.capacity_litres)} L` : r.capacity_cabins ? `${r.capacity_cabins} cabins` : '—'),
      exportValue: (r) => r.capacity_litres ?? r.capacity_cabins, hideOnMobile: true },
    { key: 'driver', header: 'Driver', render: (r) => r.driver?.full_name ?? '—', exportValue: (r) => r.driver?.full_name, hideOnMobile: true },
    { key: 'odo', header: 'Odometer', className: 'text-right', sort: 'odometer_km',
      render: (r) => <span className="tabular-nums">{formatNumber(r.odometer_km)} km</span>, exportValue: (r) => r.odometer_km, hideOnMobile: true },
    { key: 'status', header: 'Status', sort: 'status', render: (r) => (
      <span className="flex flex-col gap-0.5">
        <StatusBadge status={r.status} />
        {r.status === 'off_road' ? (
          <span className="text-xs text-red-700">{humanize(r.off_road_reason)} · back {formatDate(r.expected_return_date)}</span>
        ) : null}
      </span>
    ), exportValue: (r) => r.status },
  ];

  return (
    <>
      <CrudPage<Row>
        title="Trucks"
        subtitle="On-Road means available for jobs. Off-Road needs a reason and an expected return date."
        table="trucks"
        select="*, driver:employees(full_name)"
        schema={truckSchema}
        fields={fields}
        columns={columns}
        searchColumns={['registration_no', 'fleet_code', 'make', 'model', 'chassis_no']}
        defaultSort={{ column: 'registration_no', ascending: true }}
        canEdit={canManage}
        archivable
        exportName="trucks"
        extraActions={(row) => (canManage ? (
          <Button variant="ghost" size="sm" aria-label="Change status" onClick={() => setStatusTruck(row)}><Wrench className="h-4 w-4" /></Button>
        ) : null)}
        defaultValues={{
          registration_no: '', fleet_code: '', truck_type: 'cesspit_emptier', make: '', model: '', year: '',
          capacity_litres: '', capacity_cabins: '', chassis_no: '', fuel_type: 'diesel', odometer_km: 0, assigned_driver_id: '',
        }}
      />
      {statusTruck ? (
        <TruckStatusModal truck={statusTruck} onClose={() => setStatusTruck(null)} />
      ) : null}
      {!canManage ? (
        <p className="mt-3 text-xs text-stone-500">
          Only a Fleet Manager can add trucks or change their status. <Link to="/fleet/reports" className="text-brand-700 hover:underline">Fleet reports</Link> are open to you.
        </p>
      ) : null}
      {canManage ? (
        <p className="mt-3 flex items-center gap-1 text-xs text-stone-500">
          <Plus className="h-3 w-3" />Use the spanner to put a truck Off-Road or back On-Road; any future job orders are flagged automatically.
        </p>
      ) : null}
    </>
  );
}

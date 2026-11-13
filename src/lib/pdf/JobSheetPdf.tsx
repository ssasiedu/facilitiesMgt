import { Text, View } from '@react-pdf/renderer';
import { date, Header, s, Shell, Table, type CompanyInfo } from './PdfKit';
import { displayPhone, formatNumber } from '../format';

export interface JobSheetDoc {
  job_no: string; execution_date: string; end_date: string | null; time_window: string | null; priority: string;
  customer_name: string; customer_phone: string | null; contact_name: string | null; site_address: string | null; digital_address: string | null;
  instructions: string | null; lines: { service: string; quantity: number; description: string | null }[];
  trucks: string[]; driver: string | null; driver_phone: string | null; crew: string[]; officer: string | null;
}

export function JobSheetPdf({ company, job }: { company: CompanyInfo; job: JobSheetDoc }) {
  const field = (label: string, value: string | null | undefined) => (
    <View style={{ width: '50%', marginBottom: 6 }}><Text style={[s.muted, s.small]}>{label}</Text><Text>{value || '—'}</Text></View>
  );
  return (
    <Shell company={company} title={`Job sheet ${job.job_no}`}>
      <Header company={company} title="JOB SHEET" number={job.job_no} meta={[['Date', `${date(job.execution_date)}${job.end_date ? ` – ${date(job.end_date)}` : ''}`], ['Time', job.time_window ?? '—'], ['Priority', job.priority]]} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 10 }}>
        {field('Customer', job.customer_name)}
        {field('Phone', displayPhone(job.customer_phone))}
        {field('Site contact', job.contact_name)}
        {field('Site', `${job.site_address ?? ''}${job.digital_address ? ` (${job.digital_address})` : ''}`)}
        {field('Truck(s)', job.trucks.join(', '))}
        {field('Driver', `${job.driver ?? '—'}${job.driver_phone ? ` · ${displayPhone(job.driver_phone)}` : ''}`)}
        {field('Crew', job.crew.join(', '))}
        {field('Officer in charge', job.officer)}
      </View>
      <Table brand={company.brand_color} rows={job.lines} columns={[
        { label: 'Service', width: '45%', value: (l) => l.service },
        { label: 'Details', width: '40%', value: (l) => l.description ?? '' },
        { label: 'Qty', width: '15%', align: 'right', value: (l) => formatNumber(l.quantity) },
      ]} />
      <View style={[s.box, { marginTop: 12 }]}><Text style={s.h2}>Instructions</Text><Text>{job.instructions || '—'}</Text></View>
      <View style={[s.box, { marginTop: 12, height: 90 }]}><Text style={s.h2}>Work done / remarks</Text></View>
      <View style={[s.between, { marginTop: 30 }]}>
        <Text>Customer name: _______________________</Text>
        <Text>Signature: _______________________</Text>
      </View>
      <View style={[s.between, { marginTop: 16 }]}>
        <Text>Start time: __________   End time: __________</Text>
        <Text>Officer: _______________________</Text>
      </View>
    </Shell>
  );
}

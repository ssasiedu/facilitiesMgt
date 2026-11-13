import { Document, Font, Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import type { ReactNode } from 'react';
import { formatDate, formatGHS } from '../format';

// Inter (bundled in /public/fonts, includes the ₵ sign) for every PDF.
Font.register({
  family: 'Inter',
  fonts: [
    { src: '/fonts/Inter-Regular.ttf', fontWeight: 400 },
    { src: '/fonts/Inter-Bold.ttf', fontWeight: 700 },
  ],
});
Font.registerHyphenationCallback((word) => [word]);

export interface CompanyInfo {
  name: string;
  logo_url?: string | null;
  address?: string | null;
  digital_address?: string | null;
  tin?: string | null;
  phones?: string | null;
  email?: string | null;
  website?: string | null;
  bank_details?: string | null;
  momo_details?: string | null;
  invoice_terms?: string | null;
  invoice_footer?: string | null;
  brand_color?: string | null;
}

export const s = StyleSheet.create({
  page: { fontFamily: 'Inter', fontSize: 9, color: '#1c1917', paddingTop: 36, paddingBottom: 56, paddingHorizontal: 40 },
  row: { flexDirection: 'row' },
  between: { flexDirection: 'row', justifyContent: 'space-between' },
  h1: { fontSize: 18, fontWeight: 700 },
  h2: { fontSize: 11, fontWeight: 700, marginBottom: 4 },
  muted: { color: '#78716c' },
  small: { fontSize: 8 },
  bold: { fontWeight: 700 },
  box: { borderWidth: 1, borderColor: '#e7e5e4', borderRadius: 4, padding: 8 },
  th: { fontWeight: 700, color: '#ffffff', paddingVertical: 5, paddingHorizontal: 4 },
  td: { paddingVertical: 4, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: '#f5f5f4' },
  right: { textAlign: 'right' },
  footer: { position: 'absolute', bottom: 24, left: 40, right: 40, fontSize: 7, color: '#a8a29e', flexDirection: 'row', justifyContent: 'space-between' },
});

export const money = (n: number | string | null | undefined) => formatGHS(n);
export const date = (d: string | null | undefined) => formatDate(d);

export function Header({ company, title, number, meta }: { company: CompanyInfo; title: string; number?: string | null; meta?: [string, string][] }) {
  const brand = company.brand_color || '#0F766E';
  return (
    <View style={{ marginBottom: 18 }}>
      <View style={s.between}>
        <View style={{ flexDirection: 'row', alignItems: 'center', maxWidth: '60%' }}>
          {company.logo_url ? <Image src={company.logo_url} style={{ width: 54, height: 54, objectFit: 'contain', marginRight: 10 }} /> : null}
          <View>
            <Text style={{ fontSize: 13, fontWeight: 700, color: brand }}>{company.name}</Text>
            {company.address ? <Text style={s.muted}>{company.address}{company.digital_address ? ` · ${company.digital_address}` : ''}</Text> : null}
            {company.phones || company.email ? <Text style={s.muted}>{[company.phones, company.email].filter(Boolean).join(' · ')}</Text> : null}
            {company.tin ? <Text style={s.muted}>TIN: {company.tin}</Text> : null}
          </View>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={[s.h1, { color: brand }]}>{title}</Text>
          {number ? <Text style={s.bold}>{number}</Text> : null}
          {meta?.map(([k, v]) => <Text key={k} style={s.muted}>{k}: {v}</Text>)}
        </View>
      </View>
      <View style={{ height: 3, backgroundColor: brand, marginTop: 10 }} />
    </View>
  );
}

export interface Column<T> { label: string; width: string; align?: 'left' | 'right'; value: (row: T) => ReactNode }

export function Table<T>({ columns, rows, brand }: { columns: Column<T>[]; rows: T[]; brand?: string | null }) {
  return (
    <View>
      <View style={[s.row, { backgroundColor: brand || '#0F766E' }]} fixed>
        {columns.map((c) => <Text key={c.label} style={[s.th, { width: c.width }, c.align === 'right' ? s.right : {}]}>{c.label}</Text>)}
      </View>
      {rows.map((r, i) => (
        <View key={i} style={s.row} wrap={false}>
          {columns.map((c) => <Text key={c.label} style={[s.td, { width: c.width }, c.align === 'right' ? s.right : {}]}>{c.value(r)}</Text>)}
        </View>
      ))}
    </View>
  );
}

export function Totals({ rows }: { rows: [string, string, boolean?][] }) {
  return (
    <View style={{ alignSelf: 'flex-end', width: '45%', marginTop: 8 }}>
      {rows.map(([k, v, strong]) => (
        <View key={k} style={[s.between, { paddingVertical: 3, borderBottomWidth: strong ? 0 : 1, borderBottomColor: '#f5f5f4' }]}>
          <Text style={strong ? s.bold : s.muted}>{k}</Text>
          <Text style={strong ? [s.bold, { fontSize: 11 }] : {}}>{v}</Text>
        </View>
      ))}
    </View>
  );
}

export function PaymentDetails({ company }: { company: CompanyInfo }) {
  if (!company.bank_details && !company.momo_details) return null;
  return (
    <View style={[s.box, { marginTop: 14 }]} wrap={false}>
      <Text style={s.h2}>How to pay</Text>
      {company.bank_details ? <Text>{company.bank_details}</Text> : null}
      {company.momo_details ? <Text>{company.momo_details}</Text> : null}
    </View>
  );
}

export function Shell({ company, title, children }: { company: CompanyInfo; title: string; children: ReactNode }) {
  return (
    <Document title={title} author={company.name} creator="FacilitiesManagement">
      <Page size="A4" style={s.page}>
        {children}
        <View style={s.footer} fixed>
          <Text>{company.invoice_footer || company.name}</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

import { Page, Document, Text, View } from '@react-pdf/renderer';
import { Header, s, Table, type CompanyInfo } from './PdfKit';

export interface ReportColumn { label: string; width: string; align?: 'left' | 'right'; key: string }

/** Generic landscape report: KPI summary + one or more tables (used by reports and the dashboard export). */
export function ReportPdf({ company, title, subtitle, summary, sections }: {
  company: CompanyInfo; title: string; subtitle?: string;
  summary?: [string, string][];
  sections: { title?: string; columns: ReportColumn[]; rows: Record<string, string | number | null | undefined>[] }[];
}) {
  return (
    <Document title={title} author={company.name}>
      <Page size="A4" orientation="landscape" style={s.page}>
        <Header company={company} title={title.toUpperCase()} meta={subtitle ? [['', subtitle]] : undefined} />
        {summary?.length ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 12 }}>
            {summary.map(([k, v]) => (
              <View key={k} style={[s.box, { width: '23%', marginRight: '2%', marginBottom: 6 }]}>
                <Text style={[s.muted, s.small]}>{k}</Text><Text style={{ fontSize: 12, fontWeight: 700 }}>{v}</Text>
              </View>
            ))}
          </View>
        ) : null}
        {sections.map((sec, i) => (
          <View key={i} style={{ marginBottom: 14 }}>
            {sec.title ? <Text style={s.h2}>{sec.title}</Text> : null}
            <Table brand={company.brand_color} rows={sec.rows} columns={sec.columns.map((c) => ({ label: c.label, width: c.width, align: c.align, value: (r: Record<string, string | number | null | undefined>) => String(r[c.key] ?? '') }))} />
          </View>
        ))}
        <View style={s.footer} fixed>
          <Text>{company.name} · generated {new Date().toLocaleString('en-GB')}</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

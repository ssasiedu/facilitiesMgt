import Papa from 'papaparse';
import * as XLSX from 'xlsx';

export interface ExportColumn<T> {
  header: string;
  value: (row: T) => string | number | boolean | null | undefined;
}

function toMatrix<T>(rows: T[], columns: ExportColumn<T>[]) {
  return rows.map((r) => Object.fromEntries(columns.map((c) => [c.header, c.value(r) ?? ''])));
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportCsv<T>(rows: T[], columns: ExportColumn<T>[], filename: string) {
  const csv = Papa.unparse(toMatrix(rows, columns));
  download(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }), filename.endsWith('.csv') ? filename : `${filename}.csv`);
}

export function exportXlsx<T>(rows: T[], columns: ExportColumn<T>[], filename: string, sheet = 'Data') {
  const ws = XLSX.utils.json_to_sheet(toMatrix(rows, columns));
  ws['!cols'] = columns.map((c) => ({ wch: Math.max(12, c.header.length + 2) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheet.slice(0, 31));
  XLSX.writeFile(wb, filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`);
}

/** Several sheets in one workbook (full backup export). */
export function exportWorkbook(sheets: { name: string; rows: Record<string, unknown>[] }[], filename: string) {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(s.rows), s.name.slice(0, 31));
  XLSX.writeFile(wb, filename);
}

/** Read CSV or Excel into plain objects keyed by the header row. */
export async function readSpreadsheet(file: File): Promise<Record<string, string>[]> {
  if (/\.csv$/i.test(file.name) || file.type === 'text/csv') {
    const text = await file.text();
    const res = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true, transformHeader: (h) => h.trim() });
    return res.data;
  }
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json<Record<string, string>>(ws, { defval: '', raw: false });
}

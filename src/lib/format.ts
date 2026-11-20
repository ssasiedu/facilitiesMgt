import { format, isValid, parseISO, differenceInCalendarDays } from 'date-fns';

const money = new Intl.NumberFormat('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qty = new Intl.NumberFormat('en-GH', { maximumFractionDigits: 3 });

/** GH₵ 1,250.00 */
export function formatGHS(value: number | string | null | undefined): string {
  const n = Number(value ?? 0);
  const s = money.format(Math.abs(n));
  return `${n < 0 ? '-' : ''}GH₵ ${s}`;
}

export function formatNumber(value: number | string | null | undefined): string {
  return qty.format(Number(value ?? 0));
}

export function formatPct(value: number | string | null | undefined, digits = 1): string {
  return `${Number(value ?? 0).toFixed(digits)}%`;
}

/** Round half away from zero to 2 dp (line-level rounding, same as the database). */
export function round2(n: number): number {
  return Math.sign(n) * Math.round(Math.abs(n) * 100 + Number.EPSILON) / 100;
}

function toDate(d: string | Date | null | undefined): Date | null {
  if (!d) return null;
  const v = typeof d === 'string' ? parseISO(d) : d;
  return isValid(v) ? v : null;
}

/** DD/MM/YYYY (Africa/Accra is UTC+0, so dates need no conversion). */
export function formatDate(d: string | Date | null | undefined): string {
  const v = toDate(d);
  return v ? format(v, 'dd/MM/yyyy') : '—';
}

export function formatDateTime(d: string | Date | null | undefined): string {
  const v = toDate(d);
  return v ? format(v, 'dd/MM/yyyy HH:mm') : '—';
}

export function isoDate(d: Date = new Date()): string {
  return format(d, 'yyyy-MM-dd');
}

export function daysFrom(d: string | null | undefined): number | null {
  const v = toDate(d);
  return v ? differenceInCalendarDays(new Date(), v) : null;
}

/** Accept 024…, +233…, 233… and return 233XXXXXXXXX (or null when not a Ghana number). */
export function normalizePhone(input: string | null | undefined): string | null {
  if (!input) return null;
  let d = input.replace(/\D/g, '');
  if (d.startsWith('00233')) d = d.slice(2);
  if (d.length === 10 && d.startsWith('0')) d = `233${d.slice(1)}`;
  else if (d.length === 9) d = `233${d}`;
  return /^233\d{9}$/.test(d) ? d : null;
}

/** 233244123456 -> 024 412 3456 */
export function displayPhone(p: string | null | undefined): string {
  if (!p) return '—';
  const local = p.startsWith('233') ? `0${p.slice(3)}` : p;
  return local.replace(/^(\d{3})(\d{3})(\d{4})$/, '$1 $2 $3');
}

export const GHANA_CARD_RE = /^GHA-\d{9}-\d$/;
export const DIGITAL_ADDRESS_RE = /^[A-Z]{2}-\d{3,4}-\d{4}$/;

export function humanize(v: string | null | undefined): string {
  if (!v) return '—';
  const s = v.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const GSM = "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM_EXT = '^{}\\[~]|€';

/** SMS length in characters and 160-character segments (70 for Unicode, e.g. the ₵ sign). */
export function smsSegments(text: string): { characters: number; segments: number; unicode: boolean } {
  let units = 0;
  for (const ch of text) {
    if (GSM.includes(ch)) units += 1;
    else if (GSM_EXT.includes(ch)) units += 2;
    else {
      const n = [...text].length;
      return { characters: n, segments: n <= 70 ? 1 : Math.ceil(n / 67), unicode: true };
    }
  }
  return { characters: units, segments: units <= 160 ? 1 : Math.ceil(units / 153), unicode: false };
}

export function initials(name: string | null | undefined): string {
  return (name ?? '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('');
}

/**
 * Payment references from a gateway run to 30-odd characters and break a table cell. Shown in
 * full they overlap the next column; shown truncated with no marker they look like a different
 * reference. This keeps both ends, which is what someone matching against a provider statement
 * reads, and marks the middle as missing. The full value stays available through a title.
 */
export function shortRef(reference: string | null | undefined, keep = 20): string {
  const r = (reference ?? '').trim();
  if (!r) return '—';
  if (r.length <= keep) return r;
  const head = Math.ceil((keep - 1) / 2);
  const tail = Math.floor((keep - 1) / 2);
  return `${r.slice(0, head)}…${r.slice(-tail)}`;
}

// Template rendering, phone normalisation and SMS segment counting (mirrors src/lib/format.ts).
export function renderTemplate(body: string, vars: Record<string, unknown>): string {
  return body.replace(/\{([a-z_]+)\}/g, (match, key: string) => (key in vars ? String(vars[key] ?? "") : match));
}

export function normalizePhone(input: string | null | undefined): string | null {
  if (!input) return null;
  let d = input.replace(/\D/g, "");
  if (d.startsWith("00233")) d = d.slice(2);
  if (d.length === 10 && d.startsWith("0")) d = "233" + d.slice(1);
  else if (d.length === 9) d = "233" + d;
  return /^233\d{9}$/.test(d) ? d : null;
}

const GSM_CHARS = "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM_EXT = "^{}\\[~]|€";

export function smsSegments(text: string): { characters: number; segments: number; unicode: boolean } {
  let units = 0;
  let unicode = false;
  for (const ch of text) {
    if (GSM_CHARS.includes(ch)) units += 1;
    else if (GSM_EXT.includes(ch)) units += 2;
    else { unicode = true; break; }
  }
  if (unicode) {
    const n = [...text].length;
    return { characters: n, segments: n <= 70 ? 1 : Math.ceil(n / 67), unicode };
  }
  return { characters: units, segments: units <= 160 ? 1 : Math.ceil(units / 153), unicode };
}

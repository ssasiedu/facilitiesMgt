/** Apply the brand colour from Settings by setting the CSS variables used by Tailwind's brand-* classes. */
function hexToRgb(hex: string): [number, number, number] {
  const m = hex.replace('#', '').match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return [15, 118, 110];
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

function mix(c: [number, number, number], target: number, amount: number): string {
  return c.map((v) => Math.round(v + (target - v) * amount)).join(' ');
}

export function applyBrandColor(hex: string | null | undefined): void {
  const rgb = hexToRgb(hex || '#0F766E');
  const root = document.documentElement.style;
  root.setProperty('--brand-50', mix(rgb, 255, 0.92));
  root.setProperty('--brand-100', mix(rgb, 255, 0.82));
  root.setProperty('--brand-500', mix(rgb, 255, 0.12));
  root.setProperty('--brand-600', rgb.join(' '));
  root.setProperty('--brand-700', mix(rgb, 0, 0.18));
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', hex || '#0F766E');
}

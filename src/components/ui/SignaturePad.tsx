import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Eraser } from 'lucide-react';
import { Button } from './Button';

export interface SignaturePadHandle { isEmpty: () => boolean; toBlob: () => Promise<Blob | null>; clear: () => void }

/** Touch/mouse signature capture on a canvas. */
export const SignaturePad = forwardRef<SignaturePadHandle, { height?: number }>(function SignaturePad({ height = 160 }, ref) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [empty, setEmpty] = useState(true);

  useEffect(() => {
    const c = canvas.current!;
    const ratio = window.devicePixelRatio || 1;
    c.width = c.offsetWidth * ratio; c.height = height * ratio;
    const ctx = c.getContext('2d')!;
    ctx.scale(ratio, ratio); ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.strokeStyle = '#1c1917';
  }, [height]);

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => { const r = e.currentTarget.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const clear = () => { const c = canvas.current!; c.getContext('2d')!.clearRect(0, 0, c.width, c.height); setEmpty(true); };

  useImperativeHandle(ref, () => ({
    isEmpty: () => empty,
    clear,
    toBlob: () => new Promise((resolve) => canvas.current!.toBlob((b) => resolve(b), 'image/png')),
  }), [empty]);

  return (
    <div>
      <canvas ref={canvas} style={{ height, touchAction: 'none' }} aria-label="Signature pad"
        className="w-full rounded-lg border border-dashed border-stone-400 bg-white"
        onPointerDown={(e) => { drawing.current = true; const ctx = e.currentTarget.getContext('2d')!; const p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); e.currentTarget.setPointerCapture(e.pointerId); }}
        onPointerMove={(e) => { if (!drawing.current) return; const ctx = e.currentTarget.getContext('2d')!; const p = pos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); setEmpty(false); }}
        onPointerUp={() => { drawing.current = false; }} onPointerLeave={() => { drawing.current = false; }} />
      <div className="mt-1 flex justify-between text-xs text-stone-500">
        <span>Customer signs inside the box (optional)</span>
        <Button variant="ghost" size="sm" icon={<Eraser className="h-4 w-4" />} onClick={clear}>Clear</Button>
      </div>
    </div>
  );
});

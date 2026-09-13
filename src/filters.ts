export type FilterDef = {
  id: string;
  name: string;
  css: string;
};

export const FILTERS: FilterDef[] = [
  { id: 'natural', name: 'Original', css: 'none' },
  { id: 'grayscale', name: 'Grayscale', css: 'grayscale(1) contrast(1.1)' },
  { id: 'sepia', name: 'Sepia', css: 'sepia(.6) contrast(1.1) brightness(.95)' },
  { id: 'bright', name: 'Bright', css: 'brightness(1.2) saturate(1.1)' },
  { id: 'contrast', name: 'Contrast', css: 'contrast(1.4) brightness(1.02)' },
  { id: 'warm', name: 'Warm', css: 'sepia(.25) saturate(1.3) hue-rotate(-10deg) brightness(1.05)' },
  { id: 'cool', name: 'Cool', css: 'saturate(1.1) hue-rotate(15deg) brightness(1.02) contrast(1.05)' },
  { id: 'glow', name: 'Glow', css: 'brightness(1.08) saturate(1.15) blur(.3px) drop-shadow(0 0 8px rgba(255,240,200,.45))' },
  { id: 'vintage', name: 'Vintage', css: 'sepia(.4) contrast(1.15) brightness(.95) saturate(1.2)' },
  { id: 'vivid', name: 'Vivid', css: 'saturate(1.6) contrast(1.15) brightness(1.02)' },
];

export function getFilterCss(filterId: string): string {
  return FILTERS.find((f) => f.id === filterId)?.css ?? 'none';
}

export function applyFilterToCanvas(ctx: CanvasRenderingContext2D, filterId: string, width: number, height: number): void {
  const css = getFilterCss(filterId);
  if (css === 'none') return;
  ctx.filter = css;
  ctx.drawImage(ctx.canvas, 0, 0, width, height);
  ctx.filter = 'none';
}

export function isGlowFilter(filterId: string): boolean {
  return filterId === 'glow';
}

export function applyGlowToCanvas(ctx: CanvasRenderingContext2D, source: CanvasImageSource, dx: number, dy: number, dw: number, dh: number): void {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.35;
  ctx.filter = 'blur(6px) brightness(1.3)';
  ctx.drawImage(source, dx, dy, dw, dh);
  ctx.filter = 'none';
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.restore();
}

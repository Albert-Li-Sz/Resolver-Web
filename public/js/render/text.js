/**
 * Text + font helpers for the Resolver renderer.
 *
 * The original presentation uses the "Helvetica Plain" TTF with Java's
 * synthetic bold (the font has a single face). We load the same TTF through
 * the FontFace API and ask the browser for bold, which synthesises the weight.
 * All font sizes below are Java pixel sizes at 72 dpi (i.e. no x1.333 scaling).
 */

export const FONT_URL = '/assets/font/Helvetica-Plain.ttf';
// Helvetica Plain only ships Latin glyphs; the CJK fallbacks keep Chinese (and
// Japanese/Korean) team names from rendering as tofu on macOS/Windows/Linux.
const CJK_FALLBACK =
  '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", "Source Han Sans SC", "WenQuanYi Micro Hei", "Noto Sans SC"';
export const FONT_FAMILY = `"Helvetica Plain", ${CJK_FALLBACK}, Arial, Helvetica, sans-serif`;
// Team names keep the existing Arial look for Latin text and fall back for CJK.
export const NAME_FONT_FAMILY = `Arial, ${CJK_FALLBACK}, Helvetica, sans-serif`;

let loadPromise = null;
let loaded = false;

/**
 * Load the Helvetica TTF. Safe to call many times; returns the shared promise.
 * Resolves true when the face is usable (or after falling back to Arial).
 */
export function initFonts() {
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    try {
      if (typeof FontFace !== 'undefined' && typeof document !== 'undefined' && document.fonts) {
        const face = new FontFace('Helvetica Plain', `url(${FONT_URL})`, { style: 'normal', weight: '400' });
        await face.load();
        if (!document.fonts.has(face)) document.fonts.add(face);
      }
    } catch (err) {
      // Fall through to the CSS fallback list (Arial/Helvetica).
      console.warn('Resolver: could not load Helvetica Plain, using fallback font', err);
    }
    try {
      if (document.fonts) {
        await document.fonts.load(`700 40px "Helvetica Plain"`);
        await document.fonts.ready;
      }
    } catch (err) {
      /* ignore */
    }
    loaded = true;
    return loaded;
  })();
  return loadPromise;
}

export function fontsReady() {
  return loaded;
}

export function fontSpec(size, { bold = false, italic = false, family = FONT_FAMILY } = {}) {
  const style = italic ? 'italic ' : '';
  const weight = bold ? '700 ' : '400 ';
  return `${style}${weight}${size}px ${family}`;
}

export function setFont(ctx, size, opts) {
  ctx.font = fontSpec(size, opts);
  return ctx.font;
}

/** Advance width in px, matching ctx.measureText().width. */
export function textWidth(ctx, text, size, opts) {
  setFont(ctx, size, opts);
  return ctx.measureText(String(text)).width;
}

/**
 * Draw a single line of text.
 * Options:
 *   size, bold, italic, color, align ('left'|'center'|'right'),
 *   baseline (canvas baseline name, default 'alphabetic'),
 *   maxWidth (scale horizontally like Java TextHelper.drawFit),
 *   alpha, shadow (draw a 1px shadow? unused), embolden (extra px offset pass)
 */
export function drawText(ctx, text, x, y, opts = {}) {
  if (text === null || text === undefined) return 0;
  const s = String(text);
  if (!s) return 0;

  const size = opts.size ?? 40;
  const bold = opts.bold ?? false;
  const italic = opts.italic ?? false;
  const align = opts.align ?? 'left';
  const baseline = opts.baseline ?? 'alphabetic';
  const maxWidth = opts.maxWidth ?? null;
  const color = opts.color ?? '#ffffff';
  const alpha = opts.alpha ?? 1;
  const embolden = opts.embolden ?? 0;

  setFont(ctx, size, { bold, italic, family: opts.family });
  const width = ctx.measureText(s).width;
  const oldAlign = ctx.textAlign;
  const oldBaseline = ctx.textBaseline;
  ctx.textAlign = align;
  ctx.textBaseline = baseline;

  ctx.save();
  if (alpha !== 1) ctx.globalAlpha *= alpha;
  ctx.fillStyle = color;

  if (maxWidth !== null && maxWidth > 0 && width > maxWidth) {
    // Java TextHelper.drawFit(): translate to x, scale horizontally, draw at 0.
    const scale = maxWidth / width;
    ctx.translate(x, 0);
    ctx.scale(scale, 1);
    ctx.fillText(s, 0, y);
    if (embolden > 0) ctx.fillText(s, embolden, y);
  } else {
    ctx.fillText(s, x, y);
    if (embolden > 0) ctx.fillText(s, x + embolden, y);
  }

  ctx.restore();
  ctx.textAlign = oldAlign;
  ctx.textBaseline = oldBaseline;
  return width;
}

/**
 * Java TextHelper.drawString(g, s, x, y, width): baseline at (y - ascent).
 * Our callers mostly pass baselines directly, but this helper mirrors the
 * original when a top-anchored y is more natural.
 */
export function drawTextFit(ctx, text, x, topY, maxWidth, opts = {}) {
  return drawText(ctx, text, x, topY, { ...opts, maxWidth });
}

/** Fit a text (single line) by shortening or scaling; see drawText maxWidth. */
export function drawTextFitWidth(ctx, text, x, baseline, maxWidth, opts = {}) {
  return drawText(ctx, text, x, baseline, { ...opts, maxWidth });
}

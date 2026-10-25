import { formatSeconds } from '../standings.js';
/**
 * Colors, rounded rectangles and problem "cubes" for the Resolver renderer.
 *
 * Derived from ICPC Tools:
 *   - ICPCColors.java
 *   - ShadedRectangle.java
 *
 * Java's non-recent cube colours are IСPCColors.{SOLVED,PENDING,FAILED,
 * FIRST_TO_SOLVE}[CCOUNT/3]; those colours are partly transparent, so the cube
 * blends with the row background exactly like the Java version. We reproduce
 * the same rgba() values (alpha 210/255 after Java's rounding) so the pixels
 * match the reference screenshot, where a solved cube is rgb(11,167,11) over a
 * #3c3c3c row and rgb(0,156,0) over black.
 */

import { drawText } from './text.js';

export const ICPCColors = {
  BLUE: '#5c8add',
  YELLOW: '#ffdf36',
  RED: '#c43a24',
  PENDING_COLOR: '#1E90FF',
  SOLVED_COLOR: '#00e600',
  FIRST_TO_SOLVE_COLOR: '#006400',
  FAILED_COLOR: '#f00000',
  GOLD2: 'rgba(205,127,50,0.376)',
  SILVER2: 'rgba(230,232,250,0.376)',
  BRONZE2: 'rgba(166,125,61,0.376)',
  GOLD: '#cd7f32',
  SILVER: '#e6e8fa',
  BRONZE: '#a67d3d',
  SELECTION_COLOR: 'rgba(92,138,231,0.941176)',
  COLOR_TEAM_LIST: 'rgb(40,192,192)',
  // Rounded cube fills (ICPCColors.X[CCOUNT/3], alpha 210/255).
  CUBE_SOLVED: 'rgba(0,189,0,0.827451)',
  CUBE_PENDING: 'rgba(30,144,255,0.827451)',
  CUBE_FAILED: 'rgba(197,0,0,0.827451)',
  CUBE_FIRST_TO_SOLVE: 'rgba(0,82,0,0.827451)',
  CUBE_EMPTY: '#282828',
  CUBE_EMPTY_TEXT: 'rgba(196,196,196,0.686275)',
  BACKGROUND: '#000000',
  ROW_BACKGROUND: '#3c3c3c',
  // The selected pending submission blinks with a yellow halo behind the
  // (now blue) pending cube. Yellow is intentionally kept: it is the Java
  // origin's blink colour and reads clearly against the #1E90FF fill.
  PENDING_SUBMISSION_BLINK: '#ffff00',
  // Splash "ICPC Resolver" pill: branding yellow, not a pending-status colour,
  // so it deliberately keeps the pre-change yellow fill.
  SPLASH_PILL: 'rgba(189,189,0,0.827451)',
  OUTLINE: '#ffffff',
};

export const CUBE_ARC = 7;

/** Rounded-rect path with Java's exact ARC quadratics. */
export function roundedRectPath(ctx, x, y, w, h, arc = CUBE_ARC) {
  const r = Math.min(arc, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

export function fillRoundedRect(ctx, x, y, w, h, arc, fillStyle) {
  roundedRectPath(ctx, x, y, w, h, arc);
  ctx.fillStyle = fillStyle;
  ctx.fill();
}

export function strokeRoundedRect(ctx, x, y, w, h, arc, strokeStyle, lineWidth = 2) {
  roundedRectPath(ctx, x, y, w, h, arc);
  ctx.strokeStyle = strokeStyle;
  ctx.lineWidth = lineWidth;
  ctx.stroke();
}

/**
 * Blink for the currently selected pending submission.
 * Java: t = (count * 1.75 / 1000) - floor(...); if (t < 0.6) fill yellow
 * round rect at (cubeX-3, cubeY-3, cubeWidth+6, cubeHeight+6, arc 14).
 */
export function drawSubmissionBlink(ctx, cubeX, cubeY, cubeWidth, cubeHeight, nowMs) {
  const cycle = (nowMs * 1.75) / 1000;
  const t = cycle - Math.floor(cycle);
  if (t >= 0.6) return false;
  fillRoundedRect(
    ctx,
    cubeX - 3,
    cubeY - 3,
    cubeWidth + 6,
    cubeHeight + 6,
    14,
    ICPCColors.PENDING_SUBMISSION_BLINK,
  );
  return true;
}

const DASH = ' - ';

export function formatCubeText(cell) {
  const attempts = Number(cell?.attempts) || 0;
  if (!attempts) return '';
  let s = String(attempts);
  const time = Number(cell?.time);
  if (cell?.timeSeconds != null) s += DASH + formatSeconds(cell.timeSeconds);
  else if (Number.isFinite(time) && time > 0) s += DASH + Math.round(time);
  return s;
}

/**
 * Draw one problem cube.
 * @param {CanvasRenderingContext2D} ctx
 * @param {{x:number,y:number,width:number,height:number,cell:object,label:string,nowMs:number,
 *          statusFont:number,problemFont:number}} opts
 */
export function drawProblemCube(ctx, opts) {
  const { x, y, width: w, height: h, cell, label, statusFont, problemFont } = opts;
  const status = cell?.status ?? 'unattempted';

  if (status === 'unattempted') {
    fillRoundedRect(ctx, x, y, w, h, CUBE_ARC, ICPCColors.CUBE_EMPTY);
    if (label) {
      drawText(ctx, label, x + w / 2, y + h * 21 / 29, {
        size: problemFont,
        bold: false,
        color: ICPCColors.CUBE_EMPTY_TEXT,
        align: 'center',
      });
    }
    return;
  }

  let fill = ICPCColors.CUBE_SOLVED;
  if (status === 'pending') fill = ICPCColors.CUBE_PENDING;
  else if (status === 'failed') fill = ICPCColors.CUBE_FAILED;

  const fts = status === 'solved' && Boolean(cell?.firstToSolve);
  if (fts) fill = ICPCColors.CUBE_FIRST_TO_SOLVE;

  if (fts) {
    // Java ShadedRectangle: translate(1,1); w-=2; h-=2; fill + 2px outline.
    fillRoundedRect(ctx, x + 1, y + 1, w - 2, h - 2, CUBE_ARC, fill);
    strokeRoundedRect(ctx, x + 1, y + 1, w - 2, h - 2, CUBE_ARC, ICPCColors.SOLVED_COLOR, 2);
  } else {
    fillRoundedRect(ctx, x, y, w, h, CUBE_ARC, fill);
  }

  const s = formatCubeText(cell);
  if (s) {
    drawText(ctx, s, x + w / 2, y + h * 21 / 29, {
      maxWidth: w - 8,
      size: statusFont,
      bold: true,
      color: '#ffffff',
      align: 'center',
    });
  }
}

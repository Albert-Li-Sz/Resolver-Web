import { scoreStandings, formatSeconds } from '../standings.js';
import { DEFAULT_SCHOOL_LOGO, teamLogoUrl } from '../logos.js';
/**
 * Canvas renderer for the ICPC Tools Resolver, ported from
 * reference/icpctools/PresContest scoreboard presentations.
 *
 * Default resolution is 1920x1080. Device-local LED calibration can widen
 * the layout while keeping square pixels and the same row heights.
 *
 * Public API (see docs/CONTRACT.md):
 *   const view = new ResolverView(canvas, game);
 *   view.applyStep(step, { instant });
 *   view.update(dtMs);
 *   view.render(nowMs);
 *   view.resize();
 *   view.reset(gameState);
 */

import { Animator, Movement } from './animator.js';
import { initFonts, fontsReady, textWidth, drawText, setFont, NAME_FONT_FAMILY } from './text.js';
import {
  ICPCColors,
  drawProblemCube,
  drawSubmissionBlink,
  fillRoundedRect,
  formatCubeText,
} from './shaded-rect.js';

export const WIDTH = 1920;
export const HEIGHT = 1080;

const HEADER_HEIGHT = 40; // 1px white separator lives at y=39
const BORDER = 8;

// Movement values from AbstractScoreboardPresentation / scrolling subclass.
const TEAM_MOVEMENT = new Movement(4, 7);
const SCROLL_MOVEMENT = new Movement(4, 6);
const FOCUS_MOVEMENT = new Movement(3, 8);

// Reference layout at 12 rows (measured from resolverScreenShot2.png).
const REF_ROWS = 12;
const REF_ROW_HEIGHT = (HEIGHT - HEADER_HEIGHT) / REF_ROWS; // 86.6667
const ROW_FONT = 40.08;
const HEADER_FONT = 27.6;
const STATUS_FONT = 22.44;
const PROBLEM_FONT = 16.03;
const REF_CUBE_W = 120;
const REF_CUBE_H = 29;
const REF_CUBE_GAP = 6;
const REF_CUBE_TOP = 53;
const REF_INDENT = 181;
const REF_LOGO_X = 101;
const ROW_BASELINE = 35;
const HEADER_BASELINE = HEADER_HEIGHT - 3; // 37
const RANK_CENTER = 46;
const SOLVED_CENTER = 1776;
const TIME_CENTER = 1860;
const HEADER_RANK_CENTER = 46;
const HEADER_SOLVED_CENTER = 1773;
const HEADER_TIME_CENTER = 1862;
const ROW_FONT_CORRECTION = 40.08 / (REF_ROW_HEIGHT * 36 * 0.95 * 1.25 / 96); // Java vs screenshot scale
const FADE_MS = 350;
const TEAM_LIST_SPACING = 1.2;
const TEAM_LIST_ROWS = 15;

const SPLASH_TEXT = {
  title: 'ICPC Resolver',
  conceptBy: 'Concept by',
  conceptAttr1: 'Fredrik Niemel\u00e4',
  conceptAttr2: 'Mattias de Zalenski',
  conceptOrg: 'KTH Royal Institute of Technology',
  implBy: 'Implementation by',
  implAttr: 'Tim deBoer',
  implOrg: 'Red Hat',
  pending: '{0} pending submissions',
};

const SCREENS = new Set(['splash', 'scoreboard', 'teamAward', 'teamList']);

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

function cloneCell(cell) {
  return {
    status: cell?.status ?? 'unattempted',
    attempts: Number(cell?.attempts) || 0,
    penaltyCount: cell?.penaltyCount ?? Math.max(0, (Number(cell?.attempts) || 0) - 1),
    time: cell?.time != null && Number.isFinite(Number(cell.time)) ? Number(cell.time) : null,
    ...(cell?.timeSeconds !== undefined ? { timeSeconds: cell.timeSeconds } : {}),
    pending: Number(cell?.pending) || 0,
    firstToSolve: Boolean(cell?.firstToSolve),
  };
}

function cloneResults(results) {
  const out = Object.create(null);
  if (!results) return out;
  for (const [teamId, cells] of Object.entries(results)) {
    out[teamId] = Array.isArray(cells) ? cells.map(cloneCell) : [];
  }
  return out;
}

function teamDisplayName(team) {
  return team?.displayName || team?.name || team?.id || '';
}

function splitText(ctx, text, size, bold, maxWidth) {
  if (!text) return [];
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  const fits = (value) => textWidth(ctx, value, size, { bold }) <= maxWidth;
  let line = '';
  const flush = () => {
    if (line) {
      lines.push(line);
      line = '';
    }
  };

  for (const word of words) {
    if (!fits(word)) {
      // An unbroken word wider than the box (CJK names, URLs, handles) is
      // wrapped at character boundaries instead of being squashed by drawFit.
      flush();
      let chunk = '';
      for (const ch of word) {
        if (chunk && !fits(chunk + ch)) {
          lines.push(chunk);
          chunk = ch;
        } else {
          chunk += ch;
        }
      }
      line = chunk;
      continue;
    }
    const next = line ? `${line} ${word}` : word;
    if (!fits(next)) {
      flush();
      line = word;
    } else {
      line = next;
    }
  }
  flush();
  return lines;
}

function fitInside(img, maxW, maxH) {
  const iw = img?.naturalWidth || img?.width || 0;
  const ih = img?.naturalHeight || img?.height || 0;
  if (!iw || !ih) return { w: 0, h: 0 };
  const scale = Math.min(maxW / iw, maxH / ih);
  return { w: iw * scale, h: ih * scale };
}

function drawImageContain(ctx, img, x, y, maxW, maxH) {
  const { w, h } = fitInside(img, maxW, maxH);
  if (!w || !h) return { x, y, w: 0, h: 0 };
  const dx = x + (maxW - w) / 2;
  const dy = y + (maxH - h) / 2;
  ctx.drawImage(img, dx, dy, w, h);
  return { x: dx, y: dy, w, h };
}

export class ResolverView {
  constructor(canvas, game) {
    this.canvas = canvas;
    this.game = game || null;
    this.contest = game?.contest || {};
    this.problems = Array.isArray(this.contest.problems) ? this.contest.problems : [];
    this.teams = Array.isArray(this.contest.teams) ? this.contest.teams : [];
    this.organizations = Array.isArray(this.contest.organizations) ? this.contest.organizations : [];
    this.teamsById = new Map(this.teams.map((t) => [t.id, t]));
    this.orgsById = new Map(this.organizations.map((o) => [o.id, o]));
    this.options = {
      rowsPerScreen: 12,
      speedFactor: 1,
      rowOffset: 0,
      showLegend: false,
      showAwards: false,
      ...(game?.options || {}),
    };
    this.width = WIDTH;
    this.height = HEIGHT;
    this.canvas.width = this.width;
    this.canvas.height = this.height;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this._images = new Map();
    this._fontReady = initFonts();
    this._timeMs = 0;
    this._animationSpeed = 1;
    this._rowScrollRate = 1;
    this.nowMs = 0;

    this._screen = null;
    this._previousScreen = null;
    this._screenChangedAt = null;
    this._selectedTeamIds = [];
    this._selectType = 'NORMAL';
    this._selectedSubmission = null;
    this._focusOnTeamId = null;
    this._message = null;
    this._lastAward = null;
    this._teamListAward = null;
    this._awardTeamId = null;
    this._teamListState = null;

    this._teamY = new Map();
    this._rowScroll = new Animator(0, SCROLL_MOVEMENT);
    this._focusScroll = new Animator(0, FOCUS_MOVEMENT);
    this._teamListScroll = new Animator(0, new Movement(0.5, 0.75));
    this._scrollRow = 0;
    this._checkpoints = new Map();

    this._computeLayout();
    this.resize();
    this._preloadImages();
    this._applyInitialState();
    this._setScreen(this.options.startScreen === 'scoreboard' ? 'scoreboard' : 'splash', true);

    this._onWindowResize = () => this.resize();
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', this._onWindowResize, { passive: true });
      window.addEventListener('resolver-display', this._onWindowResize);
    }
  }

  /** Resolves when the Helvetica TTF (or fallback) is ready. */
  ready() {
    return this._fontReady;
  }

  dispose() {
    if (typeof window !== 'undefined') {
      window.removeEventListener('resize', this._onWindowResize);
      window.removeEventListener('resolver-display', this._onWindowResize);
    }
    for (const { img } of this._images.values()) img.onload = img.onerror = null;
    this._images.clear();
    this._checkpoints.clear();
  }

  // ---------------------------------------------------------------- layout

  _computeLayout() {
    const rows = clamp(Math.round(Number(this.options.rowsPerScreen) || 12), 4, 30);
    const title = this.options.title ? String(this.options.title).trim() : '';
    const titleHeight = title ? 38 : 0;
    const contentTop = HEADER_HEIGHT + titleHeight;
    const rowHeight = (this.height - contentTop) / rows;
    const scale = rowHeight / REF_ROW_HEIGHT;
    const problemCount = Math.max(1, this.problems.length || 13);

    const rowFont = (rowHeight * 36 * 0.95 * 1.25 / 96) * ROW_FONT_CORRECTION;
    const cubeGap = Math.max(2, Math.round(REF_CUBE_GAP * scale));
    const indent = Math.round(REF_INDENT * scale);
    const rightMargin = Math.round(107 * scale);
    const maxCubeW = Math.floor(
      (this.width - indent - rightMargin - cubeGap * (problemCount - 1)) / problemCount,
    );
    const cubeW = Math.max(26, Math.min(Math.round(REF_CUBE_W * scale), maxCubeW));
    const solvedCenter = this.width - Math.round((WIDTH - SOLVED_CENTER) * scale);
    // Leave room for the solved count (and a small gap) so long team names
    // cannot run into the right-hand columns.
    const solvedWidth = Math.round(textWidth(this.ctx, '99', rowFont, { bold: true }));
    const nameMaxWidth = Math.max(100, solvedCenter - indent - solvedWidth - 12);

    this.layout = {
      rows,
      rowHeight,
      scale,
      rowFont,
      headerFont: HEADER_FONT,
      title: title || null,
      titleHeight,
      contentTop,
      headerTop: titleHeight,
      statusFont: rowFont * 0.56,
      problemFont: rowFont * 0.4,
      indent,
      nameX: indent,
      cubeX: indent,
      cubeW,
      cubeGap,
      cubeTop: Math.round(REF_CUBE_TOP * scale),
      cubeH: Math.max(8, Math.round(REF_CUBE_H * scale)),
      logoSize: Math.max(10, rowHeight - 10),
      logoX: Math.round(REF_LOGO_X * scale),
      rowBaseline: Math.round(ROW_BASELINE * scale),
      nameFont: rowFont * 1.048,
      nameBaseline: Math.round(36 * scale),
      rankCenter: Math.round(RANK_CENTER * scale),
      solvedCenter,
      timeCenter: this.width - Math.round((WIDTH - TIME_CENTER) * scale),
      headerRankCenter: HEADER_RANK_CENTER,
      headerSolvedCenter: this.width - (WIDTH - HEADER_SOLVED_CENTER),
      headerTimeCenter: this.width - (WIDTH - HEADER_TIME_CENTER),
      nameMaxWidth,
    };
  }

  resize() {
    this.width = clamp(Number(this.canvas.dataset?.logicalWidth) || WIDTH, 1440, 5760);
    if (this.canvas.width !== this.width || this.canvas.height !== this.height) {
      this.canvas.width = this.width;
      this.canvas.height = this.height;
    }
    // Optional letterboxed fit if the host asks for it: data-fit="container".
    if (this.canvas.dataset && this.canvas.dataset.fit === 'container') {
      const parent = this.canvas.parentElement;
      const rect = parent ? parent.getBoundingClientRect() : { width: window.innerWidth, height: window.innerHeight };
      const scale = Math.min((rect.width || 0) / this.width, (rect.height || 0) / this.height);
      if (scale > 0) {
        this.canvas.style.width = `${Math.floor(this.width * scale)}px`;
        this.canvas.style.height = `${Math.floor(this.height * scale)}px`;
      }
    }
    this._computeLayout();
  }

  // ---------------------------------------------------------------- images

  _preloadImages() {
    const urls = [DEFAULT_SCHOOL_LOGO, '/assets/img/id.png', '/assets/img/tools-logo.png', this.contest.logo];
    for (const org of this.organizations) urls.push(org.logo);
    for (const team of this.teams) {
      // Photos are only needed on that team's award page. Loading the entire
      // photo collection here can dominate startup memory and network traffic.
      urls.push(team.logo);
    }
    for (const url of urls) this._image(url);
  }

  _image(src) {
    if (!src) return null;
    let rec = this._images.get(src);
    if (!rec) {
      const img = new Image();
      rec = { img, ready: false, failed: false };
      img.onload = () => {
        rec.ready = true;
      };
      img.onerror = () => {
        rec.failed = true;
      };
      img.src = src;
      this._images.set(src, rec);
    }
    return rec.ready ? rec.img : null;
  }

  _imageRecord(src) {
    if (!src) return null;
    let rec = this._images.get(src);
    if (!rec) {
      const img = new Image();
      rec = { img, ready: false, failed: false };
      img.onload = () => {
        rec.ready = true;
      };
      img.onerror = () => {
        rec.failed = true;
      };
      img.src = src;
      this._images.set(src, rec);
    }
    return rec;
  }

  _teamLogo(team) {
    const org = this.orgsById.get(team?.organizationId);
    return this._image(teamLogoUrl(team, org)) || this._image(org?.logo) ||
      this._image(team?.logo) || this._image(DEFAULT_SCHOOL_LOGO);
  }

  _orgLogo(team) {
    const org = this.orgsById.get(team?.organizationId);
    return this._image(org?.logo !== DEFAULT_SCHOOL_LOGO ? org?.logo : null) ||
      this._image(team?.logo) || this._image(DEFAULT_SCHOOL_LOGO);
  }

  _contestLogo() {
    return this._image(this.contest.logo) || this._image('/assets/img/id.png');
  }

  _toolsLogo() {
    return this._image('/assets/img/tools-logo.png');
  }

  // ------------------------------------------------------------- game state

  _applyInitialState() {
    const state = this.game?.initialState || {};
    this._results = cloneResults(state.results);
    let order = Array.isArray(state.order) ? state.order.slice() : this.teams.map((t) => t.id);
    // Keep any teams missing from the supplied order, at the end.
    if (order.length < this.teams.length) {
      const seen = new Set(order);
      for (const team of this.teams) if (!seen.has(team.id)) order.push(team.id);
    }
    this._order = order;
    this._teamY = new Map();
    this._order.forEach((teamId, i) => this._teamY.set(teamId, new Animator(i, TEAM_MOVEMENT)));
    for (const team of this.teams) {
      if (!this._teamY.has(team.id)) this._teamY.set(team.id, new Animator(this._order.length, TEAM_MOVEMENT));
    }
    this._rowScroll.reset(0);
    this._focusScroll.reset(0);
    this._scrollRow = 0;
    this._selectedTeamIds = [];
    this._selectType = 'NORMAL';
    this._selectedSubmission = null;
    this._focusOnTeamId = null;
    this._recomputeStandings();
  }

  /** Public reset: accepts a full game, or the game initialState. */
  reset(gameState) {
    this._animationSpeed = 1;
    this._rowScrollRate = 1;
    const state = gameState?.initialState ?? gameState;
    if (state && state.results && state.order) {
      this._applyInitialStateFrom(state);
      this._recomputeStandings();
    } else if (gameState === undefined) {
      this._applyInitialState();
    }
    this._selectedTeamIds = [];
    this._selectType = 'NORMAL';
    this._selectedSubmission = null;
    this._message = null;
    this._lastAward = null;
    this._teamListAward = null;
    this._awardTeamId = null;
    this._teamListState = null;
    this._rowScroll.reset(0);
    this._focusScroll.reset(0);
    this._scrollRow = 0;
    this._setScreen(this.options.startScreen === 'scoreboard' ? 'scoreboard' : 'splash', true);
  }

  _applyInitialStateFrom(state) {
    this._results = cloneResults(state.results);
    const order = Array.isArray(state.order) ? state.order.slice() : this._order.slice();
    if (order.length < this.teams.length) {
      const seen = new Set(order);
      for (const team of this.teams) if (!seen.has(team.id)) order.push(team.id);
    }
    this._order = order;
    this._teamY = new Map();
    this._order.forEach((teamId, i) => this._teamY.set(teamId, new Animator(i, TEAM_MOVEMENT)));
    for (const team of this.teams) {
      if (!this._teamY.has(team.id)) this._teamY.set(team.id, new Animator(this._order.length, TEAM_MOVEMENT));
    }
  }

  _emptyCells() {
    return this.problems.map(() => cloneCell(null));
  }

  _cell(teamId, index) {
    const cells = this._results[teamId];
    if (!cells) return cloneCell(null);
    if (!cells[index]) cells[index] = cloneCell(null);
    return cells[index];
  }

  _recomputeStandings() {
    this._standings = new Map(scoreStandings(this.contest, this._results).map((row) => [row.teamId, row]));
    this._standingsDirty = false;
  }

  _recomputeOrder() {
    const rows = scoreStandings(this.contest, this._results);
    this._order = rows.map((row) => row.teamId);
    this._standings = new Map(rows.map((row) => [row.teamId, row]));
  }

  _syncTeamAnimators(instant) {
    const seen = new Set();
    this._order.forEach((teamId, index) => {
      seen.add(teamId);
      let anim = this._teamY.get(teamId);
      if (!anim) {
        anim = new Animator(instant ? index : index, TEAM_MOVEMENT);
        this._teamY.set(teamId, anim);
      }
      if (instant) anim.reset(index);
      else anim.setTarget(index);
    });
    for (const team of this.teams) {
      if (seen.has(team.id)) continue;
      const anim = this._teamY.get(team.id) || new Animator(this._order.length, TEAM_MOVEMENT);
      if (instant) anim.reset(this._order.length);
      else anim.setTarget(this._order.length);
      this._teamY.set(team.id, anim);
    }
  }

  // ---------------------------------------------------------------- screens

  _setScreen(screen, instant = false) {
    if (!SCREENS.has(screen)) return;
    if (this._screen === screen) {
      if (screen === 'teamAward') this._awardTeamId = this._selectedTeamIds[0] || this._lastAward?.teamId || null;
      return;
    }
    this._previousScreen = this._screen;
    this._screen = screen;
    this._screenChangedAt = instant ? null : this.nowMs;
    if (screen === 'teamAward') {
      this._awardTeamId = this._selectedTeamIds[0] || this._lastAward?.teamId || null;
    } else if (screen === 'teamList') {
      this._teamListScroll.reset(0);
      this._teamListState = this._buildTeamListState();
    }
  }

  _buildTeamListState() {
    const contestAwards = Array.isArray(this.contest.awards) ? this.contest.awards : [];
    let award = this._teamListAward;
    if (!award) award = contestAwards.find((a) => Array.isArray(a.teamIds) && a.teamIds.length > 1);
    if (!award) award = contestAwards.find((a) => Array.isArray(a.teamIds) && a.teamIds.length > 0);
    if (!award) award = this._lastAward?.awards?.find((a) => Array.isArray(a.teamIds) && a.teamIds.length);
    const citation = award?.citation || 'ICPC Resolver';
    const teamIds =
      award && Array.isArray(award.teamIds) && award.teamIds.length
        ? award.teamIds.slice()
        : this._order.slice(0, Math.min(this._order.length, 12));
    const teams = teamIds
      .map((id) => this.teamsById.get(id))
      .filter(Boolean)
      .sort((a, b) => teamDisplayName(a).localeCompare(teamDisplayName(b), 'en'));
    const maxScroll = Math.max(0, teams.length - 11) * TEAM_LIST_SPACING;
    this._teamListScroll.setTarget(maxScroll);
    return { award, citation, teams };
  }

  _awardsForTeam(teamId) {
    const fromStep = this._lastAward?.teamId === teamId ? this._lastAward.awards : null;
    const contestAwards = Array.isArray(this.contest.awards) ? this.contest.awards : [];
    const source = Array.isArray(fromStep) && fromStep.length ? fromStep : contestAwards;
    const list = source.filter((a) => Array.isArray(a.teamIds) && a.teamIds.includes(teamId));
    return list;
  }

  // ------------------------------------------------------------- step apply

  applyStep(step, { instant = false } = {}) {
    if (!step || typeof step !== 'object') return;
    this._animationSpeed = step.speedMultiplier === 4 ? 4 : 1;
    switch (step.type) {
      case 'presentation':
        if (Array.isArray(step.awards)) this._setAward(step);
        this._setScreen(step.screen, instant);
        break;
      case 'selectTeam':
        this._selectedSubmission = null;
        this._selectedTeamIds = Array.isArray(step.teamIds) ? step.teamIds.slice() : [];
        this._selectType = step.selectType || 'NORMAL';
        break;
      case 'selectSubmission':
        this._selectedSubmission = {
          teamId: step.teamId,
          problemIndex: step.problemIndex,
        };
        break;
      case 'scroll':
        this._selectedSubmission = null;
        this._scrollTo(step.row, instant, step.durationMs);
        break;
      case 'resolve':
        this._selectedSubmission = null;
        this._applyResolve(step, instant);
        break;
      case 'award':
        this._setAward(step);
        break;
      case 'message':
        this._message = { text: String(step.text || ''), until: this.nowMs + 7000 };
        break;
      case 'pause':
      case 'delay':
      default:
        break;
    }
  }

  _scrollTo(row, instant = false, durationMs = null) {
    const value = Math.max(0, Number(row) || 0);
    this._scrollRow = value;
    this._focusOnTeamId = null;
    this._rowScrollRate = 1;
    if (instant) this._rowScroll.reset(value);
    else {
      this._rowScroll.setTarget(value);
      if (Number.isFinite(durationMs) && durationMs > 0) {
        this._rowScrollRate = Math.max(1, this._rowScroll.getMoveTime() * 1000 / durationMs);
      }
    }
  }

  _applyResolve(step, instant) {
    if (step.teamId === undefined || step.problemIndex === undefined) return;
    const teamId = step.teamId;
    const index = step.problemIndex;
    if (!this._results[teamId]) this._results[teamId] = this._emptyCells();
    const cells = this._results[teamId];
    const prev = cells[index] || cloneCell(null);
    cells[index] = {
      ...prev,
      status: step.status === 'failed' ? 'failed' : 'solved',
      attempts: Number.isFinite(Number(step.attempts)) ? Number(step.attempts) : prev.attempts,
      penaltyCount: step.penaltyCount ?? Math.max(0, (Number(step.attempts) || 0) - 1),
      time: Number.isFinite(Number(step.time)) ? Number(step.time) : prev.time,
      ...(step.timeSeconds !== undefined ? { timeSeconds: step.timeSeconds } : {}),
      firstToSolve: Boolean(step.firstToSolve),
      pending: 0,
    };
    if (step.move && Number.isInteger(step.move.from) && Number.isInteger(step.move.to)) {
      const from = this._order.indexOf(teamId);
      if (from !== step.move.to) {
        this._order.splice(from, 1);
        this._order.splice(step.move.to, 0, teamId);
      }
    } else if (Array.isArray(step.order) && step.order.length) {
      const order = step.order.slice();
      if (order.length < this.teams.length) {
        const seen = new Set(order);
        for (const team of this.teams) if (!seen.has(team.id)) order.push(team.id);
      }
      this._order = order;
    } else {
      this._recomputeOrder();
    }
    if (instant) this._standingsDirty = true;
    else { this._recomputeStandings(); this._syncTeamAnimators(false); }
  }

  finishReplay() {
    if (!this._standingsDirty) return;
    this._recomputeStandings();
    this._syncTeamAnimators(true);
  }

  captureState() {
    return { results: cloneResults(this._results), order: this._order.slice(),
      screen: this._screen, selectedTeamIds: this._selectedTeamIds.slice(), selectType: this._selectType,
      selectedSubmission: this._selectedSubmission && { ...this._selectedSubmission },
      lastAward: this._lastAward, awardTeamId: this._awardTeamId, teamListAward: this._teamListAward,
      scrollRow: this._scrollRow, animationSpeed: this._animationSpeed, message: this._message && { ...this._message } };
  }

  restoreState(state) {
    this.reset(state);
    this._selectedTeamIds = state.selectedTeamIds.slice();
    this._selectType = state.selectType;
    this._selectedSubmission = state.selectedSubmission && { ...state.selectedSubmission };
    this._lastAward = state.lastAward;
    this._awardTeamId = state.awardTeamId;
    this._teamListAward = state.teamListAward;
    this._scrollTo(state.scrollRow, true);
    this._setScreen(state.screen, true);
    this._selectedSubmission = state.selectedSubmission && { ...state.selectedSubmission };
    this._message = state.message && { ...state.message };
    this._animationSpeed = state.animationSpeed || 1;
  }

  /** Bounded checkpoints shorten subsequent seeks; replay only scores once. */
  seek(steps, target) {
    let start = -1;
    for (const index of this._checkpoints.keys()) if (index <= target && index > start) start = index;
    if (start >= 0) this.restoreState(this._checkpoints.get(start));
    else this.reset();
    const estimatedBytes = this.teams.length * (this.problems.length * 160 + 300);
    const capacity = Math.min(8, Math.floor(16 * 1024 * 1024 / Math.max(1, estimatedBytes)));
    for (let i = start + 1; i <= target && i < steps.length; i++) {
      this.applyStep(steps[i], { instant: true });
      if (capacity && (i + 1) % 256 === 0) {
        this._checkpoints.set(i, this.captureState());
        if (this._checkpoints.size > capacity) this._checkpoints.delete(this._checkpoints.keys().next().value);
      }
    }
    this.finishReplay();
  }

  _setAward(step) {
    const awards = Array.isArray(step.awards)
      ? step.awards.map((a) => ({ ...a, teamIds: Array.isArray(a?.teamIds) ? a.teamIds.slice() : [] }))
      : [];
    this._lastAward = { teamId: step.teamId || null, awards };
    if (step.teamId) this._awardTeamId = step.teamId;
    let listAward = awards.find((a) => a.teamIds.length > 1) || awards.find((a) => a.teamIds.length > 0) || null;
    if (!listAward && step.teamId) {
      const contestAwards = Array.isArray(this.contest.awards) ? this.contest.awards : [];
      listAward = contestAwards.find((a) => Array.isArray(a.teamIds) && a.teamIds.includes(step.teamId)) || null;
    }
    if (listAward) this._teamListAward = listAward;
    if (this._screen === 'teamList') {
      this._teamListScroll.reset(0);
      this._teamListState = this._buildTeamListState();
    }
  }

  _showMessage(text, durationMs) {
    this._message = { text, until: this.nowMs + (durationMs || 7000) };
  }

  // ------------------------------------------------------------------ time

  get animationSpeed() { return this._animationSpeed; }

  update(dtMs) {
    this.finishReplay();
    const dt = clamp(Number(dtMs) || 0, 0, 1000) * this._animationSpeed;
    this._timeMs += dt;
    for (const anim of this._teamY.values()) anim.incrementTimeMs(dt);
    this._rowScroll.incrementTimeMs(dt * this._rowScrollRate);
    if (this._focusOnTeamId) {
      const index = this._order.indexOf(this._focusOnTeamId);
      if (index >= 0) {
        const target = Math.max(0, index - (this.layout.rows - 2));
        this._focusScroll.setTarget(target);
        this._focusScroll.incrementTimeMs(dt);
      }
    }
    if (this._screen === 'teamList') this._teamListScroll.incrementTimeMs(dt);
  }

  _getScroll() {
    if (this._focusOnTeamId) return this._focusScroll.getValue() * this.layout.rowHeight;
    return this._rowScroll.getValue() * this.layout.rowHeight;
  }

  // ---------------------------------------------------------------- render

  render(nowMs) {
    this.finishReplay();
    if (Number.isFinite(nowMs)) this.nowMs = nowMs;
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, this.width, this.height);
    if (!this.game || !fontsReady()) return;

    const fade =
      this._screenChangedAt === null ? 1 : clamp((this.nowMs - this._screenChangedAt) / FADE_MS, 0, 1);
    if (fade <= 0) return;

    ctx.save();
    if (fade < 1) ctx.globalAlpha = fade;
    switch (this._screen) {
      case 'scoreboard':
        this._renderScoreboard(ctx);
        break;
      case 'teamAward':
        this._renderTeamAward(ctx);
        break;
      case 'teamList':
        this._renderTeamList(ctx);
        break;
      case 'splash':
      default:
        this._renderSplash(ctx);
        break;
    }
    ctx.restore();
    this._renderMessage(ctx);
  }

  // ------------------------------------------------------------- scoreboard

  _renderScoreboard(ctx) {
    const L = this.layout;
    if (L.title) {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, this.width, L.titleHeight);
      drawText(ctx, L.title, this.width / 2, L.titleHeight * 0.76, {
        size: Math.min(30, L.titleHeight * 0.72),
        bold: true,
        color: '#ffffff',
        align: 'center',
        maxWidth: this.width - 80,
      });
    }
    this._drawHeader(ctx, L.headerTop);

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, L.contentTop, this.width, this.height - L.contentTop);
    ctx.clip();

    const scroll = this._getScroll();

    // Row backgrounds: Java alternates by the original row index (i % 2),
    // and continues into one extra row (the stats row).
    for (let i = 0; i < this._order.length + 1; i += 1) {
      const y = L.contentTop + i * L.rowHeight - scroll;
      if (y + L.rowHeight <= L.contentTop || y >= this.height) continue;
      const bg = this._backgroundForRow(i);
      if (bg) {
        ctx.fillStyle = bg;
        ctx.fillRect(0, Math.trunc(y), this.width, Math.trunc(L.rowHeight));
      }
    }

    // Teams: draw back-to-front so earlier (higher ranked) rows paint on top,
    // exactly like AbstractScoreboardPresentation.paintImpl().
    for (let i = this._order.length - 1; i >= 0; i -= 1) {
      const teamId = this._order[i];
      const anim = this._teamY.get(teamId);
      if (!anim) continue;
      const y = L.contentTop + anim.getValue() * L.rowHeight - scroll;
      if (y + L.rowHeight <= L.contentTop || y >= this.height) continue;
      ctx.save();
      ctx.translate(0, Math.trunc(y));
      this._drawTeamRow(ctx, teamId, i);
      ctx.restore();
    }

    ctx.restore();
    if (this.options.showLegend) this._renderLegend(ctx);
  }

  _renderLegend(ctx) {
    const items = [
      ['Solved', ICPCColors.CUBE_SOLVED],
      ['Pending', ICPCColors.CUBE_PENDING],
      ['Failed', ICPCColors.CUBE_FAILED],
      ['First to solve', ICPCColors.CUBE_FIRST_TO_SOLVE],
    ];
    const width = 250;
    const height = 132;
    const x = this.width - width - 22;
    const y = this.height - height - 24;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.62)';
    fillRoundedRect(ctx, x, y, width, height, 10, 'rgba(0,0,0,0.62)');
    items.forEach(([label, color], index) => {
      const rowY = y + 16 + index * 26;
      fillRoundedRect(ctx, x + 16, rowY, 34, 16, 5, color);
      drawText(ctx, label, x + 60, rowY + 13, {
        size: 16,
        bold: false,
        color: '#d0d0d0',
      });
    });
    ctx.restore();
  }

  _backgroundForRow(row) {
    const awards = Array.isArray(this.contest.awards) ? this.contest.awards : [];
    if (this.options.showMedals && awards.length) {
      const counts = this._medalCounts();
      if (row < counts.gold) return ICPCColors.GOLD2;
      if (row < counts.gold + counts.silver) return ICPCColors.SILVER2;
      if (row < counts.gold + counts.silver + counts.bronze) return ICPCColors.BRONZE2;
    }
    return row % 2 === 0 ? ICPCColors.ROW_BACKGROUND : null;
  }

  _medalCounts() {
    const awards = Array.isArray(this.contest.awards) ? this.contest.awards : [];
    const counts = { gold: 0, silver: 0, bronze: 0 };
    for (const award of awards) {
      const type = String(award?.awardType || award?.id || '').toLowerCase();
      const citation = String(award?.citation || '').toLowerCase();
      const count = Array.isArray(award?.teamIds) ? award.teamIds.length : 0;
      if (!count) continue;
      if (type.includes('gold') || citation.includes('gold') || citation.includes('winner')) counts.gold += count;
      else if (type.includes('silver') || citation.includes('silver')) counts.silver += count;
      else if (type.includes('bronze') || citation.includes('bronze')) counts.bronze += count;
    }
    return counts;
  }

  _drawHeader(ctx, top = 0) {
    const L = this.layout;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, top, this.width, HEADER_HEIGHT + 2);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, top + HEADER_HEIGHT - 1, this.width, 1);
    drawText(ctx, 'Rank', L.headerRankCenter, top + HEADER_BASELINE, {
      size: L.headerFont,
      bold: true,
      align: 'center',
    });
    drawText(ctx, 'Name', L.nameX, top + HEADER_BASELINE, {
      size: L.headerFont,
      bold: true,
      align: 'left',
    });
    drawText(ctx, 'Solved', L.headerSolvedCenter, top + HEADER_BASELINE, {
      size: L.headerFont,
      bold: true,
      align: 'center',
    });
    drawText(ctx, 'Time', L.headerTimeCenter, top + HEADER_BASELINE, {
      size: L.headerFont,
      bold: true,
      align: 'center',
    });
  }

  _drawTeamRow(ctx, teamId, orderIndex) {
    const L = this.layout;
    const team = this.teamsById.get(teamId) || { id: teamId, name: teamId, displayName: teamId };
    const selected = this._selectedTeamIds.includes(teamId) || this._focusOnTeamId === teamId;

    if (selected) {
      let fill = ICPCColors.SELECTION_COLOR;
      if (this._selectType === 'FTS' || this._selectType === 'FTS_HIGHLIGHT') {
        fill = ICPCColors.FIRST_TO_SOLVE_COLOR;
      } else if (this._selectType === 'TEAM_LIST') {
        fill = ICPCColors.COLOR_TEAM_LIST;
      }
      ctx.fillStyle = fill;
      ctx.fillRect(0, 0, this.width, Math.round(L.rowHeight + 0.9));
      if (this._selectType === 'HIGHLIGHT' || this._selectType === 'FTS_HIGHLIGHT') {
        const bottom = Math.floor(L.rowHeight);
        ctx.fillStyle = '#fff';
        ctx.fillRect(-1, 0, this.width + 2, 1);
        ctx.fillRect(-1, bottom, this.width + 2, 1);
        ctx.fillRect(-1, 0, 1, bottom + 1);
        ctx.fillRect(this.width, 0, 1, bottom + 1);
      }
    }

    const standing = this._standings.get(teamId) || { rank: orderIndex + 1, solved: 0, time: 0 };

    // rank
    drawText(ctx, standing.unrank ? '*' : String(standing.rank), L.rankCenter, L.rowBaseline, {
      size: L.rowFont,
      bold: true,
      align: 'center',
    });

    // logo (fit inside the rowHeight-10 box, centered like getSmallTeamLogo)
    const logo = this._teamLogo(team);
    if (logo) {
      const { w, h } = fitInside(logo, L.logoSize, L.logoSize);
      if (w > 0 && h > 0) {
        const x = L.logoX + (L.logoSize - w) / 2;
        const y = (L.rowHeight - h) / 2;
        ctx.drawImage(logo, x, y, w, h);
      }
    }

    // name
    drawText(ctx, teamDisplayName(team), L.nameX, L.nameBaseline, {
      size: L.nameFont,
      bold: true,
      family: NAME_FONT_FAMILY,
      color: '#ffffff',
      maxWidth: L.nameMaxWidth,
    });

    // solved count + total time (computed from mutable cells)
    if (standing.solved > 0) {
      drawText(ctx, String(standing.solved), L.solvedCenter, L.rowBaseline, {
        size: L.rowFont,
        bold: true,
        align: 'center',
      });
    }
    if (standing.time > 0 || standing.timeSeconds > 0) {
      drawText(ctx, standing.timeSeconds !== undefined ? formatSeconds(standing.timeSeconds) : String(standing.time), L.timeCenter, L.rowBaseline, {
        maxWidth: Math.max(50, this.width - L.timeCenter - 10) * 2,
        size: L.rowFont,
        bold: true,
        align: 'center',
      });
    }

    // problem cubes
    for (let i = 0; i < this.problems.length; i += 1) {
      const x = L.cubeX + i * (L.cubeW + L.cubeGap);
      const y = L.cubeTop;
      if (
        this._selectedSubmission &&
        this._selectedSubmission.teamId === teamId &&
        this._selectedSubmission.problemIndex === i
      ) {
        drawSubmissionBlink(ctx, x, y, L.cubeW, L.cubeH, this.nowMs);
      }
      drawProblemCube(ctx, {
        x,
        y,
        width: L.cubeW,
        height: L.cubeH,
        cell: this._cell(teamId, i),
        label: this.problems[i]?.label || String.fromCharCode(65 + i),
        statusFont: L.statusFont,
        problemFont: L.problemFont,
      });
    }
  }

  // ------------------------------------------------------------------ splash

  _renderSplash(ctx) {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, this.width, this.height);

    const border = this.height / 20; // 54
    const inch = (this.height * 72) / 96 / 10; // 81
    const titleSize = inch * 1.25;
    const attrSize = inch * 0.3;
    const smallSize = inch * 0.225;
    const titleLineH = titleSize * 1.05;
    const attrLineH = attrSize * 1.2;
    const smallLineH = smallSize * 1.2;

    const contestName = this.contest.name || 'ICPC Resolver';
    const lines = splitText(ctx, contestName, titleSize, true, this.width - border * 2);
    let h = border;
    for (const line of lines) {
      drawText(ctx, line, this.width / 2, h + titleSize * 0.77, {
        size: titleSize,
        bold: true,
        align: 'center',
      });
      h += titleLineH;
    }

    const pendingCount =
      Number.isFinite(Number(this.game?.meta?.pendingCount))
        ? Number(this.game.meta.pendingCount)
        : this._countPending();
    const pendingText = SPLASH_TEXT.pending.replace('{0}', String(pendingCount));
    drawText(ctx, pendingText, this.width / 2, h + smallSize * 0.95, {
      size: smallSize,
      bold: true,
      align: 'center',
    });
    const tt = h + smallLineH;

    const gap = attrLineH / 3;
    const hAttr = this.height - border - attrLineH * 5.5 - gap * 2;

    // Contest logo / ICPC id.
    const img = this._contestLogo();
    if (img) {
      const top = tt + 10;
      const bottom = hAttr - attrSize - gap * 2;
      const boxH = Math.max(120, bottom - top);
      drawImageContain(ctx, img, (this.width - this.width * 0.8) / 2, top, this.width * 0.8, boxH);
    }

    // "ICPC Resolver" yellow pill.
    const title = SPLASH_TEXT.title;
    const titleW = textWidth(ctx, title, smallSize, { bold: true }) + gap * 2;
    fillRoundedRect(
      ctx,
      (this.width - titleW) / 2,
      hAttr - smallSize * 0.78 - gap,
      titleW,
      smallSize * 0.78 + gap * 2,
      7,
      ICPCColors.SPLASH_PILL,
    );
    drawText(ctx, title, this.width / 2, hAttr, {
      size: smallSize,
      bold: true,
      align: 'center',
    });
    h = hAttr + smallLineH * 2 + gap;

    const tools = this._toolsLogo();
    let tw = 0;
    if (tools) {
      const boxW = this.width * 0.11;
      const boxH = this.height * 0.11;
      const { w, h: ih } = fitInside(tools, boxW, boxH);
      tw = w / 2;
      ctx.drawImage(tools, (this.width - w) / 2, this.height - border - ih, w, ih);
    }
    const col1 = this.width / 2 - tw - border;
    const col2 = this.width / 2 + tw + border;

    const smallGap = smallLineH / 3;
    const conceptByW = textWidth(ctx, SPLASH_TEXT.conceptBy, smallSize, { bold: true }) + smallGap * 2;
    fillRoundedRect(
      ctx,
      col1 - smallGap - (conceptByW - smallGap * 2),
      h - smallSize * 0.8 - smallGap,
      conceptByW,
      smallSize * 1.05 + smallGap * 1.7,
      7,
      ICPCColors.CUBE_SOLVED,
    );
    drawText(ctx, SPLASH_TEXT.conceptBy, col1, h, {
      size: smallSize,
      bold: true,
      align: 'right',
    });

    const implByW = textWidth(ctx, SPLASH_TEXT.implBy, smallSize, { bold: true }) + smallGap * 2;
    fillRoundedRect(
      ctx,
      col2 - smallGap,
      h - smallSize * 0.8 - smallGap,
      implByW,
      smallSize * 1.05 + smallGap * 1.7,
      7,
      ICPCColors.CUBE_SOLVED,
    );
    drawText(ctx, SPLASH_TEXT.implBy, col2, h, {
      size: smallSize,
      bold: true,
      align: 'left',
    });

    h += attrLineH * 1.5 + smallGap;
    drawText(ctx, SPLASH_TEXT.conceptAttr1, col1, h, {
      size: attrSize,
      bold: false,
      align: 'right',
    });
    drawText(ctx, SPLASH_TEXT.implAttr, col2, h, {
      size: attrSize,
      bold: false,
      align: 'left',
    });
    h += attrLineH;
    drawText(ctx, SPLASH_TEXT.conceptAttr2, col1, h, {
      size: attrSize,
      bold: false,
      align: 'right',
    });
    drawText(ctx, SPLASH_TEXT.implOrg, col2, h, {
      size: smallSize,
      bold: true,
      align: 'left',
    });
    h += attrLineH;
    drawText(ctx, SPLASH_TEXT.conceptOrg, col1, h, {
      size: smallSize,
      bold: true,
      align: 'right',
    });

    drawText(ctx, 'ICPC Tools 2.5', this.width - border, this.height - border, {
      size: smallSize,
      bold: true,
      color: '#555555',
      align: 'right',
    });
  }

  _countPending() {
    let count = 0;
    for (const cells of Object.values(this._results || {})) {
      for (const cell of cells) {
        if (cell?.status === 'pending') count += 1;
      }
    }
    return count;
  }

  // -------------------------------------------------------------- team award

  _renderTeamAward(ctx) {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, this.width, this.height);

    const teamId = this._awardTeamId || this._selectedTeamIds[0] || this._order[0];
    if (!teamId) return;
    const team = this.teamsById.get(teamId);
    if (!team) return;

    // Java falls back to the contest logo when the team has no photo.
    const photo = this._image(team.photo) || this._contestLogo();
    if (photo) {
      drawImageContain(ctx, photo, 0, 0, this.width, this.height * 0.7);
    }

    const awards = this._awardsForTeam(teamId);
    const inch = (this.height * 72) / 96 / 10;
    const teamFont = inch * 0.9;
    const groupFont = inch * 0.7;
    const logoSize = this.height / 5;
    const orgLogo = this._orgLogo(team);
    const x = BORDER + 20 + (orgLogo ? logoSize + 20 : 0);
    const maxWidth = this.width - x - 40;

    const nameLines = splitText(ctx, teamDisplayName(team), teamFont, true, maxWidth);
    const citationLines = [];
    for (const award of awards) {
      const major = ['winner', 'rank', 'medal'].some((t) =>
        String(award.awardType || '').toLowerCase().includes(t),
      );
      const size = major ? teamFont : groupFont;
      const color = major ? '#ffffff' : '#d0d0d0';
      const lines = splitText(ctx, award.citation || '', size, true, maxWidth);
      for (const line of lines) citationLines.push({ text: line, size, color });
    }
    if (!citationLines.length && this._lastAward?.awards?.length) {
      for (const award of this._lastAward.awards) {
        if (!Array.isArray(award.teamIds) || !award.teamIds.includes(teamId)) continue;
        const lines = splitText(ctx, award.citation || '', teamFont, true, maxWidth);
        for (const line of lines) citationLines.push({ text: line, size: teamFont, color: '#ffffff' });
      }
    }

    const nameLineH = teamFont * 1.06;
    let panelH = 24 * 2 + nameLines.length * nameLineH;
    for (const c of citationLines) panelH += c.size * 1.06;
    panelH = Math.max(panelH, logoSize + 24);
    panelH = Math.min(panelH, this.height - 40);
    const panelTop = this.height - panelH - 112;

    ctx.fillStyle = 'rgba(0,0,0,0.77)';
    ctx.fillRect(0, panelTop, this.width, this.height - panelTop);
    if (orgLogo) {
      const { w, h: ih } = fitInside(orgLogo, logoSize, logoSize);
      ctx.drawImage(orgLogo, BORDER + 20 + (logoSize - w) / 2, panelTop + 18 + (logoSize - ih) / 2, w, ih);
    }

    let y = panelTop + 24 + teamFont * 0.82;
    for (const line of nameLines) {
      drawText(ctx, line, x, y, { size: teamFont, bold: true, color: '#ffffff', maxWidth });
      y += nameLineH;
    }
    for (const c of citationLines) {
      y += c.size * 0.9;
      drawText(ctx, c.text, x, y, { size: c.size, bold: true, color: c.color, maxWidth });
      y += c.size * 0.16;
    }
  }

  // --------------------------------------------------------------- team list

  _renderTeamList(ctx) {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, this.width, this.height);

    const state = this._teamListState || this._buildTeamListState();
    const titleFont = this.height * 0.075;
    const teamFont = this.height * 0.0465;
    const rowHeight = (this.height - 40) / TEAM_LIST_ROWS;
    const logoBox = rowHeight;

    const titleLines = splitText(ctx, state.citation, titleFont, true, this.width - 80);
    let titleY = titleFont * 0.82;
    for (const line of titleLines.slice(0, 2)) {
      drawText(ctx, line, this.width / 2, titleY, {
        size: titleFont,
        bold: true,
        align: 'center',
      });
      titleY += titleFont * 1.05;
    }
    const headerH = Math.max(titleY + 8, 96);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, headerH - 1, this.width, 1);

    const spacing = rowHeight * TEAM_LIST_SPACING;
    const scroll = this._teamListScroll.getValue() * spacing;
    const listTop = headerH + 20;
    const visibleRows = Math.floor((this.height - listTop - 20) / spacing);
    const teams = state.teams;
    const anySelected = new Set(this._selectedTeamIds);

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, headerH, this.width, this.height - headerH);
    ctx.clip();
    for (let i = 0; i < teams.length; i += 1) {
      const y = listTop + i * spacing - scroll;
      if (y + spacing < headerH || y > this.height) continue;
      const team = teams[i];
      const selected = anySelected.has(team.id);
      if (selected) {
        ctx.fillStyle = ICPCColors.SELECTION_COLOR;
        ctx.fillRect(0, y, this.width, spacing - 4);
      }
      const org = this._orgLogo(team);
      if (org) {
        const { w, h } = fitInside(org, logoBox * 0.86, logoBox * 0.86);
        ctx.drawImage(org, 80 + (logoBox * 0.86 - w) / 2, y + (spacing - 4 - h) / 2, w, h);
      }
      drawText(ctx, teamDisplayName(team), 80 + logoBox + 18, y + (spacing - 4) / 2 + teamFont * 0.35, {
        size: teamFont,
        bold: false,
        color: selected ? '#ffffff' : '#f2f2f2',
        maxWidth: this.width - 200,
      });
    }

    // Fade the bottom rows out.
    const fade = ctx.createLinearGradient(0, this.height - 90, 0, this.height);
    fade.addColorStop(0, 'rgba(0,0,0,0)');
    fade.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.fillStyle = fade;
    ctx.fillRect(0, this.height - 90, this.width, 90);
    ctx.restore();

    // Scroll hint / progress line.
    if (teams.length > visibleRows) {
      const progress = clamp(this._teamListScroll.getValue() / Math.max(1, teams.length - visibleRows), 0, 1);
      const trackX = this.width - 40;
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.fillRect(trackX, headerH + 20, 4, this.height - headerH - 60);
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.fillRect(trackX, headerH + 20 + progress * (this.height - headerH - 100), 4, 60);
    }
  }

  // ----------------------------------------------------------------- message

  _renderMessage(ctx) {
    if (!this._message) return;
    if (this.nowMs > this._message.until) {
      this._message = null;
      return;
    }
    const remaining = this._message.until - this.nowMs;
    const alpha = clamp(Math.min(1, (7000 - remaining) / 250, remaining / 400), 0, 1);
    const size = 56;
    const lines = splitText(ctx, this._message.text, size, true, this.width - 240);
    const lineH = size * 1.2;
    const boxH = lines.length * lineH + 48;
    const boxW = Math.min(
      this.width - 160,
      Math.max(...lines.map((l) => textWidth(ctx, l, size, { bold: true })), 300) + 80,
    );
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.fillStyle = 'rgba(0,0,0,0.82)';
    fillRoundedRect(ctx, (this.width - boxW) / 2, (this.height - boxH) / 2, boxW, boxH, 14, 'rgba(0,0,0,0.82)');
    let y = (this.height - boxH) / 2 + 24 + size * 0.82;
    for (const line of lines) {
      drawText(ctx, line, this.width / 2, y, { size, bold: true, align: 'center' });
      y += lineH;
    }
    ctx.restore();
  }

  // --------------------------------------------------------------- debug API

  /** Useful for the standalone test page and integration smoke tests. */
  debugState() {
    return {
      screen: this._screen,
      layout: this.layout,
      order: this._order.slice(),
      scrollRow: this._scrollRow,
      selectedTeamIds: this._selectedTeamIds.slice(),
      selectType: this._selectType,
      selectedSubmission: this._selectedSubmission,
      teamY: Object.fromEntries([...this._teamY].map(([id, a]) => [id, a.getValue()])),
      standings: Object.fromEntries(this._standings || []),
    };
  }
}

export default ResolverView;

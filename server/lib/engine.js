import { FREEZE_DEFAULTS, normalizeFreezeOptions, withFreezeOptions } from '../../public/js/freeze.js';
import { MEDAL_DEFAULTS, normalizeMedalOptions, configuredAwards } from '../../public/js/medals.js';
import { scoreStandings, updateStandings } from '../../public/js/standings.js';
import { LIMITS, inputError, jsonBytes, validateContestInput } from './limits.js';
import { DEFAULT_SCHOOL_LOGO } from '../../public/js/logos.js';
import { applySchoolLogos } from '../../public/js/school-logos.js';

/**
 * ICPC Resolver engine (Node.js port of the relevant parts of ICPC Tools).
 *
 * Responsibilities:
 *  - parse a CCS Contest API event feed (JSON Lines or a JSON array) into the
 *    internal contest shape described in docs/CONTRACT.md;
 *  - compute per-team/per-problem results, both the frozen scoreboard and the
 *    final (all judgements visible) standings;
 *  - rank teams exactly like ContestModel's `Ranking` class (LIVE scoring);
 *  - emit the presentation step sequence the Resolver player/renderer consumes.
 *
 * The contest object is a superset of the contract: it also carries a compact
 * `submissions` array so a game can be rebuilt from demo/uploaded data:
 *
 *   submissions: [{
 *     id, teamId, problemId,
 *     contestTime,                     // ms from contest start
 *     status: 'solved'|'failed'|'pending',
 *     penalty: boolean                 // judgement type counts as a penalty
 *   }]
 *
 * Extra fields are ignored by the renderer and are not copied into `game.contest`.
 *
 * Timing values are the *base* milliseconds from ResolutionUtil.DELAY_TIMES;
 * the player is responsible for multiplying them by `options.speedFactor`.
 */

// ---------------------------------------------------------------------------
// Timings / options
// ---------------------------------------------------------------------------

/**
 * Base delays from ICPC Tools `ResolutionUtil.DELAY_TIMES` (milliseconds).
 * The player scales these by `options.speedFactor`.
 */
export const DELAY_TIMES = Object.freeze({
  selectTeam: 1300,
  selectProblem: 1000,
  solvedMove: 2250,
  solvedStay: 1500,
  failed: 850,
  deselect: 250,
  selectSubmission: 450,
});

const DELAY_ALIASES = Object.freeze({
  SELECT_TEAM: 'selectTeam',
  SELECT_PROBLEM: 'selectProblem',
  SOLVED_MOVE: 'solvedMove',
  SOLVED_STAY: 'solvedStay',
  FAILED: 'failed',
  DESELECT: 'deselect',
  SELECT_SUBMISSION: 'selectSubmission',
});

/** Default game options, matching docs/CONTRACT.md. */
export const DEFAULT_OPTIONS = Object.freeze({
  ...MEDAL_DEFAULTS,
  ...FREEZE_DEFAULTS,
  rowsPerScreen: 12,
  speedFactor: 1,
  rowOffset: 0,
  singleStepStartRow: null,
  autoplay: true,
  pauseMs: 1100,
  showLegend: false,
  showAwards: false,
  title: null,
  startScreen: 'splash',
});

/**
 * Base delay for a Resolver step kind.
 * Accepts camelCase, lower-case, or the Java enum spelling (`SELECT_TEAM`).
 * Unknown kinds return 0.
 */
export function delayFor(kind) {
  if (kind == null) return 0;
  const key = String(kind);
  const name = DELAY_ALIASES[key] || DELAY_ALIASES[key.toUpperCase()] || key;
  const ms = DELAY_TIMES[name];
  return Number.isFinite(ms) ? ms : 0;
}

/** Merge/normalise user options with DEFAULT_OPTIONS. */
export function normalizeOptions(options) {
  const raw = options && typeof options === 'object' ? options : {};
  const opts = { ...DEFAULT_OPTIONS, ...normalizeMedalOptions(raw), ...normalizeFreezeOptions(raw) };

  const int = (value, fallback, min, max) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, Math.round(n)));
  };

  opts.rowsPerScreen = int(raw.rowsPerScreen ?? raw.rows_per_screen, DEFAULT_OPTIONS.rowsPerScreen, 1, 100);
  opts.speedFactor = (() => {
    const n = Number(raw.speedFactor);
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_OPTIONS.speedFactor;
  })();
  opts.rowOffset = int(raw.rowOffset, DEFAULT_OPTIONS.rowOffset, 0, 100);

  // null (or a negative value) selects the Java Resolver's default medal row.
  const singleStepRaw = raw.singleStepStartRow;
  if (singleStepRaw === null || singleStepRaw === undefined || singleStepRaw === '') {
    opts.singleStepStartRow = null;
  } else {
    const singleStep = Number(singleStepRaw);
    opts.singleStepStartRow =
      Number.isFinite(singleStep) && singleStep >= 0 ? Math.min(100000, Math.round(singleStep)) : null;
  }

  const bool = (value, fallback) => {
    if (value === undefined || value === null || value === '') return fallback;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      const s = value.trim().toLowerCase();
      return s === 'true' || s === '1' || s === 'yes' || s === 'on';
    }
    return Boolean(value);
  };

  opts.autoplay = bool(raw.autoplay, DEFAULT_OPTIONS.autoplay);
  opts.pauseMs = int(raw.pauseMs, DEFAULT_OPTIONS.pauseMs, 0, 600000);
  opts.showLegend = bool(raw.showLegend, DEFAULT_OPTIONS.showLegend);
  opts.showAwards = bool(raw.showAwards, DEFAULT_OPTIONS.showAwards);
  opts.title = raw.title == null || raw.title === '' ? null : String(raw.title);
  if (opts.title && opts.title.length > 200) throw inputError('标题长度不能超过 200 字');
  opts.startScreen = raw.startScreen === 'scoreboard' ? 'scoreboard' : 'splash';
  return opts;
}

// ---------------------------------------------------------------------------
// Small parsing helpers
// ---------------------------------------------------------------------------

const MS_PER_MINUTE = 60_000;

function toNumber(value, fallback = 0) {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Penalty time in minutes. CCS feeds normally carry an integer number of
 * minutes, but some exporters (e.g. DOMjudge) emit an ISO-8601 duration string
 * such as `0:20:00` or `PT20M`; accept both instead of silently falling back.
 */
function toPenaltyMinutes(value, fallback = 20) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? Math.max(0, Math.round(value)) : fallback;
  }
  const s = String(value).trim();
  if (!s) return fallback;
  if (/^\d+(\.\d+)?$/.test(s)) return Number.isFinite(Number(s)) ? Math.max(0, Math.round(Number(s))) : fallback;
  if (s.includes(':') || /^P/i.test(s)) {
    return Math.max(0, Math.round(parseDuration(s) / MS_PER_MINUTE));
  }
  return fallback;
}

function toBool(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const s = value.trim().toLowerCase();
    return s === 'true' || s === '1' || s === 'yes';
  }
  return false;
}

/** Parse `H:MM:SS.mmm` (or plain milliseconds / ISO-8601 duration) to ms. */
export function parseDuration(value) {
  if (value == null || value === '') return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
  const s = String(value).trim();
  if (!s) return 0;

  // Bare numbers in contest API JSON are milliseconds.
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number.isFinite(Number(s)) ? Math.max(0, Math.round(Number(s))) : 0;

  // ISO-8601 durations (PT5H, P1DT1H30M, ...).
  const iso = /^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i.exec(s);
  if (iso) {
    const days = Number(iso[1] || 0);
    const hours = Number(iso[2] || 0);
    const minutes = Number(iso[3] || 0);
    const seconds = Number(iso[4] || 0);
    const ms = (days * 86400 + hours * 3600 + minutes * 60 + seconds) * 1000;
    return Number.isFinite(ms) ? Math.max(0, Math.round(ms)) : 0;
  }

  return Math.max(0, Math.round(parseClock(s) ?? 0));
}

function parseClock(value) {
  if (value == null || (typeof value !== 'string' && typeof value !== 'number')) return null;
  const s = String(value).trim();
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number.isFinite(Number(s)) ? Number(s) : null;
  const match = /^(-?)(\d+):(\d{2}):(\d{2}(?:\.\d+)?)$/.exec(s);
  if (!match || Number(match[3]) >= 60 || Number(match[4]) >= 60) return null;
  const ms = (Number(match[2]) * 3600 + Number(match[3]) * 60 + Number(match[4])) * 1000;
  return Number.isFinite(ms) ? (match[1] ? -ms : ms) : null;
}

/**
 * Parse a contest_time value (`0:27:00.297`). Accepts milliseconds too and
 * keeps negative values (pre-start submissions) so callers can filter them.
 */
export function parseContestTime(value) {
  const ms = parseClock(value);
  return ms == null ? null : Math.round(ms);
}

function parseTimestamp(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|[+-]\d{2}(?::?\d{2})?)$/i.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute, second, fraction = '', offset] = match;
  const daysInMonth = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
  if (+month < 1 || +month > 12 || +day < 1 || +day > daysInMonth || +hour > 23 || +minute > 59 || +second > 59) return null;
  const zone = offset.toUpperCase() === 'Z' ? 'Z' : offset.length === 3 ? `${offset}:00` : offset.replace(/^([+-]\d{2})(\d{2})$/, '$1:$2');
  if (zone !== 'Z' && (+zone.slice(1, 3) > 23 || +zone.slice(4) > 59)) return null;
  const t = Date.parse(`${year}-${month}-${day}T${hour}:${minute}:${second}${fraction}${zone}`);
  return Number.isFinite(t) ? t : null;
}

/** Only keep logos/photos the browser can actually load (data: or http(s):). */
function usableAsset(value) {
  if (value == null) return null;
  if (typeof value === 'string') {
    if (value === DEFAULT_SCHOOL_LOGO) return value;
    return /^(data:|https?:\/\/|\/media\/[a-f0-9]{64}\.(?:png|jpg|webp)$)/i.test(value) ? value : null;
  }
  if (Array.isArray(value)) {
    const refs = value.filter((v) => v && typeof v === 'object' && typeof v.href === 'string');
    if (!refs.length) return null;
    const exact = refs.find((r) => Number(r.width) === 160 && Number(r.height) === 160);
    const candidate = exact || refs[0];
    return usableAsset(candidate.href);
  }
  if (typeof value === 'object' && typeof value.href === 'string') return usableAsset(value.href);
  return null;
}

/** Normalise a plural/singular CCS event-feed type name. */
function singularType(raw) {
  let type = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/_/g, '-');
  if (!type) return null;
  if (type === 'judgement-types' || type === 'judgement-type') return 'judgement-type';
  if (type === 'contest' || type === 'contests') return 'contest';
  if (type === 'state' || type === 'states') return 'state';
  if (type === 'group' || type === 'groups') return 'group';
  if (type === 'organization' || type === 'organizations') return 'organization';
  if (type === 'team' || type === 'teams') return 'team';
  if (type === 'person' || type === 'persons' || type === 'people') return 'person';
  if (type === 'problem' || type === 'problems') return 'problem';
  if (type === 'submission' || type === 'submissions') return 'submission';
  if (type === 'judgement' || type === 'judgements') return 'judgement';
  if (type === 'language' || type === 'languages') return 'language';
  if (type === 'award' || type === 'awards') return 'award';
  if (type === 'run' || type === 'runs') return 'run';
  if (type.endsWith('s')) return type.slice(0, -1);
  return type;
}

function inferAwardType(id) {
  const s = String(id ?? '').toLowerCase();
  if (s === 'winner') return 'winner';
  if (/^rank-/.test(s)) return 'rank';
  if (/-medal$/.test(s)) return 'medal';
  if (/^first-to-solve-/.test(s)) return 'first-to-solve';
  if (/^group-winner-/.test(s)) return 'group';
  if (/^organization-winner-/.test(s)) return 'organization';
  if (/^group-highlight-/.test(s)) return 'group-highlight';
  if (/^solved-/.test(s)) return 'solved';
  if (/^top-/.test(s)) return 'top';
  if (/^honors-/.test(s)) return 'honors';
  return 'other';
}

function normalizeDisplayMode(value) {
  if (value == null || value === '') return 'detail';
  if (value === true) return 'detail';
  if (value === false) return 'pause';
  const s = String(value).trim().toLowerCase();
  if (s === 'detail' || s === 'pause' || s === 'list' || s === 'ignore') return s;
  return 'detail';
}

// ---------------------------------------------------------------------------
// Event feed parsing
// ---------------------------------------------------------------------------

/** Invalid input error; the HTTP layer maps `status`/`expose` to a 400 response. */
function invalidFeedError(message) {
  const err = new Error(message);
  err.status = 400;
  err.expose = true;
  return err;
}

function eventLines(text) {
  const cleaned = text.replace(/^\uFEFF/, '').trim();
  if (!cleaned) throw invalidFeedError('Event feed is empty');

  // A JSON array (the whole response is one JSON document).
  if (cleaned.startsWith('[')) {
    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (err) {
      throw invalidFeedError('Invalid event feed: invalid JSON array');
    }
    if (!Array.isArray(parsed)) throw invalidFeedError('Invalid event feed: expected a JSON array');
    return parsed;
  }

  // Try a single JSON document first (covers `{...}` and arrays handled above).
  let single = null;
  try {
    single = JSON.parse(cleaned);
  } catch {
    single = null;
  }
  if (single !== null && typeof single === 'object') {
    if (Array.isArray(single)) return single;
    if (Array.isArray(single.events)) return single.events;
    return [single];
  }

  // Otherwise treat it as JSON Lines.
  const lines = cleaned.split(/\r?\n/);
  const events = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    try {
      events.push(JSON.parse(line));
    } catch (err) {
      throw invalidFeedError(`Invalid event feed: line ${i + 1} is not valid JSON`);
    }
  }
  if (!events.length) throw invalidFeedError('Invalid event feed: no JSON events found');
  return events;
}

/**
 * Parse a CCS Contest API event feed.
 *
 * Accepts JSON Lines or a JSON array; object types may be singular or plural,
 * `op` may be create/update/delete. Deletes are applied gracefully. Returns the
 * normalised contest object described in docs/CONTRACT.md (plus `submissions`).
 */
export function parseEventFeed(text, { scoringMode = 'auto' } = {}) {
  if (typeof text !== 'string') {
    const err = new TypeError('parseEventFeed(text) expects a string');
    err.status = 400;
    err.expose = true;
    throw err;
  }
  if (Buffer.byteLength(text) > LIMITS.feedBytes) throw inputError('事件流文件过大（上限 38 MB）', 413);
  const events = eventLines(text);
  if (events.length > LIMITS.events) throw inputError('事件流记录数量超出上限', 413);
  if (scoringMode === 'auto') {
    // onsite-toolkit emits token tN envelopes and these named groups. Ordinary
    // CCS/DOMjudge streams retain ICPC scoring; no platform selector is needed.
    const groupNames = new Set(events.filter((event) => singularType(event?.type) === 'group').map((event) => event.data?.name));
    scoringMode = groupNames.has('participants') && groupNames.has('observers') &&
      events.some((event) => /^t\d+$/.test(event?.token || '') && singularType(event.type) === 'contest') ? 'hydro' : 'icpc';
  }
  const feedAsset = (value) => {
    const asset = usableAsset(value);
    return scoringMode === 'hydro' && asset && !/^(https?:|data:image\/)/i.test(asset) ? null : asset;
  };

  const store = {
    contest: null,
    state: null,
    group: new Map(),
    organization: new Map(),
    team: new Map(),
    person: new Map(),
    problem: new Map(),
    submission: new Map(),
    judgement: new Map(),
    'judgement-type': new Map(),
    language: new Map(),
    award: new Map(),
    run: new Map(),
  };

  let lastFreezeDurationMs = 0;
  let lastFrozenAt = null;
  const apply = (event) => {
    if (!event || typeof event !== 'object' || Array.isArray(event)) return;
    const type = singularType(event.type);
    if (!type) return;
    const op = String(event.op ?? 'create').toLowerCase();

    const envelopeId = event.id == null ? null : String(event.id);
    const data =
      event.data && typeof event.data === 'object' && !Array.isArray(event.data)
        ? event.data
        : Object.fromEntries(Object.entries(event).filter(([k]) => !['type', 'op', 'id', 'data'].includes(k)));

    if (type === 'state') {
      if (data.frozen) lastFrozenAt = parseTimestamp(data.frozen);
      store.state = { ...(store.state || {}), ...data };
      return;
    }
    if (type === 'contest') {
      if (op === 'delete') {
        store.contest = null;
        lastFreezeDurationMs = 0; lastFrozenAt = null;
        return;
      }
      const freeze = parseDuration(data.scoreboard_freeze_duration ?? data.scoreboardFreezeDuration ?? data.freeze_duration ?? data.freezeDurationMs);
      if (freeze > 0) lastFreezeDurationMs = freeze;
      store.contest = { ...(store.contest || {}), ...data };
      return;
    }

    const map = store[type];
    if (!(map instanceof Map)) return;

    const id = data.id == null ? envelopeId : String(data.id);
    if (id == null) return;

    if (op === 'delete') {
      map.delete(id);
      return;
    }

    const previous = map.get(id);
    const limit = ({ team: LIMITS.teams, problem: LIMITS.problems, organization: LIMITS.organizations,
      submission: LIMITS.submissions, award: LIMITS.awards })[type] ?? LIMITS.events;
    if (!previous && map.size >= limit) throw inputError(`${type} 数量超出上限 ${limit}`, 413);
    map.set(id, { ...(previous || {}), ...data, id });
  };

  for (const event of events) apply(event);

  if (!store.contest && !store.team.size && !store.problem.size) {
    throw invalidFeedError('Invalid event feed: no contest, team or problem records found');
  }

  const contestData = store.contest || {};
  if (scoringMode === 'hydro' && contestData.scoreboard_type === 'score') {
    throw invalidFeedError('当前 Hydro 适配支持 ACM/XCPC 赛制；OI/IOI 计分赛制暂不支持。');
  }
  const startTime = contestData.start_time ?? contestData.startTime ?? null;
  const startMs = parseTimestamp(startTime);
  const parsedDurationMs = parseDuration(
    contestData.duration ?? contestData.duration_ms ?? contestData.durationMs,
  );
  // A contest without an explicit duration defaults to the ICPC 5 hours.
  const durationMs = parsedDurationMs > 0 ? parsedDurationMs : 5 * 60 * 60 * 1000;
  let freezeDurationMs = parseDuration(
    contestData.scoreboard_freeze_duration ??
      contestData.scoreboardFreezeDuration ??
      contestData.freeze_duration ??
      contestData.freezeDurationMs,
  );

  let freezeSource = freezeDurationMs > 0 ? 'feed' : 'none';
  if (!freezeDurationMs) {
    const fromState = startMs != null && lastFrozenAt != null ? durationMs - (lastFrozenAt - startMs) : 0;
    const recovered = fromState > 0 && fromState <= durationMs ? fromState : lastFreezeDurationMs;
    if (recovered > 0 && recovered <= durationMs) { freezeDurationMs = recovered; freezeSource = 'history'; }
  }

  const judgementTypes = store['judgement-type'];
  const bySubmission = new Map();
  for (const judgement of store.judgement.values()) {
    const submissionId = judgement.submission_id ?? judgement.submissionId;
    if (submissionId == null) continue;
    bySubmission.set(String(submissionId), judgement);
  }

  const submissions = [];
  let missingSubmissionTimes = 0;
  for (const [index, raw] of [...store.submission.entries()]) {
    const id = raw.id == null ? index : String(raw.id);
    const teamId = raw.team_id ?? raw.teamId;
    const problemId = raw.problem_id ?? raw.problemId;
    if (teamId == null || problemId == null) continue;

    let contestTime = raw.contest_time ?? raw.contestTime;
    if (contestTime != null) {
      contestTime = parseContestTime(contestTime);
    } else if (raw.time != null) {
      const wall = parseTimestamp(raw.time);
      contestTime = wall != null && startMs != null ? wall - startMs : null;
    } else {
      contestTime = null;
    }
    if (contestTime == null) missingSubmissionTimes++;

    const judgement = bySubmission.get(id) || bySubmission.get(String(raw.id));
    const type = judgement ? judgementTypes.get(String(judgement.judgement_type_id ?? judgement.judgementTypeId)) : null;

    let status = 'pending';
    let penalty = false;
    if (type) {
      status = toBool(type.solved) ? 'solved' : 'failed';
      penalty = toBool(type.penalty);
      if (scoringMode === 'hydro') {
        // Hydro's CDP export includes FE/IGN as penalties, but its ACM rule excludes them.
        const verdict = String(judgement.judgement_type_id ?? '').toUpperCase();
        penalty = !['AC', 'CE', 'FE', 'IGN'].includes(verdict);
      }
    }

    submissions.push({
      id,
      teamId: String(teamId),
      problemId: String(problemId),
      contestTime,
      status,
      penalty,
    });
  }

  const organizations = [...store.organization.values()].map((o) => ({
    id: String(o.id),
    name: o.name ?? o.formal_name ?? String(o.id),
    formalName: o.formal_name ?? o.formalName ?? null,
    country: o.country ?? null,
    logo: feedAsset(o.logo),
  }));

  const teams = [...store.team.values()].map((t) => ({
    id: String(t.id),
    name: t.name ?? t.display_name ?? String(t.id),
    displayName: t.display_name ?? t.displayName ?? t.name ?? String(t.id),
    organizationId: t.organization_id == null ? null : String(t.organization_id),
    photo: feedAsset(t.photo),
    logo: feedAsset(t.logo),
    unrank: scoringMode === 'hydro' && (Array.isArray(t.group_ids) ? t.group_ids : []).some((id) =>
      id === 'observers' || store.group.get(String(id))?.name === 'observers'),
    hidden: toBool(t.hidden) || (Array.isArray(t.group_ids) ? t.group_ids : []).some((id) => toBool(store.group.get(String(id))?.hidden)),
  }));

  const problems = [...store.problem.values()].map((p, index) => ({
    id: String(p.id),
    label: p.label ?? String.fromCharCode(65 + index),
    name: p.name ?? null,
    rgb: p.rgb ?? p.color ?? null,
    ordinal: p.ordinal == null ? index : Number(p.ordinal),
  }));
  problems.sort((a, b) => (a.ordinal === b.ordinal ? 0 : a.ordinal - b.ordinal));

  const awards = [...store.award.values()]
    .map((a) => {
      const teamIds = Array.isArray(a.team_ids)
        ? a.team_ids.map(String)
        : Array.isArray(a.teamIds)
          ? a.teamIds.map(String)
          : [];
      if (!teamIds.length) return null;
      return {
        id: String(a.id),
        citation: a.citation ?? a.name ?? '',
        teamIds,
        displayMode: normalizeDisplayMode(a.display_mode ?? a.displayMode ?? a.show),
        awardType: a.award_type ?? a.awardType ?? inferAwardType(a.id),
      };
    })
    .filter(Boolean);

  const contest = {
    contestId: contestData.id == null ? null : String(contestData.id),
    freezeSource, missingSubmissionTimes,
    scoringMode,
    name: contestData.name ?? contestData.formal_name ?? 'Contest',
    formalName: contestData.formal_name ?? contestData.formalName ?? null,
    startTime,
    durationMs,
    freezeDurationMs,
    penaltyMinutes: toPenaltyMinutes(contestData.penalty_time ?? contestData.penaltyTime, 20),
    logo: feedAsset(contestData.logo),
    problems: problems.map(({ ordinal, ...p }) => p),
    organizations,
    teams,
    awards,
    submissions,
  };

  return normalizeContest(contest);
}

// ---------------------------------------------------------------------------
// Contest normalisation
// ---------------------------------------------------------------------------

function normalizeStatus(value) {
  const s = String(value ?? '').toLowerCase();
  if (s === 'solved') return 'solved';
  if (s === 'failed') return 'failed';
  return 'pending';
}

function normalizeDurationValue(value, fallback) {
  if (typeof value === 'number') return Math.max(0, Math.round(Number.isFinite(value) ? value : fallback));
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return fallback;
    if (/^\d+(\.\d+)?$/.test(trimmed)) return Number.isFinite(Number(trimmed)) ? Math.max(0, Math.round(Number(trimmed))) : fallback;
    return parseDuration(trimmed);
  }
  return fallback;
}

function normalizeLogo(value) {
  return typeof value === 'string' ? usableAsset(value) : null;
}

function withRecordIds(records = [], prefix) {
  if (records.every((record) => record.id != null)) return records;
  const used = new Set(records.filter((record) => record.id != null).map((record) => String(record.id)));
  return records.map((record, index) => {
    if (record.id != null) return record;
    const base = `${prefix}-${index}`;
    let id = base, suffix = 0;
    while (used.has(id)) id = `${base}-${++suffix}`;
    used.add(id);
    return { ...record, id };
  });
}

/**
 * Return a clean, internally consistent contest object. Accepts contests with
 * camelCase or CCS snake_case fields and fills in cross-references.
 */
export function normalizeContest(input) {
  validateContestInput(input);
  // Reserve explicit IDs before allocating missing ones, including IDs later
  // in the input. Otherwise unrelated records can collapse into one result.
  input = { ...input, ...Object.fromEntries([
    ['teams', 'team'], ['problems', 'problem'], ['organizations', 'org'], ['submissions', 'submission'], ['awards', 'award'],
  ].map(([field, prefix]) => [field, withRecordIds(input[field] || [], prefix)])) };

  const durationRaw = input.durationMs ?? input.duration ?? 5 * 60 * 60 * 1000;
  const parsedDurationMs = normalizeDurationValue(durationRaw, 5 * 60 * 60 * 1000);
  const durationMs = parsedDurationMs > 0 ? parsedDurationMs : 5 * 60 * 60 * 1000;
  const freezeRaw =
    input.freezeDurationMs ??
    input.scoreboard_freeze_duration ??
    input.scoreboardFreezeDuration ??
    input.freezeDuration ??
    0;
  const freezeDurationMs = Math.min(durationMs, normalizeDurationValue(freezeRaw, 0));

  const organizations = (Array.isArray(input.organizations) ? input.organizations : []).map((o, i) => ({
    id: String(o.id ?? `org-${i}`),
    name: o.name ?? o.formalName ?? o.formal_name ?? String(o.id ?? `org-${i}`),
    formalName: o.formalName ?? o.formal_name ?? o.name ?? String(o.id ?? `org-${i}`),
    country: o.country ?? null,
    logo: normalizeLogo(o.logo),
    logoSource: ['hydro', 'default', 'manual', 'library'].includes(o.logoSource) ? o.logoSource : undefined,
    // Web-uploaded organization logos override the team logos for that org.
    logoOverride: o.logoOverride === true || o.logo_override === true,
  }));
  const orgById = new Map(organizations.map((o) => [o.id, o]));

  const teams = (Array.isArray(input.teams) ? input.teams : []).filter((t) => !toBool(t.hidden)).map((t, i) => {
    const id = String(t.id ?? `team-${i}`);
    const orgId = t.organizationId ?? t.organization_id;
    const organizationId = orgId == null ? null : String(orgId);
    const org = organizationId == null ? null : orgById.get(organizationId);
    const name = t.name ?? t.displayName ?? t.display_name ?? id;
    const displayName = t.displayName ?? t.display_name ?? t.name ?? id;
    const organizationName = t.organizationName ?? org?.name ?? '';
    const formalName = t.formalName ?? org?.formalName ?? org?.name ?? organizationName;
    const country = t.country ?? org?.country ?? null;
    return {
      id,
      name,
      displayName,
      unrank: toBool(t.unrank),
      logoOverride: t.logoOverride === true,
      organizationId,
      organizationName,
      formalName,
      country,
      logo: normalizeLogo(t.logo ?? org?.logo),
      logoSource: t.logo ? (['hydro', 'default', 'organization', 'manual', 'library'].includes(t.logoSource) ? t.logoSource : undefined) : 'organization',
      photo: normalizeLogo(t.photo),
    };
  });

  // Add placeholder organizations for teams that reference an unknown org.
  for (const team of teams) {
    if (!team.organizationId || orgById.has(team.organizationId)) continue;
    const org = {
      id: team.organizationId,
      name: team.organizationName || team.name,
      formalName: team.formalName || team.organizationName || team.name,
      country: team.country || null,
      logo: null,
    };
    organizations.push(org);
    orgById.set(org.id, org);
  }

  const problems = (Array.isArray(input.problems) ? input.problems : [])
    .map((p, i) => {
      const id = String(p.id ?? `problem-${i}`);
      return {
        id,
        label: p.label ?? String.fromCharCode(65 + i),
        name: p.name ?? null,
        rgb: p.rgb ?? p.color ?? null,
      };
    })
    .slice();

  const awards = (Array.isArray(input.awards) ? input.awards : [])
    .map((a, i) => {
      const teamIds = Array.isArray(a.teamIds)
        ? a.teamIds.map(String)
        : Array.isArray(a.team_ids)
          ? a.team_ids.map(String)
          : [];
      const id = String(a.id ?? `award-${i}`);
      return {
        id,
        citation: a.citation ?? '',
        teamIds,
        displayMode: normalizeDisplayMode(a.displayMode ?? a.display_mode ?? a.show),
        awardType: a.awardType ?? a.award_type ?? inferAwardType(id),
      };
    })
    .filter((a) => a.teamIds.length > 0);

  const startTime = input.startTime ?? input.start_time ?? null;
  // Media can be inherited by thousands of teams. Bound that expansion before
  // building cells, step streams or a potentially enormous JSON string.
  let estimated = teams.length * (problems.length * 160 + 1200);
  for (const record of [...teams, ...organizations, { logo: input.logo }]) {
    for (const field of ['logo', 'photo']) estimated += typeof record[field] === 'string' ? Buffer.byteLength(record[field]) : 0;
  }
  if (estimated > LIMITS.gameBytes) throw inputError('比赛单元格与素材总量过大，请使用上传图片的 /media/ 引用', 413);
  const startMs = parseTimestamp(startTime);
  let missingSubmissionTimes = 0;
  const submissions = (Array.isArray(input.submissions) ? input.submissions : [])
    .map((s, i) => {
      const teamId = s.teamId ?? s.team_id;
      const problemId = s.problemId ?? s.problem_id;
      if (teamId == null || problemId == null) return null;

      let contestTime = s.contestTime ?? s.contest_time;
      if (contestTime == null && s.time != null) {
        const wall = parseTimestamp(s.time);
        contestTime = wall != null && startMs != null ? wall - startMs : null;
      }
      contestTime = parseContestTime(contestTime);
      if (contestTime == null) missingSubmissionTimes++;

      let status;
      if (s.status != null) status = normalizeStatus(s.status);
      else if (typeof s.solved === 'boolean') status = s.solved ? 'solved' : 'failed';
      else if (s.judged === false) status = 'pending';
      else status = 'pending';

      return {
        id: String(s.id ?? `submission-${i}`),
        teamId: String(teamId),
        problemId: String(problemId),
        contestTime,
        status,
        penalty: toBool(s.penalty),
      };
    })
    .filter(Boolean);

  return applySchoolLogos({
    contestId: input.contestId == null ? null : String(input.contestId),
    freezeSource: input.freezeSource || (freezeDurationMs > 0 ? 'feed' : 'none'),
    missingSubmissionTimes: Math.max(missingSubmissionTimes, Number(input.missingSubmissionTimes) || 0),
    scoringMode: input.scoringMode === 'hydro' ? 'hydro' : 'icpc',
    name: input.name ?? input.formalName ?? 'Contest',
    formalName: input.formalName ?? input.formal_name ?? null,
    startTime,
    durationMs,
    freezeDurationMs,
    penaltyMinutes: toPenaltyMinutes(input.penaltyMinutes ?? input.penalty_time, 20),
    logo: normalizeLogo(input.logo),
    problems,
    organizations,
    teams,
    awards,
    submissions,
  });
}

// ---------------------------------------------------------------------------
// Results / ranking
// ---------------------------------------------------------------------------

function emptyCell() {
  return {
    status: 'unattempted',
    attempts: 0,
    time: null,
    pending: 0,
    firstToSolve: false,
    // Internal fields used for ranking; stripped from game JSON.
    _penaltyCount: 0,
    _judgedCount: 0,
    _unjudgedCount: 0,
    _solvedTimeMs: null,
    _lastSubmissionMs: null,
  };
}

function cloneCell(cell) {
  return {
    status: cell.status,
    attempts: cell.attempts,
    time: cell.time,
    ...(cell.timeSeconds !== undefined ? { timeSeconds: cell.timeSeconds } : {}),
    pending: cell.pending,
    firstToSolve: cell.firstToSolve,
    _penaltyCount: cell._penaltyCount || 0,
    _judgedCount: cell._judgedCount || 0,
    _unjudgedCount: cell._unjudgedCount || 0,
    _solvedTimeMs: cell._solvedTimeMs ?? null,
    _lastSubmissionMs: cell._lastSubmissionMs ?? null,
  };
}

/** Public contract shape for one result cell. */
function publicCell(cell) {
  return {
    status: cell.status,
    attempts: cell.attempts,
    time: cell.time,
    ...(cell.timeSeconds !== undefined ? { timeSeconds: cell.timeSeconds } : {}),
    pending: cell.pending,
    firstToSolve: cell.firstToSolve,
    penaltyCount: cell._penaltyCount || 0,
  };
}

const standingsFor = scoreStandings;

/**
 * Compute the LIVE ICPC standings for a result map.
 * Returns records sorted best-first, including shared `rank` values.
 */
export function computeStandings(contest, results) {
  const c = normalizeContest(contest);
  return standingsFor(c, results);
}

/**
 * Compute per-team/per-problem results.
 *
 * @param {object} contest  normalised or raw contest (with submissions)
 * @param {{frozen?: boolean}} [options] frozen = hide post-freeze judgements
 * @returns {{results: Record<string, object[]>, standings: object[], order: string[],
 *            pendingCount: number, totalSubmissions: number, freezeTimeMs: number,
 *            frozen: boolean, contest: object}}
 */
export function computeCells(contest, options = {}) {
  const c = normalizeContest(contest);
  const frozen = Boolean(options.frozen);
  if (c.missingSubmissionTimes) throw inputError('提交记录缺少时间或含无效时间，无法可靠计算排名');
  const freezeTimeMs = c.durationMs - c.freezeDurationMs;

  const problemIndex = new Map(c.problems.map((p, i) => [p.id, i]));
  const teamIds = new Set(c.teams.map((t) => t.id));

  const results = Object.create(null);
  for (const team of c.teams) results[team.id] = c.problems.map(() => emptyCell());

  // Only submissions inside the contest count (ICPC Tools filters these out).
  const submissions = c.submissions
    .filter((s) => {
      if (!teamIds.has(s.teamId) || !problemIndex.has(s.problemId)) return false;
      if (!Number.isFinite(s.contestTime)) return false;
      if (s.contestTime < 0) return false;
      if (c.durationMs > 0 && s.contestTime >= c.durationMs) return false;
      return true;
    })
    .sort((a, b) => a.contestTime - b.contestTime);

  for (const submission of submissions) {
    const cells = results[submission.teamId];
    if (!cells) continue;
    const cell = cells[problemIndex.get(submission.problemId)];
    if (!cell) continue;

    if (c.scoringMode === 'hydro' && cell.status === 'solved') continue;
    cell.attempts += 1;
    cell._lastSubmissionMs = submission.contestTime;

    // Once solved, later submissions only count as attempts (contract spec).
    if (cell.status === 'solved') continue;

    const judgedVisible = submission.status !== 'pending' &&
      (!frozen || submission.contestTime < freezeTimeMs || (submission.status === 'failed' && !submission.penalty));

    if (judgedVisible) {
      if (submission.status === 'solved') {
        cell.status = 'solved';
        cell._solvedTimeMs = submission.contestTime;
      } else {
        cell._judgedCount += 1;
        if (submission.penalty) cell._penaltyCount += 1;
        if (cell.status !== 'pending') cell.status = 'failed';
      }
    } else {
      cell._unjudgedCount += 1;
      cell.status = 'pending';
    }
  }

  // Finish status/time/pending for each cell.
  for (const team of c.teams) {
    const cells = results[team.id];
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      if (c.scoringMode === 'hydro') {
        const timeMs = cell.status === 'solved' ? cell._solvedTimeMs : cell._lastSubmissionMs;
        cell.timeSeconds = timeMs == null ? null : Math.floor(timeMs / 1000);
      }
      if (cell.status === 'solved') {
        cell.time = Math.floor((cell._solvedTimeMs ?? 0) / MS_PER_MINUTE);
        cell.pending = 0;
      } else if (cell._unjudgedCount > 0) {
        cell.status = 'pending';
        cell.pending = cell._unjudgedCount;
        cell.time = cell._lastSubmissionMs == null ? null : Math.floor(cell._lastSubmissionMs / MS_PER_MINUTE);
      } else if (cell._judgedCount > 0) {
        cell.status = 'failed';
        cell.pending = 0;
        cell.time = cell._lastSubmissionMs == null ? null : Math.floor(cell._lastSubmissionMs / MS_PER_MINUTE);
      } else {
        cell.status = 'unattempted';
        cell.pending = 0;
        cell.time = null;
      }
    }
  }

  // First to solve: first solved submission per problem, unless an earlier
  // submission is still unjudged (ICPC Tools marks that problem as unresolved).
  const ftsDecided = new Array(c.problems.length).fill(false);
  const unranked = new Set(c.teams.filter((team) => team.unrank).map((team) => team.id));
  for (const submission of submissions) {
    if (unranked.has(submission.teamId)) continue;
    const pIndex = problemIndex.get(submission.problemId);
    if (pIndex == null || ftsDecided[pIndex]) continue;

    const judgedVisible = submission.status !== 'pending' &&
      (!frozen || submission.contestTime < freezeTimeMs || (submission.status === 'failed' && !submission.penalty));
    if (!judgedVisible) {
      ftsDecided[pIndex] = true; // blocked by an earlier pending submission
    } else if (submission.status === 'solved') {
      const cell = results[submission.teamId]?.[pIndex];
      // Only a visible solved submission can be first-to-solve. A solved
      // submission inside the freeze is not visible in the frozen view.
      if (cell && cell.status === 'solved') {
        cell.firstToSolve = true;
        ftsDecided[pIndex] = true;
      }
    }
  }

  const standings = standingsFor(c, results);
  const order = standings.map((record) => record.teamId);
  let pendingCount = 0;
  for (const team of c.teams) {
    for (const cell of results[team.id]) pendingCount += cell.pending;
  }

  return {
    results,
    standings,
    order,
    pendingCount,
    totalSubmissions: submissions.length,
    freezeTimeMs: frozen ? Math.max(0, freezeTimeMs) : c.durationMs,
    frozen,
    contest: c,
  };
}

// ---------------------------------------------------------------------------
// Step generation
// ---------------------------------------------------------------------------

function publicResults(results) {
  return Object.fromEntries(Object.entries(results).map(([teamId, cells]) => [teamId, cells.map(publicCell)]));
}

function publicContest(contest) {
  return {
    contestId: contest.contestId, freezeSource: contest.freezeSource,
    scoringMode: contest.scoringMode,
    name: contest.name,
    formalName: contest.formalName,
    startTime: contest.startTime,
    durationMs: contest.durationMs,
    freezeDurationMs: contest.freezeDurationMs,
    penaltyMinutes: contest.penaltyMinutes,
    logo: contest.logo,
    problems: contest.problems.map((p) => ({
      id: p.id,
      label: p.label,
      name: p.name,
      rgb: p.rgb,
    })),
    organizations: contest.organizations.map((o) => ({
      id: o.id,
      name: o.name,
      formalName: o.formalName,
      country: o.country,
      logo: o.logo,
      logoSource: o.logoSource,
      logoOverride: o.logoOverride === true,
    })),
    teams: contest.teams.map((t) => ({
      id: t.id,
      name: t.name,
      displayName: t.displayName,
      unrank: t.unrank,
      logoOverride: t.logoOverride,
      organizationId: t.organizationId,
      organizationName: t.organizationName,
      formalName: t.formalName,
      country: t.country,
      logo: t.logo,
      logoSource: t.logoSource,
      photo: t.photo,
    })),
    awards: contest.awards.map((a) => ({
      id: a.id,
      citation: a.citation,
      teamIds: a.teamIds.slice(),
      displayMode: a.displayMode,
      awardType: a.awardType,
    })),
  };
}

function stepDelay(kind) {
  return { type: 'delay', ms: delayFor(kind), kind };
}

function pause(label) {
  return label ? { type: 'pause', label } : { type: 'pause' };
}

/** Lower-cased award type (normalised contests store `awardType`). */
function awardTypeOf(award) {
  return String(award?.awardType ?? award?.award_type ?? '').toLowerCase();
}

// Order of IAward.KNOWN_TYPES in ICPC Tools. The Resolver sorts the award list
// with it (AwardUtil.sortAwards), so a team's award page lists the winner and
// medal awards before FTS/group awards.
const AWARD_TYPE_ORDER = [
  'winner',
  'rank',
  'medal',
  'first-to-solve',
  'group',
  'organization',
  'group-highlight',
  'solved',
  'top',
  'honors',
];

function awardSortRank(award) {
  const index = AWARD_TYPE_ORDER.indexOf(awardTypeOf(award));
  return index < 0 ? AWARD_TYPE_ORDER.length : index;
}

/** Lowest frozen row among all enabled award recipients; never use final rank as the frozen boundary. */
export function resolveStartRowFor(contest, options, frozenOrder) {
  const last = Math.max(0, frozenOrder.length - 1);
  if (options.singleStepStartRow != null) return Math.min(last, options.singleStepStartRow);
  if (!options.showAwards) return last;
  const rows = new Map(frozenOrder.map((id, row) => [id, row]));
  let start = -1;
  for (const award of contest.awards || []) {
    if (award.displayMode === 'ignore') continue;
    for (const id of award.teamIds || []) {
      const row = rows.get(String(id));
      if (row != null) start = Math.max(start, row);
    }
  }
  return start < 0 ? last : start;
}

/**
 * Top row visible for a given ranking row (zero-based). The selected row is
 * kept at the bottom of the viewport (`rowOffset` moves it up the screen, as in
 * Resolver's `--rowDisplayOffset`), and the #1 row is never hidden: the
 * original Resolver only scrolls the scoreboard one row at a time, so a row
 * high on the board does not push first place off the top.
 */
function scrollTopFor(row, options, teamCount) {
  const maxTop = Math.max(0, teamCount - options.rowsPerScreen);
  const desired = row - options.rowsPerScreen + 1 + options.rowOffset;
  return Math.max(0, Math.min(maxTop, desired));
}

/**
 * Build the resolution steps (and final ordering) from pre-computed views.
 * Kept internal so buildGame can reuse the final order in `meta`.
 */
function buildStepsInternal(contest, options, frozenView, finalView) {
  const steps = [];
  let phase = 'intro';
  const push = (...items) => steps.push(...items.map((step) => phase === 'intro' ? step :
    { ...step, phase, speedMultiplier: phase === 'fast' ? 4 : 1 }));
  const singleStepStartRow = resolveStartRowFor(contest, options, frozenView.order);
  const awardRecipients = new Set(options.showAwards ? contest.awards
    .filter((award) => award.displayMode !== 'ignore').flatMap((award) => award.teamIds) : []);
  let manualStarted = false;
  const teamById = new Map(contest.teams.map((team) => [team.id, team]));

  // Mutable scoreboard state. Starts frozen, then resolves each pending cell.
  const results = Object.create(null);
  for (const [teamId, cells] of Object.entries(frozenView.results)) {
    results[teamId] = cells.map(cloneCell);
  }
  let order = frozenView.order.slice();
  const standingRows = frozenView.standings.slice();

  const rowOf = (teamId) => order.indexOf(teamId);

  // List awards are shown after every recipient's final row has been revealed.
  const awardsByTeam = new Map();
  const listAwards = [];
  if (options.showAwards) {
    // Same order as AwardUtil.sortAwards(): winner/medal before FTS/group.
    const sortedAwards = contest.awards
      .slice()
      .sort((a, b) => awardSortRank(a) - awardSortRank(b));
    for (const award of sortedAwards) {
      const mode = award.displayMode || 'detail';
      if (mode === 'ignore') continue;
      if (mode === 'list') { listAwards.push(award); continue; }
      for (const teamId of award.teamIds) {
        if (!teamById.has(teamId)) continue;
        if (!awardsByTeam.has(teamId)) awardsByTeam.set(teamId, []);
        awardsByTeam.get(teamId).push(award);
      }
    }
  }

  const publicAward = (award) => ({
    id: award.id,
    citation: award.citation,
    teamIds: award.teamIds.slice(),
    displayMode: award.displayMode,
    awardType: award.awardType,
  });
  const completedTeams = new Set();

  // ---- Intro: splash -> scoreboard -> bottom ------------------------------
  if (options.startScreen === 'scoreboard') {
    push({ type: 'presentation', screen: 'scoreboard' });
  } else {
    push({ type: 'presentation', screen: 'splash' });
    push(pause('splash'));
  }

  push({ type: 'selectTeam', teamIds: [], selectType: 'NORMAL', role: 'setup' });
  push({ type: 'scroll', row: 0, role: 'setup' });
  if (options.startScreen !== 'scoreboard') {
    push({ type: 'presentation', screen: 'scoreboard' });
  }
  push(pause('initial scoreboard'));

  const teamCount = order.length;
  if (teamCount === 0) {
    push(pause('done'));
    return { steps, finalOrder: order, resolveStartRow: singleStepStartRow };
  }

  push({ type: 'scroll', row: scrollTopFor(teamCount - 1, options, teamCount), role: 'intro-bottom', durationMs: 650 });
  push(pause('bottom'));

  // Select the bottom team before starting (the Resolver pauses here).
  push({ type: 'selectTeam', teamIds: [order[teamCount - 1]], selectType: 'NORMAL', role: 'setup' });
  push(pause('first team'));

  // Pending work: frozen 'pending' cells that have a judged final result.
  const pendingByTeam = new Map();
  for (const [teamId, cells] of Object.entries(results)) {
    pendingByTeam.set(teamId, cells.flatMap((cell, p) => cell.status === 'pending' &&
      ['solved', 'failed'].includes(finalView.results[teamId]?.[p]?.status) ? [p] : []));
  }
  const getNextResolve = () => {
    for (let row = order.length - 1; row >= 0; row--) {
      const teamId = order[row];
      const pending = pendingByTeam.get(teamId);
      if (pending?.length) return { teamId, problemIndex: pending[0] };
    }
    return null;
  };

  const applyResolve = (teamId, problemIndex) => {
    const final = finalView.results[teamId][problemIndex];
    results[teamId][problemIndex] = cloneCell(final);
    pendingByTeam.get(teamId).shift();
    const move = updateStandings(contest, standingRows, teamById.get(teamId), results[teamId], { ranks: false });
    if (move.from !== move.to) {
      order.splice(move.from, 1);
      order.splice(move.to, 0, teamId);
    }
    return move;
  };

  let next = getNextResolve();
  let resolvable = 0;
  for (const [teamId, cells] of Object.entries(frozenView.results)) {
    for (let p = 0; p < cells.length; p++) {
      if (cells[p].status !== 'pending') continue;
      const final = finalView.results[teamId]?.[p];
      if (final && (final.status === 'solved' || final.status === 'failed')) resolvable += 1;
    }
  }

  // Guard against a logic bug turning into an infinite loop.
  let guard = 0;
  const guardLimit = resolvable * 3 + teamCount * 4 + 100;

  // Walk the scoreboard from the last row to the top, exactly like
  // ResolverLogic.resolveEverything(): every row is scrolled to and every team
  // is highlighted, whether or not it currently has a pending submission.
  // (Skipping rows without work makes the view jump from the bottom of the
  // board straight to the top and shows awards far too early.)
  //
  // Rows below `singleStepStartRow` use `ScoreboardTiming`; rows at or above it
  // use `PauseTiming`, which replaces each delay with a pause (and does not
  // add select-problem/deselect delays for teams with nothing to resolve).
  for (let currentRow = teamCount - 1; currentRow >= 0; currentRow--) {
    const wasFast = phase === 'fast';
    if (currentRow <= singleStepStartRow || awardRecipients.has(order[currentRow])) manualStarted = true;
    phase = manualStarted ? 'manual' : 'fast';

    // Scroll before each row: the board moves one row at a time.
    push({ type: 'scroll', row: scrollTopFor(currentRow, options, teamCount),
      ...(wasFast && manualStarted ? { role: 'manual-entry' } : {}) });

    let doneWithRow = false;
    while (!doneWithRow) {
      if (++guard > guardLimit) throw new Error('Resolver failed to converge while building steps');
      const teamId = order[currentRow];
      const team = teamById.get(teamId);
      if (!team) {
        doneWithRow = true;
        break;
      }

      // A rank jump can displace an award winner below its original frozen row.
      // Stop fast forwarding before revealing that winner, even above the configured cutoff.
      if (awardRecipients.has(teamId)) manualStarted = true;
      phase = manualStarted ? 'manual' : 'fast';
      const singleStep = manualStarted;

      // Highlight the team at the current row. The original Resolver selects
      // every team while scrolling up, even the ones with nothing to resolve.
      push({ type: 'selectTeam', teamIds: [teamId], selectType: 'NORMAL' });
      if (singleStep) push(pause('select team'));
      else push(stepDelay('selectTeam'));

      if (!next || next.teamId !== teamId) {
        // Nothing to resolve for this team at this row. In single-step mode
        // PauseTiming ignores the select-problem/deselect timing, so only the
        // team highlight pause remains.
        if (!singleStep) {
          push(stepDelay('selectProblem'));
          push(stepDelay('deselect'));
        }
        doneWithRow = true;
      } else {
        // Resolve pending submissions while the team stays on this row.
        while (next && next.teamId === teamId && rowOf(teamId) === currentRow) {
          const problemIndex = next.problemIndex;

          push({ type: 'selectSubmission', teamId, problemIndex });
          if (singleStep) push(pause('select problem'));
          else push(stepDelay('selectProblem'));

          const oldRow = rowOf(teamId);
          const move = applyResolve(teamId, problemIndex);
          const newRow = rowOf(teamId);
          const resolved = results[teamId][problemIndex];
          const solved = resolved.status === 'solved';

          push({
            type: 'resolve',
            teamId,
            problemIndex,
            status: solved ? 'solved' : 'failed',
            attempts: resolved.attempts,
            penaltyCount: resolved._penaltyCount || 0,
            time: resolved.time == null ? 0 : resolved.time,
            ...(resolved.timeSeconds !== undefined ? { timeSeconds: resolved.timeSeconds } : {}),
            firstToSolve: Boolean(resolved.firstToSolve),
            move,
          });
          const statusKind = solved ? (newRow !== oldRow ? 'solvedMove' : 'solvedStay') : 'failed';
          if (singleStep) push(pause(solved ? 'solved' : 'failed'));
          else push(stepDelay(statusKind));
          // PauseTiming ignores DESELECT; ScoreboardTiming waits 250ms.
          if (!singleStep) push(stepDelay('deselect'));

          next = getNextResolve();
        }

        // The row is complete when the team didn't move and has no more work.
        doneWithRow = rowOf(teamId) === currentRow && (!next || next.teamId !== teamId);
        // If the team moved up, another team slid down into this row: loop
        // again (same row, no extra scroll) and handle that team next.
        if (!doneWithRow) continue;
      }

      // Award / highlight pause at the end of a team's row.
      const teamAwards = awardsByTeam.get(teamId);
      if (teamAwards && teamAwards.length) {
        awardsByTeam.delete(teamId);
        const showDetail = teamAwards.some((award) => award.displayMode === 'detail');
        const hasFts = teamAwards.some((award) => award.awardType === 'first-to-solve');
        const selectType = hasFts ? (showDetail ? 'FTS_HIGHLIGHT' : 'FTS') : 'HIGHLIGHT';
        if (singleStep && steps[steps.length - 1]?.type !== 'pause') push(pause());
        push({ type: 'selectTeam', teamIds: [teamId], selectType });
        push(pause('award highlight'));
        if (showDetail) {
          push({ type: 'presentation', screen: 'teamAward', teamId, awards: teamAwards.map(publicAward) });
          push({ type: 'award', teamId, awards: teamAwards.map(publicAward) });
          push(pause('award'));
          push({ type: 'presentation', screen: 'scoreboard' });
          push(pause('scoreboard'));
        }
      }
      completedTeams.add(teamId);
      for (let i = listAwards.length - 1; i >= 0; i--) {
        const award = listAwards[i];
        const recipients = award.teamIds.filter((id) => teamById.has(id));
        if (!recipients.length || !recipients.every((id) => completedTeams.has(id))) continue;
        listAwards.splice(i, 1);
        push({ type: 'selectTeam', teamIds: recipients, selectType: 'TEAM_LIST' });
        push({ type: 'presentation', screen: 'teamList', awards: [publicAward(award)] });
        push(pause('award list'));
        push({ type: 'presentation', screen: 'scoreboard' });
        push(pause('scoreboard'));
      }
    }
  }

  phase = 'manual';
  // End of resolving: deselect everything.
  push({ type: 'selectTeam', teamIds: [], selectType: 'NORMAL' });
  push(pause('done'));

  if (steps.length > LIMITS.steps) throw inputError('滚榜步骤数量超出上限', 413);
  return { steps, finalOrder: order, resolveStartRow: singleStepStartRow };
}

/**
 * Build only the resolution steps for a contest.
 */
export function buildSteps(contest, options) {
  const opts = normalizeOptions(options);
  const playbackContest = withFreezeOptions(normalizeContest(contest), opts);
  const frozenView = computeCells(playbackContest, { frozen: true });
  const finalView = computeCells(playbackContest, { frozen: false });
  frozenView.contest.awards = configuredAwards(frozenView.contest, opts, finalView.standings);
  return buildStepsInternal(frozenView.contest, opts, frozenView, finalView).steps;
}

/**
 * Build a complete game object (docs/CONTRACT.md).
 *
 * @param {object} contest parsed contest, e.g. from parseEventFeed/createDemo
 * @param {object} [options] game options
 * @param {{id?: string}} [meta] optional id (server-issued game id)
 */
export function buildGame(contest, options, meta = {}) {
  const opts = normalizeOptions(options);
  const playbackContest = withFreezeOptions(normalizeContest(contest), opts);
  const frozenView = computeCells(playbackContest, { frozen: true });
  const finalView = computeCells(playbackContest, { frozen: false });
  const c = frozenView.contest;
  c.awards = configuredAwards(c, opts, finalView.standings);

  const { steps, resolveStartRow } = buildStepsInternal(c, opts, frozenView, finalView);

  const id = meta && typeof meta === 'object' ? meta.id : undefined;
  const game = {
    ...(id ? { id: String(id) } : {}),
    contest: publicContest(c),
    options: opts,
    initialState: {
      frozen: c.freezeDurationMs > 0,
      contestTimeMs: c.freezeDurationMs > 0 ? frozenView.freezeTimeMs : c.durationMs,
      order: frozenView.order.slice(),
      results: publicResults(frozenView.results),
    },
    steps,
    meta: {
      resolveStartRow, fastForwardSpeed: 4, introScrollMs: 650,
      pendingCount: frozenView.pendingCount,
      totalSubmissions: frozenView.totalSubmissions,
      stepCount: steps.length,
      teamCount: c.teams.length,
      problemCount: c.problems.length,
    },
  };

  jsonBytes(game, LIMITS.gameBytes, '滚榜会话');
  return game;
}

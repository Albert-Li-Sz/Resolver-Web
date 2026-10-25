# Resolver Web — internal contract

This file is the integration contract between the three workstreams. Do not change
field names without telling the Lead.

## Project layout / write ownership

| Path | Owner |
| --- | --- |
| `server/lib/engine.js`, `server/lib/demo.js`, `tests/engine.test.js` | engine |
| `public/js/render/**`, `public/render-test.html` | renderer |
| `public/index.html`, `public/config.css`, `public/js/config.js` | config-ui |
| `server/index.js`, `server/lib/store.js`, `public/play.html`, `public/play.js`, `public/play.css` | Lead |

## HTTP API (served by Lead)

- `GET /api/demo` → `{ contest, options, name }` (contest from engine demo).
- `POST /api/parse` raw `application/x-ndjson` / `text/plain` (38 MB), or the legacy
  JSON `{ text }` body (16 MB), → `{ contest, stats }`. Accepts JSON Lines or an array.
  Invalid JSON messages include a line number but never echo the submitted body.
- `POST /api/game` `{ contest, options }` → `{ id, game }`. Builds all resolution
  steps and stores the game in memory. The response also includes a random `controlToken`.
- `GET /api/game/:id` → `{ ...game, playback }`. Requires the `X-Resolver-Control` header.
- `GET /api/game/:id/playback` → `{ playback }`, with the same control header; the
  presenter polls every two seconds to keep the session active and synchronize other windows.
- `PUT /api/game/:id/playback` `{ index, revision }` → `{ playback }`. Requires the control header;
  invalid action indices return 400 and stale revisions return 409 with authoritative playback.
- `GET /api/watch/:id` → `{ game, playback }`. Public game has no future steps or contest awards.
- `GET /api/watch/:id/events` → SSE: initial/reconnect `snapshot`, sequential `advance`,
  rewind/jump `snapshot`, eviction `expired`. An advance contains only `{ steps, playback }`.
  `playback` is `{ index, revision, currentAction, totalActions }` (index is a raw step index).
  Preview frames use the control token to load their game but do not publish playback changes.
- `POST /api/awards` `{ contest, options }` → `{ awards }` for an organizer's final award preview.
- `POST /api/assets` raw PNG/JPEG/WebP (up to 4 MB after browser resizing) → `{ url }`.
  Images persist under `data/images/`; `/media/<sha256>.<ext>` serves immutable assets.
- `GET /api/media-library` → `{ items }` with persisted pre-contest media rules.
- `POST /api/media-library` `{ kind, matchBy, key, url }` upserts a rule.
  `kind` is organization-logo / team-logo / team-photo; `matchBy` is id / name.
  URLs are hashed `/media/` assets uploaded through `/api/assets`.
- `DELETE /api/media-library/:id` removes a matching rule, retaining its image.
- `GET /api/configs` → `[{ id, name, updatedAt, config, hasContest }]`
- `POST /api/configs` `{ id?, name, config, contest? }` → saved record. New IDs are
  server-issued; a supplied ID must identify an existing preset. `config` is the
  options object; `contest` may be included so a saved config is self-contained.
- `DELETE /api/configs/:id`

Management APIs and configuration pages accept Basic authentication (`admin` /
`RESOLVER_ADMIN_KEY`) or `X-Resolver-Admin`. With no key, only loopback socket
connections are accepted; a public reverse proxy must configure the key. The
public viewer endpoints and presenter control tokens are separate capabilities.
All JSON APIs are `no-store`; generic errors never include raw exception details.

Remote feeds allow public HTTP(S) 80/443 by default, validate every redirect and
pin the checked DNS answer to the actual socket. Exact administrator-configured
`RESOLVER_FEED_ORIGINS` may allow local CDS origins including 8080/8443.
One 25-second deadline covers DNS, redirects and the decompressed response body.

## `game` object (engine output, consumed by renderer + player)

```ts
type Game = {
  id?: string;
  contest: {
    name: string;
    contestId?: string|null;
    freezeSource: 'feed'|'history'|'custom'|'none';
    scoringMode: 'icpc'|'hydro'; // detected from the imported feed
    formalName?: string;
    startTime?: string;
    durationMs: number;
    freezeDurationMs: number;
    penaltyMinutes: number;
    logo?: string | null;             // URL or data: URI
    problems: { id, label, name?, rgb? }[];
    organizations: { id, name, formalName?, country?, logo?: string|null,
                     logoOverride?: boolean }[];
    teams: {
      id, name, displayName, organizationId, unrank?: boolean, logoOverride?: boolean,
      organizationName?, formalName?, country?,
      logo?: string|null, photo?: string|null
    }[];
    awards: { id, citation, teamIds: string[], displayMode?, awardType? }[];
  };
  // `logoOverride` is set by the config center when the user uploads an
  // organization logo. While true the renderer uses the organization logo for
  // every team of that organization (scoreboard rows, award pages, team list);
  // otherwise the feed's team logo wins on the scoreboard.
  options: {
    rowsPerScreen: number;           // default 12
    speedFactor: number;             // default 1
    rowOffset: number;               // default 0
    singleStepStartRow: number|null; // zero-based rank row; null = engine default (last bronze row)
    autoplay: boolean;               // default true
    pauseMs: number;                 // default 1100
    showLegend: boolean;             // default false
    showAwards: boolean;             // default false
    title: string|null;              // default null (Resolver has no title)
    startScreen: 'splash'|'scoreboard';
    freezeMode: 'feed'|'custom';
    freezeMinutes: number; // manual mode: >0, no greater than contest duration
    medalMode: 'imported'|'custom';
    goldCount: number; silverCount: number; bronzeCount: number;
    goldCitation: string; silverCitation: string; bronzeCitation: string;
    medalSameScore: boolean; // cumulative cutoffs, equal solved/time gets the higher tier
  };
  initialState: {
    frozen: boolean;
    contestTimeMs: number;           // time of the frozen scoreboard
    order: string[];                 // team ids in rank order
    results: Record<string, Cell[]>; // keyed by team id; Cell[] aligned to problems
  };
  steps: Step[];
  meta: {
    pendingCount: number;
    totalSubmissions: number;
    stepCount: number;
    teamCount: number;
    problemCount: number;
  };
};

type Cell = {
  status: 'unattempted'|'pending'|'solved'|'failed';
  attempts: number;      // submissions for this team/problem
  time: number|null;     // minutes; first-solve time for solved, last submission time otherwise
  pending: number;       // number of pending submissions (frozen state)
  firstToSolve: boolean;
  timeSeconds?: number|null; // Hydro exact time, preserved in resolve steps too
  penaltyCount: number; // actual penalized failures before AC; never inferred from total attempts
};

type Step =
  | { type: 'presentation'; screen: 'splash'|'scoreboard'|'teamAward'|'teamList';
      teamId?: string; awards?: any[] }
  | { type: 'pause'; label?: string }
  | { type: 'delay'; ms: number; kind?: string }
  | { type: 'selectTeam'; teamIds: string[]; selectType: 'NORMAL'|'HIGHLIGHT'|'FTS'|'FTS_HIGHLIGHT'|'TEAM_LIST' }
  | { type: 'selectSubmission'; teamId: string; problemIndex: number }
  | { type: 'scroll'; row: number }
  | {
      type: 'resolve';
      teamId: string; problemIndex: number;
      status: 'solved'|'failed';
      attempts: number; time: number; firstToSolve: boolean; penaltyCount: number;
      move: { from: number; to: number }; // remove team at from, insert at to
      order?: string[];                // accepted by renderer for older games
    }
  | { type: 'award'; teamId: string; awards: any[] }
  | { type: 'message'; text: string };
```

`delay.ms` is already scaled by `speedFactor`? **No.** Engine emits the base
milliseconds from the ICPC Resolver (`DELAY_TIMES`), player multiplies by
`options.speedFactor`. Standard values (ms):
`selectTeam 1300, selectProblem 1000, solvedMove 2250, solvedStay 1500,
failed 850, deselect 250, selectSubmission 450`.

`initialState` must be the frozen scoreboard. Judged non-penalty failures are visible;
other submissions at or after the strict freeze boundary are pending for all feed sources.
`resolve` updates the mutable client state, including `penaltyCount`. Engine and renderer use
the shared `public/js/standings.js` for total time and LIVE tie-breaking (including last solve time for ICPC; Hydro uses exact seconds and no last-solve tie-breaker).
Unranked teams are shown with rank 0 (rendered as *), excluded from medal quotas and
skipped entirely for first-to-solve (including pending blockers). `move` is authoritative;
unchanged rows carry equal `from`/`to`, avoiding full order arrays for every reveal.
Equal-score ordering uses fixed English collation and team ID as the final tie-breaker.

Award presentations carry the currently revealed award data so spectators with no
future contest awards can render the correct team/citation immediately. List awards
are shown only once all recipients have completed their resolution rows.

`scroll.row` is the zero-based rank row that should become the **top visible
row**. The engine emits one `scroll` step per rank row while resolving (last
place upward), plus the two intro scrolls, so the view moves one row at a time
and never jumps from the bottom of the board to the top.

`singleStepStartRow` is zero-based. `null` means the engine default, mirroring
`ResolverLogic`: single-stepping starts at the last bronze medal row
(`AwardUtil.getLastBronze() - 1`, defaulting to the 12th place when there is no
bronze award). Rows at or above that row use `PauseTiming` — pauses instead of
delays, exactly like the Resolver — while rows below it use the standard
`ScoreboardTiming` delays. The manual web player ignores both timings, so this
option only affects the engine step stream and older automated clients.

The scoreboard must reproduce `reference/icpctools/Resolver/docs/resolverScreenShot2.png`.
The renderer owns that.

## Renderer API (`public/js/render/resolver-view.js`)

```js
export class ResolverView {
  // canvas is 1920x1080 logical pixels (set width/height internally)
  constructor(canvas, game);
  applyStep(step, { instant = false } = {});
  update(dtMs);
  render(nowMs);
  resize();                 // only handles backing store / CSS scaling
  reset(gameState);         // reuses the same renderer and image cache for rewind/reconnect
  seek(steps, index);       // bounded checkpoints and one scoring pass per seek
  finishReplay();           // flushes deferred scoring/animation state
}
```

`applyStep` must handle all step types. `instant` skips animations (used for
rewind/preview). Renderer can rely on `game.initialState`, `game.contest`,
`game.options`.

## Demo data

`server/lib/demo.js` exports `createDemo()` → `{ contest, options, name }`.
It must have at least 16 teams, 13 problems, frozen + pending submissions, team
logos (inline SVG data URIs are fine), and awards for the top 3 (medals) so the
resolver has something to pause on.

## Visual constants measured from the reference screenshot (1920x1080)

- header height **40px** (white 1px line at y=39); row height **86.667px**;
  12 rows; content starts at y=40.
- alternating row backgrounds: `#3c3c3c` even, `#000` odd. Selected row:
  `rgba(92,138,231,240)`; FTS green; team-list teal.
- rank/name area: first problem cube starts at x≈**181**; cube width **120**;
  gap **6**; cube height **29**; cube top inside row ≈ y=53.
- row font ≈ **40px** bold, header font ≈ **23px** bold, status/cube font ≈
  **22px**, unattempted label ≈ **16px**.
- header labels: Rank, Name, Solved, Time (Solved/Time right aligned).
- rounded-rect radius 7, colors from ICPCColors: solved `#00e600`, pending
  `#1E90FF`, failed `#f00000`, first-to-solve `#006400` (text white; empty cube
  `#282828` with `#c4c4c4` label). The splash `ICPC Resolver` pill keeps the
  brand yellow via `SPLASH_PILL`.
- font: `public/assets/font/Helvetica-Plain.ttf` (`@font-face` as
  `"Helvetica Plain"`), synthetic bold. Java sizes are px (72 dpi).

## Uploaded media and custom medals

Organizer-uploaded organization logos set `logoOverride: true`. Uploaded team photos
set `teams[].photo` to a `/media/` URL. Both survive normalization and session creation;
remote viewers use the same server URLs. The browser stores references rather than large
image data strings. Image files remain available to saved presets after references are removed.

`configuredAwards` operates on final standings, never the frozen board. Custom mode replaces
medals but retains other award types; imported mode preserves all original awards. Ties for
award allocation compare solved count and penalty time, independently of last-solve ranking
rules. Expanding a tie group does not shift subsequent cumulative cutoffs. Preview and game
construction use the same function; the spectator endpoint still omits future awards.

## Refreezing complete feeds and pre-contest media

The parser retains the latest positive historical freeze duration and timestamp even when
subsequent metadata clears it during thaw. `freezeSource: history` identifies recovered
settings. Manual freeze options override the duration on a copied contest; final judgements
are retained and final scores/order do not change. Missing or invalid submission times
remain null and prevent ranking/game construction even without a freeze. Timestamp parsing
accepts Z / +HH / +HHMM / +HH:MM and fractional seconds, rejecting invalid calendar dates.

Media rules live in `data/media-library.json` independently of a contest. Exact ID rules
precede unique-name rules; ambiguous names are not guessed. The import report retains the
unmatched/ambiguous list in browser state. Team logo overrides take precedence over
organization overrides in the scoreboard; award pages use the organization logo and team photo.

Manual raw contest media fields carry logoSource/photoSource metadata for reimport.
Same-contest identity uses contestId where available, otherwise name plus startTime.
Manual overrides survive a new feed of that contest and do not leak to unrelated contests.
Generated games only need public media URLs and override booleans; source bookkeeping
remains in the editable raw contest and saved presets.

# AI-SDLC local runner

Turns a Linear ticket into a 6-stage AI-SDLC pipeline (`01 intent` → `02 spec` →
`03 build` → `04 test` → `05 deploy` → `06 maintain`). Every stage is a headless
`claude -p` session, so each one leaves a transcript under
`~/.claude/projects/<slug>/<session-id>.jsonl` for debugging. The runner also
serves a live **pipeline dashboard** (`GET /`) so a human — or a demo audience —
can see which ticket is running, which stage is active, which approval gate is
waiting on which role, and what got approved or rejected, at a glance. `06
maintain` closes the loop: if tests or deploy fail, it opens a new Linear ticket
(labeled `sdlc-auto`) with a failure summary and a link back to the original
ticket, which re-triggers `01 intent`; the dashboard draws that as a "↺" arrow
back to the new run's card.

No GitHub Actions involved — this is a local Node daemon.

## Install

```bash
cd AI_SDLC/runner
npm install
```

## Configure

Non-secret settings live in `sdlc.config.json` (already checked in with
placeholder values — edit `linearTeamId`, `repoPath`, etc.). **Secrets only
ever come from environment variables, never from the config file:**

| Env var | Required for | Notes |
| --- | --- | --- |
| `LINEAR_WEBHOOK_SECRET` | `ticketSource: "linear"` | From the Linear webhook settings page. |
| `LINEAR_API_KEY` | `ticketSource: "linear"` | Personal API key, sent as-is in the `Authorization` header. |
| `JIRA_API_TOKEN` / `JIRA_WEBHOOK_SECRET` | `ticketSource: "jira"` | Jira adapter is a stub — see `src/adapters/jira.ts`. |
| `PORT` | optional | Overrides `sdlc.config.json`'s `port`. |
| `SDLC_CONFIG_PATH` | optional | Point at a different config file. |

The server refuses to start (with a clear message) if a required value is
missing.

## Run

```bash
npm start
```

Prints the webhook URL, the `~/.claude/projects/...` directory to watch, and
the dashboard URL (`http://localhost:<port>/`).

## Wire up a Linear webhook locally

Linear needs a public URL, so tunnel the runner's port (default `3939`):

```bash
ssh -R 80:localhost:3939 serveo.net   # or: ngrok http 3939 / cloudflared tunnel --url http://localhost:3939
```

In Linear: Settings → API → Webhooks → add `<tunnel-url>/webhook/linear`,
subscribe to Issue events, and copy the signing secret into
`LINEAR_WEBHOOK_SECRET`.

## Pipeline dashboard

Each stage's `claude -p` session is logged to `AI_SDLC/runner/.state/<key>.json`
along with its transcript path (`sessionJsonlPath`), and every run also keeps a
`.state/<key>.meta.json` (ticket, labels, depth, gate roles) and a live
`.state/<key>.live.json` snapshot (`{ stage, phase, role?, gateUrl?, since }`)
that the dashboard polls.

The runner's HTTP server exposes:

- `GET /` — the dashboard page (inline HTML/CSS/JS, no build step, polls
  `/api/runs` every 2 seconds).
- `GET /api/runs` — the JSON the page renders: an array of runs, newest first,
  each with its 7-column stage flow (`00 Setup` … `06 Maintain`), gate verdicts,
  and any follow-up ticket 06 Maintain opened.

Open it while `npm start` is running: `http://localhost:3939/` (or whatever
`port` is set to in `sdlc.config.json`).

### Preview without Linear

`scripts/seed-demo-state.ts` writes two realistic fixture runs into a target
`.state` directory — no Linear webhook or API key required:

- `ENG-42` — a human ticket where 01–05 are all approved (04 Test's e2e check
  actually failed; the Code Owner approved shipping anyway), and 06 Maintain's
  3σ detection opened the follow-up `ENG-49`.
- `ENG-49` — the auto ticket `ENG-42`'s 06 Maintain created (`sdlc-auto`,
  depth 1), currently waiting at the 01 Plan gate for the Product Owner.

```bash
npm run seed:demo       # writes fixtures into .state-demo/
npm run dashboard:serve # serves only GET / and GET /api/runs against .state-demo/
# or both in one shot:
npm run dashboard:demo
```

Then open `http://localhost:3939/`. `dashboard-server.ts` takes any state dir
and port directly too: `node --experimental-strip-types src/dashboard-server.ts
--state <dir> --port <port>`.

## Test

```bash
npx tsc --noEmit
npm test
```

`npm test` runs `node --test` (via `node --experimental-strip-types`, no test
framework dependency) against `test/*.test.ts`. It covers: Linear webhook
signature verification (accepts valid, rejects invalid/tampered/missing),
`parse()` returning `null` for events we don't care about, the `sdlc-auto`
loop-depth guard, and the dashboard's pure aggregation (`src/dashboard.ts`)
against fixture `.state` files — including missing/corrupt companion files and
the `GET /` / `GET /api/runs` routes.

## Ticket source adapters

`src/adapters/types.ts` defines the only interface the rest of the runner
depends on (`TicketSource`). `src/adapters/linear.ts` is the real
implementation; `src/adapters/jira.ts` is a stub with the same shape — each
method documents exactly which Jira REST call goes where. Swapping sources is
a one-line change in `sdlc.config.json` (`"ticketSource": "jira"`) plus
implementing the stub.

## e2e review

Default driver is `ego-lite`. Readiness check:

```bash
printf 'cliLog("ok")\n' | ego-browser nodejs 2>&1
```

`"ok"` means it's ready; `"Please complete the onboarding process first"`
means it isn't. `cliLog` output goes to **stderr**, so `src/e2e.ts` always
merges stdout+stderr when reading the CLI's output.

`aside` is defined in config as an alternate driver but not implemented:
`aside repl` requires a TTY, which a headless pipeline stage doesn't have.

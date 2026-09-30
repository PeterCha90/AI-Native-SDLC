# AI-SDLC local runner

Turns a Linear ticket into a 6-stage AI-SDLC pipeline (`01 intent` → `02 spec` →
`03 build` → `04 test` → `05 deploy` → `06 maintain`). Every stage is a headless
`claude -p` session, so each one leaves a transcript under
`~/.claude/projects/<slug>/<session-id>.jsonl` for debugging. Progress is
visible in two places: the **Linear gate sub-issues** under the original
ticket (one per stage, moved to Done/Canceled to approve/reject), and — if the
Slack bot is on — the ticket's **Slack thread**, which posts stage-progress
lines and gate buttons in real time. `06 maintain` closes the loop: if tests or
deploy fail, it opens a new Linear ticket (labeled `sdlc-auto`) with a failure
summary and a link back to the original ticket, which re-triggers `01 intent`.

Two loops sit on top of the base pipeline (see `AI_SDLC/README.md#3-c-slack으로-쓰기`
for the Slack-facing walkthrough):

- **01 Plan interview.** If `01 intent`'s draft leaves a `## 미해결 질문` section
  with open questions (parsed deterministically, no model involved), the
  runner asks the requester in the Slack thread instead of opening the
  `01-plan` gate right away. Thread replies get collected; `[답변 반영]` feeds
  them back into the same `claude -p --resume` session to revise `intent.md`,
  `[이대로 진행]` proceeds with whatever is still unanswered. Capped at
  `interviewMaxRounds` (default 5) rounds; with Slack off or in webhook mode,
  it's skipped entirely.
- **Rejection rework (01/02/03 gates only).** Rejecting `01-plan`, `02-design`,
  or `03-build` (with a reason, from the Slack modal or a Linear comment) no
  longer stops the pipeline — the runner resumes that stage's session with
  the rejection reason and re-runs it, up to `reworkMaxAttempts` (default 3)
  times per gate, then reopens the gate. `04-test`/`05-deploy`/`06-maintain`
  rejections still stop the pipeline as before.

No GitHub Actions involved — this is a local Node daemon. No public URL is
required either: Slack connects over Socket Mode and Linear is polled (or, if
you keep the webhook wired up, pushed to `POST /webhook/linear`).

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
| `LINEAR_WEBHOOK_SECRET` | `ticketSource: "linear"` and `linearTrigger: "webhook"` | From the Linear webhook settings page. Not needed when `linearTrigger` is `"poll"` (the default once Slack is on). |
| `LINEAR_API_KEY` | `ticketSource: "linear"` | Personal API key, sent as-is in the `Authorization` header. |
| `JIRA_API_TOKEN` / `JIRA_WEBHOOK_SECRET` | `ticketSource: "jira"` | Jira adapter is a stub — see `src/adapters/jira.ts`. |
| `SLACK_BOT_TOKEN` | Slack bot | `xoxb-…`, issued after Install to Workspace. |
| `SLACK_APP_TOKEN` | Slack bot | `xapp-…` with the `connections:write` scope, for Socket Mode. |
| `PORT` | optional | Overrides `sdlc.config.json`'s `port`. |
| `SDLC_CONFIG_PATH` | optional | Point at a different config file. |

The server refuses to start (with a clear message) if a required value is
missing. Slack is optional: if either `SLACK_BOT_TOKEN` or `SLACK_APP_TOKEN`
is missing, the Slack bot stays off and the runner behaves exactly as before
(webhook-only, no thread notifications).

`sdlc.config.json` also takes:

| Key | Default | Notes |
| --- | --- | --- |
| `linearTrigger` | `"poll"` if Slack is on, else `"webhook"` | `"poll"` calls `listRecentIssues` every `linearPollIntervalMs`; `"webhook"` keeps the existing `POST /webhook/linear` flow. |
| `linearPollIntervalMs` | `30000` | Only used when `linearTrigger` is `"poll"`. |
| `slack.channelId` | — | The Slack channel (`C…`) the bot posts to. |
| `slack.startMode` | `"button"` | `"button"` waits for a human to press ▶ Start; `"auto"` starts as soon as the notification posts. |
| `slack.roleGroups` | `{}` | Maps a gate role name (e.g. `"Product Owner"`) to a Slack user group ID (`S…`). Unmapped roles can be approved by anyone in the channel. |
| `interviewMaxRounds` | `5` | Max round-trips in the 01 Plan interview loop before it behaves like `[이대로 진행]`. |
| `reworkMaxAttempts` | `3` | Max times a rejected `01-plan`/`02-design`/`03-build` gate re-runs its stage before the pipeline stops. |

## Run

```bash
npm start
```

Prints the webhook URL (if `linearTrigger` is `"webhook"`), the
`~/.claude/projects/...` directory to watch, and — when Slack is on — the
Slack connection status, channel, role mapping, and poll interval.

## Wire up a Linear webhook locally

Only needed when `linearTrigger` is `"webhook"` (the default when Slack is
off). Linear needs a public URL, so tunnel the runner's port (default `3939`):

```bash
ssh -R 80:localhost:3939 serveo.net   # or: ngrok http 3939 / cloudflared tunnel --url http://localhost:3939
```

In Linear: Settings → API → Webhooks → add `<tunnel-url>/webhook/linear`,
subscribe to Issue events, and copy the signing secret into
`LINEAR_WEBHOOK_SECRET`. With Slack on and `linearTrigger: "poll"` (the
default), no tunnel or webhook is needed — the runner polls Linear directly.

## Slack bot

See [`AI_SDLC/README.md`](../README.md#3-c-slack으로-쓰기) for the full setup
walkthrough (create the app from `slack/manifest.yaml`, install it, collect
the two tokens, invite it to a channel, find user group IDs). In short:

- `slack/manifest.yaml` is the app manifest a team pastes into
  **api.slack.com/apps → Create New App → From a manifest**. It declares the
  `/sdlc` slash command, Socket Mode, interactivity, the bot scopes
  (`chat:write`, `commands`, `usergroups:read`, `users:read`, plus
  `channels:history`, `groups:history`, `users:read.email` for the interview
  loop), and the `message.channels`/`message.groups` event subscriptions used
  to collect thread replies. Existing installs must re-paste the manifest and
  reinstall the app for the new scopes to take effect.
- `src/events.ts` defines `PipelineEvents`, the interface `runPipeline` calls
  into at each stage transition (`runStarted`, `stageStarted`,
  `stageFinished`, `gateWaiting`, `gateResolved`, `followupCreated`,
  `runFinished`) — a no-op implementation is used when Slack is off.
- `src/slack/notifier.ts` implements `PipelineEvents` against the Slack Web
  API; `src/slack/app.ts` is the Bolt (Socket Mode) app that registers the
  `/sdlc` command and the approve/reject button + modal handlers;
  `src/slack/roles.ts` checks a button-presser against the mapped user group
  before letting them move a gate card.
- The source of truth for an approval is still the Linear gate card — a
  Slack button just moves it. Moving the card directly in Linear resolves the
  gate exactly the same way and updates the Slack message to match.

## Progress: state files, not a served page

Each stage's `claude -p` session is logged to `AI_SDLC/runner/.state/<key>.json`
along with its transcript path (`sessionJsonlPath`), and every run also keeps a
`.state/<key>.meta.json` (ticket, labels, depth, gate roles) and a live
`.state/<key>.live.json` snapshot (`{ stage, phase, role?, gateUrl?, since }`).
These are read by `/sdlc-status` and by the Slack notifier. The HTTP server
only exposes `GET /health` and `POST /webhook/<source>` — progress is the
Linear gate sub-issues plus (if Slack is on) the ticket's Slack thread.

## Test

```bash
npx tsc --noEmit
npm test
```

`npm test` runs `node --test` (via `node --experimental-strip-types`, no test
framework dependency) against `test/*.test.ts`. It covers: Linear webhook
signature verification (accepts valid, rejects invalid/tampered/missing),
`parse()` returning `null` for events we don't care about, the `sdlc-auto`
loop-depth guard, `PipelineEvents` call ordering (`events.test.ts`), Slack
Block Kit message shapes (`slack-blocks.test.ts`), role-group mapping and
membership caching (`slack-roles.test.ts`), the ticket-key ↔ thread-`ts`
mapping (`slack-threads.test.ts`), and the Linear poll watcher's first-run
backlog skip, cursor advance, and dedup (`linear-watcher.test.ts`). All of it
runs without real Slack or Linear calls.

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

# AI-SDLC local runner

Turns a Linear ticket into a 6-stage AI-SDLC pipeline (`01 intent` → `02 spec` →
`03 build` → `04 test` → `05 deploy` → `06 maintain`). Every stage is a headless
`claude -p` session, so each one leaves a transcript under
`~/.claude/projects/<slug>/<session-id>.jsonl` that [zoetrope](https://zoetrope.furkankly.dev/)
(`zoe`) can render live. `06 maintain` closes the loop: if tests or deploy fail,
it opens a new Linear ticket (labeled `sdlc-auto`) with a failure summary and a
link back to the original ticket, which re-triggers `01 intent`.

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
a `zoe` command to follow the live session.

## Wire up a Linear webhook locally

Linear needs a public URL, so tunnel the runner's port (default `3939`):

```bash
ssh -R 80:localhost:3939 serveo.net   # or: ngrok http 3939 / cloudflared tunnel --url http://localhost:3939
```

In Linear: Settings → API → Webhooks → add `<tunnel-url>/webhook/linear`,
subscribe to Issue events, and copy the signing secret into
`LINEAR_WEBHOOK_SECRET`.

## Watch a pipeline run with zoetrope

Each stage's `claude -p` session is logged to `AI_SDLC/runner/.state/<key>.json`
along with its transcript path. Follow the currently running stage:

```bash
zoe <path-from-.state-or-startup-log>.jsonl --follow
```

or inspect a finished one headlessly: `zoe inspect <file>.jsonl`.

## Test

```bash
npx tsc --noEmit
npm test
```

`npm test` runs `node --test` (via `node --experimental-strip-types`, no test
framework dependency) against `test/*.test.ts`. It covers: Linear webhook
signature verification (accepts valid, rejects invalid/tampered/missing),
`parse()` returning `null` for events we don't care about, and the
`sdlc-auto` loop-depth guard.

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

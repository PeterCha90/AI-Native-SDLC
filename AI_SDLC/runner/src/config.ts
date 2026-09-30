import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { StageId } from "./gate.ts";
import { bundledPluginDir, defaultHome, packageRoot, repoLayout } from "./paths.ts";
import type { Credentials } from "./user-config.ts";

export type TicketSourceKind = "linear" | "jira";
export type E2EDriverKind = "ego-lite" | "aside";

/**
 * Who approves each stage. Straight out of the playbook: the product owner owns
 * intent and spec, the engineer accepts the plan, the code owner signs off the
 * tested diff, a named release manager holds the production gate, and the service
 * owner triages what maintenance finds.
 */
export const DEFAULT_GATE_ROLES: Record<StageId, string> = {
  "01-plan": "Product Owner",
  "02-design": "Product Owner",
  "03-build": "Engineer",
  "04-test": "Code Owner",
  "05-deploy": "Release Manager",
  "06-maintain": "Service Owner",
};

export type LinearTriggerKind = "poll" | "webhook";

export interface FileConfig {
  ticketSource?: TicketSourceKind;
  repoPath?: string;
  port?: number;
  e2eDriver?: E2EDriverKind;
  demoAppUrl?: string;
  useWorktree?: boolean;
  linearTeamId?: string;
  jiraBaseUrl?: string;
  jiraEmail?: string;
  jiraProjectKey?: string;
  autoTicketLabel?: string;
  maxAutoTicketDepth?: number;
  gateRoles?: Partial<Record<StageId, string>>;
  gatePollIntervalMs?: number;
  gateTimeoutMs?: number;
  detectScript?: string;
  detectMetric?: string;
  /** How new tickets are discovered. Defaults to "poll" when Slack is on, "webhook" otherwise. */
  linearTrigger?: LinearTriggerKind;
  /** How often LinearWatcher polls for new tickets when linearTrigger is "poll". Default 30000. */
  linearPollIntervalMs?: number;
  /** Max 01 Plan interview rounds before falling back to "proceed" with any remaining questions unresolved. Default 5. */
  interviewMaxRounds?: number;
  /** Max rework attempts per gate (01/02/03) after a rejection before the pipeline stops. Default 3. */
  reworkMaxAttempts?: number;
  slack?: {
    channelId: string;
    startMode?: "button" | "auto";
    roleGroups?: Record<string, string>;
  };
}

export interface Config {
  ticketSource: TicketSourceKind;
  repoPath: string;
  /**
   * Parent of `.state/` and `.worktrees/`. Dev path (running from the runner's own checkout,
   * `sdlc.config.json` found via `SDLC_CONFIG_PATH` or the package default): the runner package
   * root. User path (`npx ai-sdlc-runner`, §4 of the design): `repoLayout(home, repo).dir`, i.e.
   * `<home>/repos/<repoKey>/`.
   */
  baseDir: string;
  /** Absolute path to the plugin bundled with the package — see `bundledPluginDir()` in paths.ts. */
  pluginDir: string;
  port: number;
  e2eDriver: E2EDriverKind;
  demoAppUrl: string;
  useWorktree: boolean;
  autoTicketLabel: string;
  maxAutoTicketDepth: number;
  gateRoles: Record<StageId, string>;
  gatePollIntervalMs: number;
  gateTimeoutMs: number;
  /** Repo-relative path to the deterministic 06 Maintain detection script. */
  detectScript: string;
  /** Metric name inside bands.yaml that 06 Maintain evaluates after a run. */
  detectMetric: string;
  /** SDLC_AUTO_APPROVE=1 — rehearsal only. Skips every human gate and says so in the log. */
  autoApprove: boolean;
  linear: { webhookSecret: string; apiKey: string; teamId: string };
  jira: { baseUrl: string; email: string; apiToken: string; projectKey: string; webhookSecret: string };
  linearTrigger: LinearTriggerKind;
  linearPollIntervalMs: number;
  /** Max 01 Plan interview rounds before falling back to "proceed" with any remaining questions unresolved. */
  interviewMaxRounds: number;
  /** Max rework attempts per gate (01/02/03) after a rejection before the pipeline stops. */
  reworkMaxAttempts: number;
  /**
   * Non-null only when both SLACK_BOT_TOKEN and SLACK_APP_TOKEN are set AND
   * sdlc.config.json has slack.channelId — all three are required to turn Slack on.
   */
  slack: null | {
    botToken: string;
    appToken: string;
    channelId: string;
    startMode: "button" | "auto";
    roleGroups: Record<string, string>;
  };
}

function loadFileConfig(configPath: string): FileConfig {
  if (!existsSync(configPath)) return {};
  try {
    return JSON.parse(readFileSync(configPath, "utf8"));
  } catch (err) {
    throw new Error(`failed to parse ${configPath}: ${(err as Error).message}`);
  }
}

function fail(message: string): never {
  console.error(`[config] ${message}`);
  process.exit(1);
}

export interface LoadConfigOptions {
  env?: NodeJS.ProcessEnv;
  /** Target repo (user path only — see below). Defaults to `process.cwd()`. */
  repo?: string;
  /** `~/.ai-sdlc`-style home (user path only). Defaults to `defaultHome(env)`. */
  home?: string;
  /** Secrets read from `credentials.json` (user path). Env vars still win over these — see below. */
  credentials?: Credentials;
  /** Settings read from `config.json` (user path) — same shape as `sdlc.config.json`. */
  fileConfig?: FileConfig;
}

const OPTIONS_KEYS = ["env", "repo", "home", "credentials", "fileConfig"] as const;

/**
 * `loadConfig` has always taken a single `NodeJS.ProcessEnv`-shaped object — every existing
 * caller (and 180 tests) does `loadConfig(process.env)` or `loadConfig({ SOME_VAR: "x" })`.
 * The new `LoadConfigOptions` shape is distinguished structurally: a real env object's keys are
 * env var names, which never collide with the five fixed `LoadConfigOptions` keys.
 */
function normalizeOptions(opts?: LoadConfigOptions | NodeJS.ProcessEnv): LoadConfigOptions {
  if (!opts) return {};
  if (OPTIONS_KEYS.some((key) => key in opts)) return opts as LoadConfigOptions;
  return { env: opts as NodeJS.ProcessEnv };
}

/**
 * Loads settings + secrets for one of two layouts (design §4):
 *
 * - **Dev path** (today's `AI_SDLC/runner` checkout): `SDLC_CONFIG_PATH` env var if set, else the
 *   package's own `sdlc.config.json`. `baseDir` is the runner package root either way — `.state`/
 *   `.worktrees` live where they always have.
 * - **User path** (`npx ai-sdlc-runner`): only entered when `SDLC_CONFIG_PATH` is unset AND
 *   `opts.fileConfig` is given. `baseDir` is `repoLayout(home, repo).dir` and `repoPath` is `repo`
 *   itself (not resolved against the package root).
 *
 * Secrets: an env var always wins; otherwise `opts.credentials` (read from `credentials.json` by
 * the caller) supplies it. `SLACK_BOT_TOKEN`/`SLACK_APP_TOKEN`/`LINEAR_API_KEY`/
 * `LINEAR_WEBHOOK_SECRET` map to `slackBotToken`/`slackAppToken`/`linearApiKey`/`linearWebhookSecret`.
 *
 * Exits the process with a clear message if a required value is missing either way.
 */
export function loadConfig(opts?: LoadConfigOptions | NodeJS.ProcessEnv): Config {
  const o = normalizeOptions(opts);
  const env = o.env ?? process.env;
  const pluginDir = bundledPluginDir();

  const devConfigPath: string | null =
    env.SDLC_CONFIG_PATH ?? (o.fileConfig ? null : resolve(packageRoot(), "sdlc.config.json"));

  let baseDir: string;
  let file: FileConfig;
  let repoPath: string;

  if (devConfigPath !== null) {
    file = loadFileConfig(devConfigPath);
    baseDir = packageRoot();
    repoPath = resolve(baseDir, file.repoPath ?? "../..");
  } else {
    // o.fileConfig is guaranteed set here — devConfigPath is null only when SDLC_CONFIG_PATH is
    // unset AND o.fileConfig was given.
    file = o.fileConfig as FileConfig;
    const home = o.home ?? defaultHome(env);
    const repo = o.repo ?? process.cwd();
    baseDir = repoLayout(home, repo).dir;
    repoPath = resolve(repo);
  }

  const ticketSource = file.ticketSource ?? "linear";

  // Env var wins over opts.credentials, which wins over "unset". A real (possibly empty-string)
  // env var always short-circuits opts.credentials — the same "env beats file" priority as every
  // other setting here.
  const creds = o.credentials ?? {};
  const slackBotToken = env.SLACK_BOT_TOKEN ?? creds.slackBotToken ?? "";
  const slackAppToken = env.SLACK_APP_TOKEN ?? creds.slackAppToken ?? "";
  const linearApiKey = env.LINEAR_API_KEY ?? creds.linearApiKey ?? "";
  const linearWebhookSecret = env.LINEAR_WEBHOOK_SECRET ?? creds.linearWebhookSecret ?? "";

  // Slack turns on only when both tokens are present AND the channel is configured in the file —
  // any one missing means "Slack is off", not "half-configured".
  const slack: Config["slack"] =
    slackBotToken && slackAppToken && file.slack?.channelId
      ? {
          botToken: slackBotToken,
          appToken: slackAppToken,
          channelId: file.slack.channelId,
          startMode: file.slack.startMode ?? "button",
          roleGroups: file.slack.roleGroups ?? {},
        }
      : null;

  // Default trigger follows Slack: once Slack is on, LinearWatcher polling is the natural way to
  // surface new tickets as channel notices. Without Slack, the pre-existing webhook path stays default.
  const linearTrigger: LinearTriggerKind = file.linearTrigger ?? (slack ? "poll" : "webhook");

  const config: Config = {
    ticketSource,
    repoPath,
    baseDir,
    pluginDir,
    port: Number(env.PORT ?? file.port ?? 3939),
    e2eDriver: file.e2eDriver ?? "ego-lite",
    demoAppUrl: file.demoAppUrl ?? "http://localhost:5173",
    useWorktree: file.useWorktree ?? true,
    autoTicketLabel: file.autoTicketLabel ?? "sdlc-auto",
    maxAutoTicketDepth: file.maxAutoTicketDepth ?? 3,
    gateRoles: { ...DEFAULT_GATE_ROLES, ...(file.gateRoles ?? {}) },
    gatePollIntervalMs: file.gatePollIntervalMs ?? 10_000,
    gateTimeoutMs: file.gateTimeoutMs ?? 30 * 60 * 1000,
    autoApprove: env.SDLC_AUTO_APPROVE === "1",
    detectScript: file.detectScript ?? "ops/detect.sh",
    detectMetric: file.detectMetric ?? "e2e_failure_rate",
    linear: {
      webhookSecret: linearWebhookSecret,
      apiKey: linearApiKey,
      teamId: file.linearTeamId ?? "",
    },
    jira: {
      baseUrl: file.jiraBaseUrl ?? "",
      email: file.jiraEmail ?? "",
      apiToken: env.JIRA_API_TOKEN ?? "",
      projectKey: file.jiraProjectKey ?? "",
      webhookSecret: env.JIRA_WEBHOOK_SECRET ?? "",
    },
    linearTrigger,
    linearPollIntervalMs: file.linearPollIntervalMs ?? 30_000,
    interviewMaxRounds: file.interviewMaxRounds ?? 5,
    reworkMaxAttempts: file.reworkMaxAttempts ?? 3,
    slack,
  };

  if (!Number.isInteger(config.port) || config.port <= 0 || config.port > 65535) {
    fail(`port must be an integer between 1 and 65535, got "${env.PORT ?? file.port}"`);
  }

  if (config.ticketSource === "linear") {
    if (config.linearTrigger === "webhook" && !config.linear.webhookSecret) {
      fail('LINEAR_WEBHOOK_SECRET env var is required when linearTrigger is "webhook"');
    }
    if (!config.linear.apiKey) fail("LINEAR_API_KEY env var is required for ticketSource=linear");
    if (!config.linear.teamId) fail("linearTeamId is required in sdlc.config.json for ticketSource=linear");
  } else if (config.ticketSource === "jira") {
    if (!config.jira.baseUrl) fail("jiraBaseUrl is required in sdlc.config.json for ticketSource=jira");
    if (!config.jira.apiToken) fail("JIRA_API_TOKEN env var is required for ticketSource=jira");
  }

  return config;
}

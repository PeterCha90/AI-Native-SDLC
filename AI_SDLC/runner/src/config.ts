import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { StageId } from "./gate.ts";

const RUNNER_DIR = fileURLToPath(new URL("..", import.meta.url));

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
  slack?: {
    channelId: string;
    startMode?: "button" | "auto";
    roleGroups?: Record<string, string>;
  };
}

export interface Config {
  ticketSource: TicketSourceKind;
  repoPath: string;
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

/**
 * Loads AI_SDLC/runner/sdlc.config.json (non-secret settings) merged with
 * environment variables (secrets ONLY — never written to the config file).
 * Exits the process with a clear message if a required value is missing.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const configPath = env.SDLC_CONFIG_PATH ?? resolve(RUNNER_DIR, "sdlc.config.json");
  const file = loadFileConfig(configPath);

  const ticketSource = file.ticketSource ?? "linear";

  // Slack turns on only when both tokens are present (secrets, env-only) AND the channel is
  // configured in the file — any one missing means "Slack is off", not "half-configured".
  const slackBotToken = env.SLACK_BOT_TOKEN ?? "";
  const slackAppToken = env.SLACK_APP_TOKEN ?? "";
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
    repoPath: resolve(RUNNER_DIR, file.repoPath ?? "../.."),
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
      webhookSecret: env.LINEAR_WEBHOOK_SECRET ?? "",
      apiKey: env.LINEAR_API_KEY ?? "",
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

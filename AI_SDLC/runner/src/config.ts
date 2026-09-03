import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RUNNER_DIR = fileURLToPath(new URL("..", import.meta.url));

export type TicketSourceKind = "linear" | "jira";
export type E2EDriverKind = "ego-lite" | "aside";

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
  linear: { webhookSecret: string; apiKey: string; teamId: string };
  jira: { baseUrl: string; email: string; apiToken: string; projectKey: string; webhookSecret: string };
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

  const config: Config = {
    ticketSource,
    repoPath: resolve(RUNNER_DIR, file.repoPath ?? "../.."),
    port: Number(env.PORT ?? file.port ?? 3939),
    e2eDriver: file.e2eDriver ?? "ego-lite",
    demoAppUrl: file.demoAppUrl ?? "http://localhost:5173",
    useWorktree: file.useWorktree ?? true,
    autoTicketLabel: file.autoTicketLabel ?? "sdlc-auto",
    maxAutoTicketDepth: file.maxAutoTicketDepth ?? 3,
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
  };

  if (config.ticketSource === "linear") {
    if (!config.linear.webhookSecret) fail("LINEAR_WEBHOOK_SECRET env var is required for ticketSource=linear");
    if (!config.linear.apiKey) fail("LINEAR_API_KEY env var is required for ticketSource=linear");
    if (!config.linear.teamId) fail("linearTeamId is required in sdlc.config.json for ticketSource=linear");
  } else if (config.ticketSource === "jira") {
    if (!config.jira.baseUrl) fail("jiraBaseUrl is required in sdlc.config.json for ticketSource=jira");
    if (!config.jira.apiToken) fail("JIRA_API_TOKEN env var is required for ticketSource=jira");
  }

  return config;
}

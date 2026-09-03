import type { Config } from "../config.ts";
import { createLinearAdapter } from "./linear.ts";
import { createJiraAdapter } from "./jira.ts";
import type { TicketSource } from "./types.ts";

/** Picks the ticket-source adapter based on config.ticketSource. This is the only switch point. */
export function createTicketSource(config: Config): TicketSource {
  switch (config.ticketSource) {
    case "linear":
      return createLinearAdapter({
        webhookSecret: config.linear.webhookSecret,
        apiKey: config.linear.apiKey,
        teamId: config.linear.teamId,
      });
    case "jira":
      return createJiraAdapter({
        baseUrl: config.jira.baseUrl,
        email: config.jira.email,
        apiToken: config.jira.apiToken,
        projectKey: config.jira.projectKey,
        webhookSecret: config.jira.webhookSecret,
      });
    default: {
      const exhaustive: never = config.ticketSource;
      throw new Error(`unknown ticketSource: ${String(exhaustive)}`);
    }
  }
}

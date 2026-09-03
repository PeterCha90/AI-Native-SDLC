import { createHmac, timingSafeEqual } from "node:crypto";
import type { NewTicket, Ticket, TicketSource } from "./types.ts";

export interface LinearAdapterOptions {
  webhookSecret: string;
  apiKey: string;
  teamId: string;
}

interface LinearWebhookPayload {
  action?: string;
  type?: string;
  url?: string;
  data?: {
    id?: string;
    identifier?: string;
    title?: string;
    description?: string;
    url?: string;
    labels?: Array<{ id?: string; name?: string }>;
    labelIds?: string[];
  };
}

const GRAPHQL_ENDPOINT = "https://api.linear.app/graphql";

function getHeader(headers: Record<string, string | string[] | undefined>, name: string): string {
  const value = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

async function graphql<T>(apiKey: string, query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await fetch(GRAPHQL_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: apiKey,
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
  if (!res.ok || json.errors?.length) {
    const message = json.errors?.map((e) => e.message).join("; ") ?? res.statusText;
    throw new Error(`Linear GraphQL request failed: ${message}`);
  }
  return json.data as T;
}

/** Resolve label names to Linear label IDs for a team. Unknown names are dropped (logged), not fatal. */
async function resolveLabelIds(apiKey: string, teamId: string, names: string[]): Promise<string[]> {
  if (names.length === 0) return [];
  const data = await graphql<{ issueLabels: { nodes: Array<{ id: string; name: string }> } }>(
    apiKey,
    `query($teamId: ID!) {
      issueLabels(filter: { team: { id: { eq: $teamId } } }, first: 250) {
        nodes { id name }
      }
    }`,
    { teamId },
  );
  const byName = new Map(data.issueLabels.nodes.map((l) => [l.name, l.id] as const));
  const ids: string[] = [];
  for (const name of names) {
    const id = byName.get(name);
    if (id) ids.push(id);
    else console.warn(`[linear] label "${name}" not found on team ${teamId}, skipping`);
  }
  return ids;
}

export function createLinearAdapter(opts: LinearAdapterOptions): TicketSource {
  const { webhookSecret, apiKey, teamId } = opts;

  return {
    name: "linear",

    verify(headers, rawBody) {
      const signature = getHeader(headers, "Linear-Signature");
      if (!signature) return false;
      const expected = createHmac("sha256", webhookSecret).update(rawBody, "utf8").digest("hex");
      const expectedBuf = Buffer.from(expected, "hex");
      const actualBuf = Buffer.from(signature, "hex");
      // timingSafeEqual throws on length mismatch, so guard first (also avoids leaking length via exception timing).
      if (expectedBuf.length !== actualBuf.length) return false;
      return timingSafeEqual(expectedBuf, actualBuf);
    },

    parse(rawBody) {
      let payload: LinearWebhookPayload;
      try {
        payload = JSON.parse(rawBody);
      } catch {
        return null;
      }
      if (payload.type !== "Issue" || payload.action !== "create" || !payload.data) return null;

      const { data } = payload;
      const labels = data.labels?.map((l) => l.name).filter((n): n is string => !!n) ?? [];

      return {
        id: data.id ?? "",
        key: data.identifier ?? data.id ?? "",
        title: data.title ?? "",
        body: data.description ?? "",
        labels,
        url: data.url ?? payload.url ?? "",
      };
    },

    async createTicket(t: NewTicket): Promise<Ticket> {
      const labelIds = t.labels ? await resolveLabelIds(apiKey, teamId, t.labels) : [];
      const data = await graphql<{
        issueCreate: { success: boolean; issue: { id: string; identifier: string; title: string; description: string; url: string } };
      }>(
        apiKey,
        `mutation($input: IssueCreateInput!) {
          issueCreate(input: $input) {
            success
            issue { id identifier title description url }
          }
        }`,
        { input: { teamId, title: t.title, description: t.body, labelIds } },
      );
      if (!data.issueCreate.success) throw new Error("Linear issueCreate reported failure");
      const issue = data.issueCreate.issue;
      return {
        id: issue.id,
        key: issue.identifier,
        title: issue.title,
        body: issue.description ?? "",
        labels: t.labels ?? [],
        url: issue.url,
      };
    },

    async comment(ticketId, body) {
      await graphql(
        apiKey,
        `mutation($input: CommentCreateInput!) {
          commentCreate(input: $input) { success }
        }`,
        { input: { issueId: ticketId, body } },
      );
    },
  };
}

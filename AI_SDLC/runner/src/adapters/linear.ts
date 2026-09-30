import { createHmac, timingSafeEqual } from "node:crypto";
import type { IssueComment, NewTicket, RecentIssue, StateType, Ticket, TicketSource } from "./types.ts";

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
    creator?: { email?: string } | null;
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

/**
 * Resolve label names to Linear label IDs for a team, creating any that don't exist yet.
 *
 * Creating rather than skipping is load-bearing for the loop guard. `sdlc-auto` is how
 * `shouldCreateFollowupTicket` recognises a pipeline-generated ticket; if the label were silently
 * dropped because it isn't in the workspace, the follow-up ticket would come back through the
 * webhook with no labels, be read as human-authored, and bypass the depth limit entirely — an
 * unbounded ticket loop, which is the exact failure the depth limit exists to prevent.
 */
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
    const existing = byName.get(name);
    if (existing) {
      ids.push(existing);
      continue;
    }
    const created = await graphql<{ issueLabelCreate: { success: boolean; issueLabel: { id: string } } }>(
      apiKey,
      `mutation($input: IssueLabelCreateInput!) {
        issueLabelCreate(input: $input) { success issueLabel { id } }
      }`,
      { input: { name, teamId } },
    );
    if (!created.issueLabelCreate.success) {
      throw new Error(`Linear issueLabelCreate failed for "${name}" on team ${teamId}`);
    }
    console.log(`[linear] created missing label "${name}" on team ${teamId}`);
    ids.push(created.issueLabelCreate.issueLabel.id);
  }
  return ids;
}

export function createLinearAdapter(opts: LinearAdapterOptions): TicketSource {
  const { webhookSecret, apiKey, teamId } = opts;

  return {
    name: "linear",

    verify(headers, rawBody) {
      // Defense in depth: an empty secret (poll mode, where LINEAR_WEBHOOK_SECRET is optional)
      // must never verify anything, even a signature someone computed against the empty string
      // themselves — index.ts is the primary guard (it doesn't route /webhook/<source> at all
      // unless linearTrigger is "webhook"), but this must hold on its own too.
      if (!webhookSecret) return false;
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
        creatorEmail: data.creator?.email,
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

    async createSubIssue(parentId, t: NewTicket): Promise<Ticket> {
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
        { input: { teamId, parentId, title: t.title, description: t.body, labelIds } },
      );
      if (!data.issueCreate.success) throw new Error("Linear issueCreate (sub-issue) reported failure");
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

    async getStateType(issueId): Promise<StateType> {
      const data = await graphql<{ issue: { state: { type: string } | null } | null }>(
        apiKey,
        `query($id: String!) { issue(id: $id) { state { type } } }`,
        { id: issueId },
      );
      const type = data.issue?.state?.type;
      if (!type) throw new Error(`Linear issue ${issueId} has no workflow state`);
      // Linear's WorkflowState.type vocabulary is already exactly our StateType set.
      return type as StateType;
    },

    async listComments(issueId): Promise<IssueComment[]> {
      const data = await graphql<{
        issue: { comments: { nodes: Array<{ body: string; createdAt: string; user: { name: string } | null }> } } | null;
      }>(
        apiKey,
        `query($id: String!) {
          issue(id: $id) {
            comments(first: 100) { nodes { body createdAt user { name } } }
          }
        }`,
        { id: issueId },
      );
      // Sort explicitly rather than trusting the connection's default order: Linear paginates on
      // `updatedAt` by default, so an edited old comment would otherwise sort last and get read as
      // the rejection reason. The gate takes the final element, so this ordering is load-bearing.
      return (data.issue?.comments.nodes ?? [])
        .map((c) => ({
          body: c.body,
          author: c.user?.name ?? "unknown",
          createdAt: c.createdAt,
        }))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    },

    async setStateType(issueId, type): Promise<void> {
      const data = await graphql<{
        issue: { team: { states: { nodes: Array<{ id: string; position: number }> } } } | null;
      }>(
        apiKey,
        `query($id: String!, $type: String!) {
          issue(id: $id) {
            team {
              states(filter: { type: { eq: $type } }) {
                nodes { id position }
              }
            }
          }
        }`,
        { id: issueId, type },
      );
      const states = data.issue?.team.states.nodes ?? [];
      if (states.length === 0) {
        throw new Error(`팀 워크플로에 ${type} 상태가 없다`);
      }
      const target = states.reduce((min, s) => (s.position < min.position ? s : min));
      await graphql<{ issueUpdate: { success: boolean } }>(
        apiKey,
        `mutation($id: String!, $input: IssueUpdateInput!) {
          issueUpdate(id: $id, input: $input) { success }
        }`,
        { id: issueId, input: { stateId: target.id } },
      );
    },

    async listRecentIssues(sinceIso): Promise<RecentIssue[]> {
      const data = await graphql<{
        issues: {
          nodes: Array<{
            id: string;
            identifier: string;
            title: string;
            description: string | null;
            url: string;
            createdAt: string;
            creator: { name: string; email?: string } | null;
            labels: { nodes: Array<{ name: string }> };
          }>;
        };
      }>(
        apiKey,
        `query($teamId: ID!, $since: DateTimeOrDuration!) {
          issues(first: 50, filter: { team: { id: { eq: $teamId } }, createdAt: { gt: $since }, parent: { null: true } }) {
            nodes {
              id
              identifier
              title
              description
              url
              createdAt
              creator { name email }
              labels { nodes { name } }
            }
          }
        }`,
        { teamId, since: sinceIso },
      );
      return data.issues.nodes
        .map((issue) => ({
          id: issue.id,
          key: issue.identifier,
          title: issue.title,
          body: issue.description ?? "",
          labels: issue.labels.nodes.map((l) => l.name),
          url: issue.url,
          createdAt: issue.createdAt,
          creator: issue.creator?.name ?? "unknown",
          creatorEmail: issue.creator?.email,
        }))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    },

    async getTicket(idOrKey): Promise<Ticket> {
      const data = await graphql<{
        issue: {
          id: string;
          identifier: string;
          title: string;
          description: string | null;
          url: string;
          labels: { nodes: Array<{ name: string }> };
          creator: { email?: string } | null;
        } | null;
      }>(
        apiKey,
        `query($id: String!) {
          issue(id: $id) {
            id
            identifier
            title
            description
            url
            labels { nodes { name } }
            creator { email }
          }
        }`,
        { id: idOrKey },
      );
      if (!data.issue) throw new Error(`Linear issue ${idOrKey} not found`);
      const issue = data.issue;
      return {
        id: issue.id,
        key: issue.identifier,
        title: issue.title,
        body: issue.description ?? "",
        labels: issue.labels.nodes.map((l) => l.name),
        url: issue.url,
        creatorEmail: issue.creator?.email,
      };
    },
  };
}

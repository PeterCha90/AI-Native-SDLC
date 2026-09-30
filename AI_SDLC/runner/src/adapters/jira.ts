import type { TicketSource } from "./types.ts";

export interface JiraAdapterOptions {
  baseUrl: string;
  email: string;
  apiToken: string;
  projectKey: string;
  webhookSecret: string;
}

/**
 * Stub adapter. Demonstrates the swap-in point: implement each method with
 * a Jira REST call and this drops in wherever `TicketSource` is used —
 * `src/pipeline.ts`, `src/index.ts` — with no other change required.
 */
export function createJiraAdapter(_opts: JiraAdapterOptions): TicketSource {
  return {
    name: "jira",

    verify(_headers, _rawBody) {
      // Jira Cloud webhooks don't sign requests by default; if you configure
      // a shared secret (e.g. via a query param or custom header), verify it
      // here the same way linear.ts does (HMAC + timingSafeEqual). Until
      // then, refuse everything rather than silently accepting unsigned events.
      throw new Error("not implemented: verify Jira webhook request here");
    },

    parse(_rawBody) {
      // Parse a Jira "jira:issue_created" webhook event JSON body into a
      // Ticket ({ id: issue.id, key: issue.key, title: issue.fields.summary,
      // body: issue.fields.description, labels: issue.fields.labels, url }).
      // Return null for any other webhookEvent value.
      throw new Error("not implemented: parse Jira webhook payload here");
    },

    async createTicket(_t) {
      // POST {baseUrl}/rest/api/3/issue with Basic auth (email:apiToken)
      // and body { fields: { project: { key: projectKey }, summary: t.title,
      // description: t.body, issuetype: { name: "Task" }, labels: t.labels } }
      throw new Error("not implemented: call Jira REST API to create an issue here");
    },

    async comment(_ticketId, _body) {
      // POST {baseUrl}/rest/api/3/issue/{ticketId}/comment with Basic auth
      // and body { body: _body } (or Atlassian Document Format for v3).
      throw new Error("not implemented: call Jira REST API to add a comment here");
    },

    async createSubIssue(_parentId, _t) {
      // Same POST as createTicket, plus fields.parent = { id: _parentId } and
      // an issuetype whose hierarchy level sits below the parent's (e.g. "Sub-task").
      throw new Error("not implemented: call Jira REST API to create a sub-task here");
    },

    async getStateType(_issueId) {
      // GET {baseUrl}/rest/api/3/issue/{issueId}?fields=status and map
      // fields.status.statusCategory.key onto StateType:
      //   "new" -> "unstarted", "indeterminate" -> "started", "done" -> "completed".
      // Jira has no distinct canceled category — map the project's Canceled/Won't Do
      // resolution to "canceled" explicitly, or the approval gates can never be rejected.
      throw new Error("not implemented: read the Jira issue status category here");
    },

    async listComments(_issueId) {
      // GET {baseUrl}/rest/api/3/issue/{issueId}/comment, oldest first, mapping
      // each to { body, author: author.displayName, createdAt: created }.
      throw new Error("not implemented: read Jira issue comments here");
    },

    async setStateType(_issueId, _type) {
      // GET {baseUrl}/rest/api/3/issue/{issueId}/transitions to find a
      // transition whose target status.statusCategory.key matches _type
      // ("done" for "completed"; the project's Canceled/Won't Do resolution
      // for "canceled"; "new" for "unstarted" — used to reopen a gate card
      // for rework after a rejection), then POST
      // {baseUrl}/rest/api/3/issue/{issueId}/transitions with body
      // { transition: { id } }. Throw if no matching transition exists.
      throw new Error("not implemented: transition a Jira issue to the given status category here");
    },

    async listRecentIssues(_sinceIso) {
      // GET {baseUrl}/rest/api/3/search?jql=project={projectKey} AND
      // created > "_sinceIso" AND parent is EMPTY ORDER BY created ASC&maxResults=50,
      // mapping each issue to { id, key, title: fields.summary,
      // body: fields.description, labels: fields.labels, url, createdAt: fields.created,
      // creator: fields.creator.displayName }.
      throw new Error("not implemented: search recent parentless Jira issues here");
    },

    async getTicket(_idOrKey) {
      // GET {baseUrl}/rest/api/3/issue/{idOrKey} (Jira accepts either the key,
      // e.g. "ENG-12", or the numeric id) and map the same way as createTicket's
      // response: { id, key, title: fields.summary, body: fields.description,
      // labels: fields.labels, url }.
      throw new Error("not implemented: look up a Jira issue by key or id here");
    },
  };
}

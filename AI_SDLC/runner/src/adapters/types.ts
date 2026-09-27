// Ticket-source adapter interface. This is the ONLY place a swap-in for
// Jira (or GitHub Issues, etc.) needs to satisfy. Nothing else in the
// runner should know which ticket tool is behind it.

export interface Ticket {
  id: string;
  key: string;
  title: string;
  body: string;
  labels: string[];
  url: string;
}

export interface NewTicket {
  title: string;
  body: string;
  labels?: string[];
}

/**
 * The lifecycle position of an issue, normalised across ticket tools.
 * The approval gates read exactly two of these — `completed` means the human
 * approved the stage, `canceled` means they rejected it — so a swap-in adapter
 * must map its own workflow states onto this set rather than inventing new ones.
 */
export type StateType = "triage" | "backlog" | "unstarted" | "started" | "completed" | "canceled" | "duplicate";

export interface IssueComment {
  body: string;
  author: string;
  createdAt: string;
}

export interface TicketSource {
  name: string;
  /** Verify a webhook request is authentic. Must use a timing-safe compare. */
  verify(headers: Record<string, string | string[] | undefined>, rawBody: string): boolean;
  /** Turn a webhook payload into a Ticket, or null if the event isn't one we care about. */
  parse(rawBody: string): Ticket | null;
  createTicket(t: NewTicket): Promise<Ticket>;
  comment(ticketId: string, body: string): Promise<void>;
  /** Create a child of `parentId`. One sub-issue per pipeline stage = one approval gate. */
  createSubIssue(parentId: string, t: NewTicket): Promise<Ticket>;
  /** Current lifecycle position. This is what the runner polls while a gate is open. */
  getStateType(issueId: string): Promise<StateType>;
  /** Oldest first. Used to read the rejection reason a human left on a canceled gate. */
  listComments(issueId: string): Promise<IssueComment[]>;
}

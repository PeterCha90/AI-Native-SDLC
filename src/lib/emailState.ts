import type { EmailSummary } from "./types";

/**
 * The state handed to JEV for one email. Structured rather than a blob of
 * prose so the model can tell the sender apart from the subject line.
 * The body is deliberately absent: subject + snippet classifies just as well
 * and keeps each request small.
 *
 * Kept free of SDK imports so client components can render the exact payload
 * that was sent without bundling the SDK.
 */
export function emailState(email: EmailSummary) {
  return {
    from: email.from,
    subject: email.subject,
    received: email.date,
    preview: email.snippet,
  };
}

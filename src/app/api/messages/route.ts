import { LIMITS } from "@/lib/defaults";
import { fetchInbox } from "@/lib/gmail";
import type { EmailSummary, MailboxStatus } from "@/lib/types";

// Reads Gmail (fs + network) — Node runtime, never cached.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface MessagesResponse {
  emails: EmailSummary[];
  status: MailboxStatus;
}

/**
 * The inbox on its own, with no analysis attached, so the page can show real
 * mail the moment it loads instead of an empty state.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const requested = Number(url.searchParams.get("limit") ?? 30);
  const limit = Number.isFinite(requested)
    ? Math.min(LIMITS.mailCount.max, Math.max(LIMITS.mailCount.min, Math.round(requested)))
    : 30;

  try {
    const { emails, status } = await fetchInbox(limit);
    return Response.json({ emails, status } satisfies MessagesResponse);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: `메일을 불러오지 못했습니다: ${message}` }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { getMailboxStatus } from "@/lib/gmail";
import type { MailboxStatus } from "@/lib/types";

// Reads a credential file from disk and talks to Gmail on every request —
// must run on the Node runtime and never be statically cached.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const status: MailboxStatus = await getMailboxStatus();
  return NextResponse.json(status);
}

/**
 * Server-Sent Events helper shared by /api/analyze and /api/spam. Both routes
 * speak a typed event union (AnalyzeEvent / SpamEvent), so this stays generic
 * over the event type rather than hard-coding either one.
 */

export function sseResponse<E>(producer: (emit: (event: E) => void) => Promise<void>): Response {
  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: E) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          // Controller already closed/errored (e.g. client disconnected) — drop silently.
          closed = true;
        }
      };

      try {
        await producer(emit);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        emit({ type: "error", message } as E);
      } finally {
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            // Already closed by the runtime (e.g. client aborted) — nothing to do.
          }
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

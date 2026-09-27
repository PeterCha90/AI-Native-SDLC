import { createTodo, listTodos, ValidationError } from '../../../lib/todos';

// Module-level state only survives within one warm instance, so pin this to the
// Node runtime rather than edge, where every request may hit a fresh isolate.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return Response.json(listTodos());
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ detail: 'invalid JSON body' }, { status: 400 });
  }

  try {
    return Response.json(createTodo(body?.title), { status: 201 });
  } catch (err) {
    if (err instanceof ValidationError) {
      return Response.json({ detail: err.message }, { status: 422 });
    }
    throw err;
  }
}

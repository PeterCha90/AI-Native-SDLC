import { deleteTodo, NotFoundError } from '../../../../lib/todos';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function DELETE(_request, { params }) {
  const { id } = await params;
  try {
    deleteTodo(Number(id));
    return new Response(null, { status: 204 });
  } catch (err) {
    if (err instanceof NotFoundError) {
      return Response.json({ detail: err.message }, { status: 404 });
    }
    throw err;
  }
}

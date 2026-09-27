/**
 * Todo store and the API's validation rules.
 *
 * Intentional bug (see README.md "심어둔 버그"):
 *   createTodo() does not reject an empty/whitespace-only title unless
 *   DEMO_STRICT_VALIDATION=1 is set. The UI already blocks empty submissions,
 *   so the bug only surfaces when something calls the API directly (curl, or
 *   the e2e step) — which is exactly how the demo is meant to catch it.
 *
 * State is a module-level array. On Vercel that means it lives as long as the
 * serverless instance stays warm; it is not shared across instances and does
 * not survive a cold start. Fine for a demo, wrong for anything real — swap in
 * a real store (Vercel KV, Postgres) if this ever needs to outlive a session.
 */

let todos = [];
let nextId = 1;

export class ValidationError extends Error {}
export class NotFoundError extends Error {}

function strictValidationEnabled() {
  // ponytail: single env var toggle, no config file. Set DEMO_STRICT_VALIDATION=1
  // to turn the seeded bug OFF (i.e. enable the validation the API is missing).
  return process.env.DEMO_STRICT_VALIDATION === '1';
}

export function listTodos() {
  return todos;
}

export function createTodo(title) {
  if (typeof title !== 'string') {
    throw new ValidationError('title must be a string');
  }
  if (strictValidationEnabled() && !title.trim()) {
    throw new ValidationError('title must not be empty');
  }
  const item = { id: nextId++, title };
  todos.push(item);
  return item;
}

export function deleteTodo(id) {
  const before = todos.length;
  todos = todos.filter((t) => t.id !== id);
  if (todos.length === before) {
    throw new NotFoundError('todo not found');
  }
}

/** Test helper. Not used by the app itself. */
export function _reset() {
  todos = [];
  nextId = 1;
}

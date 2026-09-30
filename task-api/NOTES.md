# Submission notes

## `PATCH /tasks/:id/assign` — design decisions
- **Storage:** `assignee` is a plain string on the task. New tasks now get `assignee: null` so the shape is consistent (additive change; existing fields untouched).
- **Validation (400):** `assignee` must be present, a string, non-empty after trimming, and at most 100 chars. Empty string is rejected rather than treated as "unassign" because a silent clear on a typo is a nasty failure mode. If unassigning is wanted, a dedicated `DELETE /tasks/:id/assign` or explicit `null` support is clearer than overloading `""`.
- **Whitespace:** trimmed before storing, so `"  Alice "` and `"Alice"` are the same person.
- **Already assigned:** allowed; last write wins, returns 200. Reassignment is a normal workflow. Assigning the same name twice is idempotent (PATCH semantics). The alternative, 409 Conflict, would force clients into an unassign-then-assign dance with a race in the middle.
- **Completed tasks:** can still be assigned. Assignment is orthogonal to status.
- **Order of checks:** body validated first, then 404, matching the existing `PUT` handler.
- **Not done:** no check that the assignee is a real user (there is no user model), and case is preserved (`alice` != `Alice`).

## What I'd test next
- Concurrency/ordering (in-memory store makes this cheap, but it matters once there's a DB).
- Property-based tests for pagination (union of all pages == full list, no overlaps).
- Fixing and un-`failing` bugs 2–8, then contract tests generated from an OpenAPI spec.
- Large payloads / body-size limits, and unicode in titles and assignee names.

## What surprised me
- The pagination bug and the `priority: 'medium'` line are both single-token mistakes that a happy-path "does it return 200" test would never catch. Only asserting on the *values* did.
- The route layer defaults `page` to 1 while the service assumed 0-indexing, so each layer was locally reasonable and the bug lived in the seam.
- README and code disagree on the status enum.

## Questions before production
- Should `PUT` be a true full replace or a partial update?
- What are the intended semantics of `completedAt` when status moves away from `done`?
- Is the in-memory store a placeholder? Restart = total data loss, and there's no locking story for multiple instances.
- Is there authentication? Anyone can read, edit, delete, or assign anything.
- Should list endpoints have a max `limit` and a stable sort order?

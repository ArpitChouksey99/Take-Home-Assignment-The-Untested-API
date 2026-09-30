# Bug Report — Task API

Found by writing tests against the *intended* behaviour and then confirming each one with `curl` against a running server.
Bugs marked **FIXED** have a regression test; the rest are captured as `test.failing(...)` in `tests/`, so the suite is green today and
**will go red the moment someone fixes the bug**, which is the cue to flip them to plain `test(...)`.

| # | Severity | Bug | Status |
|---|----------|-----|--------|
| 1 | High | Pagination skips the first page | **FIXED** |
| 2 | High | `?status=` uses substring matching | open |
| 3 | Medium | `complete` silently resets priority to `medium` | open |
| 4 | High | `PUT` can overwrite `id`, `createdAt`, and arbitrary fields | open |
| 5 | Low | Re-completing a task overwrites `completedAt` | open |
| 6 | Medium | Malformed JSON returns 500 instead of 400 | open |
| 7 | Medium | `?status=` silently disables pagination | open |
| 8 | Medium | `completedAt` not maintained by `PUT` / create | open |
| 9 | Docs | README task shape doesn't match the code | open |

---

## 1. Pagination skips the first page — FIXED
- **Where:** `src/services/taskService.js` → `getPaginated`
- **Expected:** `?page=1&limit=2` returns items 1–2 (pages are 1-indexed; the route already defaults `page` to `1`).
- **Actual:** returns items 3–4. `?page=3&limit=2` on 5 tasks returns `[]` when it should return the 5th task.
- **Why:** `offset = page * limit` treats `page` as 0-indexed. The route layer defaults to 1, so the two layers disagree and the first `limit` items are unreachable.
- **Found by:** service test "page 1 returns the first items"; confirmed with curl.
- **Fix:** `offset = (page - 1) * limit`. I also clamped `page`/`limit` to `>= 1` in the route, because with the old code `page=-1` produced a negative `slice` offset (which counts from the end of the array) and returned garbage.

## 2. Status filter uses substring matching
- **Where:** `taskService.js` → `getByStatus` (`t.status.includes(status)`)
- **Expected:** exact match. `?status=o` should return nothing.
- **Actual:** `?status=o` returns every task (`"todo"` contains `o`); `?status=progress` matches `in_progress`; `?status=` prefixes work too.
- **Why:** `String.prototype.includes` was used where `===` was intended.
- **Found by:** unit test with partial strings; curl returned all 5 tasks for `status=o`.
- **Fix:** `tasks.filter((t) => t.status === status)`. Optionally validate the param against `VALID_STATUSES` and return 400 for unknown values.

## 3. `complete` resets priority to `medium`
- **Where:** `taskService.js` → `completeTask` (`priority: 'medium'` in the spread)
- **Expected:** completing a task only changes `status` and `completedAt`.
- **Actual:** a `high` priority task becomes `medium` after completion, so priority history is lost and reporting on "done high-priority work" is wrong.
- **Why:** hard-coded `priority: 'medium'` in the updated object, likely a copy/paste leftover.
- **Found by:** happy-path test for `/complete` that compared the full object; confirmed with curl.
- **Fix:** delete that line.

## 4. `PUT` accepts any field, including `id` and `createdAt`
- **Where:** `taskService.js` → `update` (`{ ...tasks[index], ...fields }`) with `routes/tasks.js` passing `req.body` straight through.
- **Expected:** only `title`, `description`, `status`, `priority`, `dueDate` are writable.
- **Actual:** `PUT {"id":"hacked","createdAt":"x","foo":"bar"}` succeeds. The task's `id` changes (breaking every later lookup by the original id), and unknown fields are persisted. It's also a mass-assignment hole: `assignee` (validated on the new endpoint) and `completedAt` can be set through `PUT` with no validation.
- **Why:** no whitelist between request body and stored object.
- **Found by:** reading `update` and noticing the unfiltered spread; confirmed with curl.
- **Fix:** pick only the allowed keys before spreading. Also note `PUT` is documented as a "full update" but behaves as a partial one (omitted fields are kept). Worth a product decision.

## 5. Completing twice overwrites `completedAt`
- **Where:** `taskService.js` → `completeTask`
- **Expected:** idempotent. The second call is a no-op and keeps the original completion time.
- **Actual:** `completedAt` is replaced on every call (confirmed 1s apart with curl).
- **Fix:** `if (task.status === 'done') return task;`

## 6. Malformed JSON returns 500
- **Where:** `src/app.js` error middleware
- **Expected:** `400` for a client error.
- **Actual:** `500 Internal server error` (and a stack trace in the logs, so client typos look like outages in monitoring).
- **Why:** `express.json()` raises an error with `status: 400`, but the handler ignores `err.status` and always responds 500.
- **Fix:** `res.status(err.status || 500)`, and only log the stack for 5xx.

## 7. `?status=` short-circuits pagination
- **Where:** `routes/tasks.js` `GET /` (early `return` inside `if (status)`)
- **Expected:** filters compose: `?status=todo&page=1&limit=2` returns at most 2 todo tasks.
- **Actual:** returns every `todo` task, ignoring `page` and `limit` (4 returned in my curl check with `limit=2`).
- **Fix:** filter first, then paginate the filtered list. That needs `getPaginated` to accept a list or the filter to move into the service.

## 8. `completedAt` isn't maintained outside `/complete`
- **Where:** `taskService.js` → `create`, `update`
- **Expected:** `status: 'done'` implies a `completedAt`, and moving back out of `done` clears it.
- **Actual:** creating or `PUT`ting with `status: 'done'` leaves `completedAt: null`; moving a done task back to `todo` leaves a stale `completedAt`.
- **Fix:** centralise the status-transition logic in the service so every path goes through it.

## 9. Docs disagree with the code
README lists statuses `pending | in-progress | completed`; the code, validators, and ASSIGNMENT.md use `todo | in_progress | done`. A client following the README gets 400s on create and an empty `?status=pending`. I followed the code.

## Smaller things noticed (not filed)
- `getAll`/`findById` return live object references; a future caller that mutates them would corrupt the store.
- Validators use truthiness (`body.status && ...`), so `status: ""` or `dueDate: ""` bypass validation and get stored.
- No upper bound on `limit`.
- No auth/ownership model; `assignee` is free text.

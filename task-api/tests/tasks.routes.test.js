const request = require('supertest');
const app = require('../src/app');
const service = require('../src/services/taskService');

const create = (body = {}) => request(app).post('/tasks').send({ title: 'Task', ...body });
const seed = async (n) => {
  const out = [];
  for (let i = 1; i <= n; i++) out.push((await create({ title: `Task ${i}` })).body);
  return out;
};

beforeEach(() => {
  service._reset();
  jest.spyOn(console, 'error').mockImplementation(() => {}); // app.js logs stacks for 500s
});
afterEach(() => jest.restoreAllMocks());

describe('POST /tasks', () => {
  test('creates a task (201) with defaults', async () => {
    const res = await create({ title: 'Write tests' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      title: 'Write tests', status: 'todo', priority: 'medium', dueDate: null, completedAt: null, assignee: null,
    });
    expect(res.body.id).toBeDefined();
  });

  test.each([
    ['missing title', {}],
    ['blank title', { title: '  ' }],
    ['invalid status', { title: 'x', status: 'bogus' }],
    ['invalid priority', { title: 'x', priority: 'bogus' }],
    ['invalid dueDate', { title: 'x', dueDate: 'bogus' }],
  ])('400 on %s', async (_, body) => {
    const res = await request(app).post('/tasks').send(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toEqual(expect.any(String));
  });

  test('400 (not 500) on malformed JSON', async () => {
    // BUG #6 is tracked below as test.failing; this only asserts it does not succeed.
    const res = await request(app).post('/tasks').set('Content-Type', 'application/json').send('{bad');
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  test.failing('BUG #6: malformed JSON returns 400, not 500', async () => {
    const res = await request(app).post('/tasks').set('Content-Type', 'application/json').send('{bad');
    expect(res.status).toBe(400);
  });
});

describe('GET /tasks', () => {
  test('returns empty array when there are no tasks', async () => {
    const res = await request(app).get('/tasks');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  test('returns all tasks', async () => {
    await seed(3);
    const res = await request(app).get('/tasks');
    expect(res.body).toHaveLength(3);
  });

  test('filters by status', async () => {
    await create({ title: 'a', status: 'todo' });
    await create({ title: 'b', status: 'done' });
    const res = await request(app).get('/tasks?status=done');
    expect(res.body.map((t) => t.title)).toEqual(['b']);
  });

  test('unknown status returns empty list', async () => {
    await seed(2);
    const res = await request(app).get('/tasks?status=nope');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  describe('pagination', () => {
    beforeEach(() => seed(5));

    test('page 1 returns the first page', async () => {
      const res = await request(app).get('/tasks?page=1&limit=2');
      expect(res.body.map((t) => t.title)).toEqual(['Task 1', 'Task 2']);
    });

    test('page 2 returns the second page', async () => {
      const res = await request(app).get('/tasks?page=2&limit=2');
      expect(res.body.map((t) => t.title)).toEqual(['Task 3', 'Task 4']);
    });

    test('page past the end returns empty array', async () => {
      const res = await request(app).get('/tasks?page=99&limit=2');
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    test('defaults to page 1, limit 10 when only one param is given', async () => {
      const res = await request(app).get('/tasks?limit=3');
      expect(res.body.map((t) => t.title)).toEqual(['Task 1', 'Task 2', 'Task 3']);
    });

    test.each([
      ['non-numeric', 'page=abc&limit=2'],
      ['zero page', 'page=0&limit=2'],
      ['negative page', 'page=-1&limit=2'],
      ['negative limit', 'page=1&limit=-2'],
    ])('falls back to sane defaults for %s params', async (_, qs) => {
      const res = await request(app).get(`/tasks?${qs}`);
      expect(res.status).toBe(200);
      expect(res.body.length).toBeGreaterThan(0);
    });

    // BUG #7: `status` short-circuits before pagination is looked at.
    test.failing('status filter can be combined with pagination', async () => {
      const res = await request(app).get('/tasks?status=todo&page=1&limit=2');
      expect(res.body).toHaveLength(2);
    });
  });

  // BUG #2 at the HTTP level
  test.failing('status filter requires an exact match', async () => {
    await create({ title: 'a', status: 'todo' });
    const res = await request(app).get('/tasks?status=o');
    expect(res.body).toEqual([]);
  });
});

describe('PUT /tasks/:id', () => {
  test('updates fields and persists them', async () => {
    const { body: t } = await create({ title: 'Old' });
    const res = await request(app).put(`/tasks/${t.id}`).send({ title: 'New', priority: 'high', status: 'in_progress' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: t.id, title: 'New', priority: 'high', status: 'in_progress' });
    const list = await request(app).get('/tasks');
    expect(list.body[0].title).toBe('New');
  });

  test('404 for unknown id', async () => {
    const res = await request(app).put('/tasks/nope').send({ title: 'x' });
    expect(res.status).toBe(404);
  });

  test.each([
    ['blank title', { title: '' }],
    ['bad status', { status: 'bogus' }],
    ['bad priority', { priority: 'bogus' }],
    ['bad dueDate', { dueDate: 'bogus' }],
  ])('400 on %s', async (_, body) => {
    const { body: t } = await create();
    const res = await request(app).put(`/tasks/${t.id}`).send(body);
    expect(res.status).toBe(400);
  });

  test.failing('BUG #4: ignores attempts to overwrite id / createdAt', async () => {
    const { body: t } = await create();
    const res = await request(app).put(`/tasks/${t.id}`).send({ id: 'hacked', createdAt: 'x' });
    expect(res.body.id).toBe(t.id);
    expect(res.body.createdAt).toBe(t.createdAt);
  });

  test.failing('BUG #8: setting status to done via PUT sets completedAt', async () => {
    const { body: t } = await create();
    const res = await request(app).put(`/tasks/${t.id}`).send({ status: 'done' });
    expect(res.body.completedAt).not.toBeNull();
  });
});

describe('DELETE /tasks/:id', () => {
  test('deletes and returns 204', async () => {
    const { body: t } = await create();
    const res = await request(app).delete(`/tasks/${t.id}`);
    expect(res.status).toBe(204);
    expect((await request(app).get('/tasks')).body).toEqual([]);
  });

  test('404 for unknown id', async () => {
    expect((await request(app).delete('/tasks/nope')).status).toBe(404);
  });

  test('deleting twice: second call is 404', async () => {
    const { body: t } = await create();
    await request(app).delete(`/tasks/${t.id}`);
    expect((await request(app).delete(`/tasks/${t.id}`)).status).toBe(404);
  });
});

describe('PATCH /tasks/:id/complete', () => {
  test('marks the task done with a completedAt timestamp', async () => {
    const { body: t } = await create();
    const res = await request(app).patch(`/tasks/${t.id}/complete`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('done');
    expect(res.body.completedAt).not.toBeNull();
  });

  test('404 for unknown id', async () => {
    expect((await request(app).patch('/tasks/nope/complete')).status).toBe(404);
  });

  test.failing('BUG #3: keeps the original priority', async () => {
    const { body: t } = await create({ priority: 'high' });
    const res = await request(app).patch(`/tasks/${t.id}/complete`);
    expect(res.body.priority).toBe('high');
  });
});

describe('GET /tasks/stats', () => {
  test('returns zeroed stats when empty', async () => {
    const res = await request(app).get('/tasks/stats');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ todo: 0, in_progress: 0, done: 0, overdue: 0 });
  });

  test('counts by status and overdue', async () => {
    await create({ status: 'todo', dueDate: '2000-01-01T00:00:00.000Z' });
    await create({ status: 'in_progress' });
    await create({ status: 'done', dueDate: '2000-01-01T00:00:00.000Z' });
    const res = await request(app).get('/tasks/stats');
    expect(res.body).toEqual({ todo: 1, in_progress: 1, done: 1, overdue: 1 });
  });

  test('is not shadowed by the /:id routes', async () => {
    // "stats" must be routed to the stats handler, not treated as an id.
    expect((await request(app).get('/tasks/stats')).body).toHaveProperty('overdue');
  });
});

describe('PATCH /tasks/:id/assign', () => {
  test('assigns a task and returns it', async () => {
    const { body: t } = await create();
    const res = await request(app).patch(`/tasks/${t.id}/assign`).send({ assignee: 'Alice' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: t.id, assignee: 'Alice' });
  });

  test('assignment persists', async () => {
    const { body: t } = await create();
    await request(app).patch(`/tasks/${t.id}/assign`).send({ assignee: 'Alice' });
    expect((await request(app).get('/tasks')).body[0].assignee).toBe('Alice');
  });

  test('trims surrounding whitespace', async () => {
    const { body: t } = await create();
    const res = await request(app).patch(`/tasks/${t.id}/assign`).send({ assignee: '  Alice  ' });
    expect(res.body.assignee).toBe('Alice');
  });

  test('404 for unknown task', async () => {
    const res = await request(app).patch('/tasks/nope/assign').send({ assignee: 'Alice' });
    expect(res.status).toBe(404);
  });

  test.each([
    ['empty string', { assignee: '' }],
    ['whitespace only', { assignee: '   ' }],
    ['missing field', {}],
    ['non-string', { assignee: 5 }],
    ['null', { assignee: null }],
    ['too long', { assignee: 'x'.repeat(101) }],
  ])('400 on %s, and task is left unchanged', async (_, body) => {
    const { body: t } = await create();
    const res = await request(app).patch(`/tasks/${t.id}/assign`).send(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toEqual(expect.any(String));
    expect((await request(app).get('/tasks')).body[0].assignee).toBeNull();
  });

  test('reassigning an already-assigned task is allowed and overwrites', async () => {
    const { body: t } = await create();
    await request(app).patch(`/tasks/${t.id}/assign`).send({ assignee: 'Alice' });
    const res = await request(app).patch(`/tasks/${t.id}/assign`).send({ assignee: 'Bob' });
    expect(res.status).toBe(200);
    expect(res.body.assignee).toBe('Bob');
  });

  test('assigning the same person twice is idempotent', async () => {
    const { body: t } = await create();
    await request(app).patch(`/tasks/${t.id}/assign`).send({ assignee: 'Alice' });
    const res = await request(app).patch(`/tasks/${t.id}/assign`).send({ assignee: 'Alice' });
    expect(res.status).toBe(200);
    expect(res.body.assignee).toBe('Alice');
  });

  test('works on completed tasks (assignment is orthogonal to status)', async () => {
    const { body: t } = await create();
    await request(app).patch(`/tasks/${t.id}/complete`);
    const res = await request(app).patch(`/tasks/${t.id}/assign`).send({ assignee: 'Alice' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('done');
  });
});

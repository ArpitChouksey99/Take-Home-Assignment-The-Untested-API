const service = require('../src/services/taskService');

const seed = (n, overrides = {}) =>
  Array.from({ length: n }, (_, i) => service.create({ title: `Task ${i + 1}`, ...overrides }));

beforeEach(() => service._reset());

describe('taskService.create', () => {
  test('applies defaults', () => {
    const t = service.create({ title: 'A' });
    expect(t).toMatchObject({
      title: 'A',
      description: '',
      status: 'todo',
      priority: 'medium',
      dueDate: null,
      completedAt: null,
    });
    expect(t.id).toEqual(expect.any(String));
    expect(new Date(t.createdAt).toString()).not.toBe('Invalid Date');
  });

  test('respects supplied fields', () => {
    const t = service.create({ title: 'A', description: 'd', status: 'in_progress', priority: 'high', dueDate: '2030-01-01T00:00:00.000Z' });
    expect(t).toMatchObject({ description: 'd', status: 'in_progress', priority: 'high', dueDate: '2030-01-01T00:00:00.000Z' });
  });

  test('generates unique ids', () => {
    const [a, b] = seed(2);
    expect(a.id).not.toBe(b.id);
  });

  test('new tasks are unassigned', () => {
    expect(service.create({ title: 'A' }).assignee).toBeNull();
  });
});

describe('taskService.getAll / findById', () => {
  test('getAll returns every task, and mutating the returned array does not affect the store', () => {
    seed(3);
    const all = service.getAll();
    expect(all).toHaveLength(3);
    all.pop();
    expect(service.getAll()).toHaveLength(3);
  });

  test('findById returns the task or undefined', () => {
    const [t] = seed(1);
    expect(service.findById(t.id)).toEqual(t);
    expect(service.findById('nope')).toBeUndefined();
  });
});

describe('taskService.getByStatus', () => {
  beforeEach(() => {
    service.create({ title: 'a', status: 'todo' });
    service.create({ title: 'b', status: 'in_progress' });
    service.create({ title: 'c', status: 'done' });
  });

  test('returns only exact matches', () => {
    expect(service.getByStatus('todo').map((t) => t.title)).toEqual(['a']);
    expect(service.getByStatus('done').map((t) => t.title)).toEqual(['c']);
  });

  test('returns empty array for no matches', () => {
    expect(service.getByStatus('nonexistent')).toEqual([]);
  });

  // BUG #2: implemented with String.includes, so partial strings match.
  test.failing('does not match on substrings (e.g. "o" or "progress")', () => {
    expect(service.getByStatus('o')).toEqual([]);
    expect(service.getByStatus('progress')).toEqual([]);
  });
});

describe('taskService.getPaginated', () => {
  beforeEach(() => seed(5));

  // Regression tests for BUG #1 (fixed): pages are 1-indexed.
  test('page 1 returns the first items', () => {
    expect(service.getPaginated(1, 2).map((t) => t.title)).toEqual(['Task 1', 'Task 2']);
  });

  test('page 2 returns the next items', () => {
    expect(service.getPaginated(2, 2).map((t) => t.title)).toEqual(['Task 3', 'Task 4']);
  });

  test('last page may be partial', () => {
    expect(service.getPaginated(3, 2).map((t) => t.title)).toEqual(['Task 5']);
  });

  test('page beyond the end returns empty array', () => {
    expect(service.getPaginated(4, 2)).toEqual([]);
  });

  test('limit larger than dataset returns everything', () => {
    expect(service.getPaginated(1, 100)).toHaveLength(5);
  });
});

describe('taskService.getStats', () => {
  test('is all zeros when empty', () => {
    expect(service.getStats()).toEqual({ todo: 0, in_progress: 0, done: 0, overdue: 0 });
  });

  test('counts by status', () => {
    service.create({ title: 'a', status: 'todo' });
    service.create({ title: 'b', status: 'todo' });
    service.create({ title: 'c', status: 'in_progress' });
    service.create({ title: 'd', status: 'done' });
    expect(service.getStats()).toMatchObject({ todo: 2, in_progress: 1, done: 1, overdue: 0 });
  });

  test('overdue counts past-due tasks that are not done', () => {
    const past = '2000-01-01T00:00:00.000Z';
    const future = '2999-01-01T00:00:00.000Z';
    service.create({ title: 'late todo', dueDate: past });
    service.create({ title: 'late in progress', status: 'in_progress', dueDate: past });
    service.create({ title: 'late but done', status: 'done', dueDate: past });
    service.create({ title: 'future', dueDate: future });
    service.create({ title: 'no due date' });
    expect(service.getStats().overdue).toBe(2);
  });
});

describe('taskService.update', () => {
  test('merges fields and persists', () => {
    const [t] = seed(1);
    const updated = service.update(t.id, { title: 'New', priority: 'high' });
    expect(updated).toMatchObject({ id: t.id, title: 'New', priority: 'high' });
    expect(service.findById(t.id).title).toBe('New');
  });

  test('returns null for unknown id', () => {
    expect(service.update('nope', { title: 'x' })).toBeNull();
  });

  // BUG #4: fields are spread straight onto the task with no whitelist.
  test.failing('cannot overwrite immutable fields (id, createdAt)', () => {
    const [t] = seed(1);
    const updated = service.update(t.id, { id: 'hacked', createdAt: 'x' });
    expect(updated.id).toBe(t.id);
    expect(updated.createdAt).toBe(t.createdAt);
  });
});

describe('taskService.remove', () => {
  test('removes an existing task', () => {
    const [a, b] = seed(2);
    expect(service.remove(a.id)).toBe(true);
    expect(service.getAll()).toEqual([b]);
  });

  test('returns false for unknown id', () => {
    expect(service.remove('nope')).toBe(false);
  });
});

describe('taskService.completeTask', () => {
  test('sets status done and completedAt', () => {
    const [t] = seed(1);
    const done = service.completeTask(t.id);
    expect(done.status).toBe('done');
    expect(new Date(done.completedAt).toString()).not.toBe('Invalid Date');
    expect(service.findById(t.id).status).toBe('done');
  });

  test('returns null for unknown id', () => {
    expect(service.completeTask('nope')).toBeNull();
  });

  // BUG #3: completeTask hard-codes priority: 'medium'.
  test.failing('preserves the existing priority', () => {
    const t = service.create({ title: 'urgent', priority: 'high' });
    expect(service.completeTask(t.id).priority).toBe('high');
  });

  // BUG #5: completing twice overwrites the original completion time.
  test.failing('is idempotent: re-completing keeps the original completedAt', () => {
    jest.useFakeTimers();
    try {
      const [t] = seed(1);
      jest.setSystemTime(new Date('2030-01-01T00:00:00Z'));
      const first = service.completeTask(t.id);
      jest.setSystemTime(new Date('2030-06-01T00:00:00Z'));
      const second = service.completeTask(t.id);
      expect(second.completedAt).toBe(first.completedAt);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('taskService.assignTask', () => {
  test('stores the assignee and returns the updated task', () => {
    const [t] = seed(1);
    const result = service.assignTask(t.id, 'Alice');
    expect(result.assignee).toBe('Alice');
    expect(service.findById(t.id).assignee).toBe('Alice');
  });

  test('does not touch other fields', () => {
    const t = service.create({ title: 'keep', priority: 'high', status: 'in_progress' });
    expect(service.assignTask(t.id, 'Bob')).toMatchObject({ title: 'keep', priority: 'high', status: 'in_progress' });
  });

  test('reassigning overwrites the previous assignee', () => {
    const [t] = seed(1);
    service.assignTask(t.id, 'Alice');
    expect(service.assignTask(t.id, 'Bob').assignee).toBe('Bob');
  });

  test('returns null for unknown id', () => {
    expect(service.assignTask('nope', 'Alice')).toBeNull();
  });
});

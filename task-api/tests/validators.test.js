const { validateCreateTask, validateUpdateTask, validateAssign } = require('../src/utils/validators');

describe('validateCreateTask', () => {
  test('accepts a minimal valid body', () => {
    expect(validateCreateTask({ title: 'ok' })).toBeNull();
  });

  test('accepts a fully specified body', () => {
    expect(validateCreateTask({ title: 'ok', status: 'done', priority: 'low', dueDate: '2030-01-01' })).toBeNull();
  });

  test.each([
    ['missing title', {}],
    ['empty title', { title: '' }],
    ['whitespace title', { title: '   ' }],
    ['non-string title', { title: 123 }],
    ['bad status', { title: 'x', status: 'pending' }],
    ['bad priority', { title: 'x', priority: 'urgent' }],
    ['bad dueDate', { title: 'x', dueDate: 'not-a-date' }],
  ])('rejects %s', (_, body) => {
    expect(validateCreateTask(body)).toEqual(expect.any(String));
  });
});

describe('validateUpdateTask', () => {
  test('accepts an empty body (all fields optional)', () => {
    expect(validateUpdateTask({})).toBeNull();
  });

  test.each([
    ['empty title', { title: '' }],
    ['non-string title', { title: 5 }],
    ['bad status', { status: 'nope' }],
    ['bad priority', { priority: 'nope' }],
    ['bad dueDate', { dueDate: 'nope' }],
  ])('rejects %s', (_, body) => {
    expect(validateUpdateTask(body)).toEqual(expect.any(String));
  });
});

describe('validateAssign', () => {
  test('accepts a normal name', () => {
    expect(validateAssign({ assignee: 'Alice' })).toBeNull();
  });

  test.each([
    ['missing assignee', {}],
    ['empty string', { assignee: '' }],
    ['whitespace only', { assignee: '   ' }],
    ['number', { assignee: 42 }],
    ['null', { assignee: null }],
    ['object', { assignee: { name: 'x' } }],
    ['too long', { assignee: 'a'.repeat(101) }],
  ])('rejects %s', (_, body) => {
    expect(validateAssign(body)).toEqual(expect.any(String));
  });

  test('handles an undefined body', () => {
    expect(validateAssign(undefined)).toEqual(expect.any(String));
  });
});

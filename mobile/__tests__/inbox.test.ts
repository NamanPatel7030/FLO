import type { InboxItem } from '../src/api/types';
import { latestId, mergeInbox, newIds, normalizeItem } from '../src/lib/inbox';
import { relativeTime } from '../src/lib/time';

const item = (id: string, createdAt: string, extra: Partial<InboxItem> = {}): InboxItem => ({
  id,
  kind: 'claude_done',
  title: `t${id}`,
  body: '',
  data: null,
  createdAt,
  ...extra,
});

describe('normalizeItem', () => {
  it('stringifies numeric ids and fills defaults', () => {
    expect(normalizeItem({ id: 7, kind: 'reminder', title: 'Hi', createdAt: '2026-11-01T10:00:00Z' })).toEqual({
      id: '7',
      kind: 'reminder',
      title: 'Hi',
      body: '',
      data: null,
      createdAt: '2026-11-01T10:00:00Z',
    });
  });

  it('drops items without an id', () => {
    expect(normalizeItem({ title: 'x' })).toBeNull();
    expect(normalizeItem(null)).toBeNull();
    expect(normalizeItem('nope')).toBeNull();
    expect(normalizeItem({ id: '' })).toBeNull();
  });
});

describe('mergeInbox', () => {
  const a = item('1', '2026-11-01T10:00:00Z');
  const b = item('2', '2026-11-01T11:00:00Z');

  it('dedupes by id with incoming winning, newest first', () => {
    const merged = mergeInbox([a, b], [{ ...b, title: 'updated' }, item('3', '2026-11-01T12:00:00Z')]);
    expect(merged.map((i) => i.id)).toEqual(['3', '2', '1']);
    expect(merged[1].title).toBe('updated');
  });

  it('treats numeric and string ids as the same item', () => {
    const merged = mergeInbox([a], [{ id: 1, kind: 'reminder', title: 'n', body: '', createdAt: a.createdAt }]);
    expect(merged).toHaveLength(1);
    expect(merged[0].kind).toBe('reminder');
  });

  it('breaks createdAt ties by numeric id descending', () => {
    const t = '2026-11-01T10:00:00Z';
    const merged = mergeInbox([], [item('9', t), item('10', t), item('2', t)]);
    expect(merged.map((i) => i.id)).toEqual(['10', '9', '2']);
  });

  it('ignores invalid entries and caps the length', () => {
    const many = Array.from({ length: 130 }, (_, i) =>
      item(String(i), new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString()),
    );
    const merged = mergeInbox([], [...many, null, { nope: true }]);
    expect(merged).toHaveLength(100);
    expect(merged[0].id).toBe('129');
  });

  it('is a no-op for an empty fetch', () => {
    expect(mergeInbox([b, a], [])).toEqual([b, a]);
  });
});

describe('latestId / newIds', () => {
  it('returns the newest id', () => {
    expect(latestId([])).toBeUndefined();
    expect(latestId([item('1', '2026-11-01T10:00:00Z'), item('5', '2026-11-02T10:00:00Z')])).toBe('5');
  });

  it('finds ids that are new', () => {
    const prev = [item('1', '2026-11-01T10:00:00Z')];
    const next = [item('2', '2026-11-01T11:00:00Z'), ...prev];
    expect(newIds(prev, next)).toEqual(['2']);
  });
});

describe('relativeTime', () => {
  const now = Date.parse('2026-11-08T12:00:00Z');
  it('formats', () => {
    expect(relativeTime('2026-11-08T11:59:40Z', now)).toBe('just now');
    expect(relativeTime('2026-11-08T11:55:00Z', now)).toBe('5m ago');
    expect(relativeTime('2026-11-08T09:00:00Z', now)).toBe('3h ago');
    expect(relativeTime('2026-11-07T10:00:00Z', now)).toBe('Yesterday');
    expect(relativeTime('2026-11-04T12:00:00Z', now)).toBe('4d ago');
    expect(relativeTime('bad', now)).toBe('');
  });
});

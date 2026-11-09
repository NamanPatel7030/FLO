import { NOTIFICATION_KINDS } from '../src/api/types';
import { androidChannels, GROUPS, groupForKind, isMuted, kindLabel, metaForKind } from '../src/lib/kinds';

describe('notification kind mapping', () => {
  it('maps every contract kind to a group', () => {
    expect(groupForKind('claude_done')).toBe('claude');
    expect(groupForKind('claude_needs_you')).toBe('claude');
    expect(groupForKind('todo_due')).toBe('todos');
    expect(groupForKind('todos_digest')).toBe('todos');
    expect(groupForKind('reminder')).toBe('reminders');
    expect(groupForKind('skill_ran')).toBe('skills');
    expect(groupForKind('meeting_summary')).toBe('meetings');
    for (const k of NOTIFICATION_KINDS) expect(groupForKind(k)).not.toBe('general');
  });

  it('falls back to general for unknown kinds', () => {
    expect(groupForKind('something_new')).toBe('general');
    expect(groupForKind(undefined)).toBe('general');
    expect(metaForKind(null).channelId).toBe('default');
    expect(kindLabel('???')).toBe('Flo');
  });

  it('uses the Flo palette per kind', () => {
    expect(metaForKind('claude_done').color).toBe('#d97757');
    expect(metaForKind('reminder').color).toBe('#f5b544');
  });

  it('defines one unique Android channel per group', () => {
    const ids = androidChannels().map((c) => c.channelId);
    expect(ids).toEqual(['claude', 'todos', 'reminders', 'skills', 'meetings', 'default']);
    expect(new Set(ids).size).toBe(ids.length);
    expect(GROUPS.claude.importance).toBeGreaterThan(GROUPS.skills.importance);
  });

  it('applies per-group mutes but never mutes general', () => {
    expect(isMuted('skill_ran', { skills: true })).toBe(true);
    expect(isMuted('claude_done', { skills: true })).toBe(false);
    expect(isMuted('mystery', { claude: true, todos: true })).toBe(false);
  });
});

describe('flo_answer', () => {
  it('is a general (never muted) kind with its own label', () => {
    const { groupForKind, isMuted, kindLabel } = require('../src/lib/kinds');
    expect(groupForKind('flo_answer')).toBe('general');
    expect(isMuted('flo_answer', { claude: true, todos: true })).toBe(false);
    expect(kindLabel('flo_answer')).toBe('Flo · Your computer answered');
  });
});

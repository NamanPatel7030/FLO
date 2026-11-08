// Notification kind -> group / Android channel / colour / label mapping.

export type KindGroup = 'claude' | 'todos' | 'reminders' | 'skills' | 'meetings' | 'general';

/** Groups the user can mute (everything except the generic fallback). */
export const MUTABLE_GROUPS: readonly Exclude<KindGroup, 'general'>[] = [
  'claude',
  'todos',
  'reminders',
  'skills',
  'meetings',
];

/** Android importance levels, mirroring expo-notifications' AndroidImportance enum values. */
export const Importance = { DEFAULT: 3, HIGH: 4, MAX: 5, LOW: 2 } as const;

export interface GroupMeta {
  group: KindGroup;
  /** Android notification channel id; the server should send FCM `android.notification.channel_id` = this. */
  channelId: string;
  channelName: string;
  channelDescription: string;
  importance: number;
  label: string;
  color: string;
  /** Darker tint for gradients. */
  colorDeep: string;
  icon: 'claude' | 'todos' | 'reminders' | 'skills' | 'meetings' | 'general';
}

export const GROUPS: Record<KindGroup, GroupMeta> = {
  claude: {
    group: 'claude',
    channelId: 'claude',
    channelName: 'Claude',
    channelDescription: 'When Claude Code finishes a task or needs your input',
    importance: Importance.HIGH,
    label: 'Claude',
    color: '#d97757',
    colorDeep: '#8a3f26',
    icon: 'claude',
  },
  todos: {
    group: 'todos',
    channelId: 'todos',
    channelName: 'To-dos',
    channelDescription: 'Due to-dos and your daily to-do digest',
    importance: Importance.DEFAULT,
    label: 'To-dos',
    color: '#4aa8ff',
    colorDeep: '#1a5fb0',
    icon: 'todos',
  },
  reminders: {
    group: 'reminders',
    channelId: 'reminders',
    channelName: 'Reminders',
    channelDescription: 'Reminders you asked Flo to give you',
    importance: Importance.HIGH,
    label: 'Reminder',
    color: '#f5b544',
    colorDeep: '#9a6512',
    icon: 'reminders',
  },
  skills: {
    group: 'skills',
    channelId: 'skills',
    channelName: 'Skills',
    channelDescription: 'Results from scheduled skills',
    importance: Importance.DEFAULT,
    label: 'Skill',
    color: '#a78bfa',
    colorDeep: '#5b3fc4',
    icon: 'skills',
  },
  meetings: {
    group: 'meetings',
    channelId: 'meetings',
    channelName: 'Meetings',
    channelDescription: 'Meeting summaries',
    importance: Importance.DEFAULT,
    label: 'Meeting',
    color: '#2dd4bf',
    colorDeep: '#0f7a6d',
    icon: 'meetings',
  },
  general: {
    group: 'general',
    channelId: 'default',
    channelName: 'General',
    channelDescription: 'Other updates from Flo',
    importance: Importance.DEFAULT,
    label: 'Flo',
    color: '#66ceff',
    colorDeep: '#1a9be0',
    icon: 'general',
  },
};

const KIND_TO_GROUP: Record<string, KindGroup> = {
  claude_done: 'claude',
  claude_needs_you: 'claude',
  claude_limit: 'claude',
  claude_resumed: 'claude',
  todo_due: 'todos',
  todos_digest: 'todos',
  reminder: 'reminders',
  skill_ran: 'skills',
  meeting_summary: 'meetings',
};

export function groupForKind(kind: string | null | undefined): KindGroup {
  return (kind && KIND_TO_GROUP[kind]) || 'general';
}

export function metaForKind(kind: string | null | undefined): GroupMeta {
  return GROUPS[groupForKind(kind)];
}

/** Short, human sub-label per kind ("Needs you", "Digest"…). */
export function kindLabel(kind: string | null | undefined): string {
  switch (kind) {
    case 'claude_done':
      return 'Claude · Done';
    case 'claude_needs_you':
      return 'Claude · Needs you';
    case 'claude_limit':
      return 'Claude · Limit reached';
    case 'claude_resumed':
      return 'Claude · Resumed';
    case 'todo_due':
      return 'To-do due';
    case 'todos_digest':
      return 'To-dos today';
    case 'reminder':
      return 'Reminder';
    case 'skill_ran':
      return 'Skill ran';
    case 'meeting_summary':
      return 'Meeting summary';
    default:
      return 'Flo';
  }
}

/** All channels the app registers on Android, in display order. */
export function androidChannels(): GroupMeta[] {
  return [...MUTABLE_GROUPS.map((g) => GROUPS[g]), GROUPS.general];
}

export function isMuted(kind: string | null | undefined, muted: Partial<Record<KindGroup, boolean>>): boolean {
  const g = groupForKind(kind);
  return g !== 'general' && !!muted[g];
}

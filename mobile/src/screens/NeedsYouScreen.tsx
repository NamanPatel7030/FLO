// Sessions: every Claude Code session on your computer. Answer what Claude is asking (pick an
// option, Allow / Deny, or type an answer), and give a finished session its next prompt, without
// touching the computer. Replies go through Flo on your computer, which says whether it got there
// ("Sent to api-server") or exactly why not.
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Approval, ClaudeSessionView, SessionState } from '../api/types';
import { liveApprovals, replyStage, sortSessions } from '../lib/computer';
import { relativeTime } from '../lib/time';
import { useVoice, type Voice } from '../lib/voice';
import { useComputer } from '../state/Computer';
import { useFlo } from '../state/FloContext';
import { GlassButton, IconButton, PrimaryButton, tap } from '../ui/Buttons';
import { ActionNotice, EmptyState, NoComputer, ScreenHeader } from '../ui/ComputerBits';
import { GlassCard } from '../ui/Glass';
import { Icon } from '../ui/Icons';
import { TAB_BAR_SPACE } from '../ui/TabBar';
import { colors, fonts, themed, type } from '../ui/theme';

function left(expiresAt: string, now: number): string {
  const ms = Date.parse(expiresAt) - now;
  if (Number.isNaN(ms)) return '';
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const BADGE: Record<SessionState, { label: string; color: () => string }> = {
  needs_approval: { label: 'Needs you', color: () => colors.amber },
  waiting_reply: { label: 'Asking you', color: () => colors.amber },
  done: { label: 'Finished', color: () => colors.green },
  working: { label: 'Working', color: () => colors.sky },
  idle: { label: 'Quiet', color: () => colors.inkFaint },
};

const PLACEHOLDER: Record<string, string> = {
  instant: 'Tell Claude what to do next',
  queued: 'Claude gets this when it finishes',
  answer: 'Or type an answer',
  resume: 'Its terminal is closed. Flo will start it again.',
};

/** Allow / Deny for one permission prompt. */
function ApprovalButtons({ a, onAnswer }: { a: Approval; onAnswer: (allow: boolean) => void }) {
  const command = a.summary.startsWith('Run: ') ? a.summary.slice(5) : null;
  return (
    <View style={{ gap: 12 }}>
      {command ? (
        <View style={styles.code}>
          <Text style={styles.codeText} selectable>
            {command}
          </Text>
        </View>
      ) : (
        <Text style={styles.summary}>{a.summary}</Text>
      )}
      {a.sending ? (
        <View style={styles.sending}>
          <ActivityIndicator size="small" color={colors.sky} />
          <Text style={type.small}>{a.sending === 'approve' ? 'Allowing' : 'Denying'} on your computer...</Text>
        </View>
      ) : (
        <View style={styles.buttons}>
          <GlassButton testID={`deny-${a.id}`} label="Deny" style={{ flex: 1 }} danger onPress={() => onAnswer(false)} icon={<Icon name="close" size={17} color={colors.danger} strokeWidth={2.2} />} />
          <PrimaryButton testID={`allow-${a.id}`} label="Allow" style={{ flex: 1.4 }} onPress={() => onAnswer(true)} icon={<Icon name="check" size={18} color={colors.onPrimary} strokeWidth={2.4} />} />
        </View>
      )}
    </View>
  );
}

/** A permission prompt from a session the phone doesn't list (older computers). */
function ApprovalCard({ a, now, onAnswer }: { a: Approval; now: number; onAnswer: (allow: boolean) => void }) {
  const remaining = left(a.expiresAt, now);
  return (
    <GlassCard style={styles.card} radius={24} tint={colors.amber} strong>
      <View style={styles.cardTop}>
        <View style={[styles.cardIcon, styles.amberIcon]}>
          <Icon name="claude" size={20} color={colors.amber} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.project} numberOfLines={1}>
            Claude Code · {a.project}
          </Text>
          <Text style={type.small}>{a.tool ? `Wants to use ${a.tool}` : 'Wants permission'}</Text>
        </View>
        {!!remaining && !a.sending && (
          <View style={styles.timer}>
            <Text style={styles.timerText}>{remaining}</Text>
          </View>
        )}
      </View>
      <ApprovalButtons a={a} onAnswer={onAnswer} />
    </GlassCard>
  );
}

function Chip({ label, on, onPress, testID }: { label: string; on: boolean; onPress: () => void; testID?: string }) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      onPress={() => {
        tap();
        onPress();
      }}
      style={({ pressed }) => [styles.chip, on && styles.chipOn, pressed && { opacity: 0.75 }]}
    >
      <Text style={[styles.chipText, on && styles.chipTextOn]}>{label}</Text>
    </Pressable>
  );
}

/** Option chips for a multiple-choice question. One single-choice question sends on tap. */
function Choices({ s, onChoose }: { s: ClaudeSessionView; onChoose: (answers: string[][]) => void }) {
  const qs = s.question?.questions ?? [];
  const [picked, setPicked] = useState<string[][]>(() => qs.map(() => []));
  useEffect(() => setPicked(qs.map(() => [])), [s.question?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const instant = qs.length === 1 && !qs[0].multiSelect;
  const ready = picked.length === qs.length && picked.every((p) => p.length > 0);
  return (
    <View style={{ gap: 14 }}>
      {qs.map((q, i) => (
        <View key={`${s.question?.id}-${i}`} style={{ gap: 8 }}>
          <Text style={styles.question}>{q.question}</Text>
          {q.multiSelect && <Text style={type.small}>Pick any that fit.</Text>}
          <View style={styles.chips}>
            {q.options.map((o) => (
              <Chip
                key={o}
                testID={`choose-${s.id}-${i}-${o}`}
                label={o}
                on={picked[i]?.includes(o) ?? false}
                onPress={() => {
                  if (instant) return onChoose([[o]]);
                  setPicked((cur) =>
                    cur.map((p, j) => (j !== i ? p : q.multiSelect ? (p.includes(o) ? p.filter((x) => x !== o) : [...p, o]) : [o])),
                  );
                }}
              />
            ))}
          </View>
        </View>
      ))}
      {!instant && <PrimaryButton testID={`send-choice-${s.id}`} label="Send answer" disabled={!ready} onPress={() => onChoose(picked)} />}
    </View>
  );
}

function ReplyBox({
  s,
  draft,
  setDraft,
  voice,
  listeningHere,
  onMic,
  onSend,
}: {
  s: ClaudeSessionView;
  draft: string;
  setDraft: (t: string) => void;
  voice: Voice;
  listeningHere: boolean;
  onMic: () => void;
  onSend: () => void;
}) {
  const canSend = draft.trim().length > 0 && draft.length <= 4000;
  return (
    <View style={styles.replyRow}>
      <TextInput
        testID={`reply-${s.id}`}
        style={styles.input}
        value={draft}
        onChangeText={setDraft}
        placeholder={PLACEHOLDER[s.reply] ?? 'Reply'}
        placeholderTextColor={colors.inkFaint}
        multiline
        maxLength={4000}
        editable={!listeningHere}
      />
      {voice.supported && (
        <IconButton label={listeningHere ? 'Stop listening' : 'Speak a reply'} onPress={onMic} testID={`mic-${s.id}`}>
          <Icon name={listeningHere ? 'close' : 'mic'} size={20} color={listeningHere ? colors.danger : colors.sky} strokeWidth={2.1} />
        </IconButton>
      )}
      <IconButton label="Send" onPress={() => canSend && onSend()} testID={`send-${s.id}`}>
        <View style={[styles.sendBtn, !canSend && { opacity: 0.4 }]}>
          <Icon name="share" size={18} color={colors.onPrimary} strokeWidth={2.2} />
        </View>
      </IconButton>
    </View>
  );
}

function SessionCard({
  s,
  approval,
  now,
  sent,
  draft,
  setDraft,
  voice,
  listeningHere,
  onMic,
  onReply,
  onChoose,
  onAnswer,
}: {
  s: ClaudeSessionView;
  approval?: Approval;
  now: number;
  sent?: string;
  draft: string;
  setDraft: (t: string) => void;
  voice: Voice;
  listeningHere: boolean;
  onMic: () => void;
  onReply: () => void;
  onChoose: (answers: string[][]) => void;
  onAnswer: (allow: boolean) => void;
}) {
  const badge = BADGE[s.state];
  const needsYou = s.state === 'needs_approval' || s.state === 'waiting_reply';
  const name = s.folder || s.project;
  const sub = s.project && s.project !== name ? s.project : 'Claude Code';
  const remaining = approval ? left(approval.expiresAt, now) : '';
  return (
    <GlassCard style={styles.card} radius={24} tint={needsYou ? colors.amber : undefined} strong={needsYou}>
      <View style={styles.cardTop} testID={`session-${s.id}`}>
        <View style={[styles.cardIcon, needsYou ? styles.amberIcon : styles.skyIcon]}>
          <Icon name={needsYou ? 'claude' : 'terminal'} size={19} color={needsYou ? colors.amber : colors.sky} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.project} numberOfLines={1}>
            {name}
          </Text>
          <Text style={type.small} numberOfLines={1}>
            {sub}
            {s.updatedAt ? ` · ${relativeTime(s.updatedAt, now).toLowerCase()}` : ''}
          </Text>
        </View>
        {remaining && !approval?.sending ? (
          <View style={styles.timer}>
            <Text style={styles.timerText}>{remaining}</Text>
          </View>
        ) : (
          <View style={[styles.badge, { borderColor: badge.color() }]}>
            {s.state === 'working' && <ActivityIndicator size="small" color={badge.color()} style={{ transform: [{ scale: 0.6 }], marginLeft: -4, marginRight: -2 }} />}
            <Text style={[styles.badgeText, { color: badge.color() }]}>{badge.label}</Text>
          </View>
        )}
      </View>

      {!!s.message && (
        <Text style={styles.message} numberOfLines={approval || s.question ? 2 : 4}>
          {s.message}
        </Text>
      )}

      {s.sending ? (
        replyStage(s.sending.since, now) === 'slow' ? (
          <View style={styles.status}>
            <Icon name="laptop" size={17} color={colors.amber} />
            <Text style={[type.small, { flex: 1 }]}>Your computer hasn't picked this up yet. It will once Flo is open there.</Text>
          </View>
        ) : (
          <View style={styles.status}>
            <ActivityIndicator size="small" color={colors.sky} />
            <Text style={[type.small, { flex: 1 }]} numberOfLines={2}>
              Sending "{s.sending.text}" to your computer...
            </Text>
          </View>
        )
      ) : (
        <>
          {!!sent && (
            <View style={styles.status}>
              <Icon name="check" size={17} color={colors.green} strokeWidth={2.4} />
              <Text style={[type.small, { flex: 1 }]}>{sent}</Text>
            </View>
          )}
          {approval && <ApprovalButtons a={approval} onAnswer={onAnswer} />}
          {s.question && <Choices s={s} onChoose={onChoose} />}
          {s.reply !== 'none' ? (
            <ReplyBox s={s} draft={draft} setDraft={setDraft} voice={voice} listeningHere={listeningHere} onMic={onMic} onSend={onReply} />
          ) : (
            !!s.replyHint && <Text style={styles.hint}>{s.replyHint}</Text>
          )}
          {listeningHere && !!voice.error && <Text style={styles.hint}>{voice.error}</Text>}
        </>
      )}
    </GlassCard>
  );
}

/** "api-server finished": a quiet strip that goes away by itself. */
function FinishedStrip({ text, onDismiss }: { text: string; onDismiss: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 8000);
    return () => clearTimeout(t);
  }, [text, onDismiss]);
  return (
    <Pressable testID="finished-banner" onPress={onDismiss} accessibilityRole="alert" style={styles.finished}>
      <Icon name="check" size={16} color={colors.green} strokeWidth={2.4} />
      <Text style={styles.finishedText}>{text}</Text>
    </Pressable>
  );
}

export function NeedsYouScreen() {
  const insets = useSafeAreaInsets();
  const c = useComputer();
  const flo = useFlo();
  const voice = useVoice(flo.mock);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [voiceFor, setVoiceFor] = useState<string | null>(null);
  const st = c.state;
  const now = c.now;

  // what the mic hears goes into the reply box it was started from
  useEffect(() => {
    if (voiceFor && voice.text) setDrafts((d) => ({ ...d, [voiceFor]: voice.text }));
  }, [voice.text, voiceFor]);
  useEffect(() => {
    if (!voice.listening && voiceFor && !voice.error) setVoiceFor(null);
  }, [voice.listening]); // eslint-disable-line react-hooks/exhaustive-deps

  const approvals = st ? liveApprovals(st, now) : [];
  const sessions = useMemo(() => (st ? sortSessions(st.sessions) : []), [st]);
  const claimed = new Set(sessions.map((s) => s.approvalId).filter(Boolean));
  const loose = approvals.filter((a) => !claimed.has(a.id));
  const approvalsOff = st?.settings.find((s) => s.key === 'claudeApprovals')?.value === false;
  // older computers publish no session list: keep the old "waiting" list for them
  const legacyWaiting = st && st.sessions.length === 0 ? st.waiting : [];

  const setDraft = (id: string) => (t: string) => setDrafts((d) => ({ ...d, [id]: t }));
  const send = (s: ClaudeSessionView) => {
    const text = (drafts[s.id] ?? '').trim();
    if (!text) return;
    if (voiceFor === s.id) voice.stop();
    void c.act('reply', s.id, text);
    setDrafts((d) => ({ ...d, [s.id]: '' }));
  };
  const mic = (s: ClaudeSessionView) => {
    if (voice.listening && voiceFor === s.id) return voice.stop();
    if (voice.listening) voice.stop();
    setVoiceFor(s.id);
    void voice.start();
  };

  return (
    <ScrollView
      testID="needs-you"
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ paddingTop: insets.top + 14, paddingBottom: insets.bottom + TAB_BAR_SPACE, paddingHorizontal: 18 }}
      refreshControl={
        <RefreshControl refreshing={false} onRefresh={() => void c.refresh()} tintColor={colors.sky} colors={[colors.sky, colors.ocean]} progressBackgroundColor={colors.bgElevated} />
      }
    >
      <ScreenHeader title="Sessions" />
      {!!c.finished && <FinishedStrip text={c.finished} onDismiss={c.clearFinished} />}
      <ActionNotice />
      {!st ? (
        <NoComputer />
      ) : (
        <>
          {loose.length > 0 && (
            <View style={{ gap: 12, marginBottom: 12 }}>
              {loose.map((a) => (
                <ApprovalCard key={a.id} a={a} now={now} onAnswer={(allow) => void c.act(allow ? 'approve' : 'reject', a.id)} />
              ))}
            </View>
          )}

          {sessions.length > 0 ? (
            <View style={{ gap: 12 }}>
              {sessions.map((s) => (
                <SessionCard
                  key={s.id}
                  s={s}
                  approval={s.approvalId ? approvals.find((a) => a.id === s.approvalId) : undefined}
                  now={now}
                  sent={c.sent[s.id]?.message}
                  draft={drafts[s.id] ?? ''}
                  setDraft={setDraft(s.id)}
                  voice={voice}
                  listeningHere={voice.listening && voiceFor === s.id}
                  onMic={() => mic(s)}
                  onReply={() => send(s)}
                  onChoose={(answers) => void c.act('choose', s.id, { id: s.question?.id, answers })}
                  onAnswer={(allow) => s.approvalId && void c.act(allow ? 'approve' : 'reject', s.approvalId)}
                />
              ))}
              <Text style={styles.footnote}>
                Claude waits a few minutes for an answer, then asks in the terminal on your computer instead. A finished session takes your next prompt right away.
              </Text>
            </View>
          ) : (
            loose.length === 0 && (
              <EmptyState
                mood="proud"
                title="No Claude Code sessions"
                body={
                  approvalsOff
                    ? `"Allow or deny from Flo" is off on your computer, so Claude Code asks in the terminal. Turn it on in Settings to answer here.`
                    : `Start Claude Code on your computer. Its sessions show up here, and you can answer them or give them their next prompt.`
                }
              />
            )
          )}

          {legacyWaiting.length > 0 && (
            <>
              <Text style={styles.section}>Waiting for your reply</Text>
              <GlassCard style={{ paddingVertical: 4 }}>
                {legacyWaiting.map((w, i) => (
                  <View key={w.id} style={[styles.waitRow, i > 0 && styles.divider]}>
                    <View style={[styles.cardIcon, styles.skyIcon]}>
                      <Icon name="terminal" size={18} color={colors.sky} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.project} numberOfLines={1}>
                        {w.project}
                      </Text>
                      <Text style={type.small} numberOfLines={2}>
                        {w.message || 'Claude is waiting for your input'}
                        {w.at ? ` · ${relativeTime(w.at, now).toLowerCase()}` : ''}
                      </Text>
                    </View>
                  </View>
                ))}
              </GlassCard>
              <Text style={styles.footnote}>Update Flo on your computer to reply to these from here.</Text>
            </>
          )}
        </>
      )}
    </ScrollView>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    card: { padding: 18, gap: 14 },
    cardTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    cardIcon: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
    amberIcon: { backgroundColor: colors.dark ? 'rgba(245,181,68,0.14)' : 'rgba(196,122,0,0.1)' },
    skyIcon: { backgroundColor: colors.dark ? 'rgba(102,206,255,0.1)' : 'rgba(47,140,255,0.08)' },
    project: { fontFamily: fonts.semibold, fontSize: 15.5, color: colors.ink, letterSpacing: -0.2 },
    badge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 9, paddingVertical: 3, borderRadius: 10, borderWidth: 1 },
    badgeText: { fontFamily: fonts.semibold, fontSize: 12 },
    timer: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 10, backgroundColor: colors.dark ? 'rgba(255,255,255,0.07)' : 'rgba(20,30,60,0.06)' },
    timerText: { fontFamily: fonts.semibold, fontSize: 12.5, color: colors.inkSoft, fontVariant: ['tabular-nums'] },
    message: { fontFamily: fonts.medium, fontSize: 14.5, lineHeight: 20, color: colors.inkSoft },
    question: { fontFamily: fonts.semibold, fontSize: 15.5, lineHeight: 21, color: colors.ink },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: {
      paddingHorizontal: 14,
      paddingVertical: 9,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.hairline,
      backgroundColor: colors.dark ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.7)',
    },
    chipOn: { backgroundColor: colors.sky, borderColor: colors.sky },
    chipText: { fontFamily: fonts.medium, fontSize: 14.5, color: colors.ink },
    chipTextOn: { color: colors.onPrimary },
    code: { padding: 12, borderRadius: 14, backgroundColor: colors.dark ? 'rgba(0,0,0,0.35)' : 'rgba(11,18,32,0.9)' },
    codeText: { fontFamily: 'monospace', fontSize: 13.5, lineHeight: 19, color: '#e8f3ff' },
    summary: { fontFamily: fonts.medium, fontSize: 15.5, lineHeight: 21, color: colors.ink },
    buttons: { flexDirection: 'row', gap: 10 },
    sending: { flexDirection: 'row', alignItems: 'center', gap: 10, height: 44 },
    status: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 36 },
    replyRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
    input: {
      flex: 1,
      minHeight: 44,
      maxHeight: 140,
      paddingHorizontal: 14,
      paddingTop: 11,
      paddingBottom: 11,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.hairline,
      backgroundColor: colors.dark ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.75)',
      fontFamily: fonts.medium,
      fontSize: 15,
      color: colors.ink,
    },
    sendBtn: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.sky },
    hint: { ...type.small, color: colors.inkMuted },
    finished: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      alignSelf: 'flex-start',
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderRadius: 14,
      marginBottom: 12,
      backgroundColor: colors.dark ? 'rgba(31,157,107,0.16)' : 'rgba(31,157,107,0.1)',
    },
    finishedText: { fontFamily: fonts.semibold, fontSize: 13.5, color: colors.ink },
    section: { ...type.micro, marginTop: 26, marginBottom: 10, marginLeft: 6 },
    waitRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 13 },
    divider: { borderTopWidth: 1, borderTopColor: colors.hairline },
    footnote: { ...type.small, marginTop: 4, marginHorizontal: 6, color: colors.inkFaint },
  }),
);

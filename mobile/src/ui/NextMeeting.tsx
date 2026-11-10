import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { Meeting } from '../api/types';
import { nextMeeting } from '../lib/meetings';
import { GlassCard } from './Glass';
import { Icon } from './Icons';
import { colors, fonts, type, themed } from './theme';

/** "Next meeting · Design sync · in 25 min" on Home (hidden when there's nothing in the next 24 hours). */
export function NextMeetingCard({ meetings }: { meetings: readonly Meeting[] | undefined }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const next = nextMeeting(meetings, now);
  if (!next) return null;
  const started = next.when === 'now';
  return (
    <View style={{ marginTop: 10 }} testID="home-next-meeting" accessible accessibilityLabel={next.label}>
      <GlassCard radius={22} style={styles.row}>
        <View style={styles.icon}>
          <Icon name="meetings" size={20} color={started ? colors.amber : colors.sky} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={type.small}>Next meeting · {next.when}</Text>
          <Text style={styles.title} numberOfLines={1}>
            {next.meeting.title}
          </Text>
        </View>
      </GlassCard>
    </View>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14 },
    icon: {
      width: 40,
      height: 40,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.dark ? 'rgba(102,206,255,0.1)' : 'rgba(47,140,255,0.08)',
    },
    title: { fontFamily: fonts.semibold, fontSize: 15.5, color: colors.ink, letterSpacing: -0.2 },
  }),
);

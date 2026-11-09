// Empty inbox: Notchling floating, a little sleepy when you're at your Mac, waiting when Away.
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { usePrefs } from '../state/Prefs';
import { Notchling } from './Notchling';
import { colors, themed, type } from './theme';

export function EmptyInbox({ away }: { away: boolean }) {
  const { prefs } = usePrefs();
  return (
    <View style={styles.wrap} testID="empty-inbox">
      <Notchling mood={away ? 'listen' : 'sleepy'} size={140} pose="float" plate={false} avatar={prefs.avatar} accent={colors.sky} />
      <Text style={[type.title, styles.title]}>You're all caught up</Text>
      <Text style={[type.body, styles.text]}>
        {away
          ? 'Nothing new from your Mac yet. Claude results, to-dos, reminders and summaries will land here.'
          : "When you're Away, Claude results, to-dos, reminders and meeting summaries from your Mac land here."}
      </Text>
    </View>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    wrap: { alignItems: 'center', paddingVertical: 20, paddingHorizontal: 20 },
    title: { marginTop: 8, textAlign: 'center' },
    text: { textAlign: 'center', marginTop: 8, maxWidth: 300, color: colors.inkMuted },
  }),
);

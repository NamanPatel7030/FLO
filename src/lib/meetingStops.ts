// Meetings the user has stopped (per window). Late transcription events for these notes must never
// bring the meeting UI back (the final sentence can arrive after Stop).
import { api } from "./api";

const stopped = new Set<string>();
let stopping = false;

export const markStopped = (noteId?: string) => {
  if (noteId) stopped.add(noteId);
};
export const isStopped = (noteId?: string) => !!noteId && stopped.has(noteId);

/** Stop the live meeting; marks it stopped immediately (optimistic) and once the backend confirms. */
export async function stopMeetingNow(noteId?: string) {
  markStopped(noteId);
  if (stopping) return;
  stopping = true;
  try {
    const n = await api.stopMeeting();
    markStopped(n?.id);
  } finally {
    stopping = false;
  }
}

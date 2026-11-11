// Speech to text on the phone (Android's own recognizer, on-device when the phone supports it).
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';

type Module = typeof import('expo-speech-recognition');

export interface Voice {
  listening: boolean;
  /** what's been heard so far (partial while listening, final after) */
  text: string;
  error: string | null;
  supported: boolean;
  start(): Promise<void>;
  stop(): void;
  reset(): void;
  setText(t: string): void;
}

/** Friendly words for recognizer errors (unit-tested). */
export function voiceError(code: string, message?: string): string {
  switch (code) {
    case 'not-allowed':
      return 'Flo needs the microphone. Allow it in Settings, then try again.';
    case 'no-speech':
    case 'speech-timeout':
      return "I didn't hear anything. Tap the mic and talk.";
    case 'network':
      return 'No connection, and this language is not downloaded for offline use. Settings, Voice bubble, Offline speech shows how.';
    case 'language-not-supported':
    case 'service-not-allowed':
      return 'This phone has no speech recognizer turned on. Install or enable Google speech services.';
    case 'aborted':
      return '';
    default:
      return message || "Couldn't hear that. Try again.";
  }
}

export interface VoiceOptions {
  /** BCP-47 tag; null = the phone's language */
  lang?: string | null;
  /** no connection: insist on the on-device recognizer */
  offline?: boolean;
  /** the user wants on-device recognition even online */
  device?: boolean;
}

/** The recognizer options for a start (unit-tested). */
export function startOptions(o: VoiceOptions) {
  const onDevice = !!(o.offline || o.device);
  return {
    lang: o.lang || 'en-IN',
    interimResults: true,
    continuous: false,
    addsPunctuation: true,
    requiresOnDeviceRecognition: onDevice,
    androidIntentOptions: { EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS: 1800, ...(onDevice ? { EXTRA_PREFER_OFFLINE: true } : {}) },
  };
}

export function useVoice(mock = false, options: VoiceOptions = {}): Voice {
  const opts = useRef(options);
  opts.current = options;
  const mod = useRef<Module | null>(null);
  const [listening, setListening] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [supported, setSupported] = useState(Platform.OS === 'android' || mock);
  const subs = useRef<{ remove(): void }[]>([]);

  useEffect(() => {
    if (Platform.OS !== 'android' || mock) return;
    let live = true;
    import('expo-speech-recognition')
      .then((m) => {
        if (!live) return;
        mod.current = m;
        try {
          setSupported(m.ExpoSpeechRecognitionModule.isRecognitionAvailable());
        } catch {
          setSupported(false);
        }
        const M = m.ExpoSpeechRecognitionModule;
        subs.current = [
          M.addListener('start', () => setListening(true)),
          M.addListener('end', () => setListening(false)),
          M.addListener('result', (e) => {
            const best = e.results[0]?.transcript ?? '';
            if (best) setText(best);
          }),
          M.addListener('error', (e) => {
            const msg = voiceError(e.error, e.message);
            if (msg) setError(msg);
            setListening(false);
          }),
        ];
      })
      .catch(() => setSupported(false));
    return () => {
      live = false;
      subs.current.forEach((s) => s.remove());
      subs.current = [];
    };
  }, [mock]);

  const start = useCallback(async () => {
    setError(null);
    setText('');
    if (mock) {
      setListening(true);
      const words = "what's on my calendar today".split(' ');
      words.forEach((_, i) => setTimeout(() => setText(words.slice(0, i + 1).join(' ')), 300 * (i + 1)));
      setTimeout(() => setListening(false), 300 * (words.length + 1));
      return;
    }
    const M = mod.current?.ExpoSpeechRecognitionModule;
    if (!M) return setError('Voice input works in the Android app.');
    const perm = await M.requestPermissionsAsync();
    if (!perm.granted) return setError(voiceError('not-allowed'));
    M.start(startOptions(opts.current));
  }, [mock]);

  const stop = useCallback(() => {
    if (mock) return setListening(false);
    mod.current?.ExpoSpeechRecognitionModule.stop();
  }, [mock]);

  const reset = useCallback(() => {
    setText('');
    setError(null);
  }, []);

  return { listening, text, error, supported, start, stop, reset, setText };
}

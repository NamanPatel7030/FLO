"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Minimal typings for the native Web Speech API (not in lib.dom for all targets).
type SpeechRecognitionResultLike = { 0: { transcript: string }; isFinal: boolean };
type SpeechRecognitionEventLike = { resultIndex: number; results: ArrayLike<SpeechRecognitionResultLike> };
interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}
type SRCtor = new () => SpeechRecognitionLike;

function getSR(): SRCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function speechSupported(): boolean {
  return getSR() !== null;
}

export type VoiceStatus = "idle" | "listening" | "denied" | "error" | "unsupported";

/**
 * Real microphone transcription via the native Web Speech API, with a live 0..1 level from a
 * Web Audio AnalyserNode (one rAF loop, paused when the tab is hidden). Fully cleaned up on stop.
 * No new dependencies.
 */
export function useVoice(onLevel?: (v: number) => void) {
  // SSR-safe: "idle" on both server and client first render, then detect support after mount.
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [transcript, setTranscript] = useState("");
  useEffect(() => {
    if (!speechSupported()) setStatus((s) => (s === "idle" ? "unsupported" : s));
  }, []);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const levelCb = useRef(onLevel);
  levelCb.current = onLevel;

  const cleanup = useCallback(() => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    ctxRef.current?.close().catch(() => {});
    ctxRef.current = null;
    try {
      recRef.current?.stop();
    } catch {
      /* already stopped */
    }
    recRef.current = null;
    levelCb.current?.(0);
  }, []);

  const stop = useCallback(() => {
    cleanup();
    setStatus((s) => (s === "listening" ? "idle" : s));
  }, [cleanup]);

  const start = useCallback(async () => {
    const SR = getSR();
    if (!SR) {
      setStatus("unsupported");
      return false;
    }
    setTranscript("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AC();
      ctxRef.current = ctx;
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      src.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        if (document.hidden) {
          rafRef.current = requestAnimationFrame(tick);
          return;
        }
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
          const v = (data[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / data.length);
        levelCb.current?.(Math.min(1, Math.sqrt(rms) * 1.6));
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch {
      setStatus("denied");
      cleanup();
      return false;
    }

    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";
    rec.onresult = (e) => {
      let text = "";
      for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
      setTranscript(text.trim());
    };
    rec.onerror = (e) => {
      setStatus(e.error === "not-allowed" || e.error === "service-not-allowed" ? "denied" : "error");
      cleanup();
    };
    rec.onend = () => {
      setStatus((s) => (s === "listening" ? "idle" : s));
    };
    recRef.current = rec;
    try {
      rec.start();
      setStatus("listening");
      return true;
    } catch {
      setStatus("error");
      cleanup();
      return false;
    }
  }, [cleanup]);

  useEffect(() => cleanup, [cleanup]);

  return { status, transcript, start, stop, supported: status !== "unsupported" };
}

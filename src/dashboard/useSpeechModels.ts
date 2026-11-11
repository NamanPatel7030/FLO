// On-device speech models: the list, live download progress (MB and speed), download / retry /
// delete. Used by setup (the first download and the try-out lock) and Settings → Voice.
import { useCallback, useEffect, useRef, useState } from "react";
import { api, on } from "../lib/api";
import { demoReady, nextSpeed, type Speed } from "../lib/models";
import { EV, type LocalModel, type ModelProgressEvent, type Settings } from "../lib/types";

export interface Download {
  received: number;
  total: number;
  /** bytes per second, smoothed */
  bps: number;
  active: boolean;
  error?: string;
}

const errText = (e: unknown) => String((e as { message?: string })?.message ?? e);

export function useSpeechModels() {
  const [models, setModels] = useState<LocalModel[] | null>(null);
  const [dl, setDl] = useState<Record<string, Download>>({});
  const speeds = useRef<Record<string, Speed>>({});
  const refresh = useCallback(() => api.listModels().then(setModels).catch(() => {}), []);

  useEffect(() => {
    refresh();
    return on<ModelProgressEvent>(EV.modelProgress, (e) => {
      if (e.done) {
        delete speeds.current[e.id];
        // an error event carries no byte counts: keep the last ones (a retry resumes from there)
        setDl((d) => ({ ...d, [e.id]: { received: e.error ? (d[e.id]?.received ?? 0) : e.received, total: e.error ? (d[e.id]?.total ?? 0) : e.total, bps: 0, active: false, error: e.error } }));
        refresh();
        return;
      }
      const sp = nextSpeed(speeds.current[e.id] ?? null, Date.now(), e.received);
      speeds.current[e.id] = sp;
      setDl((d) => ({ ...d, [e.id]: { received: e.received, total: e.total, bps: sp.bps, active: true } }));
    });
  }, [refresh]);

  const download = useCallback((id: string) => {
    setDl((d) => ({ ...d, [id]: { received: d[id]?.received ?? 0, total: d[id]?.total ?? 0, bps: 0, active: true } }));
    api.downloadModel(id).catch((err) =>
      setDl((d) => ({ ...d, [id]: { received: d[id]?.received ?? 0, total: d[id]?.total ?? 0, bps: 0, active: false, error: d[id]?.error ?? errText(err) } })),
    );
  }, []);

  const remove = useCallback((id: string) => api.deleteModel(id).then(refresh), [refresh]);

  return { models, dl, download, remove, refresh };
}

export type SetupPhase = "checking" | "cloud" | "downloading" | "loading" | "ready" | "error";

/** Setup's speech model: picks the model to get ready (the small starter on a fresh install),
 *  downloads it right away, then loads it. The try-out stays locked until `ready`. */
export function useSetupModel(s: Settings | null, set: (p: Partial<Settings>) => void) {
  const sm = useSpeechModels();
  const [picked, setPicked] = useState(false);
  const [loaded, setLoaded] = useState<string | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const started = useRef(new Set<string>());
  const loading = useRef<string | null>(null);
  const local = s?.sttProvider === "local";
  const setRef = useRef(set);
  setRef.current = set;

  // once: the backend says which model setup gets ready (the chosen one if it's on disk)
  useEffect(() => {
    if (!s || !local || picked) return;
    setPicked(true);
    api
      .setupSpeechModel()
      .then((id) => {
        if (id && id !== s.sttModel) setRef.current({ sttModel: id });
      })
      .catch(() => {});
  }, [s, local, picked]);

  const id = local && picked ? s!.sttModel : null;
  const model = id ? sm.models?.find((m) => m.id === id) : undefined;
  const d = id ? sm.dl[id] : undefined;

  // download as soon as it's known to be missing (once; after a failure only Try again restarts it)
  useEffect(() => {
    if (!model || model.installed || started.current.has(model.id)) return;
    started.current.add(model.id);
    sm.download(model.id);
  }, [model, sm]);

  // then load it, so the first dictation is real and quick
  useEffect(() => {
    if (!model?.installed || loaded === model.id || loading.current === model.id || loadErr) return;
    loading.current = model.id;
    api
      .loadSpeechModel(model.id)
      .then(() => setLoaded(model.id))
      .catch((e) => setLoadErr(errText(e)))
      .finally(() => {
        loading.current = null;
      });
  }, [model, loaded, loadErr]);

  const phase: SetupPhase = !s
    ? "checking"
    : !local
      ? "cloud"
      : !model
        ? "checking"
        : !model.installed
          ? d?.error
            ? "error"
            : "downloading"
          : loadErr
            ? "error"
            : loaded === model.id
              ? "ready"
              : "loading";

  const retry = () => {
    if (!model) return;
    if (!model.installed) sm.download(model.id);
    else setLoadErr(null);
  };

  const ready = demoReady({ sttProvider: s?.sttProvider ?? "local", installed: !!model?.installed, loaded: !!model && loaded === model.id });
  return { ...sm, phase, model, progress: d, error: phase === "error" ? (loadErr ?? d?.error ?? null) : null, retry, ready };
}

export type SetupModel = ReturnType<typeof useSetupModel>;

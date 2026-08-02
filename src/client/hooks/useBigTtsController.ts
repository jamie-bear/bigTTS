import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import { activeSegmentLimits, isOpenRouterGemini31Model, isOpenRouterPcmModel, knownModelVoiceGender, PROVIDERS, sortVoiceOptions, voiceGenderLabel } from "../config/providers";
import { api, fileToBase64 } from "../services/apiClient";
import { AudioEngine } from "../services/audioEngine";
import { NarrationSession } from "../services/narrationSession";
import { STORAGE_KEYS, writeCredential, writeVoiceClones } from "../services/storage";
import { appReducer, createInitialState } from "../state/appState";
import type { NarrationOptions, ProviderId, SelectOption, ServerEvent, VoiceClone } from "../types/contracts";

const MAX_MINIMAX_SAMPLE_BYTES = 20 * 1024 * 1024;

export const SAMPLE_TEXT = `Chapter One

The morning train crossed the valley just as the clouds began to lift from the river. Mara watched the light spill across the windows and tried to remember the sentence she had written before sleep took her. It had been a good sentence, she was sure of that, the sort that opened a door in the mind and made the next page feel inevitable.

She found the notebook in her coat pocket. Between two pages was a ticket, folded once, with a station name she did not recognize. When the conductor passed, he paused beside her seat and smiled as if they had spoken many times before.

"You will want the north platform when we arrive," he said.

Mara looked down at the ticket again. The ink was fresh. Under the station name, in a careful hand, someone had written: Bring the whole story.`;

const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);

export function useBigTtsController(audioRef: React.RefObject<HTMLAudioElement | null>) {
  const [state, dispatch] = useReducer(appReducer, undefined, createInitialState);
  const stateRef = useRef(state);
  const audioEngineRef = useRef<AudioEngine | null>(null);
  const sessionRef = useRef<NarrationSession | null>(null);
  const balanceRequestRef = useRef(0);
  stateRef.current = state;

  const setStatus = useCallback((status: string) => dispatch({ type: "patch", patch: { status } }), []);

  useEffect(() => {
    if (!audioRef.current) return;
    audioEngineRef.current = new AudioEngine(audioRef.current, {
      onStatus: (message) => {
        const phase = stateRef.current.phase;
        if (phase !== "completed" && phase !== "stopped" && phase !== "error" && phase !== "paused" && phase !== "recoverable") setStatus(message);
      },
      onAudioAvailable: () => dispatch({ type: "patch", patch: { audioAvailable: true } })
    });
    return () => {
      sessionRef.current?.dispose();
      audioEngineRef.current?.dispose();
    };
  }, [audioRef, setStatus]);

  const refreshGoogle = useCallback(async (signal?: AbortSignal) => {
    try {
      const googleOAuth = await api.googleStatus(signal);
      dispatch({ type: "patch", patch: { googleOAuth } });
      return googleOAuth;
    } catch (error) {
      const googleOAuth = { configured: false, connected: false, error: errorMessage(error) };
      dispatch({ type: "patch", patch: { googleOAuth } });
      return googleOAuth;
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void refreshGoogle(controller.signal);
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.data?.type !== "google-oauth") return;
      if (event.data.ok) void refreshGoogle();
      else {
        const message = event.data.message || "Google OAuth failed.";
        dispatch({
          type: "patch",
          patch: { googleOAuth: { ...stateRef.current.googleOAuth, connected: false, error: message } }
        });
        setStatus(message);
      }
    };
    window.addEventListener("message", handleMessage);
    return () => { controller.abort(); window.removeEventListener("message", handleMessage); };
  }, [refreshGoogle, setStatus]);

  const refreshBalance = useCallback(async (signal?: AbortSignal) => {
    const current = stateRef.current;
    const provider = current.provider;
    const apiKey = current.credentials[provider].trim();
    const requestId = ++balanceRequestRef.current;
    if (!PROVIDERS[provider].supportsBalance) return;
    if (!apiKey) {
      dispatch({ type: "patch", patch: { providerBalance: null } });
      return;
    }
    try {
      const providerBalance = await api.providerBalance(provider, apiKey, signal);
      const latest = stateRef.current;
      if (signal?.aborted || requestId !== balanceRequestRef.current || latest.provider !== provider || latest.credentials[provider].trim() !== apiKey) return;
      dispatch({ type: "patch", patch: { providerBalance } });
    } catch {
      const latest = stateRef.current;
      if (signal?.aborted || requestId !== balanceRequestRef.current || latest.provider !== provider || latest.credentials[provider].trim() !== apiKey) return;
      dispatch({ type: "patch", patch: { providerBalance: null } });
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => void refreshBalance(controller.signal), state.credentials[state.provider] ? 450 : 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [refreshBalance, state.credentials, state.provider]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      const current = stateRef.current;
      const key = current.credentials[current.provider].trim();
      try {
        if (current.provider === "openrouter") {
          if (!key) {
            dispatch({ type: "patch", patch: { openrouterModels: [], openrouterVoiceOptions: {}, openrouterModel: "", voice: "" } });
            return;
          }
          const { models } = await api.openRouterModels(key, controller.signal);
          if (controller.signal.aborted || stateRef.current.provider !== "openrouter") return;
          const voiceMap = Object.fromEntries(models.map((model) => [model.id, sortVoiceOptions(model.voices || [])]));
          const preferred = models.some((model) => model.id === current.openrouterModel) ? current.openrouterModel : models[0]?.id || "";
          if (preferred) sessionStorage.setItem(STORAGE_KEYS.openrouterModel, preferred);
          const options = voiceMap[preferred] || [];
          const limits = activeSegmentLimits("openrouter", preferred);
          dispatch({ type: "patch", patch: { openrouterModels: models, openrouterVoiceOptions: voiceMap, openrouterModel: preferred, voice: options[0]?.value || "", segmentChars: limits.defaultSegmentChars } });
          setStatus(models.length ? `Loaded ${models.length.toLocaleString()} OpenRouter speech models.` : "No OpenRouter speech models were returned.");
        } else if (current.provider === "resemble") {
          if (!key) { dispatch({ type: "patch", patch: { resembleVoices: [], voice: "" } }); return; }
          const { voices } = await api.resembleVoices(key, controller.signal);
          if (controller.signal.aborted || stateRef.current.provider !== "resemble") return;
          dispatch({ type: "patch", patch: { resembleVoices: voices, voice: voices[0]?.id || "" } });
          setStatus(voices.length ? `Loaded ${voices.length.toLocaleString()} Resemble.ai custom voice${voices.length === 1 ? "" : "s"}.` : "No ready Resemble.ai custom voices were returned for this key.");
        } else if (current.provider === "minimax") {
          let remote: VoiceClone[] = [];
          if (key) remote = (await api.minimaxVoices(key, controller.signal)).voices || [];
          if (controller.signal.aborted || stateRef.current.provider !== "minimax") return;
          const merged = mergeVoices(current.minimaxVoices, remote);
          writeVoiceClones("minimaxVoiceClones", merged);
          dispatch({ type: "patch", patch: { minimaxVoices: merged, voice: current.voice || merged[0]?.id || "" } });
        }
      } catch (error) {
        if (!controller.signal.aborted) setStatus(`${PROVIDERS[current.provider].label} discovery failed: ${errorMessage(error)}`);
      }
    }, state.credentials[state.provider] ? 450 : 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [state.provider, state.credentials, setStatus]);

  const refreshMinimaxVoices = useCallback(async () => {
    const current = stateRef.current;
    const apiKey = current.credentials.minimax.trim();
    if (!apiKey) return setStatus("Add your MiniMax API key before refreshing custom voices.");
    dispatch({ type: "patch", patch: { operationBusy: true } });
    try {
      const remote = (await api.minimaxVoices(apiKey)).voices || [];
      const voices = mergeVoices(stateRef.current.minimaxVoices, remote);
      writeVoiceClones("minimaxVoiceClones", voices);
      dispatch({ type: "patch", patch: { minimaxVoices: voices, voice: stateRef.current.voice || voices[0]?.id || "", status: `Loaded ${voices.length.toLocaleString()} MiniMax custom voice${voices.length === 1 ? "" : "s"}.` } });
    } catch (error) {
      setStatus(`MiniMax voice refresh failed: ${errorMessage(error)}`);
    } finally {
      dispatch({ type: "patch", patch: { operationBusy: false } });
    }
  }, [setStatus]);

  const providerConfig = PROVIDERS[state.provider];
  const openrouterBaseVoices = state.openrouterVoiceOptions[state.openrouterModel] || providerConfig.voices;
  const voiceOptions = useMemo<SelectOption[]>(() => {
    let options: SelectOption[];
    if (state.provider === "resemble") options = state.resembleVoices.length ? state.resembleVoices.map((voice) => ({ value: voice.id, label: voice.languages?.[0] ? `${voice.name} (${voice.languages[0]})` : voice.name, gender: voice.gender })) : providerConfig.voices;
    else if (state.provider === "minimax") options = state.minimaxVoices.length ? state.minimaxVoices.map((voice) => ({ value: voice.id, label: voice.model ? `${voice.name} (${voice.model})` : voice.name, gender: voice.gender })) : providerConfig.voices;
    else options = state.provider === "openrouter"
      ? openrouterBaseVoices.map((voice) => ({ ...voice, gender: voice.gender || knownModelVoiceGender(state.openrouterModel, voice.value) }))
      : providerConfig.voices;
    return sortVoiceOptions(options).map((option) => {
      const gender = voiceGenderLabel(option.gender);
      return gender ? { ...option, label: `${option.label} — ${gender}` } : option;
    });
  }, [openrouterBaseVoices, providerConfig.voices, state.minimaxVoices, state.openrouterModel, state.provider, state.resembleVoices]);

  const hasVoiceGenderMetadata = useMemo(() => voiceOptions.some((option) => Boolean(voiceGenderLabel(option.gender))), [voiceOptions]);

  const selectProvider = useCallback((provider: ProviderId) => {
    sessionStorage.setItem(STORAGE_KEYS.provider, provider);
    dispatch({ type: "provider", provider });
  }, []);

  const setCredential = useCallback((value: string) => {
    const current = stateRef.current;
    dispatch({ type: "credential", provider: current.provider, value });
    writeCredential(current.provider, value, current.rememberCredential[current.provider]);
  }, []);

  const setRememberCredential = useCallback((value: boolean) => {
    const current = stateRef.current;
    dispatch({ type: "remember", provider: current.provider, value });
    writeCredential(current.provider, current.credentials[current.provider], value);
  }, []);

  const selectOpenRouterModel = useCallback((model: string) => {
    sessionStorage.setItem(STORAGE_KEYS.openrouterModel, model);
    const limits = activeSegmentLimits("openrouter", model);
    const options = stateRef.current.openrouterVoiceOptions[model] || [];
    dispatch({ type: "patch", patch: { openrouterModel: model, voice: options[0]?.value || "", segmentChars: limits.defaultSegmentChars } });
  }, []);

  const setMinimaxModel = useCallback((model: string) => {
    sessionStorage.setItem(STORAGE_KEYS.minimaxModel, model);
    dispatch({ type: "patch", patch: { minimaxModel: model } });
  }, []);

  const saveMinimaxClone = useCallback(async (values: { name: string; languageModel: string; promptText: string; validationText: string; source?: File; prompt?: File }) => {
    const current = stateRef.current;
    const apiKey = current.credentials.minimax.trim();
    if (!apiKey) return setStatus("Add your MiniMax API key before creating voice clones.");
    if (!values.name.trim()) return setStatus("Name the MiniMax voice clone first.");
    if (!values.source) return setStatus("Choose source audio to create a MiniMax voice clone.");
    if (values.source.size > MAX_MINIMAX_SAMPLE_BYTES || (values.prompt && values.prompt.size > MAX_MINIMAX_SAMPLE_BYTES)) return setStatus("MiniMax voice clone audio files must be 20 MB or smaller.");
    if ((values.prompt && !values.promptText.trim()) || (!values.prompt && values.promptText.trim())) return setStatus("MiniMax prompt audio and prompt text must be provided together.");
    dispatch({ type: "patch", patch: { operationBusy: true } });
    try {
      const payload = {
        apiKey, name: values.name.trim(), model: current.minimaxModel,
        promptText: values.promptText.trim(), validationText: values.validationText.trim(), languageModel: values.languageModel,
        sourceAudio: await fileToBase64(values.source), sourceFilename: values.source.name,
        sourceContentType: values.source.type || "application/octet-stream", promptAudio: values.prompt ? await fileToBase64(values.prompt) : "",
        promptFilename: values.prompt?.name || "", promptContentType: values.prompt?.type || "application/octet-stream"
      };
      const { voice } = await api.createMinimaxVoice(payload);
      const voices = [voice, ...current.minimaxVoices.filter((item) => item.id !== voice.id)];
      writeVoiceClones("minimaxVoiceClones", voices);
      dispatch({ type: "patch", patch: { minimaxVoices: voices, voice: voice.id, status: `MiniMax voice clone created: ${voice.name}.` } });
    } catch (error) { setStatus(`MiniMax voice clone failed: ${errorMessage(error)}`); }
    finally { dispatch({ type: "patch", patch: { operationBusy: false } }); }
  }, [setStatus]);

  const deleteMinimaxClone = useCallback(async () => {
    const current = stateRef.current;
    if (!current.voice) return setStatus("Select a MiniMax voice clone to delete.");
    const apiKey = current.credentials.minimax.trim();
    if (!apiKey) return setStatus("Add your MiniMax API key before deleting a MiniMax voice clone.");
    dispatch({ type: "patch", patch: { operationBusy: true } });
    try {
      await api.deleteMinimaxVoice(apiKey, current.voice);
      const voices = current.minimaxVoices.filter((voice) => voice.id !== current.voice);
      writeVoiceClones("minimaxVoiceClones", voices);
      dispatch({ type: "patch", patch: { minimaxVoices: voices, voice: voices[0]?.id || "", status: "MiniMax voice clone deleted." } });
    } catch (error) { setStatus(`MiniMax voice clone delete failed: ${errorMessage(error)}`); }
    finally { dispatch({ type: "patch", patch: { operationBusy: false } }); }
  }, [setStatus]);

  const renameMinimaxClone = useCallback((voiceId: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return setStatus("Enter a display name for the MiniMax voice clone.");
    const current = stateRef.current;
    const voices = current.minimaxVoices.map((voice) => voice.id === voiceId ? { ...voice, name: trimmed } : voice);
    writeVoiceClones("minimaxVoiceClones", voices);
    dispatch({ type: "patch", patch: { minimaxVoices: voices, status: `Voice display name updated to ${trimmed}.` } });
  }, [setStatus]);

  const handleServerEvent = useCallback((event: ServerEvent) => {
    if (event.type === "meta") {
      audioEngineRef.current?.configure(event.audioEncoding, event.sampleRate, event.channels);
      dispatch({ type: "patch", patch: { totalSegments: event.totalSegments, currentSegment: 0, progress: 0, status: `Prepared ${event.totalSegments} streaming segments.` } });
    } else if (event.type === "status") setStatus(event.message);
    else if (event.type === "segment") {
      audioEngineRef.current?.beginSegment(event.index);
      stateRef.current = { ...stateRef.current, phase: "generating" };
      dispatch({ type: "patch", patch: { phase: "generating", currentSegment: event.index, totalSegments: event.totalSegments, progress: ((event.index - 1) / event.totalSegments) * 100, segmentFailure: null, status: `Generating segment ${event.index}...` } });
    } else if (event.type === "segmentDone") {
      audioEngineRef.current?.finishSegment(event.index);
      dispatch({ type: "patch", patch: { currentSegment: event.index, totalSegments: event.totalSegments, progress: (event.index / event.totalSegments) * 100, status: `Buffered segment ${event.index}.` } });
      void refreshBalance();
    } else if (event.type === "pausePending") {
      stateRef.current = { ...stateRef.current, phase: "pausing" };
      dispatch({ type: "patch", patch: { phase: "pausing", status: `Finishing segment ${event.currentSegment} before pausing generation...` } });
    } else if (event.type === "paused") {
      stateRef.current = { ...stateRef.current, phase: "paused" };
      dispatch({ type: "patch", patch: { phase: "paused", currentSegment: event.completedSegments, totalSegments: event.totalSegments, status: `Generation paused after segment ${event.completedSegments}. Playback remains available.` } });
    } else if (event.type === "resumed") {
      stateRef.current = { ...stateRef.current, phase: "generating" };
      dispatch({ type: "patch", patch: { phase: "generating", totalSegments: event.totalSegments, status: `Generation resumed. Preparing segment ${event.nextSegment}...` } });
    } else if (event.type === "segmentFailed") {
      const segmentFailure = { index: event.index, totalSegments: event.totalSegments, message: event.message, details: event.details };
      stateRef.current = { ...stateRef.current, phase: "recoverable", segmentFailure };
      const stitchedAudio = audioEngineRef.current?.snapshot() || null;
      dispatch({
        type: "patch",
        patch: {
          phase: "recoverable",
          currentSegment: event.index,
          totalSegments: event.totalSegments,
          progress: ((event.index - 1) / event.totalSegments) * 100,
          segmentFailure,
          stitchedAudio,
          audioAvailable: Boolean(stitchedAudio),
          status: `Segment ${event.index} needs attention. Retry it or skip it to continue.`
        }
      });
    } else if (event.type === "segmentRetrying") {
      stateRef.current = { ...stateRef.current, phase: "generating", segmentFailure: null };
      dispatch({ type: "patch", patch: { phase: "generating", segmentFailure: null, status: `Retrying segment ${event.index}...` } });
    } else if (event.type === "segmentSkipped") {
      stateRef.current = { ...stateRef.current, phase: "generating", segmentFailure: null };
      dispatch({ type: "patch", patch: { phase: "generating", currentSegment: event.index, totalSegments: event.totalSegments, progress: (event.index / event.totalSegments) * 100, segmentFailure: null, status: `Skipped segment ${event.index}. Continuing narration...` } });
    } else if (event.type === "complete") {
      stateRef.current = { ...stateRef.current, phase: "completed" };
      const stitchedAudio = audioEngineRef.current?.complete() || null;
      dispatch({ type: "patch", patch: { phase: "completed", progress: 100, segmentFailure: null, stitchedAudio, audioAvailable: Boolean(stitchedAudio), status: stitchedAudio ? `Narration fully generated. Continuous ${stitchedAudio.extension.toUpperCase()} ready.` : "Narration fully generated, but no audio was received." } });
    } else if (event.type === "cancelled") {
      stateRef.current = { ...stateRef.current, phase: "stopped" };
      const stitchedAudio = audioEngineRef.current?.finalize() || null;
      dispatch({ type: "patch", patch: { phase: "stopped", segmentFailure: null, stitchedAudio, audioAvailable: Boolean(stitchedAudio), status: stitchedAudio ? `${event.message || "Cancelled."} Partial ${stitchedAudio.extension.toUpperCase()} is ready.` : event.message || "Cancelled." } });
    } else if (event.type === "error") {
      stateRef.current = { ...stateRef.current, phase: "error" };
      const stitchedAudio = audioEngineRef.current?.finalize() || null;
      dispatch({ type: "patch", patch: { phase: "error", segmentFailure: null, stitchedAudio, audioAvailable: Boolean(stitchedAudio), status: stitchedAudio ? `${event.message || "Narration failed."} Partial ${stitchedAudio.extension.toUpperCase()} is ready.` : event.message || "Narration failed." } });
    }
  }, [refreshBalance, setStatus]);

  const startNarration = useCallback(async () => {
    const current = stateRef.current;
    let googleOAuth = current.googleOAuth;
    if (current.provider === "google") googleOAuth = await refreshGoogle();
    const apiKey = current.credentials[current.provider].trim();
    if (!apiKey && !(current.provider === "google" && googleOAuth.connected)) return setStatus(current.provider === "google" ? "Connect Google before starting narration." : `Add your ${PROVIDERS[current.provider].credentialLabel}.`);
    if (!current.text.trim()) return setStatus("Paste text or load a .txt file.");
    if (current.provider === "openrouter" && !current.openrouterModel) return setStatus("Select an OpenRouter speech model before starting narration.");
    if ((current.provider === "resemble" || current.provider === "minimax") && !current.voice) return setStatus(`Select a ${PROVIDERS[current.provider].label} voice before starting narration.`);
    writeCredential(current.provider, apiKey, current.rememberCredential[current.provider]);
    const options: NarrationOptions = {
      provider: current.provider, voice: current.voice, language: current.language, speed: current.speed,
      segmentChars: current.segmentChars, optimizeStreamingLatency: current.lowLatency, textNormalization: current.textNormalization,
      model: current.provider === "openrouter" ? current.openrouterModel : current.provider === "minimax" ? current.minimaxModel : "",
      geminiContinuity: current.provider === "openrouter" && isOpenRouterGemini31Model(current.openrouterModel) && current.geminiContinuity,
      geminiNarratorDirection: current.provider === "openrouter" && isOpenRouterGemini31Model(current.openrouterModel) ? current.geminiNarratorDirection : ""
    };
    const initialPcm = current.provider === "gemini" || current.provider === "google" || current.provider === "resemble" || (current.provider === "openrouter" && isOpenRouterPcmModel(current.openrouterModel));
    audioEngineRef.current?.reset(initialPcm ? "pcm_s16le" : "mpeg");
    stateRef.current = { ...stateRef.current, phase: "connecting" };
    dispatch({ type: "patch", patch: { phase: "connecting", status: "Opening local narration stream...", progress: 0, currentSegment: 0, totalSegments: 0, segmentFailure: null, stitchedAudio: null, audioAvailable: false } });
    const session = new NarrationSession({
      onOpen: () => setStatus("Narration stream connected."), onEvent: handleServerEvent,
      onAudio: (chunk) => audioEngineRef.current?.push(chunk),
      onClose: () => {
        const phase = stateRef.current.phase;
        if (phase === "connecting" || phase === "generating" || phase === "pausing" || phase === "paused" || phase === "recoverable") {
          stateRef.current = { ...stateRef.current, phase: "error" };
          const stitchedAudio = audioEngineRef.current?.finalize() || null;
          dispatch({ type: "patch", patch: { phase: "error", segmentFailure: null, stitchedAudio, audioAvailable: Boolean(stitchedAudio), status: stitchedAudio ? `Narration stream closed unexpectedly. Partial ${stitchedAudio.extension.toUpperCase()} is ready.` : "Narration stream closed unexpectedly." } });
        }
      },
      onError: (message) => {
        stateRef.current = { ...stateRef.current, phase: "error" };
        const stitchedAudio = audioEngineRef.current?.finalize() || null;
        dispatch({ type: "patch", patch: { phase: "error", segmentFailure: null, stitchedAudio, audioAvailable: Boolean(stitchedAudio), status: stitchedAudio ? `${message} Partial ${stitchedAudio.extension.toUpperCase()} is ready.` : message } });
      }
    });
    sessionRef.current = session;
    session.start({ type: "start", apiKey, text: current.text.trim(), options });
  }, [handleServerEvent, refreshGoogle, setStatus]);

  const stopNarration = useCallback(() => {
    sessionRef.current?.cancel();
    stateRef.current = { ...stateRef.current, phase: "stopped" };
    const stitchedAudio = audioEngineRef.current?.finalize() || null;
    dispatch({ type: "patch", patch: { phase: "stopped", segmentFailure: null, stitchedAudio, audioAvailable: Boolean(stitchedAudio), status: stitchedAudio ? `Stopped. Partial ${stitchedAudio.extension.toUpperCase()} is ready.` : "Stopped." } });
  }, []);

  const pauseGeneration = useCallback(() => {
    const phase = stateRef.current.phase;
    if (phase !== "connecting" && phase !== "generating") return;
    sessionRef.current?.pause();
    stateRef.current = { ...stateRef.current, phase: "pausing" };
    dispatch({ type: "patch", patch: { phase: "pausing", status: "Pause requested. Waiting for the current segment to finish..." } });
  }, []);

  const resumeGeneration = useCallback(() => {
    if (stateRef.current.phase !== "paused") return;
    sessionRef.current?.resume();
    stateRef.current = { ...stateRef.current, phase: "generating" };
    dispatch({ type: "patch", patch: { phase: "generating", status: "Resuming generation..." } });
  }, []);

  const retryFailedSegment = useCallback(() => {
    if (stateRef.current.phase !== "recoverable") return;
    sessionRef.current?.retrySegment();
    stateRef.current = { ...stateRef.current, phase: "generating", segmentFailure: null };
    dispatch({ type: "patch", patch: { phase: "generating", segmentFailure: null, status: `Retrying segment ${stateRef.current.currentSegment}...` } });
  }, []);

  const skipFailedSegment = useCallback(() => {
    if (stateRef.current.phase !== "recoverable") return;
    sessionRef.current?.skipSegment();
    stateRef.current = { ...stateRef.current, phase: "generating", segmentFailure: null };
    dispatch({ type: "patch", patch: { phase: "generating", segmentFailure: null, status: `Skipping segment ${stateRef.current.currentSegment}...` } });
  }, []);

  const disconnectGoogle = useCallback(async () => {
    try { dispatch({ type: "patch", patch: { googleOAuth: await api.disconnectGoogle(), status: "Google disconnected." } }); }
    catch (error) { setStatus(`Google disconnect failed: ${errorMessage(error)}`); }
  }, [setStatus]);

  const connectGoogle = useCallback(() => {
    const popup = window.open("/auth/google/start", "bigtts-google-oauth", "popup=yes,width=560,height=720");
    if (!popup) setStatus("Allow popups to connect Google.");
  }, [setStatus]);

  const download = useCallback(() => {
    const current = stateRef.current;
    const stitchedAudio = audioEngineRef.current?.snapshot() || current.stitchedAudio;
    if (stitchedAudio) audioEngineRef.current?.download(stitchedAudio, current.provider);
  }, []);

  const stats = useMemo(() => {
    const chars = state.text.length;
    const price = providerConfig.costPerMillionChars;
    const segments = chars ? Math.ceil(chars / Math.max(1, state.segmentChars)) : 0;
    return {
      chars,
      segments,
      cost: price === undefined ? null : `$${((chars / 1_000_000) * price).toFixed(3)} estimated`
    };
  }, [providerConfig.costPerMillionChars, state.segmentChars, state.text.length]);

  return {
    state, providerConfig, voiceOptions, hasVoiceGenderMetadata, stats,
    limits: activeSegmentLimits(state.provider, state.openrouterModel),
    actions: {
      selectProvider, setCredential, setRememberCredential, selectOpenRouterModel, setMinimaxModel,
      setText: (text: string) => dispatch({ type: "patch", patch: { text } }),
      setVoice: (voice: string) => dispatch({ type: "patch", patch: { voice } }),
      setLanguage: (language: string) => dispatch({ type: "patch", patch: { language } }),
      setSpeed: (speed: number) => dispatch({ type: "patch", patch: { speed } }),
      setSegmentChars: (value: number) => dispatch({ type: "segment", value }),
      setLowLatency: (lowLatency: boolean) => dispatch({ type: "patch", patch: { lowLatency } }),
      setTextNormalization: (textNormalization: boolean) => dispatch({ type: "patch", patch: { textNormalization } }),
      setGeminiContinuity: (geminiContinuity: boolean) => {
        sessionStorage.setItem(STORAGE_KEYS.geminiContinuity, String(geminiContinuity));
        dispatch({ type: "patch", patch: { geminiContinuity } });
      },
      setGeminiNarratorDirection: (geminiNarratorDirection: string) => {
        const value = geminiNarratorDirection.slice(0, 800);
        sessionStorage.setItem(STORAGE_KEYS.geminiNarratorDirection, value);
        dispatch({ type: "patch", patch: { geminiNarratorDirection: value } });
      },
      loadSample: () => dispatch({ type: "patch", patch: { text: SAMPLE_TEXT } }),
      clearText: () => dispatch({ type: "patch", patch: { text: "" } }),
      loadTextFile: async (file: File) => dispatch({ type: "patch", patch: { text: await file.text(), status: `Loaded ${file.name}.` } }),
      saveMinimaxClone, refreshMinimaxVoices, deleteMinimaxClone, renameMinimaxClone,
      connectGoogle, disconnectGoogle, refreshGoogle, startNarration, pauseGeneration, resumeGeneration, retryFailedSegment, skipFailedSegment, stopNarration, download
    }
  };
}

function mergeVoices(local: VoiceClone[], remote: VoiceClone[]) {
  const merged = new Map(local.map((voice) => [voice.id, {
    id: voice.id,
    name: voice.name || voice.id,
    ...(voice.model ? { model: voice.model } : {})
  }]));
  remote.forEach((voice) => {
    const saved = merged.get(voice.id);
    const model = saved?.model || voice.model;
    merged.set(voice.id, {
      id: voice.id,
      name: saved?.name || voice.name || voice.id,
      ...(model ? { model } : {})
    });
  });
  return [...merged.values()];
}

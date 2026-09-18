import { PROVIDERS, activeSegmentLimits, isGoogleProvider } from "../config/providers";
import { readCredentials, readProvider, readVoiceClones, STORAGE_KEYS } from "../services/storage";
import type { GoogleAccessMethod, GoogleOAuthStatus, NarrationPhase, OpenRouterModel, ProviderBalance, ProviderId, SegmentFailure, SelectOption, StitchedAudio, VoiceClone } from "../types/contracts";

export interface AppState {
  provider: ProviderId;
  googleAccessMethod: GoogleAccessMethod;
  credentials: Record<ProviderId, string>;
  rememberCredential: Record<ProviderId, boolean>;
  text: string;
  voice: string;
  voiceIdOverrides: Record<"resemble" | "minimax", string>;
  language: string;
  speed: number;
  segmentChars: number;
  segmentByProvider: Record<ProviderId, number>;
  lowLatency: boolean;
  textNormalization: boolean;
  openrouterModel: string;
  openrouterModels: OpenRouterModel[];
  openrouterVoiceOptions: Record<string, SelectOption[]>;
  geminiPreviousContext: boolean;
  geminiFollowingContext: boolean;
  geminiNarratorDirection: string;
  minimaxModel: string;
  minimaxVoices: VoiceClone[];
  resembleVoices: VoiceClone[];
  googleOAuth: GoogleOAuthStatus;
  providerBalance: ProviderBalance | null;
  phase: NarrationPhase;
  status: string;
  currentSegment: number;
  totalSegments: number;
  progress: number;
  stitchedAudio: StitchedAudio | null;
  audioAvailable: boolean;
  segmentFailure: SegmentFailure | null;
  operationBusy: boolean;
}

const providerIds = Object.keys(PROVIDERS) as ProviderId[];

export function createInitialState(): AppState {
  const provider = readProvider();
  const config = PROVIDERS[provider];
  const credentials = readCredentials();
  const segmentByProvider = Object.fromEntries(providerIds.map((id) => [id, PROVIDERS[id].defaultSegmentChars])) as Record<ProviderId, number>;
  const rememberCredential = Object.fromEntries(providerIds.map((id) => [id, Boolean(sessionStorage.getItem(PROVIDERS[id].storageKey))])) as Record<ProviderId, boolean>;
  const legacyGeminiContinuity = sessionStorage.getItem(STORAGE_KEYS.geminiContinuity) !== "false";
  return {
    provider,
    googleAccessMethod: provider === "google" ? "oauth" : provider === "gemini" ? "api-key" : sessionStorage.getItem(STORAGE_KEYS.googleAccessMethod) === "oauth" ? "oauth" : "api-key",
    credentials,
    rememberCredential,
    text: "",
    voice: config.defaultVoice,
    voiceIdOverrides: {
      resemble: sessionStorage.getItem(STORAGE_KEYS.resembleVoiceIdOverride) ?? "",
      minimax: sessionStorage.getItem(STORAGE_KEYS.minimaxVoiceIdOverride) ?? ""
    },
    language: config.defaultLanguage,
    speed: 1,
    segmentChars: config.defaultSegmentChars,
    segmentByProvider,
    lowLatency: true,
    textNormalization: false,
    openrouterModel: sessionStorage.getItem(STORAGE_KEYS.openrouterModel) ?? "",
    openrouterModels: [],
    openrouterVoiceOptions: {},
    geminiPreviousContext: readStoredBoolean(STORAGE_KEYS.geminiPreviousContext, legacyGeminiContinuity),
    geminiFollowingContext: readStoredBoolean(STORAGE_KEYS.geminiFollowingContext, legacyGeminiContinuity),
    geminiNarratorDirection: sessionStorage.getItem(STORAGE_KEYS.geminiNarratorDirection) ?? "",
    minimaxModel: sessionStorage.getItem(STORAGE_KEYS.minimaxModel) ?? "speech-2.8-hd",
    minimaxVoices: readVoiceClones("minimaxVoiceClones"),
    resembleVoices: [],
    googleOAuth: { configured: false, connected: false, redirectUri: "", updatedAt: null },
    providerBalance: null,
    phase: "idle",
    status: "Idle",
    currentSegment: 0,
    totalSegments: 0,
    progress: 0,
    stitchedAudio: null,
    audioAvailable: false,
    segmentFailure: null,
    operationBusy: false
  };
}

function readStoredBoolean(key: string, fallback: boolean) {
  const value = sessionStorage.getItem(key);
  return value === null ? fallback : value !== "false";
}

export type AppAction =
  | { type: "patch"; patch: Partial<AppState> }
  | { type: "provider"; provider: ProviderId }
  | { type: "credential"; provider: ProviderId; value: string }
  | { type: "remember"; provider: ProviderId; value: boolean }
  | { type: "segment"; value: number };

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "patch": return { ...state, ...action.patch };
    case "credential": return { ...state, credentials: { ...state.credentials, [action.provider]: action.value } };
    case "remember": return { ...state, rememberCredential: { ...state.rememberCredential, [action.provider]: action.value } };
    case "segment": return {
      ...state,
      segmentChars: action.value,
      segmentByProvider: { ...state.segmentByProvider, [state.provider]: action.value }
    };
    case "provider": {
      const config = PROVIDERS[action.provider];
      const limits = activeSegmentLimits(action.provider, action.provider === "openrouter" ? state.openrouterModel : "");
      const storedSegment = state.segmentByProvider[action.provider];
      const segmentChars = storedSegment <= limits.maxSegmentChars ? storedSegment : limits.defaultSegmentChars;
      return {
        ...state,
        provider: action.provider,
        googleAccessMethod: action.provider === "google" ? "oauth" : action.provider === "gemini" ? "api-key" : state.googleAccessMethod,
        voice: isGoogleProvider(state.provider) && isGoogleProvider(action.provider) ? state.voice : config.defaultVoice,
        language: config.defaultLanguage,
        segmentChars,
        providerBalance: null,
        status: state.phase === "idle" ? "Idle" : state.status
      };
    }
  }
}

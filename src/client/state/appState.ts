import { PROVIDERS, activeSegmentLimits, isGoogleProvider } from "../config/providers";
import { readCredentials, readProvider, readVoiceClones, readMinimaxSettings, readResembleSettings, readCloneSettings, STORAGE_KEYS } from "../services/storage";
import { MINIMAX_MODELS, type MinimaxSettings, type ResembleSettings, type CloneSettings } from "../../shared/speechSettings.js";
import type { ProviderErrorDetails, TextOmission } from "../types/contracts";
import type { GoogleAccessMethod, GoogleOAuthStatus, NarrationPhase, OpenRouterModel, ProviderBalance, ProviderId, SegmentFailure, SelectOption, StitchedAudio, VoiceClone } from "../types/contracts";

export interface AppState {
  minimaxSettings: MinimaxSettings;
  resembleSettings: ResembleSettings;
  cloneSettings: CloneSettings;
  discoveryWarning: string;
  errorDetails: ProviderErrorDetails | null;
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
  autoSmartRetry: boolean;
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
  omissions: TextOmission[];
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
  const storedModel = sessionStorage.getItem(STORAGE_KEYS.minimaxModel) || "";
  const minimaxModel = MINIMAX_MODELS.includes(storedModel) ? storedModel : "speech-2.8-hd";
  const minimaxVoices = readVoiceClones("minimaxVoiceClones");
  return {
    minimaxSettings: readMinimaxSettings(minimaxModel),
    resembleSettings: readResembleSettings(),
    cloneSettings: readCloneSettings(),
    discoveryWarning: "",
    errorDetails: null,
    provider,
    googleAccessMethod: provider === "google" ? "oauth" : provider === "gemini" ? "api-key" : sessionStorage.getItem(STORAGE_KEYS.googleAccessMethod) === "oauth" ? "oauth" : "api-key",
    credentials,
    rememberCredential,
    text: "",
    voice: provider === "minimax" ? minimaxVoices[0]?.id || "" : config.defaultVoice,
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
    autoSmartRetry: sessionStorage.getItem(STORAGE_KEYS.autoSmartRetry) === "true",
    minimaxModel,
    minimaxVoices,
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
    omissions: [],
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
        voice: action.provider === "minimax" ? state.minimaxVoices[0]?.id || "" : isGoogleProvider(state.provider) && isGoogleProvider(action.provider) ? state.voice : config.defaultVoice,
        language: config.defaultLanguage,
        speed: Math.min(action.provider === "minimax" ? 2 : 1.5, Math.max(action.provider === "minimax" ? 0.5 : 0.7, state.speed)),
        discoveryWarning: "",
        segmentChars,
        providerBalance: null,
        status: state.phase === "idle" ? "Idle" : state.status
      };
    }
  }
}

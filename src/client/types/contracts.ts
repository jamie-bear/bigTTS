export type ProviderId = "gemini" | "xai" | "google" | "openrouter" | "resemble" | "minimax";

export type NarrationPhase = "idle" | "connecting" | "generating" | "pausing" | "paused" | "recoverable" | "completed" | "stopped" | "error";
export type AudioEncoding = "mpeg" | "pcm_s16le";
export type GeminiBoundary = "start" | "sentence" | "paragraph" | "scene" | "chapter" | "forced" | "end";

export interface SelectOption {
  value: string;
  label: string;
  language?: string;
  gender?: string;
  disabled?: boolean;
}

export interface ProviderConfig {
  id: ProviderId;
  label: string;
  accessDescription?: string;
  storageKey: string;
  credentialLabel: string;
  credentialPlaceholder: string;
  defaultVoice: string;
  defaultLanguage: string;
  defaultSegmentChars: number;
  maxSegmentChars: number;
  costPerMillionChars?: number;
  supportsLowLatency?: boolean;
  supportsTextNormalization?: boolean;
  supportsSpeed?: boolean;
  supportsBalance?: boolean;
  authMode: "api-key" | "google-oauth";
  voices: SelectOption[];
  languages: SelectOption[];
}

export interface VoiceClone {
  id: string;
  name: string;
  languages?: string[];
  gender?: string;
  model?: string;
}

export interface OpenRouterModel {
  id: string;
  name: string;
  voices: SelectOption[];
}

export interface GoogleOAuthStatus {
  configured: boolean;
  connected: boolean;
  redirectUri?: string;
  updatedAt?: string | null;
  error?: string;
}

export interface ProviderBalance {
  available: boolean;
  amount?: number;
  currency?: string;
  message?: string;
  updatedAt: string;
}

export interface NarrationOptions {
  provider: ProviderId;
  voice: string;
  language: string;
  speed: number;
  segmentChars: number;
  optimizeStreamingLatency: boolean;
  textNormalization: boolean;
  model: string;
  geminiContinuity: boolean;
  geminiNarratorDirection: string;
}

export interface StartNarrationCommand {
  type: "start";
  apiKey: string;
  text: string;
  options: NarrationOptions;
}

export interface OpenRouterErrorDetails {
  status?: number;
  code?: string;
  errorType?: string;
  providerCode?: string;
  providerName?: string;
  reasons?: string[];
  flaggedInput?: string;
  generationId?: string;
  requestId?: string;
  routingSummary?: string;
  attempts?: number;
}

export interface SegmentFailure {
  index: number;
  totalSegments: number;
  message: string;
  details?: OpenRouterErrorDetails;
}

export type ClientCommand = StartNarrationCommand | { type: "pause" | "resume" | "retrySegment" | "skipSegment" | "cancel" };

export type ServerEvent =
  | { type: "meta"; audioEncoding: AudioEncoding; sampleRate: number; channels: number; totalSegments: number }
  | { type: "status"; message: string }
  | { type: "segment"; index: number; totalSegments: number; boundaryBefore?: GeminiBoundary; boundaryAfter?: GeminiBoundary }
  | { type: "segmentDone"; index: number; totalSegments: number; generationId?: string; attempts?: number }
  | { type: "pausePending"; currentSegment: number; totalSegments: number }
  | { type: "paused"; completedSegments: number; totalSegments: number }
  | { type: "resumed"; nextSegment: number; totalSegments: number }
  | { type: "segmentFailed"; index: number; totalSegments: number; message: string; details?: OpenRouterErrorDetails }
  | { type: "segmentRetrying" | "segmentSkipped"; index: number; totalSegments: number }
  | { type: "complete" }
  | { type: "cancelled" | "error"; message?: string };

export interface StitchedAudio {
  blob: Blob;
  extension: "mp3" | "wav";
}

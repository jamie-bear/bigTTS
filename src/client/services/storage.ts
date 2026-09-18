import { PROVIDERS, isProviderId } from "../config/providers";
import type { ProviderId, VoiceClone } from "../types/contracts";
import { normalizeMinimaxSettings, normalizeResembleSettings, normalizeCloneSettings } from "../../shared/speechSettings.js";

export const STORAGE_KEYS = {
  provider: "ttsProvider",
  googleAccessMethod: "googleAccessMethod",
  openrouterModel: "openrouterModel",
  geminiContinuity: "openrouterGeminiContinuity",
  geminiPreviousContext: "openrouterGeminiPreviousContext",
  geminiFollowingContext: "openrouterGeminiFollowingContext",
  geminiNarratorDirection: "openrouterGeminiNarratorDirection",
  minimaxModel: "minimaxModel",
  minimaxVoiceIdOverride: "minimaxVoiceIdOverride",
  resembleVoiceIdOverride: "resembleVoiceIdOverride",
  minimaxVoiceClones: "minimaxVoiceClones",
  minimaxSettings: "minimaxSynthesisSettings",
  resembleSettings: "resembleSynthesisSettings",
  cloneSettings: "minimaxCloneSettings"
} as const;

export function readProvider(): ProviderId {
  const value = sessionStorage.getItem(STORAGE_KEYS.provider);
  return isProviderId(value) ? value : "openrouter";
}

export function readCredentials(): Record<ProviderId, string> {
  return Object.fromEntries(Object.values(PROVIDERS).map((provider) => [
    provider.id,
    provider.authMode === "api-key" ? sessionStorage.getItem(provider.storageKey) ?? "" : ""
  ])) as Record<ProviderId, string>;
}

export function writeCredential(provider: ProviderId, value: string, remember: boolean) {
  if (PROVIDERS[provider].authMode !== "api-key") return;
  if (remember && value) sessionStorage.setItem(PROVIDERS[provider].storageKey, value);
  else sessionStorage.removeItem(PROVIDERS[provider].storageKey);
}

export function readVoiceClones(key: "minimaxVoiceClones"): VoiceClone[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEYS[key]) ?? "[]");
    return Array.isArray(parsed)
      ? parsed
        .filter((voice): voice is VoiceClone => Boolean(voice && typeof voice === "object" && "id" in voice))
        .map(toStoredVoiceClone)
      : [];
  } catch {
    return [];
  }
}

export function writeVoiceClones(key: "minimaxVoiceClones", voices: VoiceClone[]) {
  localStorage.setItem(STORAGE_KEYS[key], JSON.stringify(voices.map(toStoredVoiceClone)));
}

function toStoredVoiceClone(voice: VoiceClone): VoiceClone {
  const id = String(voice.id || "");
  const model = typeof voice.model === "string" && voice.model ? voice.model : undefined;
  return { id, name: String(voice.name || id), ...(model ? { model } : {}),
    ...(typeof voice.available === "boolean" ? { available: voice.available } : {}),
    ...(typeof voice.createdAt === "string" ? { createdAt: voice.createdAt } : {}) };
}

function readSettings<T>(key: string, normalize: (value?: Partial<T>) => T): T {
  try { return normalize(JSON.parse(sessionStorage.getItem(key) || "{}")); }
  catch { return normalize(); }
}

export const readMinimaxSettings = (model: string) => readSettings<ReturnType<typeof normalizeMinimaxSettings>>(STORAGE_KEYS.minimaxSettings, (raw) => normalizeMinimaxSettings(raw, model));
export const readResembleSettings = () => readSettings(STORAGE_KEYS.resembleSettings, normalizeResembleSettings);
export const readCloneSettings = () => readSettings(STORAGE_KEYS.cloneSettings, normalizeCloneSettings);

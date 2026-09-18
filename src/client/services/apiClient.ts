import type { GoogleOAuthStatus, OpenRouterModel, ProviderBalance, ProviderErrorDetails, ProviderId, VoiceClone } from "../types/contracts";

async function request<T>(url: string, init?: RequestInit, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { ...init, signal, headers: { "Content-Type": "application/json", ...init?.headers } });
  const text = await response.text();
  let body: unknown = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = {}; }
  if (!response.ok) {
    const error = body as { error?: string; message?: string; details?: ProviderErrorDetails };
    const diagnostics = [error.details?.providerCode && `provider code ${error.details.providerCode}`, error.details?.requestId && `request ID ${error.details.requestId}`].filter(Boolean).join("; ");
    throw Object.assign(new Error(`${error.error || error.message || `${response.status} ${response.statusText}`}${diagnostics ? ` (${diagnostics})` : ""}`), { details: error.details });
  }
  return body as T;
}

const post = <T>(url: string, body: unknown, signal?: AbortSignal) => request<T>(url, { method: "POST", body: JSON.stringify(body) }, signal);

export const api = {
  openRouterModels: (apiKey: string, signal?: AbortSignal) => post<{ models: OpenRouterModel[] }>("/api/openrouter/models", { apiKey }, signal),
  providerBalance: (provider: ProviderId, apiKey: string, signal?: AbortSignal) => post<ProviderBalance>("/api/provider/balance", { provider, apiKey }, signal),
  minimaxVoices: (apiKey: string, signal?: AbortSignal) => post<{ voices: VoiceClone[] }>("/api/minimax/voices", { apiKey }, signal),
  createMinimaxVoice: (payload: Record<string, unknown>, signal?: AbortSignal) => post<{ voice: VoiceClone }>("/api/minimax/voices/create", payload, signal),
  deleteMinimaxVoice: (apiKey: string, voiceId: string, signal?: AbortSignal) => post<{ ok: boolean }>("/api/minimax/voices/delete", { apiKey, voiceId }, signal),
  resembleVoices: (apiKey: string, signal?: AbortSignal) => post<{ voices: VoiceClone[]; warning?: string }>("/api/resemble/voices", { apiKey }, signal),
  googleStatus: (signal?: AbortSignal) => request<GoogleOAuthStatus>("/api/google-oauth/status", { cache: "no-store" }, signal),
  disconnectGoogle: (signal?: AbortSignal) => request<GoogleOAuthStatus>("/api/google-oauth/disconnect", { method: "POST" }, signal)
};

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result).split(",")[1] || ""));
    reader.addEventListener("error", () => reject(reader.error || new Error("Could not read audio file.")));
    reader.readAsDataURL(file);
  });
}

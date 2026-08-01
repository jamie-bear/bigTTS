const DEFAULT_RETRY_DELAYS = [350, 900];
const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504, 529]);
const RETRYABLE_ERROR_TYPES = new Set([
  "provider_overloaded",
  "provider_unavailable",
  "rate_limit_exceeded",
  "server",
  "timeout",
  "unmapped"
]);

export async function requestOpenRouterSpeech(options) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new Error("A fetch implementation is required.");

  const maxAttempts = Math.min(3, Math.max(1, Number(options.maxAttempts) || 3));
  const retryDelays = options.retryDelays || DEFAULT_RETRY_DELAYS;
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (options.signal?.aborted) throw abortError();

    try {
      const response = await fetchImpl(options.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          Authorization: `Bearer ${options.apiKey}`,
          "X-Title": options.title || "bigTTS",
          "X-OpenRouter-Experimental-Metadata": "enabled"
        },
        body: JSON.stringify(options.body),
        signal: options.signal
      });

      if (!response.ok) throw await createOpenRouterResponseError(response);
      return await options.readResponse(response, attempt);
    } catch (error) {
      if (options.signal?.aborted || error?.name === "AbortError") throw error;
      error.attempts = attempt;
      if (!isRetryableOpenRouterError(error) || attempt >= maxAttempts) throw error;
      lastError = error;

      const fallbackDelay = retryDelays[attempt - 1] ?? retryDelays.at(-1) ?? 0;
      const delay = Number.isFinite(error.retryAfterMs) ? error.retryAfterMs : fallbackDelay;
      options.onRetry?.({ attempt, nextAttempt: attempt + 1, delay, error });
      await abortableDelay(delay, options.signal, options.sleep);
    }
  }

  throw lastError || new Error("OpenRouter TTS request failed.");
}

export function isRetryableOpenRouterError(error) {
  if (error?.errorType && RETRYABLE_ERROR_TYPES.has(error.errorType)) return true;
  if (typeof error?.status === "number") return RETRYABLE_STATUSES.has(error.status);
  return true;
}

export function openRouterErrorDetails(error) {
  if (!error || typeof error !== "object") return undefined;
  const details = {
    status: finiteNumber(error.status),
    code: shortValue(error.code),
    errorType: shortValue(error.errorType),
    providerCode: shortValue(error.providerCode),
    providerName: shortValue(error.providerName),
    reasons: shortList(error.reasons),
    flaggedInput: shortText(error.flaggedInput, 180),
    generationId: shortValue(error.generationId),
    requestId: shortValue(error.requestId),
    routingSummary: shortText(error.routingSummary, 180),
    attempts: finiteNumber(error.attempts)
  };

  return Object.fromEntries(Object.entries(details).filter(([, value]) => value !== undefined));
}

async function createOpenRouterResponseError(response) {
  const text = await response.text().catch(() => "");
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }

  const errorBody = body?.error && typeof body.error === "object" ? body.error : null;
  const metadata = errorBody?.metadata && typeof errorBody.metadata === "object" ? errorBody.metadata : {};
  const routing = body?.openrouter_metadata && typeof body.openrouter_metadata === "object" ? body.openrouter_metadata : {};
  const providerMessage = errorBody?.message || body?.message || text.slice(0, 240) || `${response.status} ${response.statusText}`.trim();
  const error = new Error(`OpenRouter TTS request failed: ${providerMessage}`);
  error.name = "OpenRouterRequestError";
  error.status = response.status;
  error.code = errorBody?.code ?? response.status;
  error.errorType = metadata.error_type;
  error.providerCode = metadata.provider_code;
  error.providerName = metadata.provider_name;
  error.reasons = metadata.reasons;
  error.flaggedInput = metadata.flagged_input;
  error.generationId = response.headers.get("x-generation-id") || "";
  error.requestId = response.headers.get("x-request-id") || response.headers.get("request-id") || "";
  error.routingSummary = routing.summary;
  error.retryAfterMs = parseRetryAfter(response.headers.get("retry-after"));
  return error;
}

function parseRetryAfter(value) {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(60_000, seconds * 1_000);
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return undefined;
  return Math.min(60_000, Math.max(0, timestamp - Date.now()));
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function shortValue(value) {
  if (value === undefined || value === null || value === "") return undefined;
  return String(value).slice(0, 120);
}

function shortText(value, maximum) {
  if (value === undefined || value === null || value === "") return undefined;
  return String(value).replace(/\s+/g, " ").trim().slice(0, maximum) || undefined;
}

function shortList(value) {
  if (!Array.isArray(value)) return undefined;
  const list = value.map((item) => shortText(item, 160)).filter(Boolean).slice(0, 5);
  return list.length ? list : undefined;
}

async function abortableDelay(milliseconds, signal, sleep) {
  if (!milliseconds) return;
  if (typeof sleep === "function") {
    await sleep(milliseconds, signal);
    return;
  }

  await new Promise((resolve, reject) => {
    let timer;
    const cleanup = () => signal?.removeEventListener("abort", onAbort);
    const onAbort = () => {
      clearTimeout(timer);
      cleanup();
      reject(abortError());
    };
    timer = setTimeout(() => {
      cleanup();
      resolve();
    }, milliseconds);
    if (signal?.aborted) onAbort();
    else signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function abortError() {
  const error = new Error("The operation was aborted.");
  error.name = "AbortError";
  return error;
}

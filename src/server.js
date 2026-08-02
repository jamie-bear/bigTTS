import http from "node:http";
import path from "node:path";
import crypto from "node:crypto";
import tls from "node:tls";
import { EventEmitter } from "node:events";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync, promises as fs } from "node:fs";
import {
  GEMINI_31_DEFAULT_SEGMENT_CHARS,
  GEMINI_31_MAX_SEGMENT_CHARS,
  buildGemini31NarrationPrompt,
  createGeminiNarrationSegments,
  isOpenRouterGemini31Model,
  requestOpenRouterGemini31Speech,
  sanitizeNarratorDirection
} from "./server/geminiContinuity.js";
import { openRouterErrorDetails, requestOpenRouterSpeech } from "./server/openRouterSpeech.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const publicDir = path.resolve(rootDir, process.env.STATIC_DIR || "dist");

loadDotEnv(path.join(rootDir, ".env"));

const PORT = Number(process.env.PORT || 20204);
const XAI_TTS_URL = "wss://api.x.ai/v1/tts";
const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models?output_modalities=speech";
const OPENROUTER_TTS_URL = "https://openrouter.ai/api/v1/audio/speech";
const OPENROUTER_KEY_URL = "https://openrouter.ai/api/v1/key";
const GOOGLE_TTS_URL = "https://texttospeech.googleapis.com/v1/text:synthesize";
const RESEMBLE_API_VOICES_URL = "https://app.resemble.ai/api/v2/voices";
const RESEMBLE_SYNTHESIS_URL = "https://f.cluster.resemble.ai/synthesize";
const RESEMBLE_SAMPLE_RATE = 22_050;
const MINIMAX_FILE_UPLOAD_URL = "https://api.minimax.io/v1/files/upload";
const MINIMAX_VOICE_CLONE_URL = "https://api.minimax.io/v1/voice_clone";
const MINIMAX_GET_VOICE_URL = "https://api.minimax.io/v1/get_voice";
const MINIMAX_DELETE_VOICE_URL = "https://api.minimax.io/v1/delete_voice";
const MINIMAX_TTS_URL = "https://api.minimax.io/v1/t2a_v2";
const MINIMAX_SAMPLE_RATE = 24_000;
const MINIMAX_REQUEST_TIMEOUT_MS = 45_000;
const GOOGLE_OAUTH_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const GOOGLE_OAUTH_SCOPE = "https://www.googleapis.com/auth/cloud-platform";
const GOOGLE_OAUTH_CLIENT_ID = String(process.env.GOOGLE_OAUTH_CLIENT_ID || "").trim();
const GOOGLE_OAUTH_CLIENT_SECRET = String(process.env.GOOGLE_OAUTH_CLIENT_SECRET || "").trim();
const GOOGLE_OAUTH_REDIRECT_URI = String(process.env.GOOGLE_OAUTH_REDIRECT_URI || "").trim();
const GOOGLE_OAUTH_TOKEN_PATH = path.resolve(rootDir, process.env.GOOGLE_OAUTH_TOKEN_PATH || ".secrets/google-oauth-token.json");
const GOOGLE_OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const GEMINI_TTS_MODEL = "gemini-3.1-flash-tts-preview";
const GEMINI_TTS_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_TTS_MODEL}:generateContent`;
const GEMINI_SAMPLE_RATE = 24_000;
const GEMINI_TTS_VOICES = new Set([
  "Zephyr",
  "Puck",
  "Charon",
  "Kore",
  "Fenrir",
  "Leda",
  "Orus",
  "Aoede",
  "Callirrhoe",
  "Autonoe",
  "Enceladus",
  "Iapetus",
  "Umbriel",
  "Algieba",
  "Despina",
  "Erinome",
  "Algenib",
  "Rasalgethi",
  "Laomedeia",
  "Achernar",
  "Alnilam",
  "Schedar",
  "Gacrux",
  "Pulcherrima",
  "Achird",
  "Zubenelgenubi",
  "Vindemiatrix",
  "Sadachbia",
  "Sadaltager",
  "Sulafat"
]);
const MAX_DELTA_CHARS = 14_500;
const DEFAULT_SEGMENT_CHARS = 2_500;
const GOOGLE_DEFAULT_SEGMENT_CHARS = 500;
const GEMINI_DEFAULT_SEGMENT_CHARS = 500;
const MAX_SEGMENT_CHARS = 12_000;
const GOOGLE_MAX_SEGMENT_CHARS = 4_500;
const GOOGLE_MAX_SEGMENT_BYTES = 3_900;
const MIN_SEGMENT_CHARS = 300;
const AUTOMATIC_SEGMENT_RETRIES = 1;
const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const googleOAuthStates = new Map();
let googleOAuthTokenCache = null;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp"
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    if (url.pathname === "/api/health") {
      sendJson(res, 200, { ok: true });
      return;
    }

    if (url.pathname === "/favicon.ico") {
      res.writeHead(204, { "Cache-Control": "public, max-age=86400" });
      res.end();
      return;
    }

    if (url.pathname === "/api/openrouter/models") {
      await handleOpenRouterModels(req, res);
      return;
    }

    if (url.pathname === "/api/provider/balance") {
      await handleProviderBalance(req, res);
      return;
    }

    if (url.pathname === "/api/resemble/voices") {
      await handleResembleVoices(req, res);
      return;
    }

    if (url.pathname.startsWith("/api/minimax/voices")) {
      await handleMinimaxVoices(req, res, url.pathname);
      return;
    }

    if (url.pathname === "/api/google-oauth/status") {
      await handleGoogleOAuthStatus(req, res);
      return;
    }

    if (url.pathname === "/api/google-oauth/disconnect") {
      await handleGoogleOAuthDisconnect(req, res);
      return;
    }

    if (url.pathname === "/auth/google/start") {
      await startGoogleOAuth(req, res);
      return;
    }

    if (url.pathname === "/oauth/google/callback") {
      await finishGoogleOAuth(req, res, url);
      return;
    }

    await serveStatic(req, res);
  } catch (error) {
    console.error(error);
    sendText(res, 500, "Internal server error");
  }
});

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  if (url.pathname !== "/stream") {
    socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }

  const key = req.headers["sec-websocket-key"];
  if (!key) {
    socket.write("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }

  const accept = crypto
    .createHash("sha1")
    .update(`${key}${WS_GUID}`)
    .digest("base64");

  socket.write([
    "HTTP/1.1 101 Switching Protocols",
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Accept: ${accept}`,
    "\r\n"
  ].join("\r\n"));

  const client = new WebSocketConnection(socket, {
    expectMaskedFrames: true,
    maskOutgoingFrames: false
  });

  if (head.length) {
    client.consume(head);
  }

  const session = createNarrationSession(client);

  client.on("message", (raw) => {
    if (Buffer.isBuffer(raw)) return;

    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      sendJsonWs(client, { type: "error", message: "Invalid JSON message." });
      return;
    }

    session.handleClientMessage(message);
  });

  client.on("close", () => session.cancel("Client disconnected."));
  client.on("error", () => session.cancel("Client socket errored."));
});

if (path.resolve(process.argv[1] || "") === __filename) {
  server.listen(PORT, () => {
    console.log(`bigTTS is running at http://localhost:${PORT}`);
  });
}

async function handleOpenRouterModels(req, res) {
  if (req.method !== "POST") {
    res.writeHead(405, {
      "Content-Type": "application/json; charset=utf-8",
      Allow: "POST"
    });
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  let body;
  try {
    body = await readJsonRequest(req, 16_384);
  } catch (error) {
    sendJson(res, 400, { error: error.message });
    return;
  }

  const apiKey = String(body.apiKey || "").trim();
  if (!apiKey) {
    sendJson(res, 400, { error: "OpenRouter API key is required." });
    return;
  }

  try {
    const response = await fetch(OPENROUTER_MODELS_URL, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": getRequestOrigin(req),
        "X-Title": "bigTTS"
      }
    });
    const parsed = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(parsed?.error?.message || parsed?.message || `${response.status} ${response.statusText}`);
    }

    const models = (parsed?.data || [])
      .map((model) => ({
        id: String(model.id || ""),
        name: String(model.name || model.id || ""),
        voices: inferOpenRouterVoices(model)
      }))
      .filter((model) => model.id);

    sendJson(res, 200, { models });
  } catch (error) {
    sendJson(res, 502, { error: `OpenRouter model discovery failed: ${error.message}` });
  }
}

async function handleProviderBalance(req, res) {
  if (req.method !== "POST") {
    res.writeHead(405, { "Content-Type": "application/json; charset=utf-8", Allow: "POST" });
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  let body;
  try {
    body = await readJsonRequest(req, 16_384);
  } catch (error) {
    sendJson(res, 400, { error: error.message });
    return;
  }

  const provider = String(body.provider || "").trim();
  const updatedAt = new Date().toISOString();
  if (provider !== "openrouter") {
    sendJson(res, 200, { available: false, message: "This provider does not expose a balance through its synthesis credential.", updatedAt });
    return;
  }

  const apiKey = String(body.apiKey || "").trim();
  if (!apiKey) {
    sendJson(res, 400, { error: "OpenRouter API key is required." });
    return;
  }

  try {
    const response = await fetch(OPENROUTER_KEY_URL, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "X-Title": "bigTTS"
      }
    });
    const text = await response.text().catch(() => "");
    const parsed = parseJsonText(text);
    if (!response.ok) throw new Error(parsed?.error?.message || parsed?.message || summarizeNonJsonResponse(text, response));
    if (!parsed) throw new Error(`OpenRouter returned ${describeContentType(response)} instead of JSON.`);
    const rawRemaining = parsed?.data?.limit_remaining;
    const amount = rawRemaining === null || rawRemaining === undefined || rawRemaining === "" ? null : Number(rawRemaining);
    if (!Number.isFinite(amount)) {
      sendJson(res, 200, { available: false, message: "This key has no credit limit; its account balance is not exposed to this API key.", updatedAt });
      return;
    }
    sendJson(res, 200, { available: true, amount, currency: "USD", updatedAt });
  } catch (error) {
    sendJson(res, 502, { error: `OpenRouter balance request failed: ${error.message}` });
  }
}

function parseJsonText(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function describeContentType(response) {
  return response.headers.get("content-type") || "a non-JSON response";
}

function summarizeNonJsonResponse(text, response) {
  const compact = String(text || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  return compact ? compact.slice(0, 240) : `${response.status} ${response.statusText}`;
}

function sanitizeVoiceId(value) {
  const voiceId = String(value || "").trim();
  if (!voiceId) throw new Error("Voice ID is required.");
  return voiceId;
}

async function readJsonRequest(req, limitBytes) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > limitBytes) throw new Error("Request body is too large.");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("Request body must be valid JSON.");
  }
}



async function handleMinimaxVoices(req, res, pathname) {
  if (req.method !== "POST") {
    res.writeHead(405, { "Content-Type": "application/json; charset=utf-8", Allow: "POST" });
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  let body;
  try {
    body = await readJsonRequest(req, pathname === "/api/minimax/voices/create" ? 64 * 1024 * 1024 : 16_384);
  } catch (error) {
    sendJson(res, 400, { error: error.message });
    return;
  }

  const apiKey = String(body.apiKey || "").trim();
  if (!apiKey) {
    sendJson(res, 400, { error: "MiniMax API key is required." });
    return;
  }

  try {
    if (pathname === "/api/minimax/voices") {
      const parsed = await requestMiniMaxJson(MINIMAX_GET_VOICE_URL, { apiKey, method: "POST", payload: { voice_type: "voice_cloning" } });
      sendJson(res, 200, { voices: normalizeMiniMaxVoices(parsed?.voice_cloning) });
      return;
    }

    if (pathname === "/api/minimax/voices/delete") {
      const voiceId = sanitizeVoiceId(body.voiceId);
      await requestMiniMaxJson(MINIMAX_DELETE_VOICE_URL, {
        apiKey,
        method: "POST",
        payload: { voice_type: "voice_cloning", voice_id: voiceId }
      });
      sendJson(res, 200, { ok: true });
      return;
    }

    if (pathname === "/api/minimax/voices/create") {
      await createMinimaxVoiceClone(res, body, apiKey);
      return;
    }

    sendJson(res, 404, { error: "Unknown MiniMax voice endpoint." });
  } catch (error) {
    sendJson(res, 502, { error: `MiniMax voice request failed: ${error.message}` });
  }
}

function normalizeMiniMaxVoices(items) {
  return (Array.isArray(items) ? items : [])
    .map((voice) => ({
      id: String(voice?.voice_id || voice?.id || ""),
      name: String(voice?.voice_name || voice?.name || voice?.voice_id || voice?.id || ""),
      createdAt: String(voice?.created_time || ""),
      updatedAt: String(voice?.created_time || "")
    }))
    .filter((voice) => voice.id);
}

async function createMinimaxVoiceClone(res, body, apiKey) {
  try {
    const name = String(body.name || "").trim();
    const voiceId = createMiniMaxVoiceId(name);
    const sourceAudio = sanitizeBase64Audio(body.sourceAudio, 28 * 1024 * 1024);
    if (!sourceAudio) throw new Error("Source audio is required.");
    const promptAudio = sanitizeBase64Audio(body.promptAudio, 28 * 1024 * 1024);
    const promptText = String(body.promptText || "").trim();
    if (Boolean(promptAudio) !== Boolean(promptText)) {
      throw new Error("MiniMax prompt audio and prompt text must be provided together.");
    }
    const sourceFileId = await uploadMiniMaxAudio(apiKey, {
      purpose: "voice_clone",
      audio: sourceAudio,
      filename: String(body.sourceFilename || "voice-clone.wav").trim(),
      contentType: String(body.sourceContentType || "application/octet-stream").trim()
    });
    let promptFileId = "";
    if (promptAudio) {
      promptFileId = await uploadMiniMaxAudio(apiKey, {
        purpose: "prompt_audio",
        audio: promptAudio,
        filename: String(body.promptFilename || "prompt.wav").trim(),
        contentType: String(body.promptContentType || "application/octet-stream").trim()
      });
    }

    const speechModel = sanitizeMiniMaxModel(body.model);
    const languageModel = sanitizeMiniMaxCloneLanguageModel(body.languageModel);
    const payload = buildMiniMaxVoiceClonePayload({
      sourceFileId,
      voiceId,
      languageModel,
      validationText: body.validationText,
      promptFileId,
      promptText
    });

    await requestMiniMaxJson(MINIMAX_VOICE_CLONE_URL, { apiKey, method: "POST", payload, timeoutMs: MINIMAX_REQUEST_TIMEOUT_MS });
    sendJson(res, 200, {
      voice: {
        id: voiceId,
        name,
        model: speechModel
      }
    });
  } catch (error) {
    sendJson(res, 502, { error: `MiniMax voice clone failed: ${error.message}` });
  }
}

export function buildMiniMaxVoiceClonePayload({ sourceFileId, voiceId, languageModel = "", validationText = "", promptFileId = "", promptText = "" }) {
  const normalizedPromptText = String(promptText || "").trim();
  if (Boolean(promptFileId) !== Boolean(normalizedPromptText)) {
    throw new Error("MiniMax prompt audio and prompt text must be provided together.");
  }
  const payload = {
    file_id: Number(sourceFileId) || sourceFileId,
    voice_id: voiceId,
    need_noise_reduction: true,
    need_volume_normalization: true
  };
  if (languageModel) payload.language_boost = languageModel;
  const transcript = String(validationText || "").trim().slice(0, 200);
  if (transcript) payload.text_validation = transcript;
  if (promptFileId) {
    payload.clone_prompt = {
      prompt_audio: Number(promptFileId) || promptFileId,
      prompt_text: normalizedPromptText.slice(0, 1000)
    };
  }
  return payload;
}

async function uploadMiniMaxAudio(apiKey, { purpose, audio, filename, contentType }) {
  const form = new FormData();
  form.append("purpose", purpose);
  form.append("file", new Blob([Buffer.from(audio, "base64")], { type: contentType || "application/octet-stream" }), filename || "audio.wav");
  const response = await fetch(MINIMAX_FILE_UPLOAD_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
    signal: AbortSignal.timeout(MINIMAX_REQUEST_TIMEOUT_MS)
  });
  const text = await response.text().catch(() => "");
  const parsed = parseJsonText(text);
  if (!response.ok) throw new Error(parsed?.error?.message || parsed?.message || summarizeNonJsonResponse(text, response));
  const fileId = parsed?.file?.file_id || parsed?.file_id || parsed?.data?.file_id;
  if (!fileId) throw new Error("MiniMax upload response did not include a file_id.");
  return String(fileId);
}

async function requestMiniMaxJson(url, { apiKey, method = "GET", payload = null, signal = undefined, timeoutMs = MINIMAX_REQUEST_TIMEOUT_MS }) {
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json; charset=utf-8"
    },
    body: payload ? JSON.stringify(payload) : undefined,
    signal: signal || AbortSignal.timeout(timeoutMs)
  });
  const text = await response.text().catch(() => "");
  const parsed = parseJsonText(text);
  if (!response.ok) throw new Error(parsed?.base_resp?.status_msg || parsed?.error?.message || parsed?.message || summarizeNonJsonResponse(text, response));
  if (!parsed) throw new Error(`MiniMax returned ${describeContentType(response)} instead of JSON.`);
  const statusCode = parsed?.base_resp?.status_code;
  if (Number.isFinite(Number(statusCode)) && Number(statusCode) !== 0) throw new Error(parsed?.base_resp?.status_msg || `MiniMax status ${statusCode}`);
  return parsed;
}

function createMiniMaxVoiceId(name) {
  const slug = String(name || "voice").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 36) || "voice";
  return `bigtts_${slug}_${Date.now().toString(36)}`;
}

function sanitizeMiniMaxModel(value) {
  const model = String(value || "speech-2.8-hd").trim();
  return ["speech-2.8-hd", "speech-2.8-turbo", "speech-2.6-hd", "speech-2.6-turbo", "speech-02-hd", "speech-02-turbo", "speech-01-hd", "speech-01-turbo"].includes(model) ? model : "speech-2.8-hd";
}

function sanitizeMiniMaxCloneLanguageModel(value) {
  const model = String(value || "auto").trim();
  if (model === "auto") return "auto";
  const allowed = new Set([
    "Chinese", "Chinese,Yue", "English", "Arabic", "Russian", "Spanish", "French",
    "Portuguese", "German", "Turkish", "Dutch", "Ukrainian", "Vietnamese",
    "Indonesian", "Japanese", "Italian", "Korean", "Thai", "Polish", "Romanian",
    "Greek", "Czech", "Finnish", "Hindi", "Bulgarian", "Danish", "Hebrew",
    "Malay", "Persian", "Slovak", "Swedish", "Croatian", "Filipino",
    "Hungarian", "Norwegian", "Slovenian", "Catalan", "Nynorsk", "Tamil",
    "Afrikaans"
  ]);
  return allowed.has(model) ? model : "auto";
}

async function handleResembleVoices(req, res) {
  if (req.method !== "POST") {
    res.writeHead(405, { "Content-Type": "application/json; charset=utf-8", Allow: "POST" });
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  let body;
  try {
    body = await readJsonRequest(req, 16_384);
  } catch (error) {
    sendJson(res, 400, { error: error.message });
    return;
  }

  const apiKey = String(body.apiKey || "").trim();
  if (!apiKey) {
    sendJson(res, 400, { error: "Resemble.ai API key is required." });
    return;
  }

  try {
    const voices = await listResembleCustomVoices(apiKey);
    sendJson(res, 200, { voices });
  } catch (error) {
    sendJson(res, 502, { error: `Resemble.ai voice discovery failed: ${error.message}` });
  }
}

async function listResembleCustomVoices(apiKey) {
  const voices = [];
  const pageSize = 100;
  for (let page = 1; page <= 20; page += 1) {
    const url = new URL(RESEMBLE_API_VOICES_URL);
    url.searchParams.set("page", String(page));
    url.searchParams.set("page_size", String(pageSize));
    url.searchParams.set("pre_built_resemble_voice", "false");

    const response = await fetch(url, {
      headers: { Authorization: normalizeBearerToken(apiKey) }
    });
    const text = await response.text().catch(() => "");
    const parsed = parseJsonText(text);
    if (!response.ok) {
      throw new Error(parsed?.error || parsed?.message || summarizeNonJsonResponse(text, response));
    }
    if (!parsed) throw new Error(`Resemble.ai returned ${describeContentType(response)} instead of JSON.`);

    voices.push(...normalizeResembleVoices(parsed));
    const pageCount = Number(parsed.page_count || parsed.total_pages || page);
    if (!Number.isFinite(pageCount) || page >= pageCount) break;
  }
  return voices;
}

function normalizeResembleVoices(parsed) {
  const items = Array.isArray(parsed?.items) ? parsed.items : Array.isArray(parsed?.voices) ? parsed.voices : Array.isArray(parsed) ? parsed : [];
  return items
    .filter((voice) => !voice?.pre_built_resemble_voice && String(voice?.source || "").toLowerCase() !== "marketplace")
    .filter((voice) => {
      const status = String(voice?.voice_status || voice?.status || "").toLowerCase();
      return !status || status === "ready";
    })
    .filter((voice) => voice?.api_support?.sync_tts !== false)
    .map((voice) => ({
      id: String(voice?.uuid || voice?.id || ""),
      name: String(voice?.name || voice?.uuid || voice?.id || ""),
      language: String(voice?.default_language || ""),
      languages: Array.isArray(voice?.supported_languages) ? voice.supported_languages.map(String) : [],
      gender: String(voice?.gender || "").trim()
    }))
    .filter((voice) => voice.id);
}

function normalizeBearerToken(apiKey) {
  const token = String(apiKey || "").trim();
  return /^Bearer\s+/i.test(token) ? token : `Bearer ${token}`;
}

async function handleGoogleOAuthStatus(req, res) {
  const storedToken = await readGoogleOAuthTokenFile();
  sendJson(res, 200, {
    configured: hasGoogleOAuthConfig(),
    connected: Boolean(storedToken?.refreshToken),
    redirectUri: getGoogleOAuthRedirectUri(req),
    scope: storedToken?.scope || GOOGLE_OAUTH_SCOPE,
    updatedAt: storedToken?.updatedAt || null
  });
}

async function handleGoogleOAuthDisconnect(req, res) {
  if (req.method !== "POST") {
    res.writeHead(405, {
      "Content-Type": "application/json; charset=utf-8",
      Allow: "POST"
    });
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  const storedToken = await readGoogleOAuthTokenFile();
  if (storedToken?.refreshToken && hasGoogleOAuthConfig()) {
    revokeGoogleOAuthToken(storedToken.refreshToken).catch((error) => {
      console.warn(`Google OAuth token revocation failed: ${error.message}`);
    });
  }

  await deleteGoogleOAuthTokenFile();
  sendJson(res, 200, { ok: true, connected: false });
}

async function startGoogleOAuth(req, res) {
  if (!hasGoogleOAuthConfig()) {
    sendGoogleOAuthResult(res, 500, {
      title: "Google OAuth is not configured",
      message: "Add GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET to .env, restart the app, then try again.",
      success: false
    });
    return;
  }

  cleanupExpiredGoogleOAuthStates();

  const state = crypto.randomBytes(24).toString("base64url");
  const codeVerifier = crypto.randomBytes(48).toString("base64url");
  const codeChallenge = base64Url(crypto.createHash("sha256").update(codeVerifier).digest());
  const redirectUri = getGoogleOAuthRedirectUri(req);

  googleOAuthStates.set(state, {
    codeVerifier,
    redirectUri,
    expiresAt: Date.now() + GOOGLE_OAUTH_STATE_TTL_MS
  });

  const authUrl = new URL(GOOGLE_OAUTH_AUTH_URL);
  authUrl.searchParams.set("client_id", GOOGLE_OAUTH_CLIENT_ID);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", GOOGLE_OAUTH_SCOPE);
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "consent");
  authUrl.searchParams.set("include_granted_scopes", "true");
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("code_challenge", codeChallenge);
  authUrl.searchParams.set("code_challenge_method", "S256");

  res.writeHead(302, { Location: authUrl.href });
  res.end();
}

async function finishGoogleOAuth(req, res, url) {
  const error = url.searchParams.get("error");
  if (error) {
    sendGoogleOAuthResult(res, 400, {
      title: "Google OAuth was cancelled",
      message: url.searchParams.get("error_description") || error,
      success: false
    });
    return;
  }

  const state = url.searchParams.get("state") || "";
  const code = url.searchParams.get("code") || "";
  const pendingState = googleOAuthStates.get(state);
  googleOAuthStates.delete(state);

  if (!code || !pendingState || pendingState.expiresAt < Date.now()) {
    sendGoogleOAuthResult(res, 400, {
      title: "Google OAuth could not be completed",
      message: "The login response was missing or expired. Start the connection again from the app.",
      success: false
    });
    return;
  }

  try {
    const tokenBody = await requestGoogleOAuthToken(new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: GOOGLE_OAUTH_CLIENT_ID,
      client_secret: GOOGLE_OAUTH_CLIENT_SECRET,
      redirect_uri: pendingState.redirectUri,
      code_verifier: pendingState.codeVerifier
    }));

    if (!tokenBody.refresh_token) {
      const existingToken = await readGoogleOAuthTokenFile();
      if (!existingToken?.refreshToken) {
        throw new Error("Google did not return a refresh token. Reconnect with consent, or remove this app from your Google account and try again.");
      }
    }

    await writeGoogleOAuthTokenFile(tokenBody);
    sendGoogleOAuthResult(res, 200, {
      title: "Google is connected",
      message: "You can close this tab and return to bigTTS.",
      success: true
    });
  } catch (exchangeError) {
    sendGoogleOAuthResult(res, 500, {
      title: "Google OAuth failed",
      message: exchangeError.message,
      success: false
    });
  }
}

function hasGoogleOAuthConfig() {
  return Boolean(GOOGLE_OAUTH_CLIENT_ID && GOOGLE_OAUTH_CLIENT_SECRET);
}

function getGoogleOAuthRedirectUri(req) {
  if (GOOGLE_OAUTH_REDIRECT_URI) return GOOGLE_OAUTH_REDIRECT_URI;

  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  const protocol = forwardedProto || "http";
  const host = req.headers.host || `localhost:${PORT}`;
  return `${protocol}://${host}/oauth/google/callback`;
}

function cleanupExpiredGoogleOAuthStates() {
  const now = Date.now();
  for (const [state, pendingState] of googleOAuthStates) {
    if (pendingState.expiresAt < now) {
      googleOAuthStates.delete(state);
    }
  }
}

async function hasGoogleOAuthRefreshToken() {
  const token = await readGoogleOAuthTokenFile();
  return Boolean(token?.refreshToken);
}

async function getGoogleOAuthAccessToken(signal) {
  if (!hasGoogleOAuthConfig()) {
    throw new Error("Google OAuth is not configured. Add GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET to .env, then restart the app.");
  }

  const storedToken = await readGoogleOAuthTokenFile();
  if (!storedToken?.refreshToken) {
    throw new Error("Google OAuth is not connected. Use the Connect Google button first.");
  }

  if (storedToken.accessToken && storedToken.expiresAt > Date.now() + 60_000) {
    return storedToken.accessToken;
  }

  const tokenBody = await requestGoogleOAuthToken(new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: storedToken.refreshToken,
    client_id: GOOGLE_OAUTH_CLIENT_ID,
    client_secret: GOOGLE_OAUTH_CLIENT_SECRET
  }), signal);
  const updatedToken = await writeGoogleOAuthTokenFile(tokenBody, storedToken);
  return updatedToken.accessToken;
}

async function requestGoogleOAuthToken(body, signal) {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body,
    signal
  });

  let parsed;
  try {
    parsed = await response.json();
  } catch {
    parsed = null;
  }

  if (!response.ok) {
    const message = parsed?.error_description || parsed?.error || `${response.status} ${response.statusText}`;
    throw new Error(`Google OAuth token request failed: ${message}`);
  }

  if (!parsed?.access_token) {
    throw new Error("Google OAuth token response did not include an access token.");
  }

  return parsed;
}

async function revokeGoogleOAuthToken(refreshToken) {
  await fetch(GOOGLE_REVOKE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({ token: refreshToken })
  });
}

async function readGoogleOAuthTokenFile() {
  if (googleOAuthTokenCache) return googleOAuthTokenCache;

  let raw;
  try {
    raw = await fs.readFile(GOOGLE_OAUTH_TOKEN_PATH, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Google OAuth token file is not valid JSON: ${GOOGLE_OAUTH_TOKEN_PATH}`);
  }

  googleOAuthTokenCache = {
    refreshToken: String(parsed.refreshToken || ""),
    accessToken: String(parsed.accessToken || ""),
    expiresAt: Number(parsed.expiresAt || 0),
    scope: String(parsed.scope || GOOGLE_OAUTH_SCOPE),
    tokenType: String(parsed.tokenType || "Bearer"),
    updatedAt: String(parsed.updatedAt || "")
  };

  return googleOAuthTokenCache.refreshToken ? googleOAuthTokenCache : null;
}

async function writeGoogleOAuthTokenFile(tokenBody, existingToken = null) {
  const existing = existingToken || await readGoogleOAuthTokenFile() || {};
  const expiresIn = Number(tokenBody.expires_in || 3600);
  const storedToken = {
    refreshToken: tokenBody.refresh_token || existing.refreshToken || "",
    accessToken: tokenBody.access_token || existing.accessToken || "",
    expiresAt: Date.now() + Math.max(60, expiresIn - 30) * 1000,
    scope: tokenBody.scope || existing.scope || GOOGLE_OAUTH_SCOPE,
    tokenType: tokenBody.token_type || existing.tokenType || "Bearer",
    updatedAt: new Date().toISOString()
  };

  if (!storedToken.refreshToken) {
    throw new Error("Cannot store Google OAuth credentials without a refresh token.");
  }

  await fs.mkdir(path.dirname(GOOGLE_OAUTH_TOKEN_PATH), { recursive: true });
  await fs.writeFile(GOOGLE_OAUTH_TOKEN_PATH, `${JSON.stringify(storedToken, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600
  });

  googleOAuthTokenCache = storedToken;
  return storedToken;
}

async function deleteGoogleOAuthTokenFile() {
  googleOAuthTokenCache = null;

  try {
    await fs.unlink(GOOGLE_OAUTH_TOKEN_PATH);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

function sendGoogleOAuthResult(res, status, { title, message, success }) {
  const safeTitle = escapeHtml(title);
  const safeMessage = escapeHtml(message);
  const popupPayload = JSON.stringify({ type: "google-oauth", ok: success, message }).replace(/</g, "\\u003c");
  const closeScript = success ? " window.setTimeout(() => window.close(), 1200);" : "";
  const script = `<script>window.opener?.postMessage(${popupPayload}, window.location.origin);${closeScript}</script>`;

  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
  res.end(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${safeTitle}</title>
    <style>
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: system-ui, sans-serif; color: #17201c; background: #f5f7f2; }
      main { max-width: 520px; padding: 32px; }
      h1 { margin: 0 0 12px; font-size: 2rem; }
      p { margin: 0; line-height: 1.5; color: #60706a; }
    </style>
  </head>
  <body>
    <main>
      <h1>${safeTitle}</h1>
      <p>${safeMessage}</p>
    </main>
    ${script}
  </body>
</html>`);
}

export function createNarrationSession(client) {
  const state = {
    active: false,
    cancelled: false,
    pauseRequested: false,
    paused: false,
    recoverableError: null,
    upstream: null,
    currentRequest: null,
    apiKey: "",
    options: {},
    segments: [],
    segmentIndex: 0,
    automaticSegmentRetries: 0,
    waitingForAudioDone: false
  };

  return {
    handleClientMessage(message) {
      if (message.type === "start") {
        start(message).catch((error) => fail(error));
        return;
      }

      if (message.type === "pause") {
        requestPause();
        return;
      }

      if (message.type === "resume") {
        resume().catch((error) => fail(error));
        return;
      }

      if (message.type === "retrySegment") {
        retryFailedSegment().catch((error) => fail(error));
        return;
      }

      if (message.type === "skipSegment") {
        skipFailedSegment().catch((error) => fail(error));
        return;
      }

      if (message.type === "cancel") {
        cancel("Narration stopped.");
      }
    },
    cancel
  };

  async function start(message) {
    if (state.active) {
      cancel("Restarting narration.");
    }

    const apiKey = String(message.apiKey || "").trim();
    const text = normalizeText(String(message.text || ""));
    const options = sanitizeOptions(message.options || {});

    if (options.provider === "google") {
      if (!(await hasGoogleOAuthRefreshToken())) throw new Error("Connect Google before starting narration.");
    } else if (!apiKey) {
      throw new Error(`Add your ${providerLabel(options.provider)} credential before starting narration.`);
    }

    if (!text) {
      throw new Error("Paste text or load a .txt file before starting narration.");
    }

    state.active = true;
    state.cancelled = false;
    state.pauseRequested = false;
    state.paused = false;
    state.recoverableError = null;
    state.apiKey = apiKey;
    state.options = options;
    state.segmentIndex = 0;
    state.automaticSegmentRetries = 0;
    state.waitingForAudioDone = false;
    state.segments = options.provider === "openrouter" && isOpenRouterGemini31Model(options.model)
      ? createGeminiNarrationSegments(text, { targetChars: options.segmentChars })
      : splitText(text, options.segmentChars, options.maxSegmentBytes).map((segmentText, index, segments) => ({
          text: segmentText,
          previousContext: "",
          nextContext: "",
          boundaryBefore: index === 0 ? "start" : "sentence",
          boundaryAfter: index === segments.length - 1 ? "end" : "sentence"
        }));

    sendJsonWs(client, {
      type: "meta",
      audioEncoding: getProviderAudioEncoding(options),
      sampleRate: getProviderSampleRate(options),
      channels: 1,
      totalSegments: state.segments.length
    });

    if (options.provider === "google") {
      sendJsonWs(client, { type: "status", message: `Using Google Cloud Gemini-TTS (${GEMINI_TTS_MODEL}).` });
    } else if (options.provider === "openrouter") {
      sendJsonWs(client, { type: "status", message: `Using OpenRouter ${options.model}.` });
    } else if (options.provider === "gemini") {
      sendJsonWs(client, { type: "status", message: "Using Gemini Developer API TTS." });
    } else if (options.provider === "resemble") {
      sendJsonWs(client, { type: "status", message: "Using Resemble.ai custom voice TTS." });
    } else if (options.provider === "minimax") {
      sendJsonWs(client, { type: "status", message: `Using MiniMax ${options.model} custom voice TTS.` });
    } else {
      await connectUpstream();
    }

    await pumpNextSegment();
  }

  async function connectUpstream() {
    if (state.options.provider !== "xai") return;

    const url = buildXaiUrl(state.options);
    if (state.upstream?.readyState === WebSocketConnection.OPEN) return;
    if (state.upstream?.readyState === WebSocketConnection.CONNECTING) return;

    const upstream = await connectXaiWebSocket(url, state.apiKey);
    state.upstream = upstream;

    upstream.on("message", (raw) => handleUpstreamMessage(raw).catch((error) => fail(error)));
    upstream.on("error", (error) => fail(new Error(`xAI WebSocket error: ${error.message}`)));
    upstream.on("close", ({ code, reason }) => {
      if (state.active && state.waitingForAudioDone && !state.cancelled) {
        fail(new Error(`xAI WebSocket closed before audio finished (${code} ${reason || ""}).`));
      }
    });

    sendJsonWs(client, { type: "status", message: "Connected to xAI streaming TTS." });
  }

  async function pumpNextSegment() {
    if (!state.active || state.cancelled || state.waitingForAudioDone || state.recoverableError) return;

    if (state.segmentIndex >= state.segments.length) {
      finish();
      return;
    }

    if (state.paused) return;
    if (state.pauseRequested) {
      enterPaused();
      return;
    }

    await connectUpstream();
    if (!state.active || state.cancelled || state.paused) return;
    if (state.pauseRequested) {
      enterPaused();
      return;
    }
    await sendSegment(state.segments[state.segmentIndex]);
  }

  function requestPause() {
    if (!state.active || state.cancelled || state.paused || state.pauseRequested) return;
    state.pauseRequested = true;
    if (state.waitingForAudioDone) {
      sendJsonWs(client, {
        type: "pausePending",
        currentSegment: state.segmentIndex + 1,
        totalSegments: state.segments.length
      });
      return;
    }
    enterPaused();
  }

  function enterPaused() {
    if (!state.active || state.cancelled || state.waitingForAudioDone || state.segmentIndex >= state.segments.length) return;
    state.pauseRequested = false;
    state.paused = true;
    closeUpstream();
    sendJsonWs(client, {
      type: "paused",
      completedSegments: state.segmentIndex,
      totalSegments: state.segments.length
    });
  }

  async function resume() {
    if (!state.active || state.cancelled) return;
    if (state.pauseRequested && !state.paused) {
      state.pauseRequested = false;
      sendJsonWs(client, {
        type: "resumed",
        nextSegment: state.segmentIndex + 1,
        totalSegments: state.segments.length
      });
      return;
    }
    if (!state.paused) return;
    state.paused = false;
    sendJsonWs(client, {
      type: "resumed",
      nextSegment: state.segmentIndex + 1,
      totalSegments: state.segments.length
    });
    await pumpNextSegment();
  }

  async function retryFailedSegment() {
    if (!state.active || state.cancelled || !state.recoverableError || state.waitingForAudioDone) return;
    const index = state.segmentIndex + 1;
    state.recoverableError = null;
    sendJsonWs(client, { type: "segmentRetrying", index, totalSegments: state.segments.length });
    await sendSegment(state.segments[state.segmentIndex]);
  }

  async function skipFailedSegment() {
    if (!state.active || state.cancelled || !state.recoverableError || state.waitingForAudioDone) return;
    const index = state.segmentIndex + 1;
    state.recoverableError = null;
    state.segmentIndex += 1;
    state.automaticSegmentRetries = 0;
    sendJsonWs(client, { type: "segmentSkipped", index, totalSegments: state.segments.length });
    await pumpNextSegment();
  }

  async function sendSegment(segment) {
    state.waitingForAudioDone = true;

    sendJsonWs(client, {
      type: "segment",
      index: state.segmentIndex + 1,
      totalSegments: state.segments.length,
      boundaryBefore: segment.boundaryBefore,
      boundaryAfter: segment.boundaryAfter
    });

    if (state.options.provider === "google") {
      await synthesizeBufferedSegment((signal) => synthesizeGoogleSpeech(segment.text, state.options, signal));
      return;
    }

    if (state.options.provider === "gemini") {
      await synthesizeBufferedSegment((signal) => synthesizeGeminiSpeech(segment.text, state.options, state.apiKey, signal));
      return;
    }

    if (state.options.provider === "openrouter") {
      const retryOptions = state.automaticSegmentRetries > 0 && isOpenRouterGemini31Model(state.options.model)
        ? { ...state.options, geminiContinuity: false }
        : state.options;
      await synthesizeBufferedSegment((signal) => synthesizeOpenRouterSpeech(segment, retryOptions, state.apiKey, signal));
      return;
    }

    if (state.options.provider === "resemble") {
      await synthesizeBufferedSegment((signal) => synthesizeResembleSpeech(segment.text, state.options, state.apiKey, signal));
      return;
    }

    if (state.options.provider === "minimax") {
      await synthesizeBufferedSegment((signal) => synthesizeMiniMaxSpeech(segment.text, state.options, state.apiKey, signal));
      return;
    }

    const upstream = state.upstream;
    if (!upstream || upstream.readyState !== WebSocketConnection.OPEN) {
      throw new Error("xAI connection is not open.");
    }

    for (const delta of splitFixed(segment.text, MAX_DELTA_CHARS)) {
      upstream.send(JSON.stringify({ type: "text.delta", delta }));
    }

    upstream.send(JSON.stringify({ type: "text.done" }));
  }

  async function synthesizeBufferedSegment(synthesize) {
    const controller = new AbortController();
    state.currentRequest = controller;

    try {
      const result = await synthesize(controller.signal);
      if (state.cancelled) return;
      const chunk = Buffer.isBuffer(result) ? result : result.audio;

      if (client.readyState === WebSocketConnection.OPEN) {
        client.send(chunk, { binary: true });
      }

      state.waitingForAudioDone = false;

      sendJsonWs(client, {
        type: "segmentDone",
        index: state.segmentIndex + 1,
        totalSegments: state.segments.length,
        generationId: result.generationId || undefined,
        attempts: result.attempts
      });

      state.segmentIndex += 1;
      state.automaticSegmentRetries = 0;
      await pumpNextSegment();
    } finally {
      if (state.currentRequest === controller) {
        state.currentRequest = null;
      }
    }
  }

  async function handleUpstreamMessage(raw) {
    let event;
    try {
      event = JSON.parse(raw.toString());
    } catch {
      throw new Error("Received a non-JSON message from xAI.");
    }

    if (event.type === "audio.delta") {
      const chunk = Buffer.from(event.delta || "", "base64");

      if (client.readyState === WebSocketConnection.OPEN) {
        client.send(chunk, { binary: true });
      }
      return;
    }

    if (event.type === "audio.done") {
      state.waitingForAudioDone = false;

      sendJsonWs(client, {
        type: "segmentDone",
        index: state.segmentIndex + 1,
        totalSegments: state.segments.length
      });

      state.segmentIndex += 1;
      state.automaticSegmentRetries = 0;
      await pumpNextSegment();
      return;
    }

    if (event.type === "audio.clear") {
      return;
    }

    if (event.type === "error") {
      throw new Error(event.message || "xAI returned an unknown TTS error.");
    }
  }

  function finish() {
    if (!state.active) return;

    state.active = false;
    state.pauseRequested = false;
    state.paused = false;
    state.recoverableError = null;
    sendJsonWs(client, { type: "complete" });

    closeUpstream();
  }

  function cancel(reason) {
    if (state.cancelled) return;

    state.cancelled = true;
    state.active = false;
    state.pauseRequested = false;
    state.paused = false;
    state.recoverableError = null;

    if (state.currentRequest) {
      state.currentRequest.abort();
      state.currentRequest = null;
    }

    if (state.options.provider === "xai" && state.upstream?.readyState === WebSocketConnection.OPEN) {
      try {
        state.upstream.send(JSON.stringify({ type: "text.clear" }));
      } catch {
        // The upstream connection is already going away.
      }
    }

    closeUpstream();
    sendJsonWs(client, { type: "cancelled", message: reason });
  }

  function fail(error) {
    if (state.cancelled) return;

    if (state.active
      && state.options.provider === "openrouter"
      && state.waitingForAudioDone
      && state.segmentIndex < state.segments.length) {
      state.waitingForAudioDone = false;

      if (state.automaticSegmentRetries < AUTOMATIC_SEGMENT_RETRIES) {
        state.automaticSegmentRetries += 1;
        sendJsonWs(client, {
          type: "status",
          message: `Segment ${state.segmentIndex + 1} failed; retrying automatically...`
        });
        sendSegment(state.segments[state.segmentIndex]).catch((retryError) => fail(retryError));
        return;
      }

      state.pauseRequested = false;
      state.paused = false;
      state.recoverableError = error;
      sendJsonWs(client, {
        type: "segmentFailed",
        index: state.segmentIndex + 1,
        totalSegments: state.segments.length,
        message: error.message || String(error),
        details: openRouterErrorDetails(error)
      });
      return;
    }

    state.active = false;
    state.pauseRequested = false;
    state.paused = false;
    state.recoverableError = null;
    closeUpstream();
    sendJsonWs(client, { type: "error", message: error.message || String(error) });
  }

  function closeUpstream() {
    if (state.currentRequest) {
      state.currentRequest.abort();
      state.currentRequest = null;
    }

    const upstream = state.upstream;
    state.upstream = null;

    if (upstream && upstream.readyState === WebSocketConnection.OPEN) {
      upstream.close(1000, "Narration session ended.");
    } else if (upstream && upstream.readyState === WebSocketConnection.CONNECTING) {
      upstream.terminate();
    }
  }
}

function sanitizeOptions(raw) {
  const provider = sanitizeProvider(raw.provider);
  const defaultVoice = provider === "google"
    ? "Enceladus"
    : provider === "gemini"
      ? "Enceladus"
      : provider === "openrouter"
        ? "alloy"
        : provider === "resemble"
          ? ""
          : provider === "minimax"
            ? ""
            : "eve";
  const voice = sanitizeVoice(raw.voice, defaultVoice, provider);
  const language = sanitizeLanguage(raw.language, provider);
  const speed = clamp(Number(raw.speed || 1), 0.7, 1.5);
  const optimizeStreamingLatency = raw.optimizeStreamingLatency ? 1 : 0;
  const textNormalization = provider === "xai" && Boolean(raw.textNormalization);
  const model = provider === "openrouter" ? String(raw.model || "").trim() : provider === "minimax" ? sanitizeMiniMaxModel(raw.model) : "";
  const gemini31OpenRouter = provider === "openrouter" && isOpenRouterGemini31Model(model);
  const defaultSegmentChars = getDefaultSegmentChars(provider, model);
  const maxSegmentChars = getMaxSegmentChars(provider, model);
  const segmentChars = Math.round(clamp(Number(raw.segmentChars || defaultSegmentChars), MIN_SEGMENT_CHARS, maxSegmentChars));
  if (provider === "openrouter" && !model) {
    throw new Error("Select an OpenRouter speech model before starting narration.");
  }
  if (provider === "resemble" && !voice) {
    throw new Error("Select a Resemble.ai custom voice before starting narration.");
  }
  if (provider === "minimax" && !voice) {
    throw new Error("Select a MiniMax custom voice before starting narration.");
  }

  return {
    provider,
    model,
    voice,
    language: language || "auto",
    speed,
    segmentChars,
    maxSegmentBytes: provider === "google" ? GOOGLE_MAX_SEGMENT_BYTES : Number.POSITIVE_INFINITY,
    optimizeStreamingLatency,
    textNormalization,
    geminiContinuity: gemini31OpenRouter && raw.geminiContinuity !== false,
    geminiNarratorDirection: gemini31OpenRouter ? sanitizeNarratorDirection(raw.geminiNarratorDirection) : ""
  };
}

function sanitizeBase64Audio(value, maxLength = 6 * 1024 * 1024) {
  const audio = String(value || "").trim();
  if (!audio) return "";
  if (!/^[A-Za-z0-9+/=]+$/.test(audio)) throw new Error("Voice reference audio must be base64-encoded.");
  if (audio.length > maxLength) throw new Error("Voice reference audio is too large.");
  return audio;
}

function getDefaultSegmentChars(provider, model = "") {
  if (provider === "google") return GOOGLE_DEFAULT_SEGMENT_CHARS;
  if (provider === "gemini") return GEMINI_DEFAULT_SEGMENT_CHARS;
  if (provider === "openrouter" && isOpenRouterGemini31Model(model)) return GEMINI_31_DEFAULT_SEGMENT_CHARS;
  return DEFAULT_SEGMENT_CHARS;
}

function getMaxSegmentChars(provider, model = "") {
  if (provider === "google") return GOOGLE_MAX_SEGMENT_CHARS;
  if (provider === "openrouter" && isOpenRouterGemini31Model(model)) return GEMINI_31_MAX_SEGMENT_CHARS;
  return MAX_SEGMENT_CHARS;
}

function sanitizeProvider(rawProvider) {
  if (rawProvider === "google") return "google";
  if (rawProvider === "gemini") return "gemini";
  if (rawProvider === "openrouter") return "openrouter";
  if (rawProvider === "resemble") return "resemble";
  if (rawProvider === "minimax") return "minimax";
  return "xai";
}

function sanitizeVoice(rawVoice, fallback, provider) {
  const voice = String(rawVoice || fallback).trim();
  if (provider === "google") {
    return GEMINI_TTS_VOICES.has(voice) ? voice : fallback;
  }

  if (provider === "gemini") {
    return GEMINI_TTS_VOICES.has(voice) ? voice : fallback;
  }

  if (provider === "openrouter" || provider === "resemble" || provider === "minimax") {
    return voice || fallback;
  }

  return (voice || fallback).toLowerCase();
}

function sanitizeLanguage(rawLanguage, provider) {
  const language = String(rawLanguage || "auto").trim();
  if (provider === "gemini") return language || "auto";
  if (provider !== "google") return language || "auto";
  if (language && language !== "auto") return language;
  return "en-US";
}

function getProviderAudioEncoding(optionsOrProvider) {
  const provider = typeof optionsOrProvider === "string" ? optionsOrProvider : optionsOrProvider.provider;
  if (provider === "gemini" || provider === "google" || provider === "resemble") return "pcm_s16le";
  if (provider === "openrouter" && requiresOpenRouterPcm(optionsOrProvider.model)) return "pcm_s16le";
  return "mpeg";
}

function getProviderSampleRate(optionsOrProvider) {
  const provider = typeof optionsOrProvider === "string" ? optionsOrProvider : optionsOrProvider.provider;
  if (provider === "resemble") return RESEMBLE_SAMPLE_RATE;
  if (provider === "gemini" || provider === "google") return GEMINI_SAMPLE_RATE;
  if (provider === "openrouter" && requiresOpenRouterPcm(optionsOrProvider.model)) return GEMINI_SAMPLE_RATE;
  return 24000;
}

function getOpenRouterResponseFormat(model) {
  return requiresOpenRouterPcm(model) ? "pcm" : "mp3";
}

function requiresOpenRouterPcm(model) {
  return /(^|[/:-])(?:google|gemini)(?:[/:-]|$)/i.test(String(model || ""));
}

function buildXaiUrl(options) {
  const params = new URLSearchParams({
    language: options.language,
    voice: options.voice,
    codec: "mp3",
    sample_rate: "24000",
    bit_rate: "128000",
    speed: String(options.speed),
    optimize_streaming_latency: String(options.optimizeStreamingLatency),
    text_normalization: String(options.textNormalization)
  });

  return `${XAI_TTS_URL}?${params}`;
}


async function synthesizeMiniMaxSpeech(text, options, apiKey, signal) {
  const trimmedApiKey = String(apiKey || "").trim();
  if (!trimmedApiKey) throw new Error("Add your MiniMax API key before starting narration.");
  const parsed = await requestMiniMaxJson(MINIMAX_TTS_URL, {
    apiKey: trimmedApiKey,
    method: "POST",
    payload: {
      model: sanitizeMiniMaxModel(options.model),
      text,
      stream: false,
      language_boost: sanitizeMiniMaxCloneLanguageModel(options.language),
      output_format: "hex",
      voice_setting: {
        voice_id: options.voice,
        speed: options.speed,
        vol: 1,
        pitch: 0
      },
      audio_setting: {
        sample_rate: MINIMAX_SAMPLE_RATE,
        bitrate: 128000,
        format: "mp3",
        channel: 1
      }
    },
    signal
  });
  const audio = parsed?.data?.audio || parsed?.audio;
  if (!audio) throw new Error("MiniMax response did not include audio content.");
  return /^[0-9a-f]+$/i.test(audio) ? Buffer.from(audio, "hex") : Buffer.from(String(audio), "base64");
}

async function synthesizeResembleSpeech(text, options, apiKey, signal) {
  const trimmedApiKey = String(apiKey || "").trim();
  if (!trimmedApiKey) {
    throw new Error("Add your Resemble.ai API key before starting narration.");
  }

  const response = await fetch(RESEMBLE_SYNTHESIS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      Authorization: normalizeBearerToken(trimmedApiKey)
    },
    body: JSON.stringify({
      voice_uuid: options.voice,
      data: text,
      sample_rate: RESEMBLE_SAMPLE_RATE,
      precision: "PCM_16",
      output_format: "wav"
    }),
    signal
  });

  let body;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok) {
    throw new Error(`Resemble.ai TTS request failed: ${body?.error || body?.message || `${response.status} ${response.statusText}`}`);
  }
  if (!body?.audio_content) {
    throw new Error("Resemble.ai response did not include audio content.");
  }

  return extractLinear16Pcm(Buffer.from(body.audio_content, "base64"));
}

async function synthesizeOpenRouterSpeech(segment, options, apiKey, signal) {
  const trimmedApiKey = String(apiKey || "").trim();
  if (!trimmedApiKey) {
    throw new Error("Add your OpenRouter API key before starting narration.");
  }

  if (isOpenRouterGemini31Model(options.model)) {
    const result = await requestOpenRouterGemini31Speech({
      url: OPENROUTER_TTS_URL,
      apiKey: trimmedApiKey,
      voice: options.voice,
      input: buildGemini31NarrationPrompt(segment, {
        speed: options.speed,
        enhancedContinuity: options.geminiContinuity,
        narratorDirection: options.geminiNarratorDirection
      }),
      signal
    });
    return {
      audio: Buffer.from(result.audio.buffer, result.audio.byteOffset, result.audio.byteLength),
      generationId: result.generationId,
      attempts: result.attempts
    };
  }

  return requestOpenRouterSpeech({
    url: OPENROUTER_TTS_URL,
    apiKey: trimmedApiKey,
    body: {
      model: options.model,
      input: requiresOpenRouterPcm(options.model) ? buildGeminiPrompt(segment.text, options) : segment.text,
      voice: options.voice,
      response_format: getOpenRouterResponseFormat(options.model),
      speed: options.speed
    },
    signal,
    readResponse: async (response, attempt) => {
      const audio = Buffer.from(await response.arrayBuffer());
      if (!audio.length) throw new Error("OpenRouter TTS returned empty audio.");
      return {
        audio: requiresOpenRouterPcm(options.model) ? extractLinear16Pcm(audio) : audio,
        generationId: response.headers.get("x-generation-id") || "",
        attempts: attempt
      };
    }
  });
}

async function synthesizeGoogleSpeech(text, options, signal) {
  const url = new URL(GOOGLE_TTS_URL);
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    Authorization: `Bearer ${await getGoogleOAuthAccessToken(signal)}`
  };

  const requestBody = {
    input: {
      text,
      prompt: buildGeminiStylePrompt(options)
    },
    voice: {
      languageCode: options.language,
      name: options.voice,
      modelName: GEMINI_TTS_MODEL
    },
    audioConfig: {
      audioEncoding: "LINEAR16",
      sampleRateHertz: GEMINI_SAMPLE_RATE
    }
  };

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(requestBody),
    signal
  });

  let body;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok) {
    const message = body?.error?.message || `${response.status} ${response.statusText}`;
    throw new Error(`Google TTS request failed: ${message}`);
  }

  if (!body?.audioContent) {
    throw new Error("Google TTS response did not include audio content.");
  }

  return extractLinear16Pcm(Buffer.from(body.audioContent, "base64"));
}

function extractLinear16Pcm(audio) {
  if (audio.length < 44) return audio;
  if (audio.toString("ascii", 0, 4) !== "RIFF" || audio.toString("ascii", 8, 12) !== "WAVE") {
    return audio;
  }

  let offset = 12;
  while (offset + 8 <= audio.length) {
    const chunkId = audio.toString("ascii", offset, offset + 4);
    const chunkSize = audio.readUInt32LE(offset + 4);
    const dataStart = offset + 8;
    const dataEnd = Math.min(dataStart + chunkSize, audio.length);

    if (chunkId === "data") {
      return audio.subarray(dataStart, dataEnd);
    }

    offset = dataStart + chunkSize + (chunkSize % 2);
  }

  return audio.subarray(44);
}

async function synthesizeGeminiSpeech(text, options, apiKey, signal) {
  const trimmedApiKey = String(apiKey || "").trim();
  if (!trimmedApiKey) {
    throw new Error("Add your Gemini API key before starting narration.");
  }

  if (/^Bearer\s+/i.test(trimmedApiKey) || trimmedApiKey.startsWith("{")) {
    throw new Error("Gemini Developer API expects an AI Studio API key, not OAuth or service account credentials.");
  }

  const response = await fetch(GEMINI_TTS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "x-goog-api-key": trimmedApiKey
    },
    body: JSON.stringify({
      contents: [{
        parts: [{
          text: buildGeminiPrompt(text, options)
        }]
      }],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: options.voice
            }
          }
        }
      },
      model: GEMINI_TTS_MODEL
    }),
    signal
  });

  let body;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok) {
    const message = body?.error?.message || `${response.status} ${response.statusText}`;
    throw new Error(`Gemini TTS request failed: ${message}`);
  }

  const audioData = body?.candidates?.[0]?.content?.parts?.find((part) => part.inlineData)?.inlineData?.data;
  if (!audioData) {
    throw new Error("Gemini TTS response did not include audio data.");
  }

  return Buffer.from(audioData, "base64");
}

function buildGeminiPrompt(text, options) {
  return `${buildGeminiStylePrompt(options)}\n\n${text}`;
}

function buildGeminiStylePrompt(options) {
  const pace = describeGeminiPace(options.speed);
  const paceInstruction = pace ? ` at a ${pace} pace` : "";
  return `Read the following audiobook passage aloud exactly as written${paceInstruction}.`;
}

function describeGeminiPace(speed) {
  if (speed <= 0.82) return "slow";
  if (speed < 0.96) return "slightly slow";
  if (speed >= 1.24) return "fast";
  if (speed > 1.06) return "slightly brisk";
  return "";
}

function base64Url(value) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function providerLabel(provider) {
  if (provider === "google") return "Google Cloud TTS";
  if (provider === "gemini") return "Gemini API";
  if (provider === "openrouter") return "OpenRouter";
  if (provider === "resemble") return "Resemble.ai";
  if (provider === "minimax") return "MiniMax";
  return "xAI";
}

function inferOpenRouterVoices(model) {
  const discovered = extractVoiceValues(model);
  const fallback = getOpenRouterFallbackVoices(model?.id || model?.name || "");
  const values = discovered.length ? discovered : fallback;
  return values.map((voice) => ({ value: voice, label: formatVoiceLabel(voice) }));
}

function extractVoiceValues(value, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return [];
  seen.add(value);

  const voices = [];
  for (const [key, child] of Object.entries(value)) {
    if (/voices?$/i.test(key)) {
      if (Array.isArray(child)) {
        for (const item of child) {
          if (typeof item === "string") voices.push(item);
          else if (item && typeof item === "object") voices.push(String(item.id || item.name || item.voice || ""));
        }
      } else if (child && typeof child === "object") {
        voices.push(...Object.keys(child));
      }
    }
    if (child && typeof child === "object") voices.push(...extractVoiceValues(child, seen));
  }

  return [...new Set(voices.map((voice) => String(voice).trim()).filter(Boolean))];
}

function getOpenRouterFallbackVoices(modelId) {
  const id = String(modelId).toLowerCase();
  if (id.includes("x-ai") || id.includes("grok")) return ["eve", "ara", "leo", "rex", "sal"];
  if (id.includes("google") || id.includes("gemini")) return [...GEMINI_TTS_VOICES];
  if (id.includes("kokoro")) return ["af_alloy", "af_aoede", "af_bella", "af_heart", "af_jessica", "af_kore", "af_nicole", "af_nova", "af_river", "af_sarah", "af_sky", "am_adam", "am_echo", "am_eric", "am_fenrir", "am_liam", "am_michael", "am_onyx", "am_puck", "am_santa", "bf_alice", "bf_emma", "bf_isabella", "bf_lily", "bm_daniel", "bm_fable", "bm_george", "bm_lewis"];
  if (id.includes("orpheus")) return ["tara", "leah", "jess", "leo", "dan", "mia", "zac", "zoe"];
  if (id.includes("sesame")) return ["conversational_a", "conversational_b", "read_speech_a", "read_speech_b"];
  if (id.includes("mai") || id.includes("microsoft") || id.includes("azure")) return ["en-US-Harper:MAI-Voice-2", "en-US-Ava:MAI-Voice-2", "en-US-Andrew:MAI-Voice-2"];
  return ["alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer", "verse"];
}

function formatVoiceLabel(voice) {
  return String(voice)
    .replace(/[_-]/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function getRequestOrigin(req) {
  const proto = String(req.headers["x-forwarded-proto"] || "http").split(",")[0].trim() || "http";
  return `${proto}://${req.headers.host || `localhost:${PORT}`}`;
}

function splitText(text, targetLength, maxBytes = Number.POSITIVE_INFINITY) {
  const normalized = normalizeText(text);
  const paragraphs = normalized
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);

  const segments = [];
  let current = "";

  for (const paragraph of paragraphs) {
    const units = paragraph.length > targetLength || byteLength(paragraph) > maxBytes
      ? splitSentences(paragraph)
      : [paragraph];

    for (const unit of units) {
      for (const piece of splitOversizedUnit(unit, targetLength, maxBytes)) {
        if (!current) {
          current = piece;
          continue;
        }

        const candidate = `${current}\n\n${piece}`;
        if (candidate.length <= targetLength && byteLength(candidate) <= maxBytes) {
          current += `\n\n${piece}`;
        } else {
          segments.push(current);
          current = piece;
        }
      }
    }
  }

  if (current) segments.push(current);
  return segments;
}

function splitSentences(text) {
  const matches = text.match(/[^.!?。！？]+[.!?。！？]+["')\]]*|[^.!?。！？]+$/g);
  return (matches || [text]).map((part) => part.trim()).filter(Boolean);
}

function splitOversizedUnit(text, targetLength, maxBytes = Number.POSITIVE_INFINITY) {
  if (text.length <= targetLength && byteLength(text) <= maxBytes) return [text];

  const pieces = [];
  let rest = text.trim();

  while (rest.length > targetLength || byteLength(rest) > maxBytes) {
    const byteCutAt = Number.isFinite(maxBytes)
      ? utf8SliceIndex(rest, maxBytes)
      : rest.length;
    const limit = Math.max(1, Math.min(targetLength, byteCutAt));
    let cutAt = rest.lastIndexOf(" ", limit);
    if (cutAt < Math.floor(targetLength * 0.6)) {
      cutAt = limit;
    }

    pieces.push(rest.slice(0, cutAt).trim());
    rest = rest.slice(cutAt).trim();
  }

  if (rest) pieces.push(rest);
  return pieces;
}

function utf8SliceIndex(text, maxBytes) {
  let bytes = 0;
  let index = 0;

  for (const char of text) {
    const charBytes = Buffer.byteLength(char, "utf8");
    if (bytes + charBytes > maxBytes) break;
    bytes += charBytes;
    index += char.length;
  }

  return index || 1;
}

function byteLength(text) {
  return Buffer.byteLength(text, "utf8");
}

function splitFixed(text, maxLength) {
  const parts = [];
  let rest = text;

  while (rest.length > maxLength) {
    parts.push(rest.slice(0, maxLength));
    rest = rest.slice(maxLength);
  }

  if (rest) parts.push(rest);
  return parts;
}

export function normalizeText(text) {
  const safeScalars = [];
  const source = String(text).replace(/\r\n?/g, "\n");

  for (const scalar of source) {
    const codePoint = scalar.codePointAt(0);

    if (codePoint === 0x0085 || codePoint === 0x2028 || codePoint === 0x2029) {
      safeScalars.push("\n");
      continue;
    }

    if (codePoint === 0x0009 || codePoint === 0x000b || codePoint === 0x000c) {
      safeScalars.push(" ");
      continue;
    }

    // Copy/paste sources often use these as invisible word boundaries. A real
    // space avoids accidentally joining two words after the marker is removed.
    if (codePoint === 0x200b || codePoint === 0xfeff) {
      safeScalars.push(" ");
      continue;
    }

    if (isTextLayoutControl(codePoint) || isUnsafeTextCodePoint(codePoint)) continue;
    safeScalars.push(scalar);
  }

  return safeScalars.join("")
    .normalize("NFC")
    .replace(/\p{Zs}+/gu, " ")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

function isTextLayoutControl(codePoint) {
  return codePoint === 0x00ad
    || codePoint === 0x061c
    || codePoint === 0x180e
    || codePoint === 0x200e
    || codePoint === 0x200f
    || (codePoint >= 0x202a && codePoint <= 0x202e)
    || (codePoint >= 0x2060 && codePoint <= 0x206f);
}

function isUnsafeTextCodePoint(codePoint) {
  const isControl = (codePoint < 0x20 && codePoint !== 0x0a)
    || (codePoint >= 0x7f && codePoint <= 0x9f);
  const isSurrogate = codePoint >= 0xd800 && codePoint <= 0xdfff;
  const isPrivateUse = (codePoint >= 0xe000 && codePoint <= 0xf8ff)
    || (codePoint >= 0xf0000 && codePoint <= 0xffffd)
    || (codePoint >= 0x100000 && codePoint <= 0x10fffd);
  const isNoncharacter = (codePoint >= 0xfdd0 && codePoint <= 0xfdef)
    || (codePoint & 0xffff) === 0xfffe
    || (codePoint & 0xffff) === 0xffff;
  const isAnnotationOrReplacement = codePoint >= 0xfff9 && codePoint <= 0xfffd;
  const isUnicodeTag = codePoint >= 0xe0000 && codePoint <= 0xe007f;

  return isControl || isSurrogate || isPrivateUse || isNoncharacter
    || isAnnotationOrReplacement || isUnicodeTag;
}

function connectXaiWebSocket(url, apiKey) {
  const parsed = new URL(url);
  const port = Number(parsed.port || 443);
  const pathWithQuery = `${parsed.pathname}${parsed.search}`;

  return new Promise((resolve, reject) => {
    const socket = tls.connect({
      host: parsed.hostname,
      port,
      servername: parsed.hostname
    });

    const key = crypto.randomBytes(16).toString("base64");
    let handshake = Buffer.alloc(0);
    let settled = false;

    const cleanup = () => {
      socket.off("secureConnect", onSecureConnect);
      socket.off("data", onHandshakeData);
      socket.off("error", onError);
      socket.off("close", onClose);
    };

    const failHandshake = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      socket.destroy();
      reject(error);
    };

    const onError = (error) => {
      failHandshake(error);
    };

    const onClose = () => {
      failHandshake(new Error("xAI WebSocket closed during handshake."));
    };

    const onSecureConnect = () => {
      socket.write([
        `GET ${pathWithQuery} HTTP/1.1`,
        `Host: ${parsed.host}`,
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Key: ${key}`,
        "Sec-WebSocket-Version: 13",
        `Authorization: Bearer ${apiKey}`,
        "\r\n"
      ].join("\r\n"));
    };

    const onHandshakeData = (chunk) => {
      handshake = Buffer.concat([handshake, chunk]);
      const headerEnd = handshake.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;

      const headerText = handshake.slice(0, headerEnd).toString("utf8");
      const [statusLine] = headerText.split("\r\n");
      const statusMatch = statusLine.match(/^HTTP\/1\.1\s+(\d+)/);
      const statusCode = statusMatch ? Number(statusMatch[1]) : 0;

      if (statusCode !== 101) {
        failHandshake(new Error(`xAI rejected the WebSocket upgrade (${statusLine}).`));
        return;
      }

      settled = true;
      cleanup();

      const ws = new WebSocketConnection(socket, {
        expectMaskedFrames: false,
        maskOutgoingFrames: true
      });

      const remaining = handshake.slice(headerEnd + 4);
      if (remaining.length) {
        ws.consume(remaining);
      }

      resolve(ws);
    };

    socket.once("secureConnect", onSecureConnect);
    socket.on("data", onHandshakeData);
    socket.once("error", onError);
    socket.once("close", onClose);
  });
}

class WebSocketConnection extends EventEmitter {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  constructor(socket, options) {
    super();
    this.socket = socket;
    this.expectMaskedFrames = options.expectMaskedFrames;
    this.maskOutgoingFrames = options.maskOutgoingFrames;
    this.readyState = WebSocketConnection.OPEN;
    this.buffer = Buffer.alloc(0);
    this.fragmentOpcode = 0;
    this.fragmentBuffers = [];
    this.closeEmitted = false;

    socket.on("data", (chunk) => this.consume(chunk));
    socket.on("error", (error) => this.emit("error", error));
    socket.on("close", () => {
      this.readyState = WebSocketConnection.CLOSED;
      this.emitClose(1006, "");
    });
  }

  send(data, options = {}) {
    if (this.readyState !== WebSocketConnection.OPEN) return;

    const opcode = options.binary || Buffer.isBuffer(data) ? 0x2 : 0x1;
    const payload = Buffer.isBuffer(data) ? data : Buffer.from(String(data));
    this.socket.write(encodeFrame(payload, opcode, this.maskOutgoingFrames));
  }

  close(code = 1000, reason = "") {
    if (this.readyState >= WebSocketConnection.CLOSING) return;

    this.readyState = WebSocketConnection.CLOSING;
    const reasonBytes = Buffer.from(reason);
    const payload = Buffer.alloc(2 + reasonBytes.length);
    payload.writeUInt16BE(code, 0);
    reasonBytes.copy(payload, 2);
    this.socket.write(encodeFrame(payload, 0x8, this.maskOutgoingFrames), () => {
      this.socket.end();
    });
  }

  terminate() {
    this.readyState = WebSocketConnection.CLOSED;
    this.socket.destroy();
  }

  consume(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);

    while (this.buffer.length >= 2) {
      const first = this.buffer[0];
      const second = this.buffer[1];
      const fin = Boolean(first & 0x80);
      const opcode = first & 0x0f;
      const masked = Boolean(second & 0x80);
      let length = second & 0x7f;
      let offset = 2;

      if (length === 126) {
        if (this.buffer.length < offset + 2) return;
        length = this.buffer.readUInt16BE(offset);
        offset += 2;
      } else if (length === 127) {
        if (this.buffer.length < offset + 8) return;
        const bigLength = this.buffer.readBigUInt64BE(offset);
        if (bigLength > BigInt(Number.MAX_SAFE_INTEGER)) {
          this.emit("error", new Error("WebSocket frame is too large."));
          this.terminate();
          return;
        }
        length = Number(bigLength);
        offset += 8;
      }

      const maskOffset = offset;
      if (masked) offset += 4;

      if (this.buffer.length < offset + length) return;

      if (this.expectMaskedFrames && !masked) {
        this.emit("error", new Error("Expected masked WebSocket frame."));
        this.terminate();
        return;
      }

      const mask = masked ? this.buffer.slice(maskOffset, maskOffset + 4) : null;
      const payload = Buffer.from(this.buffer.slice(offset, offset + length));
      this.buffer = this.buffer.slice(offset + length);

      if (mask) {
        for (let index = 0; index < payload.length; index += 1) {
          payload[index] ^= mask[index % 4];
        }
      }

      this.handleFrame(opcode, payload, fin);
    }
  }

  handleFrame(opcode, payload, fin) {
    if (opcode === 0x8) {
      const code = payload.length >= 2 ? payload.readUInt16BE(0) : 1000;
      const reason = payload.length > 2 ? payload.slice(2).toString("utf8") : "";
      if (this.readyState !== WebSocketConnection.CLOSING) {
        this.socket.write(encodeFrame(payload, 0x8, this.maskOutgoingFrames));
      }
      this.readyState = WebSocketConnection.CLOSED;
      this.emitClose(code, reason);
      this.socket.end();
      return;
    }

    if (opcode === 0x9) {
      this.socket.write(encodeFrame(payload, 0xA, this.maskOutgoingFrames));
      return;
    }

    if (opcode === 0xA) return;

    if (opcode === 0x0) {
      this.fragmentBuffers.push(payload);
      if (fin) {
        const message = Buffer.concat(this.fragmentBuffers);
        const messageOpcode = this.fragmentOpcode;
        this.fragmentOpcode = 0;
        this.fragmentBuffers = [];
        this.emit("message", messageOpcode === 0x1 ? message.toString("utf8") : message);
      }
      return;
    }

    if (!fin) {
      this.fragmentOpcode = opcode;
      this.fragmentBuffers = [payload];
      return;
    }

    this.emit("message", opcode === 0x1 ? payload.toString("utf8") : payload);
  }

  emitClose(code, reason) {
    if (this.closeEmitted) return;
    this.closeEmitted = true;
    this.emit("close", { code, reason });
  }
}

function encodeFrame(payload, opcode, masked) {
  const length = payload.length;
  let headerLength = 2;

  if (length >= 126 && length <= 65_535) {
    headerLength += 2;
  } else if (length > 65_535) {
    headerLength += 8;
  }

  const maskLength = masked ? 4 : 0;
  const frame = Buffer.alloc(headerLength + maskLength + length);
  frame[0] = 0x80 | opcode;

  let offset = 2;
  if (length < 126) {
    frame[1] = (masked ? 0x80 : 0) | length;
  } else if (length <= 65_535) {
    frame[1] = (masked ? 0x80 : 0) | 126;
    frame.writeUInt16BE(length, offset);
    offset += 2;
  } else {
    frame[1] = (masked ? 0x80 : 0) | 127;
    frame.writeBigUInt64BE(BigInt(length), offset);
    offset += 8;
  }

  if (masked) {
    const mask = crypto.randomBytes(4);
    mask.copy(frame, offset);
    offset += 4;

    for (let index = 0; index < payload.length; index += 1) {
      frame[offset + index] = payload[index] ^ mask[index % 4];
    }
  } else {
    payload.copy(frame, offset);
  }

  return frame;
}

async function serveStatic(req, res) {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const requestedPath = url.pathname === "/" ? "/index.html" : url.pathname;
  let resolved;
  try {
    resolved = resolveStaticFilePath(requestedPath);
  } catch {
    sendText(res, 400, "Malformed request path");
    return;
  }

  if (!resolved.contained) {
    sendText(res, 403, "Forbidden");
    return;
  }

  try {
    const data = await fs.readFile(resolved.absolutePath);
    const ext = path.extname(resolved.absolutePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
      "Cache-Control": resolved.decodedPath.startsWith("/assets/")
        ? "public, max-age=31536000, immutable"
        : "no-cache"
    });
    res.end(data);
  } catch (error) {
    if (error.code === "ENOENT") {
      sendText(res, 404, "Not found");
      return;
    }

    throw error;
  }
}

export function resolveStaticFilePath(requestedPath, root = publicDir) {
  const decodedPath = decodeURIComponent(requestedPath);
  const absolutePath = path.resolve(root, `.${decodedPath}`);
  const relativePath = path.relative(root, absolutePath);
  const contained = relativePath !== ".."
    && !relativePath.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relativePath);
  return { decodedPath, absolutePath, contained };
}

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function sendText(res, status, body) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(body);
}

function sendJsonWs(ws, payload) {
  if (ws.readyState === WebSocketConnection.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function loadDotEnv(filePath) {
  if (!existsSync(filePath)) return;

  const lines = readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;

    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;
    process.env[key] = parseDotEnvValue(rawValue);
  }
}

function parseDotEnvValue(rawValue) {
  const value = rawValue.trim();
  if (
    (value.startsWith("\"") && value.endsWith("\"")) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1).replace(/\\n/g, "\n");
  }

  const commentIndex = value.indexOf(" #");
  return commentIndex === -1 ? value : value.slice(0, commentIndex).trim();
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

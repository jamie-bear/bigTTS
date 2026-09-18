import { MINIMAX_MAX_AUDIO_BYTES, RESEMBLE_MAX_CHARS } from "../shared/speechSettings.js";

export async function withProviderTimeout(run, signal, timeoutMs = 45000) {
  const controller = new AbortController();
  const cancel = () => controller.abort(signal.reason);
  if (signal?.aborted) cancel();
  else signal?.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(() => controller.abort(new Error("Provider request timed out.")), timeoutMs);
  try {
    if (controller.signal.aborted) throw controller.signal.reason;
    const result = await run(controller.signal);
    if (controller.signal.aborted) throw controller.signal.reason;
    return result;
  } catch (error) {
    throw controller.signal.aborted ? controller.signal.reason : error;
  }
  finally { clearTimeout(timer); signal?.removeEventListener("abort", cancel); }
}

export function providerError(providerName, response, body, fallback) {
  const source = body?.base_resp || body?.error || body;
  const message = typeof source === "string" ? source : source?.status_msg || source?.message || (Array.isArray(body?.issues) ? body.issues.join("; ") : "");
  const error = new Error(`${providerName}: ${message || fallback || "Request failed."}`);
  error.details = {
    providerName, status: response.status,
    ...(source?.status_code !== undefined || source?.code !== undefined ? { providerCode: String(source.status_code ?? source.code) } : {}),
    ...(body?.trace_id ? { requestId: String(body.trace_id) } : {})
  };
  return error;
}

// JSON.parse rounds int64 file IDs. Quote long integer tokens before parsing;
// quoted strings are consumed as whole tokens and are never rewritten.
export function parseMiniMaxJson(text) {
  try {
    // Scan strings without a recursive regex: synthesis audio can be megabytes.
    const parts = [];
    let start = 0;
    for (let index = 0; index < text.length;) {
      if (text[index] === '"') {
        index += 1;
        while (index < text.length && text[index] !== '"') index += text[index] === "\\" ? 2 : 1;
        index += 1;
      } else if (text[index] === "-" || /[0-9]/.test(text[index])) {
        const numberStart = index++;
        while (index < text.length && /[0-9.eE+-]/.test(text[index])) index += 1;
        const token = text.slice(numberStart, index);
        if (/^-?\d{16,}$/.test(token)) {
          parts.push(text.slice(start, numberStart), JSON.stringify(token));
          start = index;
        }
      } else index += 1;
    }
    parts.push(text.slice(start));
    return JSON.parse(parts.join(""));
  } catch { return null; }
}

export function stringifyMiniMaxPayload(payload) {
  // The API declares file IDs as int64, so emit their exact decimal digits.
  return JSON.stringify(payload).replace(/"(file_id|prompt_audio)":"(\d+)"|"(?:\\.|[^"\\])*"/g,
    (token, key, digits) => key ? `"${key}":${digits}` : token);
}

export function miniMaxFileId(value) {
  if (typeof value === "number" && !Number.isSafeInteger(value)) throw new Error("MiniMax file ID lost precision.");
  const id = String(value || "");
  if (!/^[1-9]\d*$/.test(id)) throw new Error("MiniMax file ID must be a positive integer.");
  return Number.isSafeInteger(Number(id)) ? Number(id) : id;
}

export function validateCloneAudio(base64, filename) {
  if (base64.length > Math.ceil(MINIMAX_MAX_AUDIO_BYTES / 3) * 4) throw new Error("Voice recording must be 20 MB or smaller.");
  if (!base64 || base64.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) throw new Error("Voice recording must contain valid base64 audio.");
  const audio = Buffer.from(base64, "base64");
  if (!audio.length || audio.length > MINIMAX_MAX_AUDIO_BYTES) throw new Error("Voice recording must be nonempty and 20 MB or smaller.");
  const ext = String(filename).split(".").at(-1)?.toLowerCase();
  const wav = audio.length >= 12 && audio.toString("ascii", 0, 4) === "RIFF" && audio.toString("ascii", 8, 12) === "WAVE";
  const m4a = audio.length >= 12 && audio.toString("ascii", 4, 8) === "ftyp";
  const mp3 = audio.toString("ascii", 0, 3) === "ID3" || (audio.length >= 4 && audio[0] === 0xff && (audio[1] & 0xe0) === 0xe0 && (audio[1] & 0x06) !== 0);
  if (!((ext === "wav" && wav) || (ext === "m4a" && m4a) || (ext === "mp3" && mp3))) throw new Error("Recording contents must match a supported MP3, M4A or WAV file.");
  return { audio, contentType: ext === "wav" ? "audio/wav" : ext === "m4a" ? "audio/mp4" : "audio/mpeg" };
}

export function decodeMiniMaxAudio(value) {
  if (typeof value !== "string" || !value.length || value.length % 2 || !/^[0-9a-f]+$/i.test(value)) throw new Error("MiniMax returned missing or invalid hex audio.");
  return Buffer.from(value, "hex");
}

export function decodeResembleWav(value, sampleRate = 22050) {
  if (value === undefined || value === null) throw new Error("Resemble response is missing audio_content.");
  if (typeof value !== "string") throw new Error("Resemble audio_content must be a base64 string.");
  // MIME-style line wrapping and omitted terminal padding do not change the
  // audio. Normalize those forms, but don't let Buffer silently ignore junk.
  const encoded = value.replace(/[\t\n\r ]/g, "").replace(/-/g, "+").replace(/_/g, "/");
  if (!encoded) throw new Error("Resemble response is missing audio_content.");
  const invalidBase64 = () => new Error("Resemble returned invalid base64 audio (invalid characters or padding).");
  const unpadded = encoded.replace(/={1,2}$/, "");
  if (/[^A-Za-z0-9+/]/.test(unpadded) || unpadded.length % 4 === 1
    || (unpadded.length !== encoded.length && encoded.length % 4 !== 0)) throw invalidBase64();
  const audio = Buffer.from(encoded, "base64");
  const invalid = () => new Error("Resemble returned invalid WAV audio; expected mono PCM16 at 22050 Hz.");
  if (audio.length < 44 || audio.toString("ascii", 0, 4) !== "RIFF" || audio.toString("ascii", 8, 12) !== "WAVE" || audio.readUInt32LE(4) + 8 !== audio.length) throw invalid();
  let formatValid = false;
  let pcm;
  for (let offset = 12; offset + 8 <= audio.length;) {
    const id = audio.toString("ascii", offset, offset + 4);
    const size = audio.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (start + size > audio.length) throw invalid();
    if (id === "fmt ") {
      if (size < 16 || audio.readUInt16LE(start) !== 1 || audio.readUInt16LE(start + 2) !== 1 || audio.readUInt32LE(start + 4) !== sampleRate || audio.readUInt16LE(start + 14) !== 16 || audio.readUInt16LE(start + 12) !== 2) throw invalid();
      formatValid = true;
    }
    if (id === "data") pcm = audio.subarray(start, start + size);
    offset = start + size + size % 2;
  }
  if (!formatValid || !pcm?.length || pcm.length % 2) throw invalid();
  return pcm;
}

const escapeXml = (text) => String(text).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char]);

export function buildResembleData(text, settings) {
  const attrs = [];
  for (const [field, attribute] of [["prompt", "prompt"], ["language", "xml:lang"], ["temperature", "temperature"], ["exaggeration", "exaggeration"], ["seed", "seed"]]) {
    if (settings[field] !== "" && settings[field] !== undefined) attrs.push(`${attribute}="${escapeXml(settings[field])}"`);
  }
  let content = escapeXml(text);
  if (["slow", "fast"].includes(settings.delivery)) content = `<${settings.delivery}>${content}</${settings.delivery}>`;
  return `<speak${attrs.length ? ` ${attrs.join(" ")}` : ""}>${content}</speak>`;
}

// Split by Unicode scalar and escaped size, preferring whitespace boundaries.
// Each request is a complete SSML document, including the narrator attributes.
export function splitResembleText(text, targetChars, settings) {
  const overhead = buildResembleData("", settings).length;
  const budget = RESEMBLE_MAX_CHARS - overhead;
  if (budget < 16) throw new Error("Resemble narrator settings leave too little room for text; shorten the direction.");
  const segments = [];
  let rest = text.trim();
  while (rest) {
    let cut = 0;
    let escapedLength = 0;
    let whitespace = 0;
    for (const char of rest) {
      if (escapedLength + escapeXml(char).length > budget || cut + char.length > targetChars) break;
      escapedLength += escapeXml(char).length;
      cut += char.length;
      if (/\s/u.test(char)) whitespace = cut;
    }
    if (!cut) throw new Error("Resemble segment size is too small.");
    if (cut < rest.length && whitespace > cut * 0.6) cut = whitespace;
    const segment = rest.slice(0, cut).trim();
    if (segment) segments.push(segment);
    rest = rest.slice(cut).trim();
  }
  return segments;
}

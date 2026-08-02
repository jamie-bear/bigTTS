import { requestOpenRouterSpeech } from "./openRouterSpeech.js";

export const OPENROUTER_GEMINI_31_TTS_MODEL = "google/gemini-3.1-flash-tts-preview";
export const GEMINI_31_DEFAULT_SEGMENT_CHARS = 500;
export const GEMINI_31_MAX_SEGMENT_CHARS = 2_500;
export const GEMINI_31_CONTEXT_CHARS = 240;
export const GEMINI_31_MAX_DIRECTION_CHARS = 800;

const STRONG_BOUNDARIES = new Set(["chapter", "scene"]);
const CLAUSE_END = /[;:,؛،、，；：—–]/u;
const SENTENCE_END = /[.!?؟۔।。！？]/u;

export function isOpenRouterGemini31Model(model) {
  return String(model || "").trim().toLowerCase() === OPENROUTER_GEMINI_31_TTS_MODEL;
}

export function sanitizeNarratorDirection(value) {
  return String(value || "")
    .replace(/[\t\f\v]+/g, " ")
    .replace(/ {2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, GEMINI_31_MAX_DIRECTION_CHARS)
    .trim();
}

export function geminiPaceDirective(speed) {
  const value = Number.isFinite(Number(speed)) ? Number(speed) : 1;
  if (value <= 0.82) return "a deliberate audiobook pace, approximately 115 words per minute";
  if (value <= 0.94) return "a relaxed audiobook pace, approximately 135 words per minute";
  if (value <= 1.06) return "a natural audiobook pace, approximately 155 words per minute";
  if (value <= 1.23) return "a gently brisk audiobook pace, approximately 180 words per minute";
  return "a brisk but clearly articulated pace, approximately 205 words per minute";
}

export function createGeminiNarrationSegments(text, options = {}) {
  const source = String(text || "");
  if (!source) return [];

  const targetChars = clampInteger(
    options.targetChars,
    300,
    GEMINI_31_MAX_SEGMENT_CHARS,
    GEMINI_31_DEFAULT_SEGMENT_CHARS
  );
  const hardMaxChars = clampInteger(
    options.hardMaxChars,
    targetChars,
    GEMINI_31_MAX_SEGMENT_CHARS,
    GEMINI_31_MAX_SEGMENT_CHARS
  );
  const preferredMin = Math.max(1, Math.floor(targetChars * 0.65));
  const preferredMax = Math.min(hardMaxChars, Math.ceil(targetChars * 1.25));
  const units = createSemanticUnits(source, hardMaxChars, options.locale);
  const groups = [];
  let current = [];
  let currentLength = 0;

  const flush = () => {
    if (!current.length) return;
    groups.push(current);
    current = [];
    currentLength = 0;
  };

  for (const unit of units) {
    const sceneMarkerLead = current.length === 1 && current[0].sceneMarker;
    if (current.length && STRONG_BOUNDARIES.has(unit.boundaryBefore) && !unit.sceneMarker && !sceneMarkerLead) flush();

    const candidateLength = currentLength + unit.text.length;
    const currentIsHeadingLead = current.length === 1 && (current[0].heading || current[0].sceneMarker);
    const paragraphOpportunity = unit.boundaryBefore === "paragraph"
      && currentLength >= preferredMin
      && !currentIsHeadingLead
      && !unit.sceneMarker;
    const exceedsPreferred = candidateLength > preferredMax
      && currentLength > 0
      && !currentIsHeadingLead
      && !unit.sceneMarker;
    const exceedsHardMax = candidateLength > hardMaxChars && currentLength > 0 && !unit.sceneMarker;

    if (unit.sceneMarker && currentLength > 0 && candidateLength > hardMaxChars) flush();
    if (paragraphOpportunity || exceedsPreferred || exceedsHardMax) flush();

    if (unit.text.length > hardMaxChars) {
      for (const piece of splitOversizedText(unit.text, hardMaxChars)) {
        if (current.length && currentLength + piece.length > hardMaxChars) flush();
        current.push({
          ...unit,
          text: piece,
          boundaryBefore: current.length ? "forced" : unit.boundaryBefore,
          boundaryAfter: "forced",
          heading: false
        });
        currentLength += piece.length;
        if (currentLength >= hardMaxChars) flush();
      }
      const last = current.at(-1) || groups.at(-1)?.at(-1);
      if (last) last.boundaryAfter = unit.boundaryAfter;
      continue;
    }

    current.push(unit);
    currentLength += unit.text.length;

    if (unit.sceneMarker && current.length > 1) flush();

  }
  flush();

  mergeShortBoundaryTails(groups, preferredMin, hardMaxChars);
  rebalanceShortTail(groups, targetChars, hardMaxChars);

  const segments = groups.map((group, index) => ({
    text: group.map((unit) => unit.text).join(""),
    previousContext: "",
    nextContext: "",
    boundaryBefore: index === 0 ? "start" : normalizeBoundary(group[0].boundaryBefore, "sentence"),
    boundaryAfter: index === groups.length - 1 ? "end" : normalizeBoundary(group.at(-1).boundaryAfter, "sentence")
  }));

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const previous = segments[index - 1];
    const next = segments[index + 1];
    if (previous && !STRONG_BOUNDARIES.has(segment.boundaryBefore)) {
      segment.previousContext = extractContext(previous.text, "tail", options.locale);
    }
    if (next && !STRONG_BOUNDARIES.has(segment.boundaryAfter)) {
      segment.nextContext = extractContext(next.text, "head", options.locale);
    }
  }

  return segments;
}

export function buildGemini31NarrationPrompt(segment, options = {}) {
  const direction = sanitizeNarratorDirection(options.narratorDirection);
  const enhanced = options.enhancedContinuity !== false;
  const internalStart = segment.boundaryBefore !== "start" && !STRONG_BOUNDARIES.has(segment.boundaryBefore);
  const internalEnd = segment.boundaryAfter !== "end" && !STRONG_BOUNDARIES.has(segment.boundaryAfter);
  const cadence = internalStart || internalEnd
    ? "Treat this as part of a continuous performance; do not add an introduction or artificial closing cadence at the chunk boundary."
    : "Use a natural opening or closing cadence only where the document boundary calls for it.";
  const context = enhanced
    ? `Previous: ${segment.previousContext || "none"}\nFollowing: ${segment.nextContext || "none"}`
    : "Previous: none\nFollowing: none";
  const customDirection = direction ? `\nAdditional narrator direction: ${direction}` : "";

  return `Synthesize speech. Speak only the text under TRANSCRIPT.

# AUDIO PROFILE
The same professional long-form audiobook narrator throughout, using the selected voice's natural character.

# SCENE
A continuous recording session in the same quiet studio with unchanged microphone position.

# DIRECTOR'S NOTES
Natural audiobook delivery with restrained expression that follows the prose.
Maintain the same voice identity, accent, pitch center, vocal effort, pacing, and loudness across chunks.
${cadence}
Pacing: ${geminiPaceDirective(options.speed)}.${customDirection}

# SILENT CONTINUITY CONTEXT
${context}
Do not speak this context.

# TRANSCRIPT
${prepareGeminiTranscript(segment.text)}`;
}

export function prepareGeminiTranscript(value) {
  return String(value || "")
    // Scene dividers and Markdown heading sigils are document structure, not
    // narration. Keeping them inside the prompt can make a nested transcript
    // look like a new prompt section to Gemini.
    .replace(/^[ \t]*(?:(?:\*[ \t]*){3,}|-{3,}|(?:[_~#][ \t]*){3,})[ \t]*(?:\n|$)/gmu, "")
    .replace(/^([ \t]*)#{1,6}[ \t]+(?=\S)/gmu, "$1")
    .replace(/[ \t]+#{1,6}[ \t]*$/gmu, "")
    .replace(/(?<!\w)(\*{1,3})(?=\S)([^*\n]*?\S)\1(?!\w)/gu, "$2")
    .trim();
}

export async function requestOpenRouterGemini31Speech(options) {
  return requestOpenRouterSpeech({
    url: options.url,
    apiKey: options.apiKey,
    title: options.title,
    signal: options.signal,
    fetchImpl: options.fetchImpl,
    sleep: options.sleep,
    retryDelays: options.retryDelays,
    maxAttempts: options.maxAttempts,
    onRetry: options.onRetry,
    body: {
      model: OPENROUTER_GEMINI_31_TTS_MODEL,
      input: options.input,
      voice: options.voice,
      response_format: "pcm"
    },
    readResponse: async (response, attempt) => {
      const contentType = String(response.headers.get("content-type") || "").toLowerCase();
      if (contentType.includes("json") || contentType.startsWith("text/")) {
        throw new Error(`OpenRouter returned ${contentType || "a non-audio response"} for Gemini PCM audio.`);
      }
      const audio = extractPcmBytes(new Uint8Array(await response.arrayBuffer()));
      if (!audio.byteLength) throw new Error("OpenRouter Gemini TTS returned empty PCM audio.");
      if (audio.byteLength % 2 !== 0) throw new Error("OpenRouter Gemini TTS returned an invalid odd-length PCM payload.");
      return {
        audio,
        generationId: response.headers.get("x-generation-id") || "",
        attempts: attempt
      };
    }
  });
}

function createSemanticUnits(text, hardMaxChars, locale) {
  const paragraphs = splitParagraphs(text);
  const units = [];

  for (let paragraphIndex = 0; paragraphIndex < paragraphs.length; paragraphIndex += 1) {
    const paragraph = paragraphs[paragraphIndex];
    const previous = paragraphs[paragraphIndex - 1];
    const before = paragraphIndex === 0 ? "start" : boundaryBetween(previous, paragraph);
    const next = paragraphs[paragraphIndex + 1];
    const after = paragraphIndex === paragraphs.length - 1 ? "end" : boundaryBetween(paragraph, next);
    const sentences = segmentSentences(paragraph.content, locale);

    sentences.forEach((sentence, sentenceIndex) => {
      const last = sentenceIndex === sentences.length - 1;
      units.push({
        text: last ? sentence + paragraph.separator : sentence,
        boundaryBefore: sentenceIndex === 0 ? before : "sentence",
        boundaryAfter: last ? after : "sentence",
        heading: paragraph.heading && sentenceIndex === 0,
        sceneMarker: paragraph.scene && sentenceIndex === 0
      });
    });
  }

  return units.flatMap((unit) => {
    if (unit.text.length <= hardMaxChars) return unit;
    const pieces = splitOversizedText(unit.text, hardMaxChars);
    return pieces.map((piece, index) => ({
      ...unit,
      text: piece,
      boundaryBefore: index === 0 ? unit.boundaryBefore : "forced",
      boundaryAfter: index === pieces.length - 1 ? unit.boundaryAfter : "forced",
      heading: index === 0 && unit.heading,
      sceneMarker: index === 0 && unit.sceneMarker
    }));
  });
}

function splitParagraphs(text) {
  const result = [];
  const pattern = /\n{2,}/g;
  let start = 0;
  let match;
  while ((match = pattern.exec(text))) {
    const content = text.slice(start, match.index);
    if (content) result.push(createParagraph(content, match[0]));
    else if (result.length) result.at(-1).separator += match[0];
    start = match.index + match[0].length;
  }
  const tail = text.slice(start);
  if (tail) result.push(createParagraph(tail, ""));
  if (!result.length && text) result.push(createParagraph(text, ""));
  return result;
}

function createParagraph(content, separator) {
  const trimmed = content.trim();
  return {
    content,
    separator,
    scene: /^(?:\*\s*){3,}$|^-{3,}$|^(?:[_~#]\s*){3,}$/u.test(trimmed),
    heading: isLikelyHeading(trimmed)
  };
}

function isLikelyHeading(text) {
  if (!text || text.length > 80 || text.includes("\n")) return false;
  if (/^(?:chapter|book|part|section|prologue|epilogue)\b/i.test(text)) return true;
  if (SENTENCE_END.test(text)) return false;
  const words = text.split(/\s+/u).filter(Boolean);
  if (!words.length || words.length > 8) return false;
  const letterWords = words.filter((word) => /\p{L}/u.test(word));
  if (!letterWords.length) return /^\d+(?:[.:-]\d+)*$/u.test(text);
  const allCaps = letterWords.every((word) => word === word.toLocaleUpperCase());
  const titleCase = letterWords.every((word) => /^\p{Lu}/u.test(word) || /^(?:a|an|and|as|at|by|for|in|of|on|or|the|to)$/i.test(word));
  return allCaps || titleCase;
}

function boundaryBetween(left, right) {
  if (!left || !right) return "paragraph";
  if (left.scene || right.scene) return "scene";
  if (right.heading) return "chapter";
  return "paragraph";
}

function segmentSentences(text, locale) {
  if (!text) return [];
  try {
    const segmenter = new Intl.Segmenter(locale || undefined, { granularity: "sentence" });
    const parts = [...segmenter.segment(text)].map(({ segment }) => segment).filter(Boolean);
    if (parts.length) return parts;
  } catch {
    // Fall through to the Unicode-aware conservative splitter.
  }

  const parts = [];
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (!SENTENCE_END.test(text[index])) continue;
    let end = index + 1;
    while (end < text.length && /["'’”)\]}\s]/u.test(text[end])) end += 1;
    parts.push(text.slice(start, end));
    start = end;
    index = end - 1;
  }
  if (start < text.length) parts.push(text.slice(start));
  return parts.length ? parts : [text];
}

function splitOversizedText(text, maxChars) {
  const pieces = [];
  let rest = text;
  while (rest.length > maxChars) {
    const minimum = Math.floor(maxChars * 0.6);
    let cut = findLastPunctuationCut(rest, minimum, maxChars);
    if (cut <= 0) cut = findLastWhitespaceCut(rest, minimum, maxChars);
    if (cut <= 0) cut = safeCodePointCut(rest, maxChars);
    pieces.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest) pieces.push(rest);
  return pieces;
}

function findLastPunctuationCut(text, minimum, maximum) {
  let cut = -1;
  for (let index = minimum; index < Math.min(text.length, maximum); index += 1) {
    if (CLAUSE_END.test(text[index])) {
      let end = index + 1;
      while (end < text.length && /\s/u.test(text[end])) end += 1;
      if (end <= maximum) cut = end;
    }
  }
  return cut;
}

function findLastWhitespaceCut(text, minimum, maximum) {
  for (let index = Math.min(text.length, maximum); index >= minimum; index -= 1) {
    if (/\s/u.test(text[index - 1])) return index;
  }
  return -1;
}

function safeCodePointCut(text, maximum) {
  let cut = Math.min(text.length, maximum);
  const code = text.charCodeAt(cut - 1);
  if (code >= 0xD800 && code <= 0xDBFF) cut -= 1;
  return Math.max(1, cut);
}

function mergeShortBoundaryTails(groups, preferredMin, hardMaxChars) {
  for (let index = 1; index < groups.length; index += 1) {
    const tail = groups[index];
    if (groupLength(tail) >= preferredMin) continue;
    if (!STRONG_BOUNDARIES.has(tail.at(-1)?.boundaryAfter)) continue;
    if (STRONG_BOUNDARIES.has(tail[0]?.boundaryBefore)) continue;

    const previous = groups[index - 1];
    if (groupLength(previous) + groupLength(tail) > hardMaxChars) continue;
    previous.push(...tail);
    groups.splice(index, 1);
    index -= 1;
  }
}

function rebalanceShortTail(groups, targetChars, hardMaxChars) {
  if (groups.length < 2) return;
  const minimumTail = Math.floor(targetChars * 0.45);
  const tail = groups.at(-1);
  const previous = groups.at(-2);
  let tailLength = groupLength(tail);
  let previousLength = groupLength(previous);

  while (tailLength < minimumTail && previous.length > 1) {
    const candidate = previous.at(-1);
    if (STRONG_BOUNDARIES.has(candidate.boundaryBefore)) break;
    if (tailLength + candidate.text.length > hardMaxChars) break;
    if (previousLength - candidate.text.length < minimumTail) break;
    previous.pop();
    tail.unshift(candidate);
    previousLength -= candidate.text.length;
    tailLength += candidate.text.length;
  }
}

function extractContext(text, direction, locale) {
  const clean = text.trim();
  if (!clean) return "";
  const sentences = segmentSentences(clean, locale).map((part) => part.trim()).filter(Boolean);
  const sentence = direction === "tail" ? sentences.at(-1) : sentences[0];
  if (sentence.length <= GEMINI_31_CONTEXT_CHARS) return sentence;
  return direction === "tail"
    ? wordBoundarySuffix(sentence, GEMINI_31_CONTEXT_CHARS)
    : wordBoundaryPrefix(sentence, GEMINI_31_CONTEXT_CHARS);
}

function wordBoundaryPrefix(text, maximum) {
  const slice = text.slice(0, maximum + 1);
  const cut = slice.lastIndexOf(" ");
  return text.slice(0, cut >= Math.floor(maximum * 0.6) ? cut : maximum).trim();
}

function wordBoundarySuffix(text, maximum) {
  const start = Math.max(0, text.length - maximum);
  const slice = text.slice(start);
  const space = slice.indexOf(" ");
  return text.slice(space >= 0 && space <= maximum * 0.4 ? start + space + 1 : start).trim();
}

function groupLength(group) {
  return group.reduce((total, unit) => total + unit.text.length, 0);
}

function normalizeBoundary(value, fallback) {
  return ["start", "sentence", "paragraph", "scene", "chapter", "forced", "end"].includes(value) ? value : fallback;
}

function clampInteger(value, minimum, maximum, fallback) {
  const number = Number(value);
  return Math.round(Math.min(maximum, Math.max(minimum, Number.isFinite(number) ? number : fallback)));
}

function extractPcmBytes(audio) {
  if (audio.byteLength < 44 || ascii(audio, 0, 4) !== "RIFF" || ascii(audio, 8, 12) !== "WAVE") return audio;
  const view = new DataView(audio.buffer, audio.byteOffset, audio.byteLength);
  let offset = 12;
  while (offset + 8 <= audio.byteLength) {
    const chunkId = ascii(audio, offset, offset + 4);
    const chunkSize = view.getUint32(offset + 4, true);
    const dataStart = offset + 8;
    const dataEnd = Math.min(dataStart + chunkSize, audio.byteLength);
    if (chunkId === "data") return audio.slice(dataStart, dataEnd);
    offset = dataStart + chunkSize + (chunkSize % 2);
  }
  return audio.slice(44);
}

function ascii(bytes, start, end) {
  return String.fromCharCode(...bytes.slice(start, end));
}

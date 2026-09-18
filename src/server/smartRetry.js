export const SMART_RETRY_ATTEMPT_LIMIT = 64;

export function isOpenRouterGemini(options) {
  return options.provider === "openrouter" && /(^|[/:-])gemini(?:[/:-]|$)/i.test(String(options.model || ""));
}

// A generic provider 400 is often the only diagnostic supplied for rejected text.
// Known operational/configuration failures must never turn into text omissions.
export function isTextRejection(error) {
  const status = Number(error?.status);
  if ([401, 402, 404, 408, 409, 429].includes(status) || status >= 500) return false;
  const kind = `${error?.errorType || ""} ${error?.providerCode || ""}`;
  const message = String(error?.message || "");
  if (/auth|permission|credential|api[_ -]?key|billing|credit|quota|resource[_ -]?exhausted|rate[_ -]?limit|overload|unavailable|timeout|invalid[_ -]?(?:request|argument|parameter|model|voice)|unsupported|configuration/i.test(kind)) return false;
  if (/(?:invalid|missing|unsupported|unknown|not found|required|not supported).{0,40}(?:api[_ -]?key|credential|model|voice|parameter|format)|(?:api[_ -]?key|credential|model|voice|parameter|format).{0,40}(?:invalid|missing|unsupported|not found|required|not supported)|insufficient (?:credit|balance)|quota|rate limit|billing/i.test(message)) return false;
  if (/unauthori[sz]ed|permission denied|authentication|network|fetch failed|timed? ?out|timeout|overload|(?:service|provider).{0,20}unavailable|no (?:available )?providers?|rate[_ -]?limit|invalid json|malformed request/i.test(message)) return false;
  if (/content[_ -]?(?:policy|filter|violation)|prohibited[_ -]?content|safety|text[_ -]?rejection/i.test(`${kind} ${message}`)) return true;
  return status === 400;
}

// Cuts only between Intl word units, retaining every original character. Quotes
// after whitespace travel with the next word; closing punctuation with the prior.
export function splitRetryText(text) {
  const words = [...new Intl.Segmenter(undefined, { granularity: "word" }).segment(text)]
    .filter((part) => part.isWordLike);
  if (words.length < 2) return null;
  const sentenceEnds = new Set([...new Intl.Segmenter(undefined, { granularity: "sentence" }).segment(text)]
    .map((part) => part.index + part.segment.length));
  const cuts = words.slice(1).map((word, index) => {
    const previousEnd = words[index].index + words[index].segment.length;
    const gap = text.slice(previousEnd, word.index);
    const spaces = [...gap.matchAll(/\s+/gu)];
    const lastSpace = spaces.at(-1);
    const cut = lastSpace ? previousEnd + lastSpace.index + lastSpace[0].length : word.index;
    const separator = text.slice(previousEnd, cut);
    return { cut, sentence: sentenceEnds.has(cut), clause: /[;:,؛،、，；：—–]/u.test(separator) };
  });
  const central = cuts.filter(({ cut }) => cut >= text.length * 0.25 && cut <= text.length * 0.75);
  const candidates = [central.filter((cut) => cut.sentence), central.filter((cut) => cut.clause), central, cuts]
    .find((items) => items.length);
  const midpoint = text.length / 2;
  const { cut } = candidates.reduce((best, item) => Math.abs(item.cut - midpoint) < Math.abs(best.cut - midpoint) ? item : best);
  return [text.slice(0, cut), text.slice(cut)];
}

function splitPiece(piece) {
  const parts = splitRetryText(piece.text);
  if (!parts) return null;
  return [
    { text: parts[0], start: piece.start, end: piece.start + parts[0].length },
    { text: parts[1], start: piece.start + parts[0].length, end: piece.end }
  ];
}

export function createSmartRetry(text) {
  const root = { text, start: 0, end: text.length };
  return { pending: splitPiece(root) || [root], audio: [], omissions: [], attempts: 0, textLength: text.length };
}

export async function runSmartRetry(checkpoint, { synthesize, signal, onProgress, index }) {
  let attempts = 0;
  const progress = () => onProgress?.({
    attempts, attemptLimit: SMART_RETRY_ATTEMPT_LIMIT,
    resolvedPieces: checkpoint.audio.length, skippedPieces: checkpoint.omissions.length
  });
  while (checkpoint.pending.length && attempts < SMART_RETRY_ATTEMPT_LIMIT) {
    signal.throwIfAborted();
    const piece = checkpoint.pending[0];
    attempts += 1;
    checkpoint.attempts += 1;
    progress();
    try {
      const result = await synthesize(piece, signal);
      signal.throwIfAborted();
      checkpoint.audio.push(Buffer.isBuffer(result) ? result : result.audio);
      checkpoint.pending.shift();
    } catch (error) {
      signal.throwIfAborted();
      if (!isTextRejection(error)) throw error;
      const children = splitPiece(piece);
      checkpoint.pending.shift();
      if (children) checkpoint.pending.unshift(...children);
      else checkpoint.omissions.push({ index, text: piece.text });
    }
    progress();
  }
  return checkpoint.pending.length === 0;
}

export const OPENROUTER_GEMINI_31_TTS_MODEL = "google/gemini-3.1-flash-tts-preview";
export const GEMINI_DEFAULT_SEGMENT_CHARS = 500;
export const GEMINI_MAX_SEGMENT_CHARS = 2_500;

const common = {
  narratorDirection: true,
  semanticSegmentation: true,
  defaultSegmentChars: GEMINI_DEFAULT_SEGMENT_CHARS,
  maxSegmentChars: GEMINI_MAX_SEGMENT_CHARS
};
const models = new Map([
  [OPENROUTER_GEMINI_31_TTS_MODEL, Object.freeze({ ...common, promptFormat: "legacy", neighboringContext: true })],
  ...["google/gemini-3.8-flash-tts", "google/gemini-3.8-flash-lite-tts"].map((id) =>
    [id, Object.freeze({ ...common, promptFormat: "instructions", neighboringContext: false })])
]);

export function getOpenRouterGeminiCapabilities(model) {
  return models.get(String(model || "").trim().toLowerCase());
}

export function isOpenRouterGemini31Model(model) {
  return String(model || "").trim().toLowerCase() === OPENROUTER_GEMINI_31_TTS_MODEL;
}

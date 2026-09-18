// Shared by the browser and Node: keep provider capabilities and defaults aligned.
export const MINIMAX_MODELS = ["speech-2.8-hd", "speech-2.8-turbo", "speech-2.6-hd", "speech-2.6-turbo", "speech-02-hd", "speech-02-turbo", "speech-01-hd", "speech-01-turbo"];
export const MINIMAX_LANGUAGES = ["auto", "Chinese", "Chinese,Yue", "English", "Arabic", "Russian", "Spanish", "French", "Portuguese", "German", "Turkish", "Dutch", "Ukrainian", "Vietnamese", "Indonesian", "Japanese", "Italian", "Korean", "Thai", "Polish", "Romanian", "Greek", "Czech", "Finnish", "Hindi", "Bulgarian", "Danish", "Hebrew", "Malay", "Persian", "Slovak", "Swedish", "Croatian", "Filipino", "Hungarian", "Norwegian", "Slovenian", "Catalan", "Nynorsk", "Tamil", "Afrikaans"];
export const MINIMAX_EMOTIONS = ["happy", "sad", "angry", "fearful", "disgusted", "surprised", "calm", "fluent", "whisper"];
export const MINIMAX_MAX_CHARS = 9999;
export const RESEMBLE_MAX_CHARS = 3000;
export const MINIMAX_MAX_AUDIO_BYTES = 20 * 1024 * 1024;
export const MINIMAX_DEFAULTS = { volume: 1, pitch: 0, emotion: "", textNormalization: false, pronunciation: "" };
export const RESEMBLE_DEFAULTS = { hd: false, customPronunciations: false, prompt: "", language: "", delivery: "normal", temperature: "", exaggeration: "", seed: "" };
export const CLONE_DEFAULTS = { noiseReduction: true, volumeNormalization: true, accuracy: 0.7 };

export function minimaxLanguageSupported(language, model) {
  return MINIMAX_LANGUAGES.includes(language) && !(/^speech-0[12]-/.test(model) && ["Persian", "Filipino", "Tamil"].includes(language));
}

export function minimaxEmotionSupported(emotion, model) {
  return emotion === "" || (MINIMAX_EMOTIONS.includes(emotion) && (!["fluent", "whisper"].includes(emotion) || /^speech-2\.6-/.test(model)));
}

export function minimaxPrice(model) {
  return /^speech-(2\.[68]|02)-(hd|turbo)$/.test(model) ? (model.endsWith("-hd") ? 100 : 60) : undefined;
}

function numberInRange(value, fallback, min, max, integer = false) {
  const number = value === "" || value === undefined || value === null ? fallback : Number(value);
  if (!Number.isFinite(number) || number < min || number > max || (integer && !Number.isInteger(number))) throw new Error(`Expected ${integer ? "an integer" : "a number"} from ${min} to ${max}.`);
  return number;
}

export function normalizeMinimaxSettings(raw = {}, model = "speech-2.8-hd") {
  const emotion = String(raw.emotion || "");
  if (!minimaxEmotionSupported(emotion, model)) throw new Error(`Emotion ${emotion} is not supported by ${model}.`);
  const pronunciation = String(raw.pronunciation || "").trim();
  if (pronunciation.length > 10000) throw new Error("Pronunciation dictionary must be 10,000 characters or fewer.");
  for (const rule of pronunciation.split(/\r?\n/).filter((line) => line.trim())) {
    const separator = rule.indexOf("/");
    if (separator < 1 || !rule.slice(separator + 1).trim()) throw new Error("Use original/replacement for each pronunciation rule.");
  }
  return { volume: numberInRange(raw.volume, 1, 0.1, 10), pitch: numberInRange(raw.pitch, 0, -12, 12, true), emotion, textNormalization: raw.textNormalization === true, pronunciation };
}

export function normalizeCloneSettings(raw = {}) {
  return { noiseReduction: raw.noiseReduction !== false, volumeNormalization: raw.volumeNormalization !== false, accuracy: numberInRange(raw.accuracy, 0.7, 0, 1) || 0.7 };
}

export function normalizeResembleSettings(raw = {}) {
  const prompt = String(raw.prompt || "").trim();
  if (prompt.length > 800) throw new Error("Resemble narrator direction must be 800 characters or fewer.");
  const language = String(raw.language || "").trim();
  if (language && !/^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/.test(language)) throw new Error("Use a language code such as en-US or de-DE.");
  const optionalNumber = (value, min, max, integer = false) => value === "" || value === undefined || value === null ? "" : String(numberInRange(value, min, min, max, integer));
  if (raw.delivery && !["normal", "slow", "fast"].includes(raw.delivery)) throw new Error("Unknown Resemble delivery style.");
  return {
    hd: raw.hd === true, customPronunciations: raw.customPronunciations === true, prompt, language,
    delivery: raw.delivery || "normal", temperature: optionalNumber(raw.temperature, 0.1, 5),
    exaggeration: optionalNumber(raw.exaggeration, 0, 1), seed: optionalNumber(raw.seed, 0, Number.MAX_SAFE_INTEGER, true)
  };
}

export function validateCloneDuration(duration, prompt = false) {
  if (!Number.isFinite(duration) || duration <= 0 || (prompt ? duration >= 8 : duration < 10 || duration > 300)) {
    throw new Error(prompt ? "Prompt audio must be shorter than 8 seconds." : "Source audio must be between 10 seconds and 5 minutes.");
  }
}

import type { ProviderConfig, ProviderId, SelectOption } from "../types/contracts";

export const OPENROUTER_GEMINI_31_TTS_MODEL = "google/gemini-3.1-flash-tts-preview";

export const GEMINI_VOICE_GENDERS: Record<string, "female" | "male"> = {
  Achernar: "female", Achird: "male", Algenib: "male", Algieba: "male", Alnilam: "male",
  Aoede: "female", Autonoe: "female", Callirrhoe: "female", Charon: "male", Despina: "female",
  Enceladus: "male", Erinome: "female", Fenrir: "male", Gacrux: "female", Iapetus: "male",
  Kore: "female", Laomedeia: "female", Leda: "female", Orus: "male", Puck: "male",
  Pulcherrima: "female", Rasalgethi: "male", Sadachbia: "male", Sadaltager: "male", Schedar: "male",
  Sulafat: "female", Umbriel: "male", Vindemiatrix: "female", Zephyr: "female", Zubenelgenubi: "male"
};

export const XAI_VOICE_GENDERS: Record<string, "female" | "male" | "neutral"> = {
  ara: "female", eve: "female", leo: "male", rex: "male", sal: "neutral"
};

export const GEMINI_VOICES: SelectOption[] = [
  ["Kore", "Firm"], ["Puck", "Upbeat"], ["Aoede", "Breezy"], ["Charon", "Informative"],
  ["Zephyr", "Bright"], ["Fenrir", "Excitable"], ["Leda", "Youthful"], ["Orus", "Firm"],
  ["Callirrhoe", "Easy-going"], ["Autonoe", "Bright"], ["Enceladus", "Breathy"],
  ["Iapetus", "Clear"], ["Umbriel", "Easy-going"], ["Algieba", "Smooth"], ["Despina", "Smooth"],
  ["Erinome", "Clear"], ["Algenib", "Gravelly"], ["Rasalgethi", "Informative"],
  ["Laomedeia", "Upbeat"], ["Achernar", "Soft"], ["Alnilam", "Firm"], ["Schedar", "Even"],
  ["Gacrux", "Mature"], ["Pulcherrima", "Forward"], ["Achird", "Friendly"],
  ["Zubenelgenubi", "Casual"], ["Vindemiatrix", "Gentle"], ["Sadachbia", "Lively"],
  ["Sadaltager", "Knowledgeable"], ["Sulafat", "Warm"]
].map(([value, quality]) => ({ value, label: `${value} — ${quality}`, gender: GEMINI_VOICE_GENDERS[value] }));

const optionList = (entries: Array<[string, string]>): SelectOption[] => entries.map(([value, label]) => ({ value, label }));
const autoOnly = optionList([["auto", "Auto"]]);

const xaiLanguages = optionList([
  ["auto", "Auto"], ["en", "English"], ["de", "German"], ["fr", "French"], ["it", "Italian"],
  ["es-ES", "Spanish (Spain)"], ["es-MX", "Spanish (Mexico)"], ["pt-BR", "Portuguese (Brazil)"],
  ["pt-PT", "Portuguese (Portugal)"], ["zh", "Chinese"], ["ja", "Japanese"], ["ko", "Korean"],
  ["hi", "Hindi"], ["id", "Indonesian"], ["tr", "Turkish"], ["vi", "Vietnamese"], ["ru", "Russian"],
  ["bn", "Bengali"], ["ar-EG", "Arabic (Egypt)"], ["ar-SA", "Arabic (Saudi Arabia)"], ["ar-AE", "Arabic (UAE)"]
]);

export const MINIMAX_LANGUAGES = optionList([
  ["auto", "Auto"], ["English", "English"], ["Chinese", "Chinese"], ["Chinese,Yue", "Chinese (Cantonese)"],
  ["Spanish", "Spanish"], ["French", "French"], ["Portuguese", "Portuguese"], ["German", "German"],
  ["Arabic", "Arabic"], ["Russian", "Russian"], ["Japanese", "Japanese"], ["Italian", "Italian"],
  ["Korean", "Korean"], ["Hindi", "Hindi"], ["Turkish", "Turkish"], ["Dutch", "Dutch"],
  ["Ukrainian", "Ukrainian"], ["Vietnamese", "Vietnamese"], ["Indonesian", "Indonesian"], ["Thai", "Thai"],
  ["Polish", "Polish"], ["Romanian", "Romanian"], ["Greek", "Greek"], ["Czech", "Czech"], ["Finnish", "Finnish"]
]);

const providers: ProviderConfig[] = [
  {
    id: "openrouter", label: "OpenRouter: Various Models", storageKey: "openrouterApiKey",
    credentialLabel: "OpenRouter API key", credentialPlaceholder: "sk-or-...", authMode: "api-key",
    defaultVoice: "alloy", defaultLanguage: "auto", defaultSegmentChars: 2500, maxSegmentChars: 12000, supportsSpeed: true, supportsBalance: true,
    voices: [{ value: "", label: "Select a model to load voices" }], languages: autoOnly
  },
  {
    id: "minimax", label: "MiniMax: Custom Voices", storageKey: "minimaxApiKey",
    credentialLabel: "MiniMax API key", credentialPlaceholder: "MiniMax API key", authMode: "api-key",
    defaultVoice: "", defaultLanguage: "auto", defaultSegmentChars: 2500, maxSegmentChars: 10000, supportsSpeed: true,
    costPerMillionChars: 30, voices: [{ value: "", label: "Create or refresh MiniMax custom voices" }], languages: MINIMAX_LANGUAGES.slice(0, 14)
  },
  {
    id: "xai", label: "xAI: Grok TTS 1.0", storageKey: "xaiApiKey", credentialLabel: "xAI API key",
    credentialPlaceholder: "xai-...", authMode: "api-key", defaultVoice: "eve", defaultLanguage: "auto",
    defaultSegmentChars: 2500, maxSegmentChars: 12000, costPerMillionChars: 15, supportsSpeed: true,
    supportsLowLatency: true, supportsTextNormalization: true,
    voices: optionList([["eve", "Eve"], ["ara", "Ara"], ["leo", "Leo"], ["rex", "Rex"], ["sal", "Sal"]])
      .map((voice) => ({ ...voice, gender: XAI_VOICE_GENDERS[voice.value] })),
    languages: xaiLanguages
  },
  {
    id: "gemini", label: "Gemini Developer API — API key", storageKey: "geminiApiKey",
    accessDescription: "Gemini 3.1 Flash TTS (Preview) through the Developer API, using an AI Studio API key.",
    credentialLabel: "Gemini API key", credentialPlaceholder: "AI Studio API key", authMode: "api-key",
    defaultVoice: "Enceladus", defaultLanguage: "auto", defaultSegmentChars: 500, maxSegmentChars: 12000, supportsSpeed: true,
    voices: GEMINI_VOICES, languages: autoOnly
  },
  {
    id: "google", label: "Google Cloud TTS — OAuth", storageKey: "googleTtsCredential",
    accessDescription: "Gemini 3.1 Flash TTS (Preview) through Google Cloud Text-to-Speech, using Google OAuth.",
    credentialLabel: "", credentialPlaceholder: "", authMode: "google-oauth", defaultVoice: "Enceladus",
    defaultLanguage: "en-US", defaultSegmentChars: 500, maxSegmentChars: 4500, supportsSpeed: true, voices: GEMINI_VOICES,
    languages: optionList([["en-US", "English (US)"], ["en-GB", "English (UK)"], ["de-DE", "German (Germany)"],
      ["fr-FR", "French (France)"], ["it-IT", "Italian (Italy)"], ["es-ES", "Spanish (Spain)"],
      ["pt-BR", "Portuguese (Brazil)"], ["ja-JP", "Japanese"], ["ko-KR", "Korean"]])
  },
  {
    id: "resemble", label: "Resemble.ai: Custom Voices", storageKey: "resembleApiKey",
    credentialLabel: "Resemble.ai API key", credentialPlaceholder: "Bearer token", authMode: "api-key",
    defaultVoice: "", defaultLanguage: "auto", defaultSegmentChars: 2500, maxSegmentChars: 12000, supportsSpeed: false,
    voices: [{ value: "", label: "Enter a Resemble.ai API key to load custom voices" }], languages: autoOnly
  }
];

export const PROVIDER_ORDER = providers.map(({ id }) => id);
export const PROVIDERS = Object.fromEntries(providers.map((provider) => [provider.id, provider])) as Record<ProviderId, ProviderConfig>;
export const SEGMENT_OPTIONS = optionList([["500", "Very short"], ["1200", "Short"], ["2500", "Balanced"], ["4500", "Long"], ["8000", "Very long"], ["12000", "Maximum"]]);
export const MINIMAX_MODELS = ["speech-2.8-hd", "speech-2.8-turbo", "speech-2.6-hd", "speech-2.6-turbo", "speech-02-hd", "speech-02-turbo", "speech-01-hd", "speech-01-turbo"];

export const isProviderId = (value: string | null): value is ProviderId => Boolean(value && value in PROVIDERS);
export const isOpenRouterPcmModel = (modelId: string) => /(^|[/:-])(?:google|gemini)(?:[/:-]|$)/i.test(modelId);
export const isOpenRouterGemini31Model = (modelId: string) => modelId.trim().toLowerCase() === OPENROUTER_GEMINI_31_TTS_MODEL;

export function sortVoiceOptions(options: SelectOption[]) {
  return [...options].sort((left, right) => left.label.localeCompare(right.label, undefined, { sensitivity: "base", numeric: true }));
}

export function voiceGenderLabel(gender?: string) {
  const normalized = gender?.trim().toLowerCase();
  if (normalized === "female" || normalized === "woman") return "Female";
  if (normalized === "male" || normalized === "man") return "Male";
  if (normalized === "unisex" || normalized === "neutral" || normalized === "gender-neutral") return "Neutral";
  if (normalized === "nonbinary" || normalized === "non-binary") return "Non-binary";
  return "";
}

export function knownModelVoiceGender(modelId: string, voice: string) {
  const model = modelId.toLowerCase();
  if (/(^|[/:-])(?:google|gemini)(?:[/:-]|$)/i.test(model)) return GEMINI_VOICE_GENDERS[voice];
  if (model.includes("x-ai") || model.includes("grok")) return XAI_VOICE_GENDERS[voice.toLowerCase()];
  return undefined;
}

export function activeSegmentLimits(provider: ProviderId, model: string) {
  const config = PROVIDERS[provider];
  return provider === "openrouter" && isOpenRouterGemini31Model(model)
    ? { defaultSegmentChars: 1200, maxSegmentChars: 2500 }
    : { defaultSegmentChars: config.defaultSegmentChars, maxSegmentChars: config.maxSegmentChars };
}

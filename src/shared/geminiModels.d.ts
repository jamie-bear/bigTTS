export const OPENROUTER_GEMINI_31_TTS_MODEL: string;
export const GEMINI_DEFAULT_SEGMENT_CHARS: number;
export const GEMINI_MAX_SEGMENT_CHARS: number;
export interface GeminiCapabilities {
  readonly promptFormat: "legacy" | "instructions";
  readonly narratorDirection: boolean;
  readonly neighboringContext: boolean;
  readonly semanticSegmentation: boolean;
  readonly defaultSegmentChars: number;
  readonly maxSegmentChars: number;
}
export function getOpenRouterGeminiCapabilities(model: string): GeminiCapabilities | undefined;
export function isOpenRouterGemini31Model(model: string): boolean;

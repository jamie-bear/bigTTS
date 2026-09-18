export interface MinimaxSettings { volume: number; pitch: number; emotion: string; textNormalization: boolean; pronunciation: string }
export interface ResembleSettings { hd: boolean; customPronunciations: boolean; prompt: string; language: string; delivery: string; temperature: string; exaggeration: string; seed: string }
export interface CloneSettings { noiseReduction: boolean; volumeNormalization: boolean; accuracy: number }
export const MINIMAX_MODELS: string[];
export const MINIMAX_LANGUAGES: string[];
export const MINIMAX_EMOTIONS: string[];
export const MINIMAX_MAX_CHARS: number;
export const RESEMBLE_MAX_CHARS: number;
export const MINIMAX_MAX_AUDIO_BYTES: number;
export const MINIMAX_DEFAULTS: MinimaxSettings;
export const RESEMBLE_DEFAULTS: ResembleSettings;
export const CLONE_DEFAULTS: CloneSettings;
export function minimaxLanguageSupported(language: string, model: string): boolean;
export function minimaxEmotionSupported(emotion: string, model: string): boolean;
export function minimaxPrice(model: string): number | undefined;
export function normalizeMinimaxSettings(raw?: Partial<MinimaxSettings>, model?: string): MinimaxSettings;
export function normalizeResembleSettings(raw?: Partial<ResembleSettings>): ResembleSettings;
export function normalizeCloneSettings(raw?: Partial<CloneSettings>): CloneSettings;
export function validateCloneDuration(duration: number, prompt?: boolean): void;

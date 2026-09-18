import { MINIMAX_MAX_AUDIO_BYTES, validateCloneDuration } from "../../shared/speechSettings.js";

export async function validateCloneFile(file: File, prompt = false): Promise<void> {
  if (!/\.(mp3|m4a|wav)$/i.test(file.name)) throw new Error("Choose an MP3, M4A or WAV recording.");
  if (!file.size || file.size > MINIMAX_MAX_AUDIO_BYTES) throw new Error("Recordings must be nonempty and 20 MB or smaller.");
  const duration = await new Promise<number>((resolve, reject) => {
    const audio = document.createElement("audio");
    const url = URL.createObjectURL(file);
    const cleanup = () => { clearTimeout(timer); audio.removeAttribute("src"); audio.load(); URL.revokeObjectURL(url); };
    const finish = (error?: Error) => {
      const duration = audio.duration;
      audio.onloadedmetadata = null; audio.onerror = null;
      cleanup();
      if (error) reject(error); else resolve(duration);
    };
    const timer = window.setTimeout(() => finish(new Error("Could not read recording duration. Try a WAV recording.")), 10000);
    audio.onloadedmetadata = () => finish();
    audio.onerror = () => finish(new Error("Could not read recording duration. Try a WAV recording."));
    audio.preload = "metadata";
    audio.src = url;
  });
  validateCloneDuration(duration, prompt);
}

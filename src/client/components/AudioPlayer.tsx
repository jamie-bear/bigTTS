import type { RefObject } from "react";
import { formatTime, useAudioPlayback } from "../hooks/useAudioPlayback";
import { IconButton, type CssVars } from "./ui/Controls";
import { Icon } from "./ui/Icon";

const RATES = [0.75, 1, 1.25, 1.5, 2];

export function AudioPlayer({ audioRef, available, bufferSeconds }: { audioRef: RefObject<HTMLAudioElement | null>; available: boolean; bufferSeconds: number }) {
  const playback = useAudioPlayback(audioRef);
  const { currentTime, duration, bufferedEnd, seekable } = playback;
  const span = seekable ? duration : 0;
  const played = span ? Math.min(100, (currentTime / span) * 100) : 0;
  const buffered = span ? Math.min(100, (bufferedEnd / span) * 100) : 0;
  const silent = playback.muted || playback.volume === 0;
  const scrubberFill: CssVars = { "--played": `${played}%`, "--buffered": `${buffered}%` };
  const volumeFill: CssVars = { "--range-percent": `${(silent ? 0 : playback.volume) * 100}%` };
  return <div className="audio-player">
    <audio ref={audioRef} className="sr-only" aria-label="Generated narration playback" />
    <div className="player-main">
      <button type="button" className="player-play" aria-label={playback.playing ? "Pause playback" : "Play narration"} disabled={!available} onClick={playback.toggle}>
        <Icon name={playback.playing ? "pause" : "play"} />
      </button>
      <div className="player-track">
        <div className="player-scrubber" style={scrubberFill}>
          <input type="range" aria-label="Seek narration" min={0} max={span || 1} step={0.01} value={seekable ? Math.min(currentTime, span) : 0} disabled={!available || !seekable} onChange={(event) => playback.seek(Number(event.target.value))} />
        </div>
        <div className="player-times"><span>{formatTime(currentTime)}</span><span>{formatTime(duration)}</span></div>
      </div>
    </div>
    <div className="player-secondary">
      <div className="player-volume">
        <IconButton label={silent ? "Unmute" : "Mute"} icon={silent ? "volume-off" : "volume"} disabled={!available} onClick={playback.toggleMute} />
        <input type="range" aria-label="Volume" min={0} max={1} step={0.01} value={silent ? 0 : playback.volume} disabled={!available} onChange={(event) => playback.setVolume(Number(event.target.value))} style={volumeFill} />
      </div>
      <label className="player-rate">
        <span className="sr-only">Playback speed</span>
        <select value={playback.rate} disabled={!available} onChange={(event) => playback.setRate(Number(event.target.value))}>
          {RATES.map((rate) => <option key={rate} value={rate}>{rate}×</option>)}
        </select>
      </label>
    </div>
    <p className="player-caption">Playback buffer — {Math.round(bufferSeconds)}s</p>
  </div>;
}

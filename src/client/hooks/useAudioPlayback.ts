import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

export interface AudioPlaybackState {
  playing: boolean;
  currentTime: number;
  duration: number;
  bufferedEnd: number;
  bufferedAhead: number;
  seekable: boolean;
  volume: number;
  muted: boolean;
  rate: number;
}

const IDLE: AudioPlaybackState = { playing: false, currentTime: 0, duration: Number.NaN, bufferedEnd: 0, bufferedAhead: 0, seekable: false, volume: 1, muted: false, rate: 1 };

// AudioEngine swaps `src` and restores `currentTime` at every segment boundary, so nothing
// here may be cached across renders — each of these events re-reads the element.
const MEDIA_EVENTS = ["play", "playing", "pause", "ended", "timeupdate", "progress", "durationchange", "loadedmetadata", "emptied", "ratechange", "volumechange", "seeking", "seeked"];

export function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "--:--";
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(rest)}` : `${minutes}:${pad(rest)}`;
}

function bufferedEndOf(audio: HTMLAudioElement) {
  try {
    const ranges = audio.buffered;
    return ranges && ranges.length ? ranges.end(ranges.length - 1) : 0;
  } catch {
    return 0;
  }
}

function bufferedAheadOf(audio: HTMLAudioElement) {
  const currentTime = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
  try {
    for (let index = 0; index < audio.buffered.length; index += 1) {
      const start = audio.buffered.start(index);
      const end = audio.buffered.end(index);
      if (currentTime >= start && currentTime <= end) return Math.max(0, end - currentTime);
    }
  } catch {
    // Media ranges can change while they are being read.
  }
  return 0;
}

function readAudio(audio: HTMLAudioElement): AudioPlaybackState {
  const duration = audio.duration;
  return {
    playing: !audio.paused && !audio.ended,
    currentTime: Number.isFinite(audio.currentTime) ? audio.currentTime : 0,
    duration,
    bufferedEnd: bufferedEndOf(audio),
    bufferedAhead: bufferedAheadOf(audio),
    seekable: Number.isFinite(duration) && duration > 0,
    volume: audio.volume,
    muted: audio.muted,
    rate: audio.playbackRate
  };
}

function isSame(a: AudioPlaybackState, b: AudioPlaybackState) {
  return a.playing === b.playing
    && a.currentTime === b.currentTime
    && Object.is(a.duration, b.duration)
    && a.bufferedEnd === b.bufferedEnd
    && a.bufferedAhead === b.bufferedAhead
    && a.seekable === b.seekable
    && a.volume === b.volume
    && a.muted === b.muted
    && a.rate === b.rate;
}

export function useAudioPlayback(audioRef: RefObject<HTMLAudioElement | null>) {
  const [playback, setPlayback] = useState<AudioPlaybackState>(IDLE);
  const syncRef = useRef<() => void>(() => {});
  const selectedRateRef = useRef(IDLE.rate);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    let frame = 0;
    let disposed = false;

    const sync = () => setPlayback((previous) => {
      // Source replacement can make the media element briefly publish its restored rate.
      // Keep the user's choice as the source of truth instead of adopting that transient
      // value through a ratechange/emptied/loadedmetadata event.
      const selectedRate = selectedRateRef.current;
      if (audio.defaultPlaybackRate !== selectedRate) audio.defaultPlaybackRate = selectedRate;
      if (audio.playbackRate !== selectedRate) audio.playbackRate = selectedRate;
      const next = readAudio(audio);
      return isSame(previous, next) ? previous : next;
    });
    syncRef.current = sync;

    const stopLoop = () => {
      if (frame && typeof cancelAnimationFrame === "function") cancelAnimationFrame(frame);
      frame = 0;
    };
    // A frame loop only while playing keeps the scrubber smooth without idling work.
    const startLoop = () => {
      if (disposed || frame || typeof requestAnimationFrame !== "function") return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (disposed) return;
        sync();
        if (!audio.paused && !audio.ended) startLoop();
      });
    };

    const handleEvent = (event: Event) => {
      sync();
      if (event.type === "play" || event.type === "playing") startLoop();
      else if (event.type === "pause" || event.type === "ended") stopLoop();
    };

    MEDIA_EVENTS.forEach((name) => audio.addEventListener(name, handleEvent));
    sync();
    if (!audio.paused && !audio.ended) startLoop();

    return () => {
      disposed = true;
      stopLoop();
      MEDIA_EVENTS.forEach((name) => audio.removeEventListener(name, handleEvent));
      syncRef.current = () => {};
    };
  }, [audioRef]);

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused || audio.ended) {
      const started = audio.play();
      if (started && typeof started.catch === "function") started.catch(() => {});
    } else {
      audio.pause();
    }
    syncRef.current();
  }, [audioRef]);

  const seek = useCallback((time: number) => {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(time)) return;
    const duration = audio.duration;
    if (!Number.isFinite(duration) || duration <= 0) return;
    audio.currentTime = Math.min(duration, Math.max(0, time));
    syncRef.current();
  }, [audioRef]);

  const setVolume = useCallback((value: number) => {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(value)) return;
    audio.volume = Math.min(1, Math.max(0, value));
    if (audio.volume > 0) audio.muted = false;
    syncRef.current();
  }, [audioRef]);

  const toggleMute = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.muted = !audio.muted;
    syncRef.current();
  }, [audioRef]);

  const setRate = useCallback((value: number) => {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(value) || value <= 0) return;
    selectedRateRef.current = value;
    // AudioEngine reloads the element at every segment boundary; the load algorithm resets
    // playbackRate to defaultPlaybackRate, so both must be set or the choice keeps reverting.
    audio.defaultPlaybackRate = value;
    audio.playbackRate = value;
    syncRef.current();
  }, [audioRef]);

  return { ...playback, toggle, seek, setVolume, toggleMute, setRate };
}

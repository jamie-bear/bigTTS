import { fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { formatTime, useAudioPlayback } from "../../src/client/hooks/useAudioPlayback";

function Probe() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const playback = useAudioPlayback(audioRef);
  return <div>
    <audio ref={audioRef} data-testid="audio" />
    <span data-testid="seekable">{String(playback.seekable)}</span>
    <span data-testid="elapsed">{formatTime(playback.currentTime)}</span>
    <span data-testid="total">{formatTime(playback.duration)}</span>
    <span data-testid="rate">{playback.rate}</span>
    <button type="button" onClick={() => playback.setRate(1.5)}>set rate</button>
  </div>;
}

const setMediaProperty = (element: HTMLElement, name: string, value: number) => {
  Object.defineProperty(element, name, { configurable: true, value });
};

describe("formatTime", () => {
  it("renders minutes and seconds, and hours only when needed", () => {
    expect(formatTime(0)).toBe("0:00");
    expect(formatTime(9)).toBe("0:09");
    expect(formatTime(65)).toBe("1:05");
    expect(formatTime(599)).toBe("9:59");
    expect(formatTime(3725)).toBe("1:02:05");
  });

  it("renders a placeholder for values a media element cannot report", () => {
    expect(formatTime(Number.NaN)).toBe("--:--");
    expect(formatTime(Number.POSITIVE_INFINITY)).toBe("--:--");
    expect(formatTime(-1)).toBe("--:--");
  });
});

describe("useAudioPlayback", () => {
  it("treats a non-finite duration as unseekable", () => {
    render(<Probe />);
    const audio = screen.getByTestId("audio");

    // jsdom starts with duration NaN, which is what MediaSource streaming also reports.
    expect(screen.getByTestId("seekable")).toHaveTextContent("false");
    expect(screen.getByTestId("total")).toHaveTextContent("--:--");

    setMediaProperty(audio, "duration", Number.POSITIVE_INFINITY);
    fireEvent(audio, new Event("durationchange"));
    expect(screen.getByTestId("seekable")).toHaveTextContent("false");
    expect(screen.getByTestId("total")).toHaveTextContent("--:--");
  });

  it("re-reads the element after a duration or time change instead of caching", () => {
    render(<Probe />);
    const audio = screen.getByTestId("audio");

    setMediaProperty(audio, "duration", 125);
    fireEvent(audio, new Event("durationchange"));
    expect(screen.getByTestId("seekable")).toHaveTextContent("true");
    expect(screen.getByTestId("total")).toHaveTextContent("2:05");

    setMediaProperty(audio, "currentTime", 42);
    fireEvent(audio, new Event("timeupdate"));
    expect(screen.getByTestId("elapsed")).toHaveTextContent("0:42");

    // A segment boundary swaps src and resets the element; the hook must follow it down.
    setMediaProperty(audio, "duration", Number.NaN);
    setMediaProperty(audio, "currentTime", 0);
    fireEvent(audio, new Event("emptied"));
    expect(screen.getByTestId("seekable")).toHaveTextContent("false");
    expect(screen.getByTestId("elapsed")).toHaveTextContent("0:00");
  });

  it("sets defaultPlaybackRate alongside playbackRate so a segment reload can't revert the chosen speed", () => {
    render(<Probe />);
    const audio = screen.getByTestId("audio") as HTMLAudioElement;

    fireEvent.click(screen.getByRole("button", { name: "set rate" }));
    expect(screen.getByTestId("rate")).toHaveTextContent("1.5");
    expect(audio.playbackRate).toBe(1.5);
    // The HTML load algorithm resets playbackRate to defaultPlaybackRate on every reload
    // AudioEngine performs at a segment boundary; without this, the choice reverts to 1x.
    expect(audio.defaultPlaybackRate).toBe(1.5);
  });
});

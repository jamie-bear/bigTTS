import { useRef } from "react";
import { NarrationOutput, SettingsPanel } from "./components/NarrationPanel";
import { TextWorkspace } from "./components/TextWorkspace";
import { ThemeToggle } from "./components/ThemeToggle";
import { useBigTtsController } from "./hooks/useBigTtsController";
import { useTheme } from "./hooks/useTheme";

const logoUrl = new URL("../logo.png", import.meta.url).href;

export default function App() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const controller = useBigTtsController(audioRef);
  const { theme, cycleTheme } = useTheme();
  return <div className="app-frame">
    <header className="app-header">
      <div className="app-header-inner">
        <a className="wordmark" href="#main-workspace" aria-label="bigTTS home"><img className="wordmark-mark" src={logoUrl} alt="" /><span>bigTTS</span></a>
        <p className="app-tagline">Long-form text to speech</p>
        <ThemeToggle theme={theme} onCycle={cycleTheme} />
      </div>
    </header>
    <main id="main-workspace" className="app-shell">
      <SettingsPanel controller={controller} />
      <TextWorkspace controller={controller} />
      <NarrationOutput controller={controller} audioRef={audioRef} />
    </main>
  </div>;
}

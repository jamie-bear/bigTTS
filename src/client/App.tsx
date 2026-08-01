import { useRef } from "react";
import { NarrationOutput, SettingsPanel } from "./components/NarrationPanel";
import { TextWorkspace } from "./components/TextWorkspace";
import { useBigTtsController } from "./hooks/useBigTtsController";

const logoUrl = new URL("../logo.png", import.meta.url).href;

export default function App() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const controller = useBigTtsController(audioRef);
  return <div className="app-frame">
    <header className="app-header">
      <a className="wordmark" href="#main-workspace" aria-label="bigTTS home"><img className="wordmark-mark" src={logoUrl} alt="" /><span>bigTTS</span></a>
      <p>Long-form text to speech</p>
    </header>
    <main id="main-workspace" className="app-shell">
      <SettingsPanel controller={controller} />
      <TextWorkspace controller={controller} />
      <NarrationOutput controller={controller} audioRef={audioRef} />
    </main>
  </div>;
}

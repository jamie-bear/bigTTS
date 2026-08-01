import { useMemo, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import type { useBigTtsController } from "../hooks/useBigTtsController";
import { Button } from "./ui/Controls";
import { Icon } from "./ui/Icon";

type Controller = ReturnType<typeof useBigTtsController>;

const isTextFile = (file: File) => file.type.startsWith("text/") || file.name.toLowerCase().endsWith(".txt");

export function TextWorkspace({ controller }: { controller: Controller }) {
  const { state, stats, actions } = controller;
  const [dropping, setDropping] = useState(false);
  const dragDepth = useRef(0);
  const words = useMemo(() => {
    const trimmed = state.text.trim();
    return trimmed ? trimmed.split(/\s+/).length : 0;
  }, [state.text]);

  const loadFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) void actions.loadTextFile(file);
    event.target.value = "";
  };

  const endDrag = () => {
    dragDepth.current = 0;
    setDropping(false);
  };

  const onDragEnter = (event: DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer?.types.includes("Files")) return;
    dragDepth.current += 1;
    setDropping(true);
  };

  const onDragLeave = () => {
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (!dragDepth.current) setDropping(false);
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!dropping) return;
    event.preventDefault();
    endDrag();
    const file = event.dataTransfer?.files?.[0];
    if (file && isTextFile(file)) void actions.loadTextFile(file);
  };

  return <section className="card editor-card" aria-labelledby="source-heading">
    <div className="section-heading">
      <div><p className="eyebrow">Source</p><h1 id="source-heading">Text workspace</h1><p>Paste a chapter, article, or any long-form text.</p></div>
      <div className="text-metrics" aria-label="Text statistics">
        <span className="metric"><strong>{stats.chars.toLocaleString()}</strong><span>characters</span></span>
        <span className="metric-divider" aria-hidden="true" />
        <span className="metric"><strong>{words.toLocaleString()}</strong><span>words</span></span>
        <span className="metric-divider" aria-hidden="true" />
        <span className="metric-cost">{stats.cost}</span>
      </div>
    </div>
    <div className="text-toolbar">
      <label className="button file-button" htmlFor="fileInput"><Icon name="file" />Load .txt</label><input id="fileInput" type="file" accept=".txt,text/plain" onChange={loadFile} />
      <Button type="button" onClick={actions.loadSample}><Icon name="spark" />Use sample</Button>
      <Button type="button" className="button-quiet" onClick={actions.clearText}><Icon name="trash" />Clear</Button>
    </div>
    <div
      className={`editor-shell ${dropping ? "is-dropping" : ""}`.trim()}
      onDragEnter={onDragEnter}
      onDragOver={(event) => { if (dropping) event.preventDefault(); }}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <label className="sr-only" htmlFor="bookText">Book or chapter text</label>
      <textarea id="bookText" spellCheck value={state.text} onChange={(event) => actions.setText(event.target.value)} placeholder="Paste or type the text you want to narrate…" />
      {dropping && <div className="editor-dropzone" aria-hidden="true"><Icon name="file" /><span>Drop a .txt file to load it</span></div>}
    </div>
  </section>;
}

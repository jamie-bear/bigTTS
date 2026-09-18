import { useEffect, useId, useState, type ReactNode, type RefObject } from "react";
import { isOpenRouterGemini31Model, isOpenRouterGeminiModel, isOpenRouterPcmModel, MINIMAX_LANGUAGES, SEGMENT_OPTIONS } from "../config/providers";
import type { useBigTtsController } from "../hooks/useBigTtsController";
import { AudioPlayer } from "./AudioPlayer";
import { ProviderSetup } from "./ProviderSetup";
import { Button, Disclosure, SelectField, Slider, Switch } from "./ui/Controls";
import { Icon } from "./ui/Icon";
import type { SegmentFailure } from "../types/contracts";
import { minimaxLanguageSupported } from "../../shared/speechSettings.js";
import { ProviderSynthesisSettings } from "./ProviderSynthesisSettings";

type Controller = ReturnType<typeof useBigTtsController>;

export function SettingsPanel({ controller }: { controller: Controller }) {
  const { state, providerConfig, voiceOptions, hasVoiceGenderMetadata, limits, actions } = controller;
  const lowLatencyAvailable = Boolean(providerConfig.supportsLowLatency);
  const textNormalizationAvailable = Boolean(providerConfig.supportsTextNormalization);
  const unavailableCapabilityCount = Number(!lowLatencyAvailable) + Number(!textNormalizationAvailable);
  const gemini31OpenRouter = state.provider === "openrouter" && isOpenRouterGemini31Model(state.openrouterModel);
  const geminiOpenRouter = state.provider === "openrouter" && isOpenRouterGeminiModel(state.openrouterModel);
  const sessionActive = ["connecting", "generating", "pausing", "paused", "recoverable"].includes(state.phase);
  const geminiContextMeta = state.geminiPreviousContext && state.geminiFollowingContext
    ? "Both"
    : state.geminiPreviousContext
      ? "Previous"
      : state.geminiFollowingContext
        ? "Following"
        : "Off";
  return <aside className="settings-panel" aria-label="Narration setup">
    <section className="card setup-card" aria-labelledby="provider-heading">
      <div className="compact-heading"><div className="heading-icon"><Icon name="key" /></div><div><p className="eyebrow">Connection</p><h2 id="provider-heading">Provider & access</h2></div></div>
      <ProviderSetup controller={controller} />
    </section>

    <section className="card setup-card" aria-labelledby="settings-heading">
      <div className="compact-heading"><div className="heading-icon"><Icon name="settings" /></div><div><p className="eyebrow">Configuration</p><h2 id="settings-heading">Voice & synthesis</h2></div></div>
      <form className="settings" aria-label="Narration settings" onSubmit={(event) => event.preventDefault()}>
        <SelectField id="voice" label="Voice" options={voiceOptions} value={state.voice} onChange={(event) => actions.setVoice(event.target.value)} helper={hasVoiceGenderMetadata ? "Gender is shown as text only where provider metadata is available." : undefined} />
        {state.discoveryWarning && <p role="status" className="field-help">{state.discoveryWarning}</p>}
        {state.provider === "resemble" && state.resembleVoices.some((voice) => voice.unavailableReason?.includes("Ultra")) && <p className="field-help">Some voices require an upgrade to Resemble Ultra. <a href="https://app.resemble.ai/hub/voices" target="_blank" rel="noreferrer">Open Resemble Voices</a> to upgrade them.</p>}
        {(state.provider === "resemble" || state.provider === "minimax") && <div className="field">
          <label className="field-label" htmlFor="voiceIdOverride">Voice ID <em>Optional</em></label>
          <input id="voiceIdOverride" type="text" autoComplete="off" autoCapitalize="none" spellCheck={false}
            placeholder={state.provider === "resemble" ? "e.g. 819fcc57" : "Enter a MiniMax voice ID"}
            value={state.voiceIdOverrides[state.provider]} onChange={(event) => actions.setVoiceIdOverride(event.target.value)}
            aria-describedby="voiceIdOverrideHelp" />
          <small id="voiceIdOverrideHelp" className="field-help">Overrides the selected voice. Clear this field to use the dropdown.</small>
        </div>}
        {state.provider === "minimax" && <MiniMaxVoiceManager controller={controller} />}
        <div className="field-grid">{state.provider !== "resemble" && <SelectField id="language" label="Language" options={providerConfig.languages.map((option) => ({ ...option, disabled: state.provider === "minimax" && !minimaxLanguageSupported(option.value, state.minimaxModel) }))} value={state.language} onChange={(event) => actions.setLanguage(event.target.value)} />}<SelectField id="segmentChars" label={gemini31OpenRouter ? "Segment target" : "Segment size"} options={SEGMENT_OPTIONS.map((option) => ({ ...option, disabled: Number(option.value) > limits.maxSegmentChars }))} value={state.segmentChars} onChange={(event) => actions.setSegmentChars(Number(event.target.value))} helper={gemini31OpenRouter || state.provider === "resemble" ? `${state.segmentChars.toLocaleString()}-character target${state.provider === "resemble" ? "; requests capped at 3,000 including delivery settings" : ""}` : `${state.segmentChars.toLocaleString()} characters per request`} /></div>
        {state.provider !== "resemble" && <Slider
          id="speed"
          label="Reading speed"
          className={providerConfig.supportsSpeed ? "" : "is-unavailable"}
          min={state.provider === "minimax" ? 0.5 : 0.7}
          max={state.provider === "minimax" ? 2 : 1.5}
          step={0.05}
          value={state.speed}
          disabled={!providerConfig.supportsSpeed}
          valueText={`${state.speed.toFixed(2)}×`}
          badge={providerConfig.supportsSpeed ? undefined : "Unavailable"}
          onChange={(event) => actions.setSpeed(Number(event.target.value))}
          helper={<>
            {gemini31OpenRouter && <small>Gemini follows this as a narration direction; audio is not mechanically time-stretched.</small>}
            {!providerConfig.supportsSpeed && <small>This provider does not accept a reading-speed setting.</small>}
          </>}
        />}
        <ProviderSynthesisSettings controller={controller} />
        {geminiOpenRouter && <div className="field">
          <Switch id="autoSmartRetry" label="Auto smart retry" checked={state.autoSmartRetry} disabled={sessionActive} onChange={(event) => actions.setAutoSmartRetry(event.target.checked)} />
          <small className="field-help">Automatically split rejected text and continue without prompts. Words that still fail are skipped and listed. Choose before starting narration; remembered for this browser session.</small>
        </div>}
        {gemini31OpenRouter && <Disclosure className="gemini-continuity-panel" summary="Gemini continuity" meta={geminiContextMeta} bodyClassName="gemini-continuity-settings">
          <Switch id="geminiPreviousContext" label="Send previous segment context" checked={state.geminiPreviousContext} onChange={(event) => actions.setGeminiPreviousContext(event.target.checked)} />
          <Switch id="geminiFollowingContext" label="Send following segment context" checked={state.geminiFollowingContext} onChange={(event) => actions.setGeminiFollowingContext(event.target.checked)} />
          <small>Each enabled direction sends a compact, silent excerpt to help sustain delivery. Disable either direction if neighboring text causes Gemini to reject a segment.</small>
          <label htmlFor="geminiNarratorDirection"><span>Narrator direction <em>Optional</em></span><textarea className="gemini-direction" id="geminiNarratorDirection" maxLength={800} value={state.geminiNarratorDirection} onChange={(event) => actions.setGeminiNarratorDirection(event.target.value)} placeholder="For example: Warm, intimate literary narration with restrained emotion." /></label>
          <small>Keep this compatible with the selected voice. The same direction is repeated for every segment. {state.geminiNarratorDirection.length}/800</small>
        </Disclosure>}
        <div className="capability-list" aria-label="Provider capabilities">
          {lowLatencyAvailable && <Capability available unavailableText=""><Switch id="lowLatency" label="Optimize first audio chunk" checked={state.lowLatency} onChange={(event) => actions.setLowLatency(event.target.checked)} /></Capability>}
          {textNormalizationAvailable && <Capability available unavailableText=""><Switch id="textNormalization" label="Normalize numbers and abbreviations" checked={state.provider === "minimax" ? state.minimaxSettings.textNormalization : state.textNormalization} onChange={(event) => state.provider === "minimax" ? actions.setMinimaxSettings({ textNormalization: event.target.checked }) : actions.setTextNormalization(event.target.checked)} />{state.provider === "minimax" && <small>Chinese and English; may add latency.</small>}</Capability>}
          {unavailableCapabilityCount > 0 && <Disclosure className="unavailable-capabilities" summary="Unavailable options" meta={<span className="count-pill">{unavailableCapabilityCount}</span>} bodyClassName="unavailable-capability-list">
            {!lowLatencyAvailable && <Capability available={false} unavailableText="Only xAI exposes first-chunk latency control."><Switch id="lowLatency" label="Optimize first audio chunk" checked={state.lowLatency} disabled onChange={(event) => actions.setLowLatency(event.target.checked)} /></Capability>}
            {!textNormalizationAvailable && <Capability available={false} unavailableText="Available with xAI and MiniMax."><Switch id="textNormalization" label="Normalize numbers and abbreviations" checked={state.textNormalization} disabled onChange={(event) => actions.setTextNormalization(event.target.checked)} /></Capability>}
          </Disclosure>}
        </div>
      </form>
    </section>
  </aside>;
}

export function NarrationOutput({ controller, audioRef }: { controller: Controller; audioRef: RefObject<HTMLAudioElement | null> }) {
  const { state, actions } = controller;
  const sessionActive = state.phase === "connecting" || state.phase === "generating" || state.phase === "pausing" || state.phase === "paused" || state.phase === "recoverable";
  const canPause = state.phase === "connecting" || state.phase === "generating";
  const pauseLabel = state.phase === "paused" ? "Resume generation" : state.phase === "pausing" ? "Pausing..." : "Pause generation";
  const pcm = state.provider === "gemini" || state.provider === "google" || state.provider === "resemble" || (state.provider === "openrouter" && isOpenRouterPcmModel(state.openrouterModel));
  const extension = state.stitchedAudio?.extension.toUpperCase() || (pcm ? "WAV" : "MP3");
  const partial = state.audioAvailable && state.phase !== "completed";
  const idleStatus = (state.provider === "minimax" || state.provider === "resemble") && state.status !== "Idle" ? state.status : "Narration audio appears here once you start. Progress, playback, and download unlock as segments arrive.";
  return <aside className="output-panel" aria-label="Narration output">
    <section className="card output-card" aria-labelledby="output-heading">
      <div className="compact-heading output-heading"><div className="heading-icon"><Icon name="audio" /></div><div><p className="eyebrow">Output</p><h2 id="output-heading">Narration</h2></div><span className={`phase-badge phase-${state.phase}`}>{state.phase}</span></div>
      {/* The live region stays mounted so status changes are announced rather than inserted. */}
      <div className="progress-block" aria-live="polite" aria-atomic="true">
        {state.phase === "idle"
          ? <p className="output-empty">{idleStatus}</p>
          : <>
              <div className="progress-copy"><span>{state.status}</span><span>{state.currentSegment} / {state.totalSegments} segments</span></div>
              <div className={`progress-rail ${state.phase === "connecting" ? "is-indeterminate" : ""}`.trim()}><progress value={state.progress} max={100} aria-label="Narration generation progress" /></div>
            </>}
      </div>
      {state.segmentFailure && <SegmentFailurePanel failure={state.segmentFailure} onRetry={actions.retryFailedSegment} onSmartRetry={actions.smartRetryFailedSegment} onSkip={actions.skipFailedSegment} />}
      {state.omissions.length > 0 && <details className="segment-failure omission-history">
        <summary>{state.omissions.length} text {state.omissions.length === 1 ? "piece" : "pieces"} omitted by Smart retry</summary>
        <p>These pieces were still rejected individually and are missing from playback and downloads.</p>
        <ul>{state.omissions.map((omission, index) => <li key={index}>Segment {omission.index}: <q>{omission.text.trim()}</q></li>)}</ul>
      </details>}
      {state.errorDetails && <details className="segment-failure"><summary>Provider diagnostics</summary><dl>
        <dt>Provider</dt><dd>{state.errorDetails.providerName}</dd>
        <dt>HTTP status</dt><dd>{state.errorDetails.status}</dd>
        {state.errorDetails.providerCode && <><dt>Provider code</dt><dd>{state.errorDetails.providerCode}</dd></>}
        {state.errorDetails.requestId && <><dt>Request ID</dt><dd>{state.errorDetails.requestId}</dd></>}
      </dl></details>}
      <AudioPlayer audioRef={audioRef} available={state.audioAvailable} />
      <div className="transport">
        <Button id="startButton" type="button" className="primary transport-primary" disabled={sessionActive} onClick={() => void actions.startNarration()}><Icon name="play" />Start narration</Button>
        <div className="transport-row">
          <Button type="button" disabled={!canPause && state.phase !== "paused"} onClick={state.phase === "paused" ? actions.resumeGeneration : actions.pauseGeneration}><Icon name={state.phase === "paused" ? "play" : "pause"} />{pauseLabel}</Button>
          <Button type="button" disabled={!sessionActive} onClick={actions.stopNarration}><Icon name="stop" />Stop</Button>
        </div>
      </div>
      <Button type="button" className="download-button" disabled={!state.audioAvailable} onClick={actions.download}>
        <Icon name="download" />
        <span className="download-label">Download {partial ? "partial " : ""}{extension}</span>
        <span className="download-help">{state.audioAvailable ? "Includes all audio received so far" : "Available as soon as audio is received"}</span>
      </Button>
    </section>
  </aside>;
}

export function SegmentFailurePanel({ failure, onRetry, onSmartRetry, onSkip }: { failure: SegmentFailure; onRetry: () => void; onSmartRetry: () => void; onSkip: () => void }) {
  const details = failure.details;
  const hasDiagnostics = Boolean(details && Object.keys(details).length);
  return <div className="segment-failure" role="alert">
    <div><strong>Segment {failure.index} was rejected</strong><span>{failure.message}</span></div>
    {hasDiagnostics && <details>
      <summary>Provider diagnostics</summary>
      <dl>
        {details?.status !== undefined && <><dt>HTTP status</dt><dd>{details.status}</dd></>}
        {details?.errorType && <><dt>Error type</dt><dd><code>{details.errorType}</code></dd></>}
        {details?.providerCode && <><dt>Provider code</dt><dd><code>{details.providerCode}</code></dd></>}
        {details?.providerName && <><dt>Provider</dt><dd>{details.providerName}</dd></>}
        {details?.attempts !== undefined && <><dt>Attempts</dt><dd>{details.attempts}</dd></>}
        {details?.reasons?.length && <><dt>Reasons</dt><dd>{details.reasons.join("; ")}</dd></>}
        {details?.flaggedInput && <><dt>Flagged input</dt><dd><q>{details.flaggedInput}</q></dd></>}
        {details?.generationId && <><dt>Generation ID</dt><dd><code>{details.generationId}</code></dd></>}
        {details?.requestId && <><dt>Request ID</dt><dd><code>{details.requestId}</code></dd></>}
        {details?.routingSummary && <><dt>Routing</dt><dd>{details.routingSummary}</dd></>}
      </dl>
    </details>}
    {failure.smartRetryAvailable && <>
      <Button type="button" className="primary smart-retry-button" onClick={onSmartRetry}><Icon name="refresh" />Smart retry</Button>
      <small>Splits rejected text into smaller pieces without surrounding context. Words that still fail are skipped.</small>
    </>}
    {failure.smartRetryResumable && <small>Smart retry continues saved progress. Retry segment restarts the whole segment; Skip segment omits it entirely. Both discard its saved recovery audio.</small>}
    <div className="segment-recovery-actions">
      <Button type="button" className={failure.smartRetryAvailable ? undefined : "primary"} onClick={onRetry}><Icon name="refresh" />Retry segment</Button>
      <Button type="button" onClick={onSkip}><Icon name="play" />Skip segment</Button>
    </div>
    <small>Skipping continues with the next segment and omits this segment from the audio.</small>
  </div>;
}

function MiniMaxVoiceManager({ controller }: { controller: Controller }) {
  const { state, actions } = controller;
  const selected = state.minimaxVoices.find((voice) => voice.id === state.voice);
  const [mode, setMode] = useState<"idle" | "create" | "rename" | "delete">("idle");
  const [name, setName] = useState("");
  const [languageModel, setLanguageModel] = useState("auto");
  const [promptText, setPromptText] = useState("");
  const [validationText, setValidationText] = useState("");
  const [source, setSource] = useState<File>();
  const [prompt, setPrompt] = useState<File>();
  const formId = useId();

  useEffect(() => {
    setMode("idle");
    setName(selected?.name || "");
  }, [selected?.id, selected?.name]);

  const beginCreate = () => {
    setName("");
    setLanguageModel("auto");
    setPromptText("");
    setValidationText("");
    setSource(undefined);
    setPrompt(undefined);
    setMode("create");
  };

  return <Disclosure id="minimaxVoiceClonePanel" className="voice-tools-panel" summary={<><Icon name="user" />Custom voice library</>} meta={`${state.minimaxVoices.length} voice${state.minimaxVoices.length === 1 ? "" : "s"}`} bodyClassName="voice-library" live>
    <div className="voice-library-toolbar">
      <div><strong>MiniMax voices</strong><span>Choose a voice above, or manage your library here.</span></div>
      <Button type="button" disabled={state.operationBusy} onClick={() => void actions.refreshMinimaxVoices()}>Refresh</Button>
    </div>

    {selected ? <div className="selected-voice">
      <div className="selected-voice-copy"><span>Selected library voice</span><strong>{selected.name}</strong><code>{selected.id}</code>{selected.model && <small>Preferred synthesis model: {selected.model} (not a cloning-model assignment)</small>}{selected.available === false && <small>Not listed by MiniMax. New clones appear only after first use; enter this voice ID above to use a new clone within 7 days. Older voices may have expired or been deleted.</small>}</div>
      <div className="voice-action-row">
        <Button type="button" disabled={state.operationBusy} onClick={() => { setName(selected.name); setMode("rename"); }}><Icon name="settings" />Rename</Button>
        <Button type="button" className="danger-button" disabled={state.operationBusy} onClick={() => setMode("delete")}><Icon name="trash" />Delete</Button>
      </div>
    </div> : <p className="voice-library-empty">No custom voice selected. Choose or add a library voice, or enter a voice ID above to narrate with MiniMax.</p>}

    {mode === "rename" && selected && <div className="voice-inline-editor">
      <label htmlFor={`${formId}-display-name`}>Display name <span>Saved in this browser</span></label>
      <input id={`${formId}-display-name`} type="text" value={name} onChange={(event) => setName(event.target.value)} />
      <div className="voice-inline-actions"><Button type="button" onClick={() => setMode("idle")}>Cancel</Button><Button type="button" className="primary" onClick={() => { actions.renameMinimaxClone(selected.id, name); setMode("idle"); }}>Save name</Button></div>
    </div>}

    {mode === "delete" && selected && <div className="voice-delete-confirm" role="alert">
      <div><strong>Delete “{selected.name}”?</strong><span>This permanently removes the voice from MiniMax. This cannot be undone.</span></div>
      <div className="voice-inline-actions"><Button type="button" onClick={() => setMode("idle")}>Cancel</Button><Button type="button" className="danger-button-solid" disabled={state.operationBusy} onClick={() => void actions.deleteMinimaxClone()}>{state.operationBusy ? "Deleting…" : "Delete voice"}</Button></div>
    </div>}

    {mode !== "create" && <Button type="button" className="add-voice-button" onClick={beginCreate}><Icon name="check" />Add new voice</Button>}

    {mode === "create" && <div className="voice-create-panel">
      <div className="voice-create-heading"><div><strong>Add a custom voice</strong><span>Source audio is required. Accent and style guidance are optional.</span></div><Button type="button" onClick={() => setMode("idle")}>Cancel</Button></div>
      <div className="voice-clone-form">
        <label htmlFor={`${formId}-name`}><span>Voice name</span><input id={`${formId}-name`} type="text" value={name} onChange={(event) => setName(event.target.value)} placeholder="Narrator voice" /></label>
        <label htmlFor={`${formId}-language`}><span>Language/accent</span><select id={`${formId}-language`} value={languageModel} onChange={(event) => setLanguageModel(event.target.value)}>{MINIMAX_LANGUAGES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        <label className="voice-form-wide" htmlFor={`${formId}-source`}><span>Source audio</span><input id={`${formId}-source`} type="file" accept=".mp3,.m4a,.wav,audio/mpeg,audio/mp4,audio/wav,audio/x-wav" onChange={(event) => setSource(event.target.files?.[0])} /></label>
        <label className="voice-form-wide" htmlFor={`${formId}-transcript`}><span>Source transcript check <em>Optional</em></span><input id={`${formId}-transcript`} type="text" maxLength={200} value={validationText} onChange={(event) => setValidationText(event.target.value)} placeholder="Transcript of the source audio" /></label>
        <label htmlFor={`${formId}-prompt-audio`}><span>Style prompt audio <em>Optional, under 8s</em></span><input id={`${formId}-prompt-audio`} type="file" accept=".mp3,.m4a,.wav,audio/mpeg,audio/mp4,audio/wav,audio/x-wav" onChange={(event) => setPrompt(event.target.files?.[0])} /></label>
        <label htmlFor={`${formId}-prompt-text`}><span>Style prompt transcript <em>Optional</em></span><input id={`${formId}-prompt-text`} type="text" value={promptText} onChange={(event) => setPromptText(event.target.value)} placeholder="Text spoken in prompt audio" /></label>
        <Switch id={`${formId}-noise`} label="Reduce recording noise" checked={state.cloneSettings.noiseReduction} onChange={(event) => actions.setCloneSettings({ noiseReduction: event.target.checked })} />
        <Switch id={`${formId}-volume`} label="Normalize recording volume" checked={state.cloneSettings.volumeNormalization} onChange={(event) => actions.setCloneSettings({ volumeNormalization: event.target.checked })} />
        <label htmlFor={`${formId}-accuracy`}><span>Transcript-match accuracy</span><input id={`${formId}-accuracy`} type="number" min={0} max={1} step={0.05} value={state.cloneSettings.accuracy} onChange={(event) => actions.setCloneSettings({ accuracy: Number(event.target.value) })} /><small>Used with the optional transcript check. Zero uses the provider default of 0.7.</small></label>
      </div>
      <p className="voice-clone-policy">Only clone voices you have permission to use. Source audio: 10 seconds–5 minutes. Prompt audio: under 8 seconds, with its transcript. MP3, M4A or WAV; each file at most 20 MB. Use a new clone within 7 days to keep it. First use incurs a separate $1.50 cloning charge. No preview is generated automatically.</p>
      <Button type="button" className="primary create-voice-button" disabled={state.operationBusy} onClick={() => void actions.saveMinimaxClone({ name, languageModel, promptText, validationText, source, prompt })}><Icon name="check" />{state.operationBusy ? "Creating voice…" : "Create voice"}</Button>
    </div>}
  </Disclosure>;
}

function Capability({ available, unavailableText, children }: { available: boolean; unavailableText: string; children: ReactNode }) {
  return <div className={`capability ${available ? "" : "is-unavailable"}`.trim()}>{children}{!available && <div className="capability-note"><span className="availability-badge">Unavailable</span><small>{unavailableText}</small></div>}</div>;
}

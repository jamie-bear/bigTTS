import type { useBigTtsController } from "../hooks/useBigTtsController";
import { MINIMAX_EMOTIONS, minimaxEmotionSupported } from "../../shared/speechSettings.js";
import { Disclosure, SelectField, Slider, Switch } from "./ui/Controls";

export function ProviderSynthesisSettings({ controller }: { controller: ReturnType<typeof useBigTtsController> }) {
  const { state, actions } = controller;
  if (state.provider === "minimax") {
    const settings = state.minimaxSettings;
    return <Disclosure summary="Advanced MiniMax settings" bodyClassName="provider-synthesis-settings">
      <Slider id="minimaxVolume" label="Voice volume" min={0.1} max={10} step={0.1} value={settings.volume} valueText={`${settings.volume}×`} onChange={(event) => actions.setMinimaxSettings({ volume: Number(event.target.value) })} />
      <Slider id="minimaxPitch" label="Voice pitch" min={-12} max={12} step={1} value={settings.pitch} valueText={settings.pitch} onChange={(event) => actions.setMinimaxSettings({ pitch: Number(event.target.value) })} />
      <SelectField id="minimaxEmotion" label="Emotion" value={settings.emotion} options={[{ value: "", label: "Automatic" }, ...MINIMAX_EMOTIONS.map((value) => ({ value, label: value, disabled: !minimaxEmotionSupported(value, state.minimaxModel) }))]} onChange={(event) => actions.setMinimaxSettings({ emotion: event.target.value })} helper="Fluent and whisper are available here only for Speech 2.6." />
      <label className="field" htmlFor="minimaxPronunciation"><span>Pronunciation dictionary</span><textarea id="minimaxPronunciation" rows={4} maxLength={10000} value={settings.pronunciation} onChange={(event) => actions.setMinimaxSettings({ pronunciation: event.target.value })} placeholder={'Dr./Doctor\nresume/(rɪˈzjuːm)'} /><small>One original/replacement rule per line. Rules apply to every segment.</small></label>
      <small>Cost estimates use public pay-as-you-go rates, exclude discounts, and exclude the separate $1.50 first-use cloning charge.</small>
    </Disclosure>;
  }
  if (state.provider !== "resemble") return null;
  const settings = state.resembleSettings;
  const languages = state.resembleVoices.find((voice) => voice.id === (state.voiceIdOverrides.resemble.trim() || state.voice))?.languages || [];
  return <Disclosure summary="Resemble delivery settings" bodyClassName="provider-synthesis-settings">
    <Switch id="resembleHd" label="HD synthesis" checked={settings.hd} onChange={(event) => actions.setResembleSettings({ hd: event.target.checked })} />
    <Switch id="resemblePronunciations" label="Apply team custom pronunciations" checked={settings.customPronunciations} onChange={(event) => actions.setResembleSettings({ customPronunciations: event.target.checked })} />
    <SelectField id="resembleDelivery" label="Delivery speed" value={settings.delivery} options={[{ value: "normal", label: "Normal" }, { value: "slow", label: "Slow" }, { value: "fast", label: "Fast" }]} onChange={(event) => actions.setResembleSettings({ delivery: event.target.value })} helper="Resemble controls pacing qualitatively rather than by a speed multiplier." />
    <label className="field" htmlFor="resembleLanguage"><span>Language code <em>Optional</em></span><input id="resembleLanguage" type="text" list="resembleLanguages" value={settings.language} placeholder="Auto (e.g. en-US, de-DE)" onChange={(event) => actions.setResembleSettings({ language: event.target.value })} /><datalist id="resembleLanguages">{languages.map((language) => <option key={language} value={language} />)}</datalist><small>The selected voice must support this language.</small></label>
    <label className="field" htmlFor="resemblePrompt"><span>Narrator direction <em>Optional</em></span><textarea id="resemblePrompt" rows={3} maxLength={800} value={settings.prompt} onChange={(event) => actions.setResembleSettings({ prompt: event.target.value })} placeholder="Warm, restrained storytelling." /><small>Applies to every segment. Direction counts toward the request limit.</small></label>
    <div className="field-grid">
      <label className="field" htmlFor="resembleTemperature"><span>Temperature <em>Optional</em></span><input id="resembleTemperature" type="number" min={0.1} max={5} step={0.1} placeholder="Provider default" value={settings.temperature} onChange={(event) => actions.setResembleSettings({ temperature: event.target.value })} /></label>
      <label className="field" htmlFor="resembleExaggeration"><span>Emotion intensity <em>Optional</em></span><input id="resembleExaggeration" type="number" min={0} max={1} step={0.05} placeholder="Provider default" value={settings.exaggeration} onChange={(event) => actions.setResembleSettings({ exaggeration: event.target.value })} /></label>
    </div>
    <label className="field" htmlFor="resembleSeed"><span>Seed <em>Optional</em></span><input id="resembleSeed" type="number" min={0} max={Number.MAX_SAFE_INTEGER} step={1} placeholder="Unset" value={settings.seed} onChange={(event) => actions.setResembleSettings({ seed: event.target.value })} /></label>
  </Disclosure>;
}

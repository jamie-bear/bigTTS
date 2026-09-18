# bigTTS

A local audiobook web app for turning long-form text into narration through OpenRouter speech models, Gemini TTS, xAI streaming TTS, Google Cloud Text-to-Speech voices, MiniMax custom voices, or Resemble.ai custom voices.

The frontend uses React, TypeScript, and Vite. Provider configuration, persistence, REST/OAuth access, WebSocket narration, audio playback/assembly, and presentation are separated so the interface can be redesigned without changing synthesis behavior.

## Features

- Paste a book or chapter, or load a `.txt` file.
- Pick OpenRouter, MiniMax, xAI, Gemini API, Google Cloud TTS, or Resemble.ai at runtime.
- Keep provider credentials local. OpenRouter, xAI, Resemble.ai, and Gemini API keys stay in the active browser/backend session; Google OAuth stores a refresh token in the ignored `.secrets` folder.
- Streams or buffers audio through a backend WebSocket proxy so provider credentials are not exposed in frontend source.
- Splits long text by paragraph and sentence, using a continuity-aware multilingual segmenter for OpenRouter Gemini 3.1 while keeping xAI segments below the `text.delta` limit and Google segments below Cloud TTS request-size limits.
- Generates every segment sequentially after narration starts, independent of playback position, while still streaming audio for listening.
- Expands the player into a cumulative seekable timeline after each completed segment, preserving the listener's position as more audio arrives and staging source updates so active playback is never interrupted.
- Pauses generation safely after the in-flight segment finishes and resumes with the next segment, without pausing audio playback.
- Retries transient OpenRouter failures with backoff and keeps rejected segments recoverable, exposing provider diagnostics plus retry and skip actions without discarding completed audio.
- Supports OpenRouter speech models, Gemini TTS voices through Google Cloud TTS, built-in xAI voices, MiniMax and Resemble.ai custom voices, language selection where available, delivery controls, low-latency xAI options, and xAI/MiniMax text normalization.
- Offers MiniMax emotion, pitch, volume and pronunciation settings, plus Resemble HD, custom pronunciations and per-segment narrator direction. Provider settings are remembered for the browser session.
- Displays the selected provider's current balance when its synthesis credential exposes one, and refreshes it after every completed segment.
- Automatically stitches completed segments into one continuous MP3 or WAV download after generation finishes.

Generation pauses live only for the current browser/WebSocket session. Keep the tab open while paused; refreshing or closing it stops the session.

## Run With Docker Compose

Make sure Docker Desktop or another Docker engine is running first.

```bash
docker compose up --build
```

Then open `http://localhost:20204`.

To run in the background:

```bash
docker compose up --build -d
```

To stop:

```bash
docker compose down
```

The default container and host port is `20204`. To change it, update `PORT` and the `ports` mapping in `compose.yaml`.

The Compose service, image, and container are all named `bigtts`, keeping them distinct from another installation that may be running alongside this one. The bind-mounted `.secrets` directory is local to this checkout, so its OAuth token is isolated too.

## Local Node Fallback

Install dependencies and build the frontend before starting the production server:

```bash
npm install
npm run build
npm start
```

Production runs at `http://localhost:20204`.

For frontend development with hot reload:

```bash
npm install
npm run dev
```

Vite remains at `http://localhost:20204` and proxies API, OAuth, and narration WebSocket traffic to the local Node backend on port `20205`. Both ports are distinct so this development stack can run in parallel with another installation.

## Frontend Quality Checks

```bash
npm run typecheck
npm run lint
npm test
npm run test:e2e
npm run build
```

An optional, credential-gated listening evaluation compares the former 500-character behavior with the continuity pipeline. It writes ignored WAV files and a generation manifest under `artifacts/gemini-continuity/`:

```bash
OPENROUTER_API_KEY=your-key npm run evaluate:gemini-continuity
```

Set `GEMINI_TTS_VOICE` or `GEMINI_TTS_SPEED` to override the default `Kore` voice and `1.0` pace for the evaluation.

Unit tests use credential-free browser mocks. Playwright covers every provider at desktop and mobile sizes, mocked WebSocket narration, horizontal overflow, and committed visual-regression baselines. No provider credentials are required.

Frontend source is organized under `src/client`:

- `components` contains the current visual shell and reusable controls.
- `config` is the single source of truth for provider capabilities and options.
- `state` and `hooks` own reducer-driven application behavior.
- `services` isolate storage, REST/OAuth, WebSocket, playback, and download logic.
- `styles` is a token-driven stylesheet set: `tokens.css` (light and dark palettes plus the spacing, radius, type, shadow and motion scales), then `base`, `layout`, `panels`, `controls`, `player` and `accessibility`, composed in that order by `index.css`.

Dark mode follows `prefers-color-scheme` until the header toggle pins a choice; the selection persists in `localStorage["bigtts.theme"]` and is applied before first paint by a small inline script in `index.html`.

## Google OAuth Setup

For personal Google Cloud access, create a local `.env` file from `.env.example`:

```bash
GOOGLE_OAUTH_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_OAUTH_CLIENT_SECRET=your-client-secret
```

In the Google Cloud OAuth client, add this authorized redirect URI:

```text
http://localhost:20204/oauth/google/callback
```

If your OAuth consent screen is in testing mode, add your Google account as a test user. The Cloud Text-to-Speech API must be enabled for the project, and the signed-in account needs access to use it. Gemini-TTS through Cloud Text-to-Speech also needs `aiplatform.endpoints.predict`, which can be granted with the Vertex AI User role. After restarting the app, choose Google Cloud TTS and use Connect Google. The refresh token is stored locally at `.secrets/google-oauth-token.json`, which is ignored by Git and mounted into Docker Compose for persistence.

## Provider Notes

OpenRouter uses `https://openrouter.ai/api/v1/audio/speech` for speech generation and `https://openrouter.ai/api/v1/models?output_modalities=speech` for model discovery. Every discovered model uses the built-in voice selection and speech-generation flow. The exact `google/gemini-3.1-flash-tts-preview` model additionally uses multilingual semantic segmentation, stable audiobook direction, and optional silent context from adjacent segments. The app checks `https://openrouter.ai/api/v1/key` for the selected key's remaining credit limit; keys without a configured limit do not expose an account balance through that endpoint.

OpenRouter Gemini 3.1 defaults to a 500-character semantic target (the **Very short** setting) and a 2,500-character hard maximum. These are targets rather than fixed cuts: the segmenter preserves sentence separators, prefers paragraph and chapter boundaries, attaches short headings to following prose, and rebalances short tails. Compact silent context from the previous and following segments is enabled by default; each direction can be disabled independently under **Gemini continuity** when neighboring content causes a request to be rejected. An optional narrator direction is repeated consistently across requests and stored only for the browser session.

Gemini 3.1 pace is expressed in the director prompt because OpenRouter's generic `speed` field is not supported by every TTS provider. The model returns 24 kHz, 16-bit mono PCM. Successful responses are validated without filtering or normalizing the audio; transient preview-model failures are retried up to twice, with both neighboring-context directions removed on retries. The generation ID is retained in narration diagnostics. Waveform crossfading and a Web Audio playback scheduler remain intentionally out of scope, so this release improves tonal and prosodic continuity rather than mechanically editing boundaries.

Select **Google: Gemini 3.1 Flash TTS**, then choose **API key** or **OAuth** under **Access method**. The app remembers the method for the browser session and keeps your selected voice when switching methods. Existing saved Google/Gemini selections and API keys remain compatible.

The **API key** method uses the Gemini Developer API endpoint `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-tts-preview:generateContent` with an AI Studio API key. Gemini TTS returns raw 24 kHz PCM audio, so the browser wraps it as WAV for playback and download.

For xAI, this app uses the streaming TTS endpoint, `wss://api.x.ai/v1/tts`. The official docs state that each `text.delta` message is capped at 15,000 characters, while the bidirectional WebSocket endpoint supports long total text through multiple deltas and multi-utterance sessions.

For Google Cloud TTS, this app uses Cloud Text-to-Speech `text:synthesize` at `https://texttospeech.googleapis.com/v1/text:synthesize` with `voice.modelName` set to `gemini-3.1-flash-tts-preview`. Google returns one base64 LINEAR16 payload per segment; the backend removes the WAV header and forwards 24 kHz PCM audio so the browser can play and download a continuous WAV. Cloud Gemini-TTS requires principal-backed authentication plus permission to call the model endpoint; use the local OAuth connection above before starting narration.

Resemble.ai uses `https://app.resemble.ai/api/v2/voices` to discover custom voices with advanced metadata after an API key is entered, then calls `https://f.cluster.resemble.ai/synthesize` with the selected `voice_uuid`, 22.05 kHz sample rate, and `PCM_16` WAV precision. The voice determines its model; no synthesis `model` parameter is sent. Confirmed legacy TTS models are shown as unavailable with guidance to upgrade to Ultra in Resemble. Unknown model metadata does not disable a voice. The backend validates the returned WAV format before forwarding mono PCM16 for playback and continuous WAV download.

Resemble defaults to a 2,500-character segment target and enforces a 3,000-character limit on the **complete request data**, including generated SSML, escaped text and narrator direction. Long text splits automatically into complete requests. Under **Resemble delivery settings**, HD and team custom pronunciations default off; delivery defaults to normal; narrator direction, language code, temperature (0.1–5), emotion intensity (0–1), and seed are optional and unset. Slow/fast delivery uses Resemble's qualitative pacing controls. Arbitrary SSML input is not supported: pasted markup is spoken as text. For example, select slow delivery, enter `Warm, restrained storytelling.` as direction, and optionally set `en-US` as the voice's language.

Voice discovery accepts `num_pages`, `page_count`, and `total_pages`, removes duplicates, and reports an incomplete list if the 20-page safety limit is reached. This handles the different pagination names in Resemble's API reference and management guide.

For Resemble.ai and MiniMax, choose a custom voice from the dropdown or enter an optional **Voice ID** (for example, `819fcc57` for Resemble.ai). A nonempty ID overrides the dropdown, even if no custom voices can be loaded. Clear the field to use the dropdown again. Each provider's entered ID is remembered separately for the browser session, including page reloads. IDs are trimmed before narration and must be usable with your provider API key. MiniMax library rename/delete actions always apply to the selected library voice, not the entered ID.

MiniMax uses `https://api.minimax.io/v1/t2a_v2` with non-streaming, hex-encoded MP3 responses. Its eight speech models remain available. The segment target defaults to 2,500 characters and the server caps each request at 9,999, conservatively following the API's “less than 10,000” requirement. MiniMax's complete language catalog is shared between client and server; Persian, Filipino and Tamil are disabled for Speech 01/02. Speed supports 0.5–2. Under **Advanced MiniMax settings**, volume defaults to 1, pitch to 0, emotion to automatic, pronunciation rules to empty, and number/abbreviation normalization to off. Pronunciation rules use one `original/replacement` entry per line, for example `Dr./Doctor`. Normalization supports Chinese and English. Fluent/whisper emotions are enabled only for Speech 2.6 because the documentation's Speech 2.8 emotion wording is ambiguous.

MiniMax cost estimates use public pay-as-you-go rates of **$100 per million characters for HD** and **$60 for Turbo**, covering Speech 2.8, 2.6 and 02. Speech 01 displays “Estimate unavailable” because its pricing was not verified. Estimates exclude discounts and the separate **$1.50 first-use cloning charge**. For example, 10,000 characters cost an estimated $1.00 on HD or $0.60 on Turbo before any cloning charge. Rates were reviewed on 2026-09-18; actual billing remains provider-controlled.

MiniMax cloning requires MP3, M4A or WAV recordings, each at most 20 MB: source audio must be 10–300 seconds, and optional prompt audio must be shorter than 8 seconds and accompanied by its transcript. The browser checks duration before upload; the backend checks decoded size and file contents, with final validation performed by MiniMax. Uploaded file IDs retain their exact integer precision. Noise reduction and volume normalization default on and can be switched off. The optional source transcript is forwarded as `text_validation`, with transcript-match accuracy defaulting to 0.7 (zero also means the provider default). The saved speech-model label is an app preference for later synthesis, not a permanent cloning-model assignment.

Use a new MiniMax clone for synthesis within **seven days** or the provider may delete it. A successful voice refresh marks saved voices missing from the provider as unavailable while preserving local names; a failed refresh leaves the saved library intact. Manual voice IDs remain independent. bigTTS does not request an automatic billed clone preview.

MiniMax's voice-management documentation adds an important caveat: **unused clones are not listed until their first synthesis**. An absent entry therefore does not prove expiry. If a new clone is marked unavailable after a refresh, enter its saved ID in **Voice ID** for the first use within seven days. The UI explains this distinction; it never silently generates a billed preview to activate a clone.

Both integrations check provider-level failures as well as HTTP failures. MiniMax uploads also check `base_resp`; provider codes and trace IDs are retained when supplied. MiniMax audio must match the requested hex encoding, and requests combine cancellation with timeouts. Existing stored settings and voice IDs remain compatible; missing new settings use the defaults above.

The direct Gemini API and Google Cloud TTS routes retain their existing 500-character defaults. Cloud Gemini-TTS has a 4,000-byte text-field limit per request, so the backend applies a stricter Google segment cap and checks UTF-8 byte length when splitting text. The continuity behavior described above applies only to Gemini 3.1 through OpenRouter.

Sources:

- https://openrouter.ai/blog/announcements/announcing-audio-apis/
- https://openrouter.ai/docs/guides/overview/multimodal/tts
- https://openrouter.ai/google/gemini-3.1-flash-tts-preview/providers
- https://openrouter.ai/mistralai/voxtral-mini-tts-2603/api
- https://openrouter.ai/docs/api/reference/limits
- https://docs.x.ai/developers/model-capabilities/audio/text-to-speech
- https://docs.x.ai/developers/rest-api-reference/inference/voice
- https://ai.google.dev/gemini-api/docs/speech-generation
- https://ai.google.dev/gemini-api/docs/api-key
- https://docs.cloud.google.com/text-to-speech/docs/gemini-tts
- https://docs.cloud.google.com/text-to-speech/docs/reference/rest/v1/text/synthesize
- https://docs.cloud.google.com/docs/authentication
- https://docs.cloud.google.com/text-to-speech/quotas

- https://docs.resemble.ai/getting-started/authentication
- https://docs.resemble.ai/voice-creation/voices/list
- https://docs.resemble.ai/guides/creating-clips/getting-started
- https://docs.resemble.ai/getting-started/model-versions
- https://docs.resemble.ai/api-reference/text-to-speech/synthesize
- https://docs.resemble.ai/api-reference/voices/list-voices
- https://docs.resemble.ai/getting-started/ssml
- https://docs.resemble.ai/guides/prompt-generation/getting-started
- https://platform.minimax.io/docs/api-reference/speech-t2a-http
- https://platform.minimax.io/docs/api-reference/voice-cloning-uploadcloneaudio
- https://platform.minimax.io/docs/api-reference/voice-cloning-uploadprompt
- https://platform.minimax.io/docs/api-reference/voice-cloning-clone
- https://platform.minimax.io/docs/api-reference/voice-management-get
- https://platform.minimax.io/docs/guides/pricing-paygo

## Deferred Provider Work

- [ ] MiniMax HTTP streaming with aggregate-final-audio duplication prevention; Resemble `/stream` with its separate 2,000-character limit, incremental WAV parsing and progressive playback. Preserve pause, cancellation and partial downloads.
- [ ] Explicit MiniMax system/designed and Resemble prebuilt voice categories, with deletion restricted by voice type.
- [ ] MiniMax asynchronous long-form jobs: persist jobs, retrieve results and support timestamp-aware captions before exposing the workflow (50,000 inline characters or one million through file input).
- [ ] Before release, run short live MiniMax and Resemble synthesis/clone smoke tests with authorized credentials and record any differences from the documented contracts. Automated coverage uses mocks and incurs no provider charges.

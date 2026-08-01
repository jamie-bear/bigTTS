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
- Supports OpenRouter speech models, Gemini TTS voices through Google Cloud TTS, built-in xAI voices, MiniMax and Resemble.ai custom voices, language selection where available, speed controls, low-latency xAI options, and xAI text normalization.
- Displays the selected provider's current balance when its synthesis credential exposes one, and refreshes it after every completed segment.
- Automatically stitches completed segments into one continuous MP3 or WAV download after generation finishes.

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
- `styles` exposes semantic tokens while retaining the current presentation.

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

OpenRouter Gemini 3.1 defaults to a 1,200-character semantic target and a 2,500-character hard maximum. These are targets rather than fixed cuts: the segmenter preserves sentence separators, prefers paragraph and chapter boundaries, attaches short headings to following prose, and rebalances short tails. Enhanced continuity is enabled by default and can be disabled under **Gemini continuity**. An optional narrator direction is repeated consistently across requests and stored only for the browser session.

Gemini 3.1 pace is expressed in the director prompt because OpenRouter's generic `speed` field is not supported by every TTS provider. The model returns 24 kHz, 16-bit mono PCM. Successful responses are validated without filtering or normalizing the audio; transient preview-model failures are retried up to twice. The generation ID is retained in narration diagnostics. Waveform crossfading and a Web Audio playback scheduler remain intentionally out of scope, so this release improves tonal and prosodic continuity rather than mechanically editing boundaries.

Gemini API is the simplest Google option. It uses the Gemini Developer API endpoint `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-tts-preview:generateContent` with an AI Studio API key. Gemini TTS returns raw 24 kHz PCM audio, so the browser wraps it as WAV for playback and download.

For xAI, this app uses the streaming TTS endpoint, `wss://api.x.ai/v1/tts`. The official docs state that each `text.delta` message is capped at 15,000 characters, while the bidirectional WebSocket endpoint supports long total text through multiple deltas and multi-utterance sessions.

For Google Cloud TTS, this app uses Cloud Text-to-Speech `text:synthesize` at `https://texttospeech.googleapis.com/v1/text:synthesize` with `voice.modelName` set to `gemini-3.1-flash-tts-preview`. Google returns one base64 LINEAR16 payload per segment; the backend removes the WAV header and forwards 24 kHz PCM audio so the browser can play and download a continuous WAV. Cloud Gemini-TTS requires principal-backed authentication plus permission to call the model endpoint; use the local OAuth connection above before starting narration.

Resemble.ai uses `https://app.resemble.ai/api/v2/voices` to list ready custom voices after a Resemble.ai API key is entered, then calls `https://f.cluster.resemble.ai/synthesize` with the selected `voice_uuid`, 22.05 kHz sample rate, and `PCM_16` WAV precision. Resemble.ai returns base64 WAV audio; the backend forwards the decoded 16-bit PCM payload so the browser can play and download a continuous WAV.

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

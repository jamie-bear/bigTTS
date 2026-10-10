import path from "node:path";
import { promises as fs } from "node:fs";
import {
  buildGeminiSpeechBody,
  createGeminiNarrationSegments,
  requestOpenRouterGeminiSpeech
} from "../src/server/geminiContinuity.js";

import { getOpenRouterGeminiCapabilities, OPENROUTER_GEMINI_31_TTS_MODEL } from "../src/shared/geminiModels.js";

const model = String(process.env.GEMINI_TTS_MODEL || OPENROUTER_GEMINI_31_TTS_MODEL).trim();
const capabilities = getOpenRouterGeminiCapabilities(model);
if (!capabilities) throw new Error(`Unsupported evaluation model: ${model}`);
const narratorDirection = String(process.env.GEMINI_TTS_DIRECTION || "Warm and restrained.");
const dryRun = process.argv.includes("--dry-run");
const apiKey = String(process.env.OPENROUTER_API_KEY || "").trim();
if (!apiKey && !dryRun) throw new Error("Set OPENROUTER_API_KEY before running the Gemini continuity evaluation.");

const voice = String(process.env.GEMINI_TTS_VOICE || "Kore").trim() || "Kore";
const speed = Number(process.env.GEMINI_TTS_SPEED || 1);
if (!Number.isFinite(speed) || speed < 0.7 || speed > 1.5) throw new Error("GEMINI_TTS_SPEED must be between 0.7 and 1.5.");
const outputRoot = path.resolve("artifacts", "gemini-continuity", new Date().toISOString().replace(/[:.]/g, "-"));
const samples = [
  {
    id: "description",
    text: `The valley opened slowly beneath the train, its river carrying a thin ribbon of dawn between dark banks. Mara watched the first windows catch the light, one farm after another waking in silence, and wondered whether the landscape had always looked this temporary. ${"Beyond the glass, fields rose and fell in long green measures while the carriage held its quiet rhythm. ".repeat(16)}`
  },
  {
    id: "dialogue",
    text: `"You knew the road was closed," Mara said.\n\n"I knew what the sign claimed," Elias replied, too calmly.\n\nShe laughed once, without humor. "That is not the same thing."\n\nHe looked toward the rain-dark ridge. "No. It rarely is."\n\n${"For a moment neither of them spoke, and the weather filled the distance between them. ".repeat(12)}`
  },
  {
    id: "chapters",
    text: `Chapter One\n\n${"The old station clock had stopped at four minutes past midnight, although every train still arrived beneath it. ".repeat(12)}\n\n* * *\n\n${"By morning the platform was bright with frost and the tracks were singing under the cold. ".repeat(10)}\n\nChapter Two\n\n${"Mara returned with the ticket folded inside her glove and a different answer prepared. ".repeat(12)}`
  },
  {
    id: "multilingual",
    text: `${"Der Zug fuhr leise durch das Tal. Niemand im Abteil bemerkte, wie der Morgen über den Bergen aufstieg. ".repeat(8)}\n\n${"列車は静かな谷を進んだ。窓の向こうで、朝の光がゆっくりと山を越えてきた。".repeat(8)}\n\n${"تحرك القطار بهدوء عبر الوادي. لم يلاحظ أحد كيف وصل ضوء الصباح إلى النوافذ. ".repeat(8)}`
  },
  {
    id: "long-clause",
    text: `Mara kept walking because the rain had erased the path behind her, because the lamps along the ridge were going out one by one, because the letter in her pocket had named a place that did not appear on any map, and because stopping now would mean admitting that the voice she had heard at the station belonged to someone she remembered; ${"yet every turn revealed another familiar wall, another locked gate, another window lit for her arrival, ".repeat(24)}until the road descended at last toward the sea.`
  }
];

if (!dryRun) await fs.mkdir(outputRoot, { recursive: true });
const manifest = {
  createdAt: new Date().toISOString(),
  model,
  narratorDirection,
  voice,
  speed,
  note: "Listen for spoken directions, duplicate or missing text, pacing response, and consistency across adjacent segments. For 3.8 compare plain/styled pairs; repeat at different GEMINI_TTS_SPEED values to assess pacing. Generated files are ignored by git.",
  samples: []
};

for (const sample of samples) {
  const productionBody = (segment) => buildGeminiSpeechBody(segment, { model, voice, speed, narratorDirection, enhancedContinuity: true });
  const semanticSegments = createGeminiNarrationSegments(sample.text, { targetChars: capabilities.defaultSegmentChars });
  const variants = capabilities.promptFormat === "instructions" ? [
    { name: "plain", segments: semanticSegments, body: (segment) => ({ ...productionBody(segment), instructions: "" }) },
    { name: "styled", segments: semanticSegments, body: productionBody }
  ] : [
    {
      name: "baseline",
      segments: legacySegments(sample.text, 500).map((text, index, list) => ({
        text, previousContext: "", nextContext: "", boundaryBefore: index ? "sentence" : "start", boundaryAfter: index === list.length - 1 ? "end" : "sentence"
      })),
      body: (segment) => ({ model, voice, response_format: "pcm", input: `Read the following audiobook passage aloud exactly as written.\n\n${segment.text}` })
    },
    {
      name: "optimized",
      segments: createGeminiNarrationSegments(sample.text, { targetChars: 1_200 }),
      body: productionBody
    }
  ];
  const sampleManifest = { id: sample.id, sourceChars: sample.text.length, variants: [] };

  for (const variant of variants) {
    const audioParts = [];
    const segmentManifest = [];
    for (const [index, segment] of variant.segments.entries()) {
      process.stdout.write(`${sample.id} ${variant.name} ${index + 1}/${variant.segments.length}\n`);
      const body = variant.body(segment);
      if (dryRun) {
        process.stdout.write(`${JSON.stringify(body)}\n`);
        continue;
      }
      const result = await requestOpenRouterGeminiSpeech({
        url: "https://openrouter.ai/api/v1/audio/speech",
        apiKey,
        ...body
      });
      audioParts.push(result.audio);
      segmentManifest.push({
        index: index + 1,
        chars: segment.text.length,
        boundaryBefore: segment.boundaryBefore,
        boundaryAfter: segment.boundaryAfter,
        generationId: result.generationId,
        attempts: result.attempts,
        text: segment.text,
        input: body.input,
        instructions: body.instructions
      });
    }
    const filename = `${sample.id}-${variant.name}.wav`;
    if (!dryRun) await fs.writeFile(path.join(outputRoot, filename), createWav(audioParts));
    sampleManifest.variants.push({ name: variant.name, filename, segments: segmentManifest });
  }
  manifest.samples.push(sampleManifest);
}

if (!dryRun) {
  await fs.writeFile(path.join(outputRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  process.stdout.write(`Evaluation written to ${outputRoot}\n`);
}

function legacySegments(text, targetLength) {
  const paragraphs = text.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
  const segments = [];
  let current = "";
  for (const paragraph of paragraphs) {
    const units = paragraph.length > targetLength
      ? paragraph.match(/[^.!?。！？]+[.!?。！？]+["')\]]*|[^.!?。！？]+$/g) || [paragraph]
      : [paragraph];
    for (const unitValue of units) {
      const unit = unitValue.trim();
      const candidate = current ? `${current}\n\n${unit}` : unit;
      if (candidate.length <= targetLength) current = candidate;
      else {
        if (current) segments.push(current);
        current = unit;
      }
    }
  }
  if (current) segments.push(current);
  return segments;
}

function createWav(parts) {
  const dataLength = parts.reduce((total, part) => total + part.byteLength, 0);
  const output = Buffer.allocUnsafe(44 + dataLength);
  output.write("RIFF", 0, "ascii");
  output.writeUInt32LE(36 + dataLength, 4);
  output.write("WAVE", 8, "ascii");
  output.write("fmt ", 12, "ascii");
  output.writeUInt32LE(16, 16);
  output.writeUInt16LE(1, 20);
  output.writeUInt16LE(1, 22);
  output.writeUInt32LE(24_000, 24);
  output.writeUInt32LE(48_000, 28);
  output.writeUInt16LE(2, 32);
  output.writeUInt16LE(16, 34);
  output.write("data", 36, "ascii");
  output.writeUInt32LE(dataLength, 40);
  let offset = 44;
  for (const part of parts) {
    Buffer.from(part.buffer, part.byteOffset, part.byteLength).copy(output, offset);
    offset += part.byteLength;
  }
  return output;
}

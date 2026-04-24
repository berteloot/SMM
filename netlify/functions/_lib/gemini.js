import { GoogleGenAI } from "@google/genai";

const MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash-exp";

let _client;
function client() {
  if (_client) return _client;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
  _client = new GoogleGenAI({ apiKey });
  return _client;
}

export async function uploadVideo(buffer, { mimeType = "video/webm", displayName = "candidate.webm" } = {}) {
  const blob = new Blob([buffer], { type: mimeType });
  const uploaded = await client().files.upload({
    file: blob,
    config: { mimeType, displayName },
  });

  // Wait for the file to finish PROCESSING before sending to a model.
  let file = uploaded;
  const startedAt = Date.now();
  const timeoutMs = 5 * 60 * 1000;
  while (file.state === "PROCESSING") {
    if (Date.now() - startedAt > timeoutMs) throw new Error("gemini_file_processing_timeout");
    await new Promise((r) => setTimeout(r, 3000));
    file = await client().files.get({ name: uploaded.name });
  }
  if (file.state === "FAILED") throw new Error("gemini_file_processing_failed");
  return file;
}

export async function analyzeVideo(file, prompt) {
  const result = await client().models.generateContent({
    model: MODEL,
    contents: [{
      role: "user",
      parts: [
        { fileData: { fileUri: file.uri, mimeType: file.mimeType } },
        { text: prompt + "\n\nThe candidate's video submission is attached. Analyze it now and return JSON only." },
      ],
    }],
    config: {
      responseMimeType: "application/json",
      temperature: 0.2,
    },
  });

  const text = result.text || result.response?.text?.() || "";
  if (!text) throw new Error("gemini_empty_response");
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`gemini_invalid_json: ${err.message}: ${text.slice(0, 200)}`);
  }
}

import { verifyToken } from "./_lib/token.js";
import { getJson, presignPut } from "./_lib/s3.js";
import { QUESTIONS, RECORDING_LIMIT_SECONDS } from "./_lib/questions.js";

const json = (statusCode, obj) => ({
  statusCode,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(obj),
});

export async function handler(event) {
  if (event.httpMethod !== "POST") return json(405, { error: "method_not_allowed" });

  let input;
  try {
    input = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "invalid_json" });
  }

  const token = input.token;
  const verdict = verifyToken(token, process.env.SMM_TOKEN_SECRET);
  if (!verdict.ok) return json(401, { error: "invalid_token", reason: verdict.reason });

  const tokenBody = token.split(".")[0];
  const candidate = await getJson(`candidates/${tokenBody}.json`);
  if (!candidate) return json(404, { error: "candidate_not_found" });

  if (candidate.status === "submitted") {
    return json(409, { error: "already_submitted" });
  }

  const contentType = typeof input.content_type === "string" ? input.content_type : "video/webm";
  const ext = contentType.includes("mp4") ? "mp4" : "webm";
  const videoKey = `videos/${tokenBody}.${ext}`;
  const uploadUrl = await presignPut(videoKey, contentType, 3600);

  return json(200, {
    ok: true,
    first_name: candidate.first_name || (candidate.name || "").split(" ")[0],
    last_name: candidate.last_name || (candidate.name || "").split(" ").slice(1).join(" "),
    name: candidate.name,
    email: candidate.email,
    questions: QUESTIONS,
    recording_limit_seconds: RECORDING_LIMIT_SECONDS,
    upload_url: uploadUrl,
    upload_content_type: contentType,
    video_key: videoKey,
  });
}

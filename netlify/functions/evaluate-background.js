import sgMail from "@sendgrid/mail";
import { getJson, putJson, getObjectBytes, presignGet } from "./_lib/s3.js";
import { uploadVideo, analyzeVideo } from "./_lib/gemini.js";
import { ANALYSIS_PROMPT } from "./_lib/analysis_prompt.js";
import { pushCandidate } from "./_lib/notion.js";

const json = (statusCode, obj) => ({
  statusCode,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(obj),
});

const escapeHtml = (s) =>
  String(s || "").replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" }[c]));

export async function handler(event) {
  if (event.httpMethod !== "POST") return json(405, { error: "method_not_allowed" });

  let input;
  try {
    input = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "invalid_json" });
  }
  const tokenBody = input.token_body;
  if (!tokenBody || typeof tokenBody !== "string") return json(400, { error: "missing_token_body" });

  const candidateKey = `candidates/${tokenBody}.json`;
  const candidate = await getJson(candidateKey);
  if (!candidate) return json(404, { error: "candidate_not_found" });
  if (!candidate.video_key) return json(400, { error: "candidate_has_no_video" });

  const evaluationKey = `evaluations/${tokenBody}.json`;
  if (await getJson(evaluationKey)) {
    console.log("evaluation_already_exists", tokenBody);
    return json(200, { ok: true, skipped: true });
  }

  let evaluation = null;
  let evalError = null;
  try {
    const videoBytes = await getObjectBytes(candidate.video_key);
    const mimeType = candidate.video_key.endsWith(".mp4") ? "video/mp4" : "video/webm";
    const file = await uploadVideo(videoBytes, { mimeType, displayName: `${tokenBody}.${mimeType.split("/")[1]}` });
    evaluation = await analyzeVideo(file, ANALYSIS_PROMPT);
  } catch (err) {
    console.error("evaluation_failed", err);
    evalError = err.message || String(err);
  }

  const result = {
    candidate: {
      first_name: candidate.first_name,
      last_name: candidate.last_name,
      email: candidate.email,
      linkedin: candidate.linkedin,
      submitted_at: candidate.submitted_at,
    },
    evaluation,
    error: evalError,
    evaluated_at: new Date().toISOString(),
    model: process.env.GEMINI_MODEL || "gemini-2.0-flash-exp",
  };
  await putJson(evaluationKey, result);

  const videoUrl = await presignGet(candidate.video_key);
  const evaluationUrl = await presignGet(evaluationKey);

  const notionPage = await pushCandidate({ candidate, evaluation, videoUrl, evaluationUrl })
    .catch((err) => { console.error("notion_push_failed", err); return null; });

  await sendAdminEmail(candidate, evaluation, evalError, videoUrl, evaluationUrl, notionPage)
    .catch((err) => console.error("admin_email_failed", err));

  return json(200, { ok: true });
}

async function sendAdminEmail(candidate, evaluation, evalError, videoUrl, evaluationUrl, notionPage) {
  const apiKey = process.env.SENDGRID_API_KEY;
  if (!apiKey) {
    console.warn("no_sendgrid_key, skipping admin email");
    return;
  }
  const adminTo = process.env.ADMIN_NOTIFY_EMAIL || "stan@sharemymeals.org";
  sgMail.setApiKey(apiKey);

  const fullName = `${candidate.first_name || ""} ${candidate.last_name || ""}`.trim() || candidate.name || candidate.email;

  const subject = evaluation
    ? `New CEO application: ${fullName} | ${evaluation.total}/35 | ${evaluation.recommendation}${evaluation.flagged_low_score ? " [flagged]" : ""}`
    : `New CEO application: ${fullName} (AI scoring failed, review manually)`;

  await sgMail.send({
    to: adminTo,
    from: {
      email: process.env.SMM_MAGIC_LINK_FROM_EMAIL || "stan@sharemymeals.org",
      name: process.env.SMM_MAGIC_LINK_FROM_NAME || "SMM CEO Search",
    },
    replyTo: candidate.email,
    subject,
    text: buildAdminText(candidate, evaluation, evalError, videoUrl, evaluationUrl, notionPage),
    html: buildAdminHtml(candidate, evaluation, evalError, videoUrl, evaluationUrl, notionPage),
  });
}

function buildAdminText(candidate, evaluation, evalError, videoUrl, evaluationUrl, notionPage) {
  const fullName = `${candidate.first_name || ""} ${candidate.last_name || ""}`.trim();
  const lines = [
    `Candidate: ${fullName} <${candidate.email}>`,
    candidate.linkedin ? `LinkedIn: ${candidate.linkedin}` : null,
    `Submitted: ${candidate.submitted_at}`,
    "",
    `Video: ${videoUrl}`,
    `Full evaluation JSON: ${evaluationUrl}`,
    notionPage ? `Notion record: ${notionPage.url}` : null,
    "(Video + JSON links expire in 7 days)",
    "",
  ].filter(Boolean);

  if (evaluation) {
    lines.push(
      `Total score: ${evaluation.total}/35`,
      `Recommendation: ${evaluation.recommendation}`,
      evaluation.flagged_low_score ? "Flagged: at least one criterion scored below 2" : null,
      "",
      "Score breakdown:",
      `  Mission clarity:        ${evaluation.scores?.mission_clarity ?? "?"}/5`,
      `  Operational readiness:  ${evaluation.scores?.operational_readiness ?? "?"}/5`,
      `  Leadership under pressure: ${evaluation.scores?.leadership_under_pressure ?? "?"}/5`,
      `  Coalition building:     ${evaluation.scores?.coalition_relationship_building ?? "?"}/5`,
      `  Fundraising credibility: ${evaluation.scores?.fundraising_credibility ?? "?"}/5`,
      `  Communication quality:  ${evaluation.scores?.communication_quality ?? "?"}/5`,
      `  Cultural fit:           ${evaluation.scores?.cultural_fit ?? "?"}/5`,
      "",
      "Strengths:",
      evaluation.strengths,
      "",
      "Concerns:",
      evaluation.concerns,
      "",
      "On-camera presence:",
      evaluation.behavioral_observations || "(no observations recorded)",
    );
  } else {
    lines.push(
      "AI evaluation failed:",
      evalError || "unknown error",
      "",
      "Please review the video manually.",
    );
  }

  return lines.filter(Boolean).join("\n");
}

function buildAdminHtml(candidate, evaluation, evalError, videoUrl, evaluationUrl, notionPage) {
  const fullName = escapeHtml(`${candidate.first_name || ""} ${candidate.last_name || ""}`.trim());
  const linkedinRow = candidate.linkedin
    ? `<tr><td style="padding:4px 12px 4px 0;color:#6b7280">LinkedIn</td><td><a href="${escapeHtml(candidate.linkedin)}">${escapeHtml(candidate.linkedin)}</a></td></tr>`
    : "";

  let evalBlock;
  if (evaluation) {
    const scoreRow = (label, key) =>
      `<tr><td style="padding:4px 12px 4px 0;color:#6b7280">${label}</td><td style="font-variant-numeric:tabular-nums"><strong>${evaluation.scores?.[key] ?? "?"}</strong>/5</td></tr>`;
    const recoColor = evaluation.recommendation === "ADVANCE" ? "#166534" : evaluation.recommendation === "PASS" ? "#b91c1c" : "#a16207";
    evalBlock = `
<h2 style="margin:24px 0 8px;color:#313C59">Evaluation</h2>
<p style="margin:0 0 12px"><strong style="font-size:24px;color:#F86A0E">${evaluation.total}/35</strong>
&nbsp;&nbsp;<span style="color:${recoColor};font-weight:700;letter-spacing:0.05em">${escapeHtml(evaluation.recommendation)}</span>
${evaluation.flagged_low_score ? '&nbsp;&nbsp;<span style="background:#fef3c7;color:#92400e;padding:2px 8px;border-radius:4px;font-size:12px">FLAGGED: criterion below 2</span>' : ""}</p>
<table style="border-collapse:collapse;font-size:14px;margin-bottom:16px">
${scoreRow("Mission clarity", "mission_clarity")}
${scoreRow("Operational readiness", "operational_readiness")}
${scoreRow("Leadership under pressure", "leadership_under_pressure")}
${scoreRow("Coalition building", "coalition_relationship_building")}
${scoreRow("Fundraising credibility", "fundraising_credibility")}
${scoreRow("Communication quality", "communication_quality")}
${scoreRow("Cultural fit", "cultural_fit")}
</table>
<h3 style="margin:16px 0 4px;color:#313C59;font-size:14px">Strengths</h3>
<p style="margin:0 0 12px">${escapeHtml(evaluation.strengths)}</p>
<h3 style="margin:16px 0 4px;color:#313C59;font-size:14px">Concerns</h3>
<p style="margin:0 0 12px">${escapeHtml(evaluation.concerns)}</p>
<h3 style="margin:16px 0 4px;color:#313C59;font-size:14px">On-camera presence</h3>
<p style="margin:0 0 12px;font-style:italic;color:#444">${escapeHtml(evaluation.behavioral_observations || "(no observations recorded)")}</p>`;
  } else {
    evalBlock = `
<h2 style="margin:24px 0 8px;color:#b91c1c">AI evaluation failed</h2>
<p>${escapeHtml(evalError || "unknown error")}</p>
<p>Please review the video manually using the link above.</p>`;
  }

  return `
<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;max-width:640px;margin:0 auto;color:#313C59;line-height:1.55">
<h1 style="margin:0 0 4px;font-size:22px;color:#313C59">New CEO application</h1>
<p style="margin:0 0 16px;color:#6b7280">${escapeHtml(candidate.submitted_at || "")}</p>

<table style="border-collapse:collapse;font-size:14px;margin-bottom:16px">
  <tr><td style="padding:4px 12px 4px 0;color:#6b7280">Name</td><td><strong>${fullName}</strong></td></tr>
  <tr><td style="padding:4px 12px 4px 0;color:#6b7280">Email</td><td><a href="mailto:${escapeHtml(candidate.email)}">${escapeHtml(candidate.email)}</a></td></tr>
  ${linkedinRow}
</table>

<p style="margin:8px 0 16px">
  <a href="${escapeHtml(videoUrl)}" style="background:#F86A0E;color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:600;display:inline-block">Watch video</a>
  &nbsp;
  <a href="${escapeHtml(evaluationUrl)}" style="background:#fff;color:#313C59;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:600;display:inline-block;border:1px solid #e5e7eb">Full evaluation JSON</a>
  ${notionPage ? `&nbsp;<a href="${escapeHtml(notionPage.url)}" style="background:#fff;color:#313C59;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:600;display:inline-block;border:1px solid #e5e7eb">Open in Notion</a>` : ""}
</p>
<p style="margin:0 0 12px;font-size:12px;color:#6b7280">Video + JSON links expire in 7 days.</p>

${evalBlock}
</div>`;
}

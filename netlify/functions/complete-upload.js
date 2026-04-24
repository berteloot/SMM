import sgMail from "@sendgrid/mail";
import { verifyToken } from "./_lib/token.js";
import { getJson, putJson, objectExists } from "./_lib/s3.js";

const json = (statusCode, obj) => ({
  statusCode,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(obj),
});

function escapeHtml(s) {
  return String(s || "").replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" }[c]));
}

export async function handler(event) {
  if (event.httpMethod !== "POST") return json(405, { error: "method_not_allowed" });

  let input;
  try {
    input = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "invalid_json" });
  }

  const token = input.token;
  const videoKey = input.video_key;
  const verdict = verifyToken(token, process.env.SMM_TOKEN_SECRET);
  if (!verdict.ok) return json(401, { error: "invalid_token", reason: verdict.reason });
  if (!videoKey || typeof videoKey !== "string") return json(400, { error: "missing_video_key" });

  const tokenBody = token.split(".")[0];
  if (!videoKey.startsWith(`videos/${tokenBody}.`)) {
    return json(400, { error: "video_key_mismatch" });
  }

  const exists = await objectExists(videoKey);
  if (!exists) return json(400, { error: "video_not_uploaded" });

  const candidateKey = `candidates/${tokenBody}.json`;
  const candidate = await getJson(candidateKey);
  if (!candidate) return json(404, { error: "candidate_not_found" });

  const alreadySubmitted = candidate.status === "submitted";

  const updated = {
    ...candidate,
    status: "submitted",
    video_key: videoKey,
    submitted_at: candidate.submitted_at || new Date().toISOString(),
  };
  await putJson(candidateKey, updated);

  if (!alreadySubmitted) {
    await sendConfirmationEmail(updated).catch((err) => console.error("confirmation_email_failed", err));
    await notifyTelegram(updated).catch((err) => console.error("telegram_notify_failed", err));
    triggerEvaluation(tokenBody, event).catch((err) => console.error("evaluation_trigger_failed", err));
  }

  return json(200, { ok: true });
}

function triggerEvaluation(tokenBody, event) {
  const proto = event.headers["x-forwarded-proto"] || "https";
  const host = event.headers["x-forwarded-host"] || event.headers.host;
  const baseUrl = process.env.SMM_SITE_URL || (host ? `${proto}://${host}` : null);
  if (!baseUrl) {
    console.warn("evaluation_trigger_no_base_url");
    return Promise.resolve();
  }
  const url = `${baseUrl.replace(/\/$/, "")}/.netlify/functions/evaluate-background`;
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token_body: tokenBody }),
  }).then((res) => {
    if (!res.ok && res.status !== 202) console.warn("evaluation_trigger_unexpected_status", res.status);
  });
}

async function sendConfirmationEmail(candidate) {
  if (!process.env.SENDGRID_API_KEY) return;
  const firstName = candidate.first_name || (candidate.name || "").split(" ")[0] || "there";
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
  await sgMail.send({
    to: candidate.email,
    from: {
      email: process.env.SMM_MAGIC_LINK_FROM_EMAIL || "stan@sharemymeals.org",
      name: process.env.SMM_MAGIC_LINK_FROM_NAME || "Stan Berteloot",
    },
    subject: "We've got your Share My Meals CEO application",
    text: buildConfirmationText(firstName),
    html: buildConfirmationHtml(firstName),
  });
}

function buildConfirmationText(firstName) {
  return [
    `Hi ${firstName},`,
    "",
    "Your video is in. Thank you for taking the time to share it.",
    "",
    "I'll review every application personally with the Share My Meals board. If there's a fit, we'll reach out to set up a conversation. Either way, you'll hear back from us.",
    "",
    "If anything comes up in the meantime, reply to this email.",
    "",
    "Stan Berteloot",
    "Share My Meals",
  ].join("\n");
}

function buildConfirmationHtml(firstName) {
  const safeFirst = escapeHtml(firstName);
  return `
<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;max-width:540px;margin:0 auto;color:#313C59;line-height:1.55">
  <p>Hi ${safeFirst},</p>
  <p>Your video is in. Thank you for taking the time to share it.</p>
  <p>I'll review every application personally with the Share My Meals board. If there's a fit, we'll reach out to set up a conversation. Either way, you'll hear back from us.</p>
  <p>If anything comes up in the meantime, reply to this email.</p>
  <p>Stan Berteloot<br>Share My Meals</p>
</div>`;
}

async function notifyTelegram(candidate) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!botToken || !chatId) return;

  const text = [
    "*New SMM CEO application*",
    `Name: ${escapeMd(candidate.name)}`,
    `Email: ${escapeMd(candidate.email)}`,
    candidate.linkedin ? `LinkedIn: ${escapeMd(candidate.linkedin)}` : null,
    `Video: \`${escapeMd(candidate.video_key)}\``,
  ].filter(Boolean).join("\n");

  await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" }),
  });
}

function escapeMd(s) {
  if (!s) return "";
  return String(s).replace(/([_*`\[\]])/g, "\\$1");
}

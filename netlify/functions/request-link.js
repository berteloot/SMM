import sgMail from "@sendgrid/mail";
import { signToken } from "./_lib/token.js";
import { putJson } from "./_lib/s3.js";
import { verifyTurnstile } from "./_lib/turnstile.js";

const json = (statusCode, obj) => ({
  statusCode,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(obj),
});

function isValidEmail(e) {
  return typeof e === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 254;
}

function normalizeLinkedIn(url) {
  if (!url) return "";
  const trimmed = url.trim();
  if (!trimmed) return "";
  if (!/^https?:\/\//i.test(trimmed)) return `https://${trimmed}`;
  return trimmed;
}

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

  const firstName = (input.first_name || "").trim();
  const lastName = (input.last_name || "").trim();
  const email = (input.email || "").trim().toLowerCase();
  const linkedin = normalizeLinkedIn(input.linkedin);
  const turnstileToken = input.turnstile_token;

  if (!firstName || firstName.length > 60) return json(400, { error: "invalid_first_name" });
  if (!lastName || lastName.length > 60) return json(400, { error: "invalid_last_name" });
  if (!isValidEmail(email)) return json(400, { error: "invalid_email" });

  const ip = event.headers["x-nf-client-connection-ip"] || event.headers["x-forwarded-for"]?.split(",")[0];
  const captcha = await verifyTurnstile(turnstileToken, ip);
  if (!captcha.ok) return json(400, { error: "captcha_failed", detail: captcha.reason });

  const token = signToken({ email, first_name: firstName, last_name: lastName }, process.env.SMM_TOKEN_SECRET);

  const now = new Date().toISOString();
  await putJson(`candidates/${token.split(".")[0]}.json`, {
    first_name: firstName,
    last_name: lastName,
    name: `${firstName} ${lastName}`,
    email,
    linkedin,
    token,
    issued_at: now,
    status: "link_sent",
    ip: ip || null,
    user_agent: event.headers["user-agent"] || null,
  });

  const siteUrl = (process.env.SMM_SITE_URL || "").replace(/\/$/, "");
  const link = `${siteUrl}/record.html?t=${encodeURIComponent(token)}`;

  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
  await sgMail.send({
    to: email,
    from: {
      email: process.env.SMM_MAGIC_LINK_FROM_EMAIL || "stan@sharemymeals.org",
      name: process.env.SMM_MAGIC_LINK_FROM_NAME || "Stan Berteloot",
    },
    subject: "Your Share My Meals CEO application link",
    text: buildEmailText(firstName, link),
    html: buildEmailHtml(firstName, link),
  });

  return json(200, { ok: true });
}

function buildEmailText(firstName, link) {
  return [
    `Hi ${firstName},`,
    "",
    "Thanks for your interest in leading Share My Meals.",
    "",
    "Use the link below to record a short video answering three questions. It takes about five minutes. The link is good for seven days.",
    "",
    link,
    "",
    "If you have trouble, just reply to this email.",
    "",
    "Stan Berteloot",
    "Share My Meals",
  ].join("\n");
}

function buildEmailHtml(firstName, link) {
  const safeFirst = escapeHtml(firstName);
  return `
<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;max-width:540px;margin:0 auto;color:#313C59;line-height:1.55">
  <p>Hi ${safeFirst},</p>
  <p>Thanks for your interest in leading Share My Meals.</p>
  <p>Use the link below to record a short video answering three questions. It takes about five minutes. The link is good for seven days.</p>
  <p style="margin:28px 0">
    <a href="${link}" style="background:#F86A0E;color:#fff;text-decoration:none;padding:12px 22px;border-radius:6px;font-weight:600;display:inline-block">Start recording</a>
  </p>
  <p style="font-size:13px;color:#666">Or paste this URL into your browser:<br><span style="word-break:break-all">${link}</span></p>
  <p>If you have trouble, just reply to this email.</p>
  <p>Stan Berteloot<br>Share My Meals</p>
</div>`;
}

const form = document.getElementById("apply-form");
const msg = document.getElementById("form-msg");
const btn = document.getElementById("submit-btn");
const turnstileWrap = document.getElementById("turnstile-wrap");

let turnstileWidgetId = null;

async function init() {
  const cfg = await fetch("/api/config").then(r => r.json());
  await waitForTurnstile();
  turnstileWidgetId = window.turnstile.render(turnstileWrap, {
    sitekey: cfg.turnstile_site_key,
    theme: "light",
  });
}

function waitForTurnstile() {
  return new Promise((resolve) => {
    const check = () => {
      if (window.turnstile && window.turnstile.render) return resolve();
      setTimeout(check, 50);
    };
    check();
  });
}

function setMsg(text, kind) {
  msg.textContent = text;
  msg.dataset.kind = kind || "";
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  setMsg("");
  const data = new FormData(form);
  const body = {
    first_name: (data.get("first_name") || "").trim(),
    last_name: (data.get("last_name") || "").trim(),
    email: (data.get("email") || "").trim(),
    linkedin: (data.get("linkedin") || "").trim(),
    turnstile_token: turnstileWidgetId != null ? window.turnstile.getResponse(turnstileWidgetId) : "",
  };

  if (!body.first_name) return setMsg("Please enter your first name.", "error");
  if (!body.last_name) return setMsg("Please enter your last name.", "error");
  if (!body.email) return setMsg("Please enter your email.", "error");
  if (!body.turnstile_token) return setMsg("Please complete the challenge above.", "error");

  btn.disabled = true;
  btn.textContent = "Sending...";
  try {
    const res = await fetch("/api/request-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok || !out.ok) {
      throw new Error(out.error || `error_${res.status}`);
    }
    form.hidden = true;
    setMsg(`Thanks. We sent a recording link to ${body.email}. Check your inbox (and spam folder).`, "success");
  } catch (err) {
    setMsg(friendlyError(err.message), "error");
    btn.disabled = false;
    btn.textContent = "Send me the recording link";
    if (window.turnstile && turnstileWidgetId != null) window.turnstile.reset(turnstileWidgetId);
  }
});

function friendlyError(code) {
  switch (code) {
    case "invalid_email": return "That email address doesn't look right. Try again?";
    case "invalid_first_name": return "Please enter your first name.";
    case "invalid_last_name": return "Please enter your last name.";
    case "captcha_failed": return "The challenge didn't pass. Please try again.";
    default: return "Something went wrong. Please try again, or email stan@sharemymeals.org.";
  }
}

init();

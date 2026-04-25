const token = new URLSearchParams(window.location.search).get("t");

const $ = (id) => document.getElementById(id);
const loading = $("loading");
const errorBox = $("error");
const errorMsg = $("error-msg");
const recorder = $("recorder");
const done = $("done");
const greeting = $("greeting");
const preview = $("preview");
const timerEl = $("timer");
const startBtn = $("start-btn");
const stopBtn = $("stop-btn");
const redoBtn = $("redo-btn");
const submitBtn = $("submit-btn");
const statusMsg = $("status-msg");
const progress = $("progress");
const progressBar = $("progress-bar");

let session = null;
let mediaStream = null;
let mediaRecorder = null;
let chunks = [];
let videoBlob = null;
let recordingStartedAt = 0;
let timerInterval = null;

function showOnly(section) {
  for (const el of [loading, errorBox, recorder, done]) el.hidden = el !== section;
}

function setStatus(text, kind) {
  statusMsg.textContent = text || "";
  statusMsg.dataset.kind = kind || "";
}

function fail(message) {
  errorMsg.textContent = message;
  showOnly(errorBox);
}

async function init() {
  if (!token) return fail("This link is missing its access token.");
  try {
    const res = await fetch("/api/verify-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, content_type: pickContentType() }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      if (data.error === "already_submitted") return fail("You've already submitted an application on this link.");
      if (data.error === "invalid_token" && data.reason === "expired") return fail("This link has expired. Ask Stan for a new one.");
      if (data.error === "invalid_token") return fail("This link isn't valid.");
      return fail("We couldn't load your session. Please try again later.");
    }
    session = data;
    renderSession();
    resetTimerDisplay();
    showOnly(recorder);
  } catch (err) {
    fail("Network error. Please try again.");
  }
}

function pickContentType() {
  const ua = navigator.userAgent || "";
  const isIOS = /iPad|iPhone|iPod/.test(ua);
  const isSafari = /Safari/.test(ua) && !/Chrome|CriOS|FxiOS/.test(ua);
  // iOS Safari's MediaRecorder claims to support video/webm but produces
  // audio-only output. Force mp4 (h264+aac) on Safari, where it works.
  const candidates = isIOS || isSafari
    ? ["video/mp4", "video/mp4;codecs=h264,aac", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"]
    : ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4"];
  for (const c of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(c)) return c;
  }
  return "video/webm";
}

function blobHasVideo(blob) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const v = document.createElement("video");
    v.preload = "metadata";
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(url);
      resolve(ok);
    };
    v.onloadedmetadata = () => {
      const hasVideo = v.videoWidth > 0 && v.videoHeight > 0;
      finish(hasVideo);
    };
    v.onerror = () => finish(false);
    setTimeout(() => finish(false), 5000);
    v.src = url;
  });
}

function renderSession() {
  const firstName = session.first_name || (session.name || "").split(" ")[0];
  greeting.textContent = firstName ? `Hi ${firstName}, welcome.` : "Welcome.";
}

async function startCamera() {
  if (mediaStream) return mediaStream;

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new CameraError(
      "no_api",
      "Your browser doesn't support video recording. Please use the latest Safari (iPhone) or Chrome (computer) and try again.",
    );
  }

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
      audio: { echoCancellation: true, noiseSuppression: true },
    });
  } catch (err) {
    throw new CameraError("permission_or_hardware", cameraErrorMessage(err));
  }

  const videoTracks = stream.getVideoTracks();
  const audioTracks = stream.getAudioTracks();

  if (videoTracks.length === 0) {
    stream.getTracks().forEach((t) => t.stop());
    throw new CameraError(
      "no_video_track",
      "We can hear you but we can't see you, your camera isn't connected to this page. " + howToFix(),
    );
  }
  if (audioTracks.length === 0) {
    stream.getTracks().forEach((t) => t.stop());
    throw new CameraError(
      "no_audio_track",
      "Your microphone isn't connected to this page. " + howToFix(),
    );
  }
  if (!videoTracks[0].enabled || videoTracks[0].readyState !== "live") {
    stream.getTracks().forEach((t) => t.stop());
    throw new CameraError(
      "video_not_live",
      "Your camera is connected but not sending video. Close any other app using your camera (Zoom, FaceTime, Photo Booth) and reload this page.",
    );
  }

  mediaStream = stream;
  preview.srcObject = mediaStream;
  preview.muted = true;
  return mediaStream;
}

class CameraError extends Error {
  constructor(code, userMessage) {
    super(userMessage);
    this.code = code;
  }
}

function cameraErrorMessage(err) {
  const name = err && err.name;
  if (name === "NotAllowedError" || name === "PermissionDeniedError") {
    return "Camera and microphone access was blocked. " + howToFix();
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return "No camera or microphone was found on this device.";
  }
  if (name === "NotReadableError" || name === "TrackStartError") {
    return "Your camera is in use by another app. Close Zoom, FaceTime, Photo Booth, or any other camera app and reload this page.";
  }
  if (name === "OverconstrainedError") {
    return "Your camera doesn't support the requested resolution. Try a different device or browser.";
  }
  return "We couldn't access your camera or microphone. " + howToFix();
}

function howToFix() {
  const ua = navigator.userAgent || "";
  const isIOS = /iPad|iPhone|iPod/.test(ua);
  if (isIOS) {
    return "On iPhone: tap the AA icon in the Safari address bar -> Website Settings -> set Camera and Microphone to Allow, then reload. Make sure you're using Safari directly, not a link opened inside Gmail, Instagram, or LinkedIn.";
  }
  return "Click the camera icon in the address bar of your browser, set Camera and Microphone to Allow, then reload this page.";
}

function formatMMSS(seconds) {
  const m = Math.floor(seconds / 60).toString().padStart(2, "0");
  const s = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function resetTimerDisplay() {
  const limit = session?.recording_limit_seconds || 300;
  timerEl.textContent = `00:00 / ${formatMMSS(limit)}`;
  timerEl.dataset.state = "";
}

function startTimer() {
  recordingStartedAt = Date.now();
  const limit = session.recording_limit_seconds || 300;
  timerInterval = setInterval(() => {
    const elapsed = (Date.now() - recordingStartedAt) / 1000;
    timerEl.textContent = `${formatMMSS(elapsed)} / ${formatMMSS(limit)}`;
    if (elapsed >= limit - 30 && elapsed < limit - 10) timerEl.dataset.state = "warning";
    else if (elapsed >= limit - 10) timerEl.dataset.state = "critical";
    if (elapsed >= limit) stopRecording();
  }, 250);
}

function clearTimer() {
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = null;
}

startBtn.addEventListener("click", async () => {
  setStatus("");
  try {
    await startCamera();
  } catch (err) {
    setStatus(err.message || "We couldn't access your camera or microphone. " + howToFix(), "error");
    return;
  }
  chunks = [];
  videoBlob = null;
  const mimeType = session.upload_content_type;
  mediaRecorder = new MediaRecorder(mediaStream, MediaRecorder.isTypeSupported(mimeType) ? { mimeType } : undefined);
  mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
  mediaRecorder.onstop = async () => {
    clearTimer();
    const blob = new Blob(chunks, { type: mediaRecorder.mimeType || mimeType });
    preview.srcObject = null;
    preview.muted = false;
    preview.src = URL.createObjectURL(blob);
    preview.controls = true;
    redoBtn.hidden = false;
    startBtn.hidden = true;
    stopBtn.hidden = true;

    setStatus("Checking your recording...");
    const hasVideo = await blobHasVideo(blob);
    if (!hasVideo) {
      videoBlob = null;
      submitBtn.hidden = true;
      setStatus(
        "Your recording captured audio but no video. This is usually an iPhone Safari issue. Please tap Re-record, then make sure you can see yourself in the preview the whole time. If the issue keeps happening, open this link directly in Safari (not from Gmail/Instagram/LinkedIn) and reload the page.",
        "error",
      );
      return;
    }
    videoBlob = blob;
    submitBtn.hidden = false;
    setStatus("Preview your recording above. Re-record if you'd like, or submit.");
  };
  mediaRecorder.start();
  startTimer();
  startBtn.hidden = true;
  stopBtn.hidden = false;
  redoBtn.hidden = true;
  submitBtn.hidden = true;
  preview.controls = false;
  setStatus("Recording. Speak clearly and take your time. Aim for 3 to 5 minutes.");
});

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== "inactive") mediaRecorder.stop();
}

stopBtn.addEventListener("click", stopRecording);

redoBtn.addEventListener("click", () => {
  videoBlob = null;
  preview.src = "";
  preview.controls = false;
  if (mediaStream) preview.srcObject = mediaStream;
  preview.muted = true;
  redoBtn.hidden = true;
  submitBtn.hidden = true;
  startBtn.hidden = false;
  stopBtn.hidden = true;
  resetTimerDisplay();
  setStatus("Ready when you are.");
});

submitBtn.addEventListener("click", async () => {
  if (!videoBlob) return;
  submitBtn.disabled = true;
  redoBtn.disabled = true;
  progress.hidden = false;
  setStatus("Uploading your video...");

  try {
    await uploadToS3(videoBlob, session.upload_url, session.upload_content_type);
    setStatus("Finalizing...");
    const res = await fetch("/api/complete-upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, video_key: session.video_key }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw new Error(data.error || `error_${res.status}`);
    if (mediaStream) for (const t of mediaStream.getTracks()) t.stop();
    showOnly(done);
  } catch (err) {
    setStatus(`Upload failed: ${err.message}. Please try again or contact stan@sharemymeals.org.`, "error");
    submitBtn.disabled = false;
    redoBtn.disabled = false;
    progress.hidden = true;
  }
});

function uploadToS3(blob, url, contentType) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.setRequestHeader("x-amz-server-side-encryption", "AES256");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        progressBar.style.width = `${Math.round((e.loaded / e.total) * 100)}%`;
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`S3 returned ${xhr.status}`));
    };
    xhr.onerror = () => reject(new Error("network_error"));
    xhr.send(blob);
  });
}

init();

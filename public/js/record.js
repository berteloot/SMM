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

const MIN_ACCEPTABLE_FPS = 10;
const FRAME_PROBE_REAL_SECONDS = 3;
const FRAME_PROBE_PLAYBACK_RATE = 4;

let session = null;
let mediaStream = null;
let mediaRecorder = null;
let chunks = [];
let videoBlob = null;
let recordingStartedAt = 0;
let timerInterval = null;
let wakeLock = null;
let recorderError = null;
let visibilityHandler = null;

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
  // iOS Safari MediaRecorder claims to support video/webm but produces
  // audio-only files. Force mp4 (h264+aac) on Safari, where it works.
  const candidates = isIOS || isSafari
    ? ["video/mp4", "video/mp4;codecs=h264,aac", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"]
    : ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4"];
  for (const c of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(c)) return c;
  }
  return "video/webm";
}

// Returns { ok, reason, fps } after loading the blob and probing actual decoded frames.
function probeBlob(blob) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const v = document.createElement("video");
    v.preload = "auto";
    v.muted = true;
    v.playsInline = true;
    let settled = false;
    let frameCount = 0;
    let probeStartedAt = 0;
    let probeStopped = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      try { v.pause(); } catch (e) {}
      URL.revokeObjectURL(url);
      resolve(result);
    };

    v.onerror = () => finish({ ok: false, reason: "decode_error" });

    v.onloadedmetadata = async () => {
      if (!(v.videoWidth > 0 && v.videoHeight > 0)) {
        return finish({ ok: false, reason: "no_video_track" });
      }
      if (!v.duration || v.duration < 1) {
        return finish({ ok: false, reason: "too_short" });
      }
      if (typeof v.requestVideoFrameCallback !== "function") {
        // Browsers without RVFC: trust the dimensions check, accept.
        return finish({ ok: true, reason: "no_rvfc", fps: null });
      }

      const tickFrame = () => {
        frameCount += 1;
        if (probeStopped) return;
        v.requestVideoFrameCallback(tickFrame);
      };

      try {
        v.playbackRate = FRAME_PROBE_PLAYBACK_RATE;
        v.requestVideoFrameCallback(tickFrame);
        await v.play();
        probeStartedAt = performance.now();
      } catch (e) {
        return finish({ ok: false, reason: "play_failed" });
      }

      setTimeout(() => {
        probeStopped = true;
        const realElapsed = (performance.now() - probeStartedAt) / 1000;
        const videoElapsed = realElapsed * FRAME_PROBE_PLAYBACK_RATE;
        const fps = videoElapsed > 0 ? frameCount / videoElapsed : 0;
        finish({ ok: fps >= MIN_ACCEPTABLE_FPS, reason: fps >= MIN_ACCEPTABLE_FPS ? "ok" : "low_fps", fps });
      }, FRAME_PROBE_REAL_SECONDS * 1000);
    };

    setTimeout(() => finish({ ok: false, reason: "probe_timeout" }), 30000);
    v.src = url;
  });
}

function renderSession() {
  const firstName = session.first_name || (session.name || "").split(" ")[0];
  greeting.textContent = firstName ? `Hi ${firstName}, welcome.` : "Welcome.";
}

function stopMediaTracks() {
  if (mediaStream) {
    for (const t of mediaStream.getTracks()) t.stop();
    mediaStream = null;
  }
}

async function startCamera({ fresh } = {}) {
  if (fresh) stopMediaTracks();
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
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30, min: 15 },
        facingMode: "user",
      },
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

async function acquireWakeLock() {
  try {
    if (navigator.wakeLock && navigator.wakeLock.request) {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener?.("release", () => { wakeLock = null; });
    }
  } catch (e) {
    // Not supported or denied; silently continue. The visibility check still fires.
  }
}

async function releaseWakeLock() {
  if (wakeLock) {
    try { await wakeLock.release(); } catch (e) {}
    wakeLock = null;
  }
}

function attachVisibilityWatcher() {
  detachVisibilityWatcher();
  visibilityHandler = () => {
    if (document.visibilityState === "hidden" && mediaRecorder && mediaRecorder.state === "recording") {
      recorderError = "interrupted";
      try { mediaRecorder.stop(); } catch (e) {}
    } else if (document.visibilityState === "visible" && wakeLock === null && mediaRecorder && mediaRecorder.state === "recording") {
      // Re-acquire wake lock if it was released when the page was backgrounded.
      acquireWakeLock();
    }
  };
  document.addEventListener("visibilitychange", visibilityHandler);
}

function detachVisibilityWatcher() {
  if (visibilityHandler) {
    document.removeEventListener("visibilitychange", visibilityHandler);
    visibilityHandler = null;
  }
}

startBtn.addEventListener("click", async () => {
  setStatus("");
  recorderError = null;
  try {
    await startCamera();
  } catch (err) {
    setStatus(err.message || "We couldn't access your camera or microphone. " + howToFix(), "error");
    return;
  }
  chunks = [];
  videoBlob = null;
  const mimeType = session.upload_content_type;
  const recorderOpts = MediaRecorder.isTypeSupported(mimeType)
    ? { mimeType, videoBitsPerSecond: 2_500_000, audioBitsPerSecond: 128_000 }
    : { videoBitsPerSecond: 2_500_000, audioBitsPerSecond: 128_000 };

  mediaRecorder = new MediaRecorder(mediaStream, recorderOpts);
  mediaRecorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.push(e.data); };
  mediaRecorder.onerror = (e) => {
    recorderError = (e && e.error && e.error.name) || "recorder_error";
    console.error("MediaRecorder error", e);
  };
  mediaRecorder.onstop = async () => {
    clearTimer();
    detachVisibilityWatcher();
    await releaseWakeLock();

    const blob = new Blob(chunks, { type: mediaRecorder.mimeType || mimeType });
    preview.srcObject = null;
    preview.muted = false;
    preview.src = URL.createObjectURL(blob);
    preview.controls = true;
    redoBtn.hidden = false;
    startBtn.hidden = true;
    stopBtn.hidden = true;

    if (recorderError === "interrupted") {
      videoBlob = null;
      submitBtn.hidden = true;
      setStatus(
        "Recording was interrupted because the page lost focus (screen lock, app switch, or notification). Please tap Re-record and stay on this page until you finish.",
        "error",
      );
      return;
    }
    if (recorderError) {
      videoBlob = null;
      submitBtn.hidden = true;
      setStatus(
        `Your recording hit an error (${recorderError}). Please tap Re-record. If it keeps happening, try a different browser or device.`,
        "error",
      );
      return;
    }

    setStatus("Checking your recording...");
    const probe = await probeBlob(blob);
    if (!probe.ok) {
      videoBlob = null;
      submitBtn.hidden = true;
      const reasons = {
        no_video_track: "Your recording captured audio but no video. This is usually an iPhone Safari issue. Open this link directly in Safari (not from Gmail/Instagram/LinkedIn) and try again.",
        low_fps: `Your recording froze partway through (only ${probe.fps ? probe.fps.toFixed(1) : "?"} frames per second). Please tap Re-record and stay on this tab the entire time. Don't let your screen lock.`,
        too_short: "Your recording is too short. Please tap Re-record and answer all three questions.",
        decode_error: "We couldn't read your recording. Please tap Re-record. If this keeps happening, try a different browser.",
        play_failed: "Your browser couldn't play back the recording for verification. Please tap Re-record.",
        probe_timeout: "Verifying your recording took too long. Please tap Re-record.",
      };
      setStatus(reasons[probe.reason] || `Your recording didn't pass our quality check (${probe.reason}). Please tap Re-record.`, "error");
      return;
    }
    videoBlob = blob;
    submitBtn.hidden = false;
    setStatus("Preview your recording above. Re-record if you'd like, or submit.");
  };

  // Periodic flush every 1s. iOS Safari's MediaRecorder freezes the video
  // encoder if the buffer isn't drained periodically.
  mediaRecorder.start(1000);
  startTimer();
  attachVisibilityWatcher();
  acquireWakeLock();

  startBtn.hidden = true;
  stopBtn.hidden = false;
  redoBtn.hidden = true;
  submitBtn.hidden = true;
  preview.controls = false;
  setStatus("Recording. Stay on this tab and keep your screen on. Aim for 3 to 5 minutes.");
});

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== "inactive") mediaRecorder.stop();
}

stopBtn.addEventListener("click", stopRecording);

redoBtn.addEventListener("click", async () => {
  videoBlob = null;
  recorderError = null;
  preview.src = "";
  preview.controls = false;
  preview.muted = true;

  // Fresh getUserMedia so iOS doesn't reuse a stalled track.
  try {
    await startCamera({ fresh: true });
  } catch (err) {
    setStatus(err.message || "Couldn't restart the camera. Please reload the page.", "error");
    return;
  }

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
    stopMediaTracks();
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

window.addEventListener("beforeunload", () => {
  detachVisibilityWatcher();
  releaseWakeLock();
  stopMediaTracks();
});

init();

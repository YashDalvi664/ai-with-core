/* script.js — updated connectivity-only patch
   - All mandala / particle / chat functionality kept identical.
   - Enhanced backend connectivity logic:
     * auto-upgrade http:// -> https:// when page is https
     * probe /health and show an unobtrusive status banner with tips
     * settings UI to change backend & api key (saved to localStorage)
*/

const canvas = document.getElementById('aiBall');
const ctx = canvas.getContext('2d');

let cx, cy;
let bigRadius;
const particleCount = 450;
let particles = [];
let aiThinking = false;
let mouse = { x: -9999, y: -9999 };
let mandalaRotation = 0;
let mandalaProgress = 0;
const rings = 6;

// === CONNECTIVITY CONFIG (now dynamic) ===
// Default (safe local dev default). Override via:
//  1) URL query: ?backend=<BACKEND_URL>&apikey=<API_KEY>
//  2) localStorage keys: ULTRON_BACKEND and ULTRON_API_KEY
let DEFAULT_BACKEND_URL = "http://127.0.0.1:5001/api/chat";
let DEFAULT_API_KEY = "ULTRON_CLIENT_KEY_ABC";

// helper: read query params
function getQueryParams() {
  try {
    const search = window.location.search.substring(1);
    return Object.fromEntries(new URLSearchParams(search));
  } catch (e) {
    return {};
  }
}

const q = getQueryParams();
let BACKEND_URL = q.backend || localStorage.getItem('ULTRON_BACKEND') || DEFAULT_BACKEND_URL;
let API_KEY = q.apikey || localStorage.getItem('ULTRON_API_KEY') || DEFAULT_API_KEY;

// helper to compute origin (for resolving resume_url)
function backendOriginFrom(url) {
  try {
    const u = new URL(url);
    return u.origin;
  } catch (e) {
    return window.location.origin;
  }
}
let BACKEND_ORIGIN = backendOriginFrom(BACKEND_URL);

// small UI banner to show connection status & tips
function ensureStatusBanner() {
  if (document.getElementById('ultron-conn-banner')) return;
  const banner = document.createElement('div');
  banner.id = 'ultron-conn-banner';
  banner.style.position = 'fixed';
  banner.style.left = '50%';
  banner.style.transform = 'translateX(-50%)';
  banner.style.bottom = '84px';
  banner.style.zIndex = 9998;
  banner.style.padding = '8px 12px';
  banner.style.borderRadius = '10px';
  banner.style.boxShadow = '0 10px 30px rgba(0,0,0,0.12)';
  banner.style.background = '#fff7ed';
  banner.style.color = '#92400e';
  banner.style.fontSize = '13px';
  banner.style.display = 'none';
  banner.style.maxWidth = 'min(88%,720px)';
  banner.style.textAlign = 'left';
  banner.style.lineHeight = '1.25';
  banner.style.border = '1px solid rgba(0,0,0,0.04)';
  banner.style.fontFamily = 'system-ui, Arial, sans-serif';
  document.body.appendChild(banner);
}
function showStatusBanner(html, timeoutMs = 0) {
  ensureStatusBanner();
  const banner = document.getElementById('ultron-conn-banner');
  banner.innerHTML = html;
  banner.style.display = 'block';
  if (timeoutMs > 0) {
    setTimeout(() => { banner.style.display = 'none'; }, timeoutMs);
  }
}
function hideStatusBanner() {
  const banner = document.getElementById('ultron-conn-banner');
  if (banner) banner.style.display = 'none';
}

// Linear interpolation & easing
function lerp(a, b, t) { return a + (b - a) * t; }
function easeInOut(t) { return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t; }

// Initialize particles
function initParticles() {
  particles = [];
  const particlesPerRing = Math.floor(particleCount / rings) || 1;
  for (let r = 1; r <= rings; r++) {
    const radius = (bigRadius * 0.4) * r / rings;
    for (let i = 0; i < particlesPerRing; i++) {
      const angle = (2 * Math.PI * i) / particlesPerRing;
      const scatterAngle = Math.random() * 2 * Math.PI;
      const scatterRadius = Math.sqrt(Math.random()) * bigRadius;
      const phase = Math.random() * 2 * Math.PI;
      const speed = 0.001 + Math.random() * 0.002;

      particles.push({
        x: cx + Math.random() * 10 - 5,
        y: cy + Math.random() * 10 - 5,
        scatterAngle,
        scatterRadius,
        phase,
        speed,
        mandalaRadius: radius,
        mandalaAngle: angle,
        baseSize: 1.5
      });
    }
  }
}

// Resize canvas
function resizeCanvas() {
  const oldCx = cx || window.innerWidth / 2;
  const oldCy = cy || window.innerHeight / 2;
  const oldBigRadius = bigRadius || Math.min(oldCx, oldCy) * 0.45;

  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  cx = canvas.width / 2;
  cy = canvas.height / 4;
  bigRadius = Math.min(cx, cy) * 0.80;

  if (particles.length > 0) {
    const scaleX = cx / oldCx;
    const scaleY = cy / oldCy;
    const scaleR = bigRadius / oldBigRadius;
    for (let p of particles) {
      p.x = cx + (p.x - oldCx) * scaleX;
      p.y = cy + (p.y - oldCy) * scaleY;
      p.scatterRadius *= scaleR;
      p.mandalaRadius *= scaleR;
    }
  } else {
    initParticles();
  }
}

// Mouse events
canvas.addEventListener('mousemove', e => {
  mouse.x = e.clientX;
  mouse.y = e.clientY;
});
canvas.addEventListener('mouseleave', () => {
  mouse.x = -9999;
  mouse.y = -9999;
});

// Thinking / mandala helpers
let thinkingStartedAt = 0;
const MIN_THINK_MS = 1200; // minimum visible thinking time
const MANDALA_RAMP_FAST = 0.04; // ramp speed while thinking (bigger = faster)
const MANDALA_RAMP_SLOW = 0.01; // ramp speed while stopping

function startThinking() {
  aiThinking = true;
  thinkingStartedAt = performance.now();
}

function stopThinking() {
  const elapsed = performance.now() - thinkingStartedAt;
  const remain = Math.max(0, MIN_THINK_MS - elapsed);
  setTimeout(() => {
    aiThinking = false;
  }, remain);
}

// Animate particles
function animate(time) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // AI area subtle background circle
  ctx.beginPath();
  ctx.arc(cx, cy, bigRadius + 20, 0, 2 * Math.PI);
  const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, bigRadius + 60);
  gradient.addColorStop(0, "rgba(0, 200, 255, 0.3)");
  gradient.addColorStop(1, "rgba(0, 200, 255, 0)");
  ctx.fillStyle = gradient;
  ctx.fill();

  // Mandala progress & rotation
  if (aiThinking && mandalaProgress < 1) mandalaProgress = Math.min(1, mandalaProgress + MANDALA_RAMP_FAST);
  else if (!aiThinking && mandalaProgress > 0) mandalaProgress = Math.max(0, mandalaProgress - MANDALA_RAMP_SLOW);

  const easedProgress = easeInOut(Math.max(0, Math.min(1, mandalaProgress)));
  if (aiThinking) mandalaRotation += 0.012 * (1 + easedProgress);

  for (let p of particles) {
    p.scatterAngle += p.speed;

    let idleX = cx + p.scatterRadius * Math.cos(p.scatterAngle);
    let idleY = cy + p.scatterRadius * Math.sin(p.scatterAngle);

    let mandalaX = cx + p.mandalaRadius * Math.cos(p.mandalaAngle + mandalaRotation);
    let mandalaY = cy + p.mandalaRadius * Math.sin(p.mandalaAngle + mandalaRotation);

    let targetX = lerp(idleX, mandalaX, easedProgress);
    let targetY = lerp(idleY, mandalaY, easedProgress);

    const osc = Math.sin(time * 0.003 + p.phase) * 3 * (1 - easedProgress);
    targetX += osc;
    targetY += osc;

    if (!aiThinking) {
      const dx = p.x - mouse.x;
      const dy = p.y - mouse.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      if (dist < 120) {
        const force = (120 - dist) / 120 * 20;
        targetX += dx / dist * force;
        targetY += dy / dist * force;
      }
    }

    p.x = lerp(p.x, targetX, 0.05);
    p.y = lerp(p.y, targetY, 0.05);

    ctx.beginPath();
    ctx.arc(p.x, p.y, p.baseSize, 0, 2 * Math.PI);
    ctx.fillStyle = "#000";
    ctx.fill();
  }

  // Neural lines
  if (mandalaProgress > 0.05) {
    ctx.strokeStyle = "rgba(0,0,0,0.05)";
    ctx.lineWidth = 0.3;
    for (let i = 0; i < particles.length; i += 12) {
      for (let j = i + 1; j < particles.length; j += 12) {
        const dx = particles[i].x - particles[j].x;
        const dy = particles[i].y - particles[j].y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 60) {
          ctx.beginPath();
          ctx.moveTo(particles[i].x, particles[i].y);
          ctx.lineTo(particles[j].x, particles[j].y);
          ctx.stroke();
        }
      }
    }
  }

  requestAnimationFrame(animate);
}

// === CONNECTIVITY HELPERS ===

// health endpoint derived from BACKEND_URL
function healthUrlForBackend(url) {
  try {
    const u = new URL(url);
    // replace path with /health
    u.pathname = '/health';
    u.search = '';
    u.hash = '';
    return u.toString();
  } catch (e) {
    // fallback: try base origin + /health
    return (backendOriginFrom(url) + '/health');
  }
}

// probe backend /health and return {ok:boolean, json?, status:number, error?:string}
async function probeBackend(url, timeout = 3000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(healthUrlForBackend(url), { method: 'GET', mode: 'cors', signal: controller.signal });
    clearTimeout(id);
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      return { ok: false, status: res.status, error: txt || `status ${res.status}` };
    }
    const json = await res.json().catch(() => null);
    return { ok: true, status: res.status, json };
  } catch (err) {
    clearTimeout(id);
    // Distinguish common causes
    if (err.name === 'AbortError') return { ok: false, error: 'timeout' };
    return { ok: false, error: err.message || String(err) };
  }
}

// Upgrade http -> https when page is secure to avoid mixed-content
async function tryAutoUpgradeIfNeeded() {
  // only when page served over https and backend is http
  if (window.location.protocol === 'https:' && BACKEND_URL.startsWith('http://')) {
    const httpsCandidate = BACKEND_URL.replace(/^http:\/\//i, 'https://');
    // probe httpsCandidate
    const probe = await probeBackend(httpsCandidate, 2500);
    if (probe.ok) {
      BACKEND_URL = httpsCandidate;
      BACKEND_ORIGIN = backendOriginFrom(BACKEND_URL);
      localStorage.setItem('ULTRON_BACKEND', BACKEND_URL);
      showStatusBanner('Connected: upgraded backend to <code>https://</code>.', 3000);
      return true;
    } else {
      // if probe failed, likely blocked by mixed-content or cert issue — show banner with tips
      let tipHtml = `<strong>Backend unreachable from this HTTPS page.</strong> Browser may block HTTP backend (mixed-content).<br>`;
      tipHtml += `Try one of these: <ul style="margin:6px 0 4px 18px;padding:0">`;
      tipHtml += `<li>Set backend to an <code>https://</code> URL (e.g. <code>https://192.168.0.105:5001/api/chat</code>) and accept the certificate at its <a href="${healthUrlForBackend(BACKEND_URL)}" target="_blank" rel="noopener noreferrer">/health</a>.</li>`;
      tipHtml += `<li>Or test locally by serving the frontend on your laptop and using <code>http://127.0.0.1:5001/api/chat</code>.</li></ul>`;
      tipHtml += `Open the settings (⚙) to change the backend URL.`;
      showStatusBanner(tipHtml);
      return false;
    }
  }
  return true;
}

// Call this whenever settings change or on load
async function verifyBackendAndUpdateUI() {
  hideStatusBanner();
  BACKEND_ORIGIN = backendOriginFrom(BACKEND_URL);
  // try auto-upgrade if needed
  await tryAutoUpgradeIfNeeded();

  // probe actual BACKEND_URL
  const probe = await probeBackend(BACKEND_URL, 2500);
  if (probe.ok) {
    // good
    hideStatusBanner();
    return true;
  } else {
    // If we are on an HTTPS page and backend is HTTP, we know browser will block — show targeted banner
    if (window.location.protocol === 'https:' && BACKEND_URL.startsWith('http://')) {
      const tipHtml = `<strong>Mixed-content detected:</strong> This page is HTTPS but your backend is HTTP.<br>` +
        `Change backend to <code>https://...:5001/api/chat</code> (use your laptop IP) and accept the certificate at its <a href="${healthUrlForBackend(BACKEND_URL)}" target="_blank" rel="noopener noreferrer">/health</a>.`;
      showStatusBanner(tipHtml);
      return false;
    }

    // otherwise show generic unreachable banner with diagnostic
    let details = probe.error || `status ${probe.status || 'n/a'}`;
    const tipHtml = `<strong>Ultron backend unreachable:</strong> ${escapeHtml(details)}.<br>` +
      `Check server is running and backend URL is correct. Health: <code>${escapeHtml(healthUrlForBackend(BACKEND_URL))}</code>.<br>` +
      `Open settings (⚙) to edit backend & API key.`;
    showStatusBanner(tipHtml);
    return false;
  }
}

// small helper to escape HTML for banner
function escapeHtml(s) {
  if (!s) return '';
  return String(s).replace(/[&<>"']/g, function (m) {
    return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m];
  });
}

// === CHAT / BACKEND ===
async function sendToBackend(msg) {
  async function postTo(url) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: msg, apiKey: API_KEY, clientId: navigator.userAgent })
    });
    if (!res.ok) {
      let text = "";
      try { text = await res.text(); } catch (_) {}
      let body = null;
      try { body = JSON.parse(text || "{}"); } catch (_) {}
      const errMsg = body && body.error ? body.error : (text || `status ${res.status}`);
      const e = new Error(`Server error: ${errMsg}`);
      e.status = res.status;
      e.body = text;
      throw e;
    }
    return res.json();
  }

  // Try current BACKEND_URL first
  try {
    const data = await postTo(BACKEND_URL);
    const replyText = data.reply || data.text || "Ultron: (no response)";
    let resumeFullUrl = null;
    if (data.resume_url) {
      try { resumeFullUrl = new URL(data.resume_url, BACKEND_ORIGIN).toString(); } catch (e) { resumeFullUrl = data.resume_url; }
    }
    return { reply: replyText, resume_url: resumeFullUrl };
  } catch (err) {
    console.warn("Primary backend request failed:", err);

    // If page is HTTPS and backend was HTTP, try https upgrade automatically
    if (window.location.protocol === 'https:' && BACKEND_URL.startsWith('http://')) {
      const httpsCandidate = BACKEND_URL.replace(/^http:\/\//i, 'https://');
      try {
        const data = await postTo(httpsCandidate);
        // success: persist new url
        BACKEND_URL = httpsCandidate;
        BACKEND_ORIGIN = backendOriginFrom(BACKEND_URL);
        localStorage.setItem('ULTRON_BACKEND', BACKEND_URL);
        showStatusBanner('Connected: upgraded backend to <code>https://</code>.', 2200);
        const replyText = data.reply || data.text || "Ultron: (no response)";
        let resumeFullUrl = null;
        if (data.resume_url) {
          try { resumeFullUrl = new URL(data.resume_url, BACKEND_ORIGIN).toString(); } catch (e) { resumeFullUrl = data.resume_url; }
        }
        return { reply: replyText, resume_url: resumeFullUrl };
      } catch (err2) {
        console.warn("HTTPS fallback failed:", err2);
        // show mixed-content advice
        const health = healthUrlForBackend(BACKEND_URL);
        let help = "Ultron: Unable to reach backend.";
        if (window.location.protocol === "https:" && BACKEND_URL.startsWith("http://")) {
          help += " (Blocked by browser: this page is HTTPS but backend is HTTP — mixed-content.)";
          help += ` Tip: set backend to an <code>https://</code> URL (e.g. <code>https://192.168.0.105:5001/api/chat</code>) and accept the certificate at <a href="${health}" target="_blank" rel="noopener noreferrer">/health</a>.`;
        } else {
          help += " (See console for details.)";
        }
        showStatusBanner(help);
        return { reply: help };
      }
    }

    // Generic fallback message with helpful tips
    let help = "Ultron: Unable to reach backend.";
    if (err && err.message && err.message.toLowerCase().includes("server error")) {
      help += " (" + escapeHtml(err.message) + ")";
    } else {
      help += " (Check server, URL & API key).";
    }
    showStatusBanner(help);
    return { reply: help };
  }
}

// chat input handling
const chatMessages = document.getElementById("chatMessages");
const chatInput = document.getElementById("chatInput");

chatInput.addEventListener("keypress", e => {
  if (e.key === "Enter" && chatInput.value.trim() !== "") {
    const msg = chatInput.value.trim();
    addMessage("user", msg);
    chatInput.value = "";

    startThinking();

    sendToBackend(msg).then(result => {
      stopThinking();
      addMessage("ai", result.reply);

      if (result.resume_url) {
        const a = document.createElement("a");
        a.href = result.resume_url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.textContent = "Download resume";
        a.classList.add("resume-link");
        const div = document.createElement("div");
        div.classList.add("message", "ai", "resume");
        div.appendChild(a);
        chatMessages.appendChild(div);
        chatMessages.scrollTop = chatMessages.scrollHeight;
      }
    }).catch(err => {
      stopThinking();
      addMessage("ai", "Ultron: Something went wrong.");
      console.error(err);
    });
  }
});

function addMessage(sender, text) {
  const div = document.createElement("div");
  div.classList.add("message", sender);
  div.textContent = text;
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

/* -----------------------
   SETTINGS UI (ADDED)
   ----------------------- */

function createSettingsUI() {
  // container
  const container = document.createElement('div');
  container.id = 'ultron-settings';
  container.style.position = 'fixed';
  container.style.right = '18px';
  container.style.bottom = '18px';
  container.style.zIndex = '9999';
  container.style.fontFamily = 'system-ui,Arial, sans-serif';
  document.body.appendChild(container);

  // gear button
  const btn = document.createElement('button');
  btn.title = 'Ultron settings';
  btn.style.width = '48px';
  btn.style.height = '48px';
  btn.style.borderRadius = '12px';
  btn.style.border = 'none';
  btn.style.boxShadow = '0 6px 18px rgba(0,0,0,0.12)';
  btn.style.background = '#0ea5ff';
  btn.style.color = '#fff';
  btn.style.cursor = 'pointer';
  btn.style.display = 'flex';
  btn.style.alignItems = 'center';
  btn.style.justifyContent = 'center';
  btn.style.fontSize = '20px';
  btn.innerHTML = '⚙';
  container.appendChild(btn);

  // panel (hidden initially)
  const panel = document.createElement('div');
  panel.style.minWidth = '320px';
  panel.style.maxWidth = '520px';
  panel.style.padding = '12px';
  panel.style.borderRadius = '10px';
  panel.style.boxShadow = '0 10px 30px rgba(0,0,0,0.15)';
  panel.style.background = '#fff';
  panel.style.color = '#111';
  panel.style.marginBottom = '8px';
  panel.style.display = 'none';
  panel.style.flexDirection = 'column';
  panel.style.gap = '8px';
  panel.style.fontSize = '13px';
  panel.style.border = '1px solid rgba(0,0,0,0.06)';
  panel.style.boxSizing = 'border-box';
  container.appendChild(panel);

  // title
  const title = document.createElement('div');
  title.textContent = 'Ultron — Settings';
  title.style.fontWeight = '600';
  panel.appendChild(title);

  // backend url input
  const backendLabel = document.createElement('label');
  backendLabel.textContent = 'Backend URL';
  backendLabel.style.fontSize = '12px';
  panel.appendChild(backendLabel);

  const backendInput = document.createElement('input');
  backendInput.type = 'text';
  backendInput.value = BACKEND_URL || '';
  backendInput.placeholder = 'https://192.168.0.105:5001/api/chat';
  backendInput.style.width = '100%';
  backendInput.style.padding = '8px';
  backendInput.style.borderRadius = '6px';
  backendInput.style.border = '1px solid rgba(0,0,0,0.08)';
  panel.appendChild(backendInput);

  // api key input
  const apiLabel = document.createElement('label');
  apiLabel.textContent = 'Client API Key';
  apiLabel.style.fontSize = '12px';
  panel.appendChild(apiLabel);

  const apiInput = document.createElement('input');
  apiInput.type = 'text';
  apiInput.value = API_KEY || '';
  apiInput.placeholder = 'ULTRON_CLIENT_KEY_ABC';
  apiInput.style.width = '100%';
  apiInput.style.padding = '8px';
  apiInput.style.borderRadius = '6px';
  apiInput.style.border = '1px solid rgba(0,0,0,0.08)';
  panel.appendChild(apiInput);

  // buttons row
  const row = document.createElement('div');
  row.style.display = 'flex';
  row.style.gap = '8px';
  row.style.marginTop = '6px';
  panel.appendChild(row);

  const saveBtn = document.createElement('button');
  saveBtn.textContent = 'Save';
  saveBtn.style.flex = '1';
  saveBtn.style.padding = '8px 10px';
  saveBtn.style.borderRadius = '8px';
  saveBtn.style.border = 'none';
  saveBtn.style.cursor = 'pointer';
  saveBtn.style.background = '#10b981';
  saveBtn.style.color = '#fff';
  row.appendChild(saveBtn);

  const resetBtn = document.createElement('button');
  resetBtn.textContent = 'Reset';
  resetBtn.style.flex = '1';
  resetBtn.style.padding = '8px 10px';
  resetBtn.style.borderRadius = '8px';
  resetBtn.style.border = '1px solid rgba(0,0,0,0.08)';
  resetBtn.style.cursor = 'pointer';
  resetBtn.style.background = '#fff';
  resetBtn.style.color = '#111';
  row.appendChild(resetBtn);

  const closeBtn = document.createElement('button');
  closeBtn.textContent = 'Close';
  closeBtn.style.padding = '8px 10px';
  closeBtn.style.borderRadius = '8px';
  closeBtn.style.border = 'none';
  closeBtn.style.cursor = 'pointer';
  closeBtn.style.background = '#64748b';
  closeBtn.style.color = '#fff';
  row.appendChild(closeBtn);

  // small helper text
  const hint = document.createElement('div');
  hint.style.fontSize = '12px';
  hint.style.color = '#6b7280';
  hint.textContent = 'You can also set backend & key via URL query parameters or console.';
  panel.appendChild(hint);

  // events
  btn.addEventListener('click', () => {
    panel.style.display = panel.style.display === 'none' ? 'flex' : 'none';
  });

  closeBtn.addEventListener('click', () => {
    panel.style.display = 'none';
  });

  saveBtn.addEventListener('click', async () => {
    const newBackend = backendInput.value.trim();
    const newKey = apiInput.value.trim();
    if (newBackend) {
      localStorage.setItem('ULTRON_BACKEND', newBackend);
      BACKEND_URL = newBackend;
      BACKEND_ORIGIN = backendOriginFrom(BACKEND_URL);
    } else {
      localStorage.removeItem('ULTRON_BACKEND');
      BACKEND_URL = DEFAULT_BACKEND_URL;
      BACKEND_ORIGIN = backendOriginFrom(BACKEND_URL);
    }
    if (newKey) {
      localStorage.setItem('ULTRON_API_KEY', newKey);
      API_KEY = newKey;
    } else {
      localStorage.removeItem('ULTRON_API_KEY');
      API_KEY = DEFAULT_API_KEY;
    }

    // verify new settings and inform user
    const ok = await verifyBackendAndUpdateUI();
    if (ok) {
      saveBtn.textContent = 'Saved ✓';
    } else {
      saveBtn.textContent = 'Saved (unreachable)';
    }
    setTimeout(() => (saveBtn.textContent = 'Save'), 1400);
  });

  resetBtn.addEventListener('click', async () => {
    localStorage.removeItem('ULTRON_BACKEND');
    localStorage.removeItem('ULTRON_API_KEY');
    backendInput.value = DEFAULT_BACKEND_URL;
    apiInput.value = DEFAULT_API_KEY;
    BACKEND_URL = DEFAULT_BACKEND_URL;
    API_KEY = DEFAULT_API_KEY;
    BACKEND_ORIGIN = backendOriginFrom(BACKEND_URL);
    const ok = await verifyBackendAndUpdateUI();
    resetBtn.textContent = ok ? 'Reset ✓' : 'Reset (unreachable)';
    setTimeout(() => (resetBtn.textContent = 'Reset'), 900);
  });

  // prefill inputs from storage (in case changed after script load)
  backendInput.value = localStorage.getItem('ULTRON_BACKEND') || BACKEND_URL || '';
  apiInput.value = localStorage.getItem('ULTRON_API_KEY') || API_KEY || '';
}

// Initialize
resizeCanvas();
initParticles();
animate(0);
window.addEventListener('resize', resizeCanvas);

// create settings ui after mount
createSettingsUI();

// Do a connectivity check on load (but don't spam)
setTimeout(() => {
  verifyBackendAndUpdateUI().catch((e) => {
    console.warn("verifyBackendAndUpdateUI failed:", e);
  });
}, 400);

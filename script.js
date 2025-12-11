/* updated script.js - mandala thinking reliably visible + backend call
   Connectivity patch: query/localStorage backend + API key, resume link handling.
   (Everything else unchanged.)
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
// Default (kept for backwards compatibility). You can override via:
// 1) URL query: ?backend=<BACKEND_URL>&apikey=<API_KEY>
// 2) localStorage keys: ULTRON_BACKEND and ULTRON_API_KEY
let DEFAULT_BACKEND_URL = "https://shanta-unreared-richie.ngrok-free.dev/api/chat";
let DEFAULT_API_KEY = "ULTRON_TEST_KEY_123";

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
const BACKEND_URL = q.backend || localStorage.getItem('ULTRON_BACKEND') || DEFAULT_BACKEND_URL;
const API_KEY = q.apikey || localStorage.getItem('ULTRON_API_KEY') || DEFAULT_API_KEY;

// helper: compute backend origin (for resolving relative resume_url)
function backendOriginFrom(url) {
  try {
    const u = new URL(url);
    return u.origin;
  } catch (e) {
    // if url is relative or invalid, fall back to current origin
    return window.location.origin;
  }
}
const BACKEND_ORIGIN = backendOriginFrom(BACKEND_URL);

// Chat elements
const chatMessages = document.getElementById("chatMessages");
const chatInput = document.getElementById("chatInput");

// Linear interpolation
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
  // make mandala progress increase faster immediately for visible effect
}

function stopThinking() {
  // ensure minimum visible thinking time
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

  // Mandala animation progress with faster ramp when thinking
  if (aiThinking && mandalaProgress < 1) mandalaProgress = Math.min(1, mandalaProgress + MANDALA_RAMP_FAST);
  else if (!aiThinking && mandalaProgress > 0) mandalaProgress = Math.max(0, mandalaProgress - MANDALA_RAMP_SLOW);

  const easedProgress = easeInOut(Math.max(0, Math.min(1, mandalaProgress)));
  if (aiThinking) mandalaRotation += 0.012 * (1 + easedProgress); // faster rotation while thinking

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

  // Neural lines (visible when mandala appears)
  if (mandalaProgress > 0.05) {
    ctx.strokeStyle = "rgba(0,0,0,0.05)";
    ctx.lineWidth = 0.3;
    // sample connections to reduce cost
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

// === CHAT / BACKEND ===
async function sendToBackend(msg) {
  try {
    const res = await fetch(BACKEND_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: msg, apiKey: API_KEY, clientId: navigator.userAgent })
    });
    if (!res.ok) {
      // try to parse error body
      let errBody = "";
      try { errBody = await res.text(); } catch (_) {}
      console.error("Server error:", res.status, errBody);
      return { reply: `Ultron: (backend error ${res.status})` };
    }
    const data = await res.json();
    // data may be { reply } or { text } and may include resume_url
    const replyText = data.reply || data.text || "Ultron: (no response)";
    // normalize resume url: if backend returns "resume_url" relative, convert to absolute
    let resumeFullUrl = null;
    if (data.resume_url) {
      try {
        // if resume_url is absolute, new URL will parse it. If relative, base it on backend origin.
        resumeFullUrl = new URL(data.resume_url, BACKEND_ORIGIN).toString();
      } catch (e) {
        resumeFullUrl = data.resume_url;
      }
    }
    return { reply: replyText, resume_url: resumeFullUrl };
  } catch (e) {
    console.error("Backend fetch failed:", e);
    return { reply: "Ultron: Unable to reach backend." };
  }
}

chatInput.addEventListener("keypress", e => {
  if (e.key === "Enter" && chatInput.value.trim() !== "") {
    const msg = chatInput.value.trim();
    addMessage("user", msg);
    chatInput.value = "";

    // Start thinking visually
    startThinking();

    // Call backend but do not block main thread — handle reply in .then()
    // This ensures the render loop keeps running immediately.
    sendToBackend(msg).then(result => {
      // Guarantee min thinking time before stopping
      stopThinking();
      // Show AI message (same feeling as before)
      addMessage("ai", result.reply);

      // If backend returned a resume URL, add a download link under the AI message
      if (result.resume_url) {
        const a = document.createElement("a");
        a.href = result.resume_url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.textContent = "Download resume";
        a.classList.add("resume-link");
        // attach small stub message so it scrolls into view
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

// Initialize
resizeCanvas();
initParticles();
animate(0);
window.addEventListener('resize', resizeCanvas);

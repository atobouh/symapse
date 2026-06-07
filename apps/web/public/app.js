const apiBase = (window.__SYMAPSE_API_BASE__ && window.__SYMAPSE_API_BASE__ !== "__SYMAPSE_API_BASE__")
  ? window.__SYMAPSE_API_BASE__
  : "http://localhost:4580";

const state = {
  lines: [],
  currentStatus: null,
  currentTarget: "loading...",
  currentView: "boot",
  currentDeadCount: 0,
  seenEvents: new Set(),
  clientId: `ui-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`
};

const els = {
  output: document.getElementById("terminal-output"),
  map: document.getElementById("terminal-map"),
  status: document.getElementById("terminal-status"),
  target: document.getElementById("terminal-target"),
  form: document.getElementById("terminal-form"),
  input: document.getElementById("terminal-input")
};

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatTime(iso = new Date().toISOString()) {
  return new Date(iso).toLocaleTimeString([], { hour12: false });
}

function clamp(value, limit = 120) {
  const text = String(value ?? "");
  return text.length > limit ? `${text.slice(0, limit - 3)}...` : text;
}

function countLabel(count, singular, plural = `${singular}s`) {
  const total = Number(count || 0);
  return `${total} ${total === 1 ? singular : plural}`;
}

function setStatus(kind, text) {
  const tone = kind === "ok" ? "status-ok" : kind === "warn" ? "status-warn" : kind === "bad" ? "status-bad" : "status-neutral";
  els.status.className = `status-pill ${tone}`;
  els.status.textContent = text;
}

function updateHeader() {
  const status = state.currentStatus;
  const summary = status?.summary ?? {};
  const target = status?.targetPath || status?.repoRoot || state.currentTarget || "loading...";

  state.currentTarget = target;
  els.target.textContent = `target: ${clamp(target, 72)}`;

  if (status?.indexing) {
    setStatus("warn", "indexing");
  } else if (status?.indexError) {
    setStatus("bad", "index error");
  } else if (status) {
    setStatus("ok", "ready");
  } else {
    setStatus("neutral", "booting");
  }

  document.title = `Symapse // ${countLabel(summary.fileCount, "file")} | ${countLabel(summary.symbolCount, "symbol")} | ${countLabel(summary.edgeCount, "edge")}`;
}

function buildAsciiMap() {
  const status = state.currentStatus;
  const summary = status?.summary ?? {};
  const dead = state.currentDeadCount || 0;
  const target = state.currentTarget || "unknown";
  const view = state.currentView.toUpperCase();

  return [
    "+------------------------------------------------------+",
    `| VIEW    : ${clamp(view, 44).padEnd(44, " ")}|`,
    `| TARGET  : ${clamp(target, 44).padEnd(44, " ")}|`,
    `| FILES   : ${String(summary.fileCount ?? 0).padEnd(44, " ")}|`,
    `| SYMBOLS : ${String(summary.symbolCount ?? 0).padEnd(44, " ")}|`,
    `| EDGES   : ${String(summary.edgeCount ?? 0).padEnd(44, " ")}|`,
    `| DEAD    : ${String(dead).padEnd(44, " ")}|`,
    `| INDEX   : ${(status?.indexing ? "YES" : "NO").padEnd(44, " ")}|`,
    "+------------------------------------------------------+"
  ].join("\n");
}

function updateMap() {
  els.map.textContent = buildAsciiMap();
}

function renderOutput() {
  const html = state.lines.length
    ? state.lines.map((line) => `
        <div class="terminal-line level-${escapeHtml(line.level)}">
          <span class="line-time">${escapeHtml(line.time)}</span>
          <span class="line-tag">${escapeHtml(line.tag)}</span>
          <pre class="line-text ${escapeHtml(line.level)}">${escapeHtml(line.text)}</pre>
        </div>
      `).join("")
    : '<div class="terminal-empty">type <span>help</span> to begin.</div>';

  els.output.innerHTML = html;
  els.output.scrollTop = els.output.scrollHeight;
}

function appendLine(level, tag, text, time = new Date().toISOString()) {
  state.lines.push({ level, tag, text, time });
  if (state.lines.length > 240) {
    state.lines = state.lines.slice(-240);
  }
  renderOutput();
}

function clearOutput() {
  state.lines = [];
  renderOutput();
}

function parseCommand(text) {
  const tokens = [];
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match;
  while ((match = pattern.exec(String(text || ""))) !== null) {
    tokens.push(match[1] ?? match[2] ?? match[3]);
  }
  return tokens;
}

async function api(path, init = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    headers: {
      ...(init.headers || {})
    },
    ...init
  });

  const raw = await response.text();
  let payload = null;
  try {
    payload = raw ? JSON.parse(raw) : null;
  } catch {
    payload = raw;
  }

  if (!response.ok) {
    const message = payload?.message || payload?.error || `Request failed (${response.status})`;
    throw new Error(message);
  }

  return payload;
}

function applyEvent(event) {
  if (!event || state.seenEvents.has(event.id)) {
    return;
  }

  state.seenEvents.add(event.id);

  if (event.view) {
    state.currentView = event.view;
  }

  if (event.view === "status" && event.data) {
    state.currentStatus = event.data;
    state.currentDeadCount = 0;
    updateHeader();
    updateMap();
  } else if (event.view === "target" && event.data?.targetPath) {
    state.currentTarget = event.data.targetPath;
    updateHeader();
    updateMap();
  } else if (event.view === "deadcode" && event.data) {
    state.currentDeadCount = Number(event.data.totalCandidates || event.data.candidates?.length || 0);
    updateMap();
  }

  if (event.type === "clear") {
    clearOutput();
    return;
  }

  const tag = event.tag || (event.level === "ok" ? "OK" : event.level === "warn" ? "WARN" : event.level === "bad" ? "ERR" : "ACTION");
  const text = event.detail ? `${event.text}\n${event.detail}` : event.text;
  appendLine(event.level || "action", tag, text, event.time);
  updateHeader();
  updateMap();
}

function connectEvents() {
  const source = new EventSource(`${apiBase}/events`);
  source.addEventListener("line", (message) => applyEvent(JSON.parse(message.data)));
  source.addEventListener("block", (message) => applyEvent(JSON.parse(message.data)));
  source.addEventListener("clear", (message) => applyEvent(JSON.parse(message.data)));
  source.onerror = () => {
    setStatus("warn", "stream offline");
  };
}

async function sendCommand(command) {
  const raw = String(command || "").trim();
  if (!raw) {
    return;
  }

  const result = await api("/command", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      command: raw,
      clientId: state.clientId
    })
  });

  for (const event of result.events || []) {
    applyEvent(event);
  }

  if (result.data && result.view === "status") {
    state.currentStatus = result.data;
    updateHeader();
    updateMap();
  }

  if (result.data && result.view === "target" && result.data.targetPath) {
    state.currentTarget = result.data.targetPath;
    updateHeader();
    updateMap();
  }

  if (result.data && result.view === "deadcode") {
    state.currentDeadCount = Number(result.data.totalCandidates || result.data.candidates?.length || 0);
    updateMap();
  }
}

function seedConsole() {
  clearOutput();
  appendLine("action", "ACTION", "symapse terminal ready");
  appendLine("action", "ACTION", "type help to inspect the repo");
  updateMap();
}

async function boot() {
  seedConsole();
  updateHeader();
  connectEvents();
  els.input.focus();

  try {
    await sendCommand("status");
    await sendCommand("help");
  } catch (error) {
    appendLine("bad", "ERR", `boot failed: ${error.message}`);
  }
}

els.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const value = els.input.value;
  els.input.value = "";
  try {
    await sendCommand(value);
  } catch (error) {
    appendLine("bad", "ERR", error.message || "command failed");
  }
  els.input.focus();
});

els.input.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    els.input.value = "";
    return;
  }

  if (event.key === "ArrowUp" || event.key === "ArrowDown") {
    event.preventDefault();
  }
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && document.activeElement !== els.input) {
    els.input.focus();
  }
});

boot();

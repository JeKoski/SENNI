// companion-memory.js — Companion settings: Memory tab
// Loaded after companion.js.
//
// Exports used by companion.js:
//   cpMemoryInit()           — called when Memory tab is opened
//   cpMemoryPopulate()       — called from cpPopulate() on window open
//   _cpGetMemoryPayload()    — called by cpSave() to include cognitive_stack in save body

let _cpMemoryInitDone = false;

// ── Init ──────────────────────────────────────────────────────────────────────

async function cpMemoryInit() {
  if (_cpMemoryInitDone) return;
  _cpMemoryInitDone = true;
  await _cpMemoryRefreshStatus();
}

function cpMemoryReset() {
  _cpMemoryInitDone = false;
}

// ── Status fetch ──────────────────────────────────────────────────────────────

async function _cpMemoryRefreshStatus() {
  const statusEl  = document.getElementById('cp-mem-status-text');
  const countEl   = document.getElementById('cp-mem-note-count');
  const consEl    = document.getElementById('cp-mem-consolidated');
  const pendingEl = document.getElementById('cp-mem-pending');

  try {
    const res  = await fetch('/api/memory/status');
    const data = await res.json();

    if (!data.available) {
      if (statusEl) {
        const reason = data.reason === 'memory_disabled'   ? 'Disabled'
                     : data.reason === 'memory_unavailable' ? 'ChromaDB not installed'
                     : 'Not initialised';
        statusEl.textContent = reason;
        statusEl.style.color = data.reason === 'memory_disabled'
          ? 'rgba(221,225,240,0.4)'
          : 'var(--red, #f87171)';
      }
      if (countEl)   countEl.textContent   = '—';
      if (consEl)    consEl.textContent    = '—';
      if (pendingEl) pendingEl.textContent = '';
      return;
    }

    if (statusEl) {
      statusEl.textContent = 'Active';
      statusEl.style.color = 'var(--green, #86efac)';
    }
    if (countEl) countEl.textContent = data.note_count ?? 0;

    if (consEl) {
      if (data.last_consolidated_at) {
        const d = new Date(data.last_consolidated_at);
        consEl.textContent = d.toLocaleDateString(undefined, {
          month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
        });
      } else {
        consEl.textContent = 'Never';
      }
    }

    if (pendingEl) {
      const p = data.pending_llm_consolidation || 0;
      pendingEl.textContent = p > 0 ? `${p} pending LLM pass` : '';
    }

    // Update stack initialised warning
    _cpMemoryUpdateStackWarning(data.stack_initialised);

  } catch {
    if (statusEl) {
      statusEl.textContent = 'Unavailable';
      statusEl.style.color = 'rgba(221,225,240,0.4)';
    }
  }
}

// ── Populate from settings ────────────────────────────────────────────────────

function cpMemoryPopulate() {
  const cfg     = cpSettings || {};
  const memGlobal = cfg.config?.memory || {};
  const companion = cfg.active_companion || {};
  const stack     = companion.cognitive_stack || {};

  // Global memory enabled toggle
  const togEl = document.getElementById('cp-mem-enabled');
  if (togEl) togEl.classList.toggle('on', !!memGlobal.enabled);

  // session_start_k and mid_convo_k
  const skEl = document.getElementById('cp-mem-session-k');
  const mkEl = document.getElementById('cp-mem-mid-k');
  if (skEl) skEl.value = memGlobal.session_start_k ?? 6;
  if (mkEl) mkEl.value = memGlobal.mid_convo_k     ?? 4;

  // Cognitive stack slots
  const slots = stack.slots || [
    { position: 1, charge: 'm', function: 'T', polarity: null },
    { position: 2, charge: 'f', function: 'S', polarity: null },
    { position: 3, charge: 'm', function: 'N', polarity: null },
    { position: 4, charge: 'f', function: 'F', polarity: null },
  ];

  slots.forEach((slot, i) => {
    const pos     = i + 1;
    const chargeEl = document.getElementById(`cp-stack-charge-${pos}`);
    const funcEl   = document.getElementById(`cp-stack-func-${pos}`);
    if (chargeEl) chargeEl.value = slot.charge || 'm';
    if (funcEl)   funcEl.value   = slot.function || 'T';
  });

  _cpMemoryUpdateStackWarning(stack.stack_initialised);
  _cpMemoryUpdateStackPreview();
}

// ── Stack display helpers ─────────────────────────────────────────────────────

function _cpMemoryUpdateStackWarning(initialised) {
  const warn = document.getElementById('cp-stack-uninit-warn');
  if (!warn) return;
  warn.style.display = initialised ? 'none' : 'block';
}

function _cpMemoryUpdateStackPreview() {
  const previewEl = document.getElementById('cp-stack-preview');
  if (!previewEl) return;

  const parts = [];
  for (let pos = 1; pos <= 4; pos++) {
    const charge = document.getElementById(`cp-stack-charge-${pos}`)?.value || 'm';
    const func   = document.getElementById(`cp-stack-func-${pos}`)?.value   || '?';
    parts.push(charge + func);
  }
  previewEl.textContent = parts.join('-');
}

// ── Save memory global settings ───────────────────────────────────────────────

async function cpMemorySaveGlobal() {
  const enabled  = document.getElementById('cp-mem-enabled')?.classList.contains('on') ?? false;
  const sessionK = parseInt(document.getElementById('cp-mem-session-k')?.value) || 6;
  const midK     = parseInt(document.getElementById('cp-mem-mid-k')?.value)     || 4;

  try {
    const res = await fetch('/api/settings/memory', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ enabled, session_start_k: sessionK, mid_convo_k: midK }),
    });
    const data = await res.json();
    if (data.ok) {
      // Update local cache
      if (cpSettings?.config) {
        cpSettings.config.memory = {
          ...(cpSettings.config.memory || {}),
          enabled,
          session_start_k: sessionK,
          mid_convo_k:     midK,
        };
      }
      cpShowToast('Memory settings saved ✓');
      await _cpMemoryRefreshStatus();
    } else {
      cpShowToast('Save failed ✗');
    }
  } catch (e) {
    cpShowToast('Save failed ✗');
    console.warn('cpMemorySaveGlobal error:', e);
  }
}

// ── Payload for cpSave() ─────────────────────────────────────────────────────

function _cpGetMemoryPayload() {
  const slots = [];
  const funcs = ['T', 'S', 'N', 'F'];  // defaults per position

  for (let pos = 1; pos <= 4; pos++) {
    const charge = document.getElementById(`cp-stack-charge-${pos}`)?.value || 'm';
    const func   = document.getElementById(`cp-stack-func-${pos}`)?.value   || funcs[pos - 1];
    slots.push({ position: pos, charge, function: func, polarity: null });
  }

  return {
    cognitive_stack: {
      slots,
      stack_initialised: true,  // user has explicitly set it via this UI
    },
  };
}

// heartbeat.js — Autonomous companion turns (silent tool use and/or unprompted messages)
// Depends on: chat.js, chat-ui.js, chat-tabs.js

// ── State ─────────────────────────────────────────────────────────────────────
let _hbPollInterval  = null;   // setInterval handle for idle polling
let _hbLastActivity  = Date.now();
let _hbRunning       = false;
let _hbFiredTriggers = new Set(); // prevent context threshold firing repeatedly
let _hbAbortCtrl     = null;   // AbortController for in-flight heartbeat generation

// ── Config accessor ───────────────────────────────────────────────────────────
function _hbCfg() {
  return config?.active_heartbeat || {};
}

function _hbEnabled() {
  const c = _hbCfg();
  return c.silent_enabled || c.message_enabled;
}

// Returns the instructions for a specific trigger, falling back to default
function _hbInstructions(trigger) {
  const instr = _hbCfg().instructions;
  if (!instr) return '';
  if (typeof instr === 'string') return instr; // legacy flat string
  return (instr[trigger] && instr[trigger].trim()) ? instr[trigger].trim()
       : (instr.default  && instr.default.trim())  ? instr.default.trim()
       : '';
}

// ── Initialise / re-initialise ────────────────────────────────────────────────
function heartbeatInit() {
  heartbeatStop();

  // Show or hide manual trigger button based on enabled state
  const manBtn = document.getElementById('hb-manual-btn');
  if (manBtn) manBtn.style.display = _hbEnabled() ? '' : 'none';

  if (!_hbEnabled()) return;

  const c = _hbCfg();

  // Use setInterval + timestamp comparison instead of setTimeout.
  // This works correctly across background tabs — when the tab becomes
  // visible again we check if idle time elapsed and fire immediately.
  if (c.idle_trigger && c.idle_minutes > 0) {
    // Poll every 30 seconds
    _hbPollInterval = setInterval(_hbIdlePoll, 30_000);

    // Reset activity time when user interacts with the SENNI tab
    document.addEventListener('keydown',    _hbOnActivity, { passive: true });
    document.addEventListener('mousedown',  _hbOnActivity, { passive: true });
    document.addEventListener('touchstart', _hbOnActivity, { passive: true });

    // When tab becomes visible, check immediately if idle threshold elapsed
    document.addEventListener('visibilitychange', _hbOnVisibilityChange);
  }

  // Reset context threshold guard on init
  _hbFiredTriggers.delete('context_threshold');

  console.log('[heartbeat] initialised, enabled:', c.silent_enabled, '/', c.message_enabled);
}

function heartbeatStop() {
  if (_hbPollInterval) { clearInterval(_hbPollInterval); _hbPollInterval = null; }
  document.removeEventListener('keydown',           _hbOnActivity);
  document.removeEventListener('mousedown',         _hbOnActivity);
  document.removeEventListener('touchstart',        _hbOnActivity);
  document.removeEventListener('visibilitychange',  _hbOnVisibilityChange);
}

function _hbOnActivity() {
  _hbLastActivity = Date.now();
}

function _hbIdlePoll() {
  if (document.hidden) return; // wait until tab is visible to fire
  const c       = _hbCfg();
  const minutes = c.idle_minutes || 15;
  const elapsed = (Date.now() - _hbLastActivity) / 60_000;
  if (elapsed >= minutes) {
    _hbLastActivity = Date.now(); // reset so it doesn't fire every 30s
    heartbeatFire('idle');
  }
}

function _hbOnVisibilityChange() {
  if (!document.hidden) {
    // Tab just became visible — run the poll immediately
    _hbIdlePoll();
  }
}

// ── External trigger points ───────────────────────────────────────────────────
function heartbeatOnConversationEnd() {
  if (_hbEnabled() && _hbCfg().conversation_end_trigger) {
    heartbeatFire('conversation_end');
  }
}

function heartbeatOnSessionStart() {
  if (_hbEnabled() && _hbCfg().session_start_trigger) {
    heartbeatFire('session_start');
  }
}

function heartbeatOnContextThreshold(pct) {
  const c = _hbCfg();
  if (!_hbEnabled() || !c.context_threshold_trigger) return;
  if (pct < (c.context_threshold_pct || 75)) return;
  if (_hbFiredTriggers.has('context_threshold')) return; // don't spam
  _hbFiredTriggers.add('context_threshold');
  heartbeatFire('context_threshold');
}

// Called when context is cleared — allow threshold to fire again next time
function heartbeatResetThreshold() {
  _hbFiredTriggers.delete('context_threshold');
}

// Manual trigger — sidebar ✦ button
async function heartbeatManual() {
  if (!_hbEnabled()) {
    appendSystemNote('Heartbeat is disabled. Enable it in Settings > Companion.');
    return;
  }
  await heartbeatFire('manual');
}

// ── Core: run one heartbeat turn ──────────────────────────────────────────────
async function heartbeatFire(trigger) {
  if (_hbRunning) { console.log('[heartbeat] already running, skipping'); return; }
  if (isSending)  { console.log('[heartbeat] user is sending, deferring'); return; }
  if (!config.model_running) {
    console.log('[heartbeat] model not running, skipping (config.model_running=', config.model_running, ')');
    return;
  }

  const c = _hbCfg();
  console.log('[heartbeat] fire check — silent:', c.silent_enabled, 'message:', c.message_enabled, 'trigger:', trigger);
  if (!c.silent_enabled && !c.message_enabled) {
    console.log('[heartbeat] neither mode enabled, skipping');
    return;
  }

  _hbRunning = true;
  console.log('[heartbeat] firing, trigger:', trigger);

  // Insert a purple event pill so the user knows a heartbeat turn is starting
  const pill = _appendHeartbeatPill(trigger);

  // Show stop button so the user can cancel heartbeat generation
  if (typeof showStopButton === 'function') showStopButton();

  // Set orb to heartbeat state for the duration of this turn
  if (typeof setPresenceState === 'function') setPresenceState('heartbeat');

  // Create an AbortController — stopGeneration() in chat-controls.js will
  // reach _hbAbortCtrl via the typeof guard added there.
  _hbAbortCtrl = new AbortController();

  try {
    const prompt   = _buildHeartbeatPrompt(trigger);
    const history  = _buildHeartbeatHistory();
    const response = await callModel(prompt, history, _hbAbortCtrl.signal);

    if (response && response.trim()) {
      const text = response.trim();
      const skip = text === '[skip]' || text.toLowerCase() === '[skip]';

      // No output — remove the pill and any streamed bubble
      if (skip) {
        if (pill) pill.remove();
        // Streaming renders the bubble before we can check for [skip], so remove it
        if (typeof streamWasRendered === 'function' && streamWasRendered()) {
          const rows = document.querySelectorAll('.msg-row.companion');
          if (rows.length) rows[rows.length - 1].remove();
          // Pop the history entry streaming added
          if (conversationHistory?.length &&
              conversationHistory[conversationHistory.length - 1].role === 'assistant') {
            conversationHistory.pop();
          }
        }
      }

      if (c.message_enabled && !skip) {
        // callModel → _streamFinalReply already rendered the bubble and pushed
        // to conversationHistory if streaming ran. Check the flag before adding
        // a second bubble or a second history entry.
        if (typeof streamWasRendered === 'function' && streamWasRendered()) {
          // Bubble already in DOM — just annotate it with the heartbeat meta
          _annotateLastBubbleAsHeartbeat(trigger);
        } else {
          // Non-streaming fallback: render the bubble ourselves
          _appendHeartbeatMessage(text, trigger);
          conversationHistory.push({ role: 'assistant', content: text });
        }
        // Save the tab state once, after everything is settled
        _saveCurrentTabState();
        if (typeof saveTabs === 'function') saveTabs();

      } else if (c.silent_enabled && !skip) {
        // Silent mode: tools have already run, just log a timestamped note
        appendSystemNote('\u2736 ' + _triggerLabel(trigger) + ' \u2014 ' +
          new Date().toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' }));
        _saveCurrentTabState();
        if (typeof saveTabs === 'function') saveTabs();
      }
    } else if (pill) {
      // No response at all — clean up the pill
      pill.remove();
    }
  } catch(e) {
    if (e.name === 'AbortError') {
      console.log('[heartbeat] aborted by user');
    } else {
      console.warn('[heartbeat] error:', e);
    }
    if (pill) pill.remove();
  }

  _hbAbortCtrl = null;

  // Restore orb to idle and hide stop button
  if (typeof setPresenceState === 'function') setPresenceState('idle');
  if (typeof hideStopButton === 'function') hideStopButton();
  _hbRunning = false;
}

// ── System prompt for heartbeat ───────────────────────────────────────────────
function _buildHeartbeatPrompt(trigger) {
  const c    = _hbCfg();
  let p      = buildSystemPrompt('chat');

  p += '\n\n--- HEARTBEAT TURN ---';
  p += '\nThis is an autonomous turn, not a reply to a user message.';
  p += '\nTrigger: ' + _triggerLabel(trigger);

  if (c.silent_enabled && !c.message_enabled) {
    p += '\nMode: SILENT -- use tools only. Do NOT write a conversational reply.';
  } else if (c.message_enabled && !c.silent_enabled) {
    p += '\nMode: MESSAGE -- you may send one brief, natural message to the user.';
  } else {
    p += '\nMode: TOOLS + MESSAGE -- use tools as needed, then optionally send a brief message.';
  }

  const instr = _hbInstructions(trigger);
  if (instr) p += '\n\nInstructions for this turn:\n' + instr;

  p += '\n\nIf you have nothing meaningful to do, respond with exactly: [skip]';
  return p;
}

function _buildHeartbeatHistory() {
  const recent = (conversationHistory || []).slice(-10);
  if (!recent.length) return [{ role: 'user', content: '[heartbeat]' }];
  if (recent[recent.length - 1].role === 'assistant') {
    return [...recent, { role: 'user', content: '[heartbeat]' }];
  }
  return recent;
}

// ── Heartbeat message rendering ───────────────────────────────────────────────

// Called when the stream already rendered the bubble — we just add the
// heartbeat identity (class, meta line) to the existing last companion row.
function _annotateLastBubbleAsHeartbeat(trigger) {
  const list = document.getElementById('messages');
  if (!list) return;
  // Walk backwards to find the last companion msg-row
  let targetRow = null;
  for (let i = list.children.length - 1; i >= 0; i--) {
    const el = list.children[i];
    if (el.classList.contains('msg-row') && el.classList.contains('companion')) {
      targetRow = el;
      break;
    }
  }
  if (!targetRow) return;

  targetRow.classList.add('heartbeat-msg');
  targetRow.querySelector('.bubble')?.classList.add('heartbeat-bubble');

  // Replace or augment the timestamp with the heartbeat meta
  const existingTime = targetRow.querySelector('.msg-time');
  const metaText = '\u2736 ' + _triggerLabel(trigger) + ' \u00b7 ' +
    new Date().toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
  if (existingTime) {
    existingTime.classList.add('heartbeat-meta');
    existingTime.textContent = metaText;
  } else {
    const meta = document.createElement('div');
    meta.className   = 'msg-time heartbeat-meta';
    meta.textContent = metaText;
    targetRow.querySelector('div')?.appendChild(meta);
  }
}

function _appendHeartbeatPill(trigger) {
  const list = document.getElementById('messages');
  if (!list) return null;
  const pill = document.createElement('div');
  pill.className = 'heartbeat-pill';
  pill.innerHTML =
    '<div class="heartbeat-pill-dot"></div>' +
    '\u2736 Heartbeat: ' + _triggerLabel(trigger);
  list.appendChild(pill);
  scrollToBottom();
  return pill;
}

function _appendHeartbeatMessage(text, trigger) {
  const list = document.getElementById('messages');
  const row  = document.createElement('div');
  row.className = 'msg-row companion heartbeat-msg';
  const wrap   = document.createElement('div');
  const bubble = document.createElement('div');
  bubble.className       = 'bubble heartbeat-bubble';
  bubble.dataset.rawText = text;
  bubble.innerHTML       = renderMarkdown(text);
  const meta = document.createElement('div');
  meta.className   = 'msg-time heartbeat-meta';
  meta.textContent = '\u2736 ' + _triggerLabel(trigger) + ' \u00b7 ' +
    new Date().toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
  wrap.appendChild(bubble);
  wrap.appendChild(meta);
  row.appendChild(wrap);
  list.appendChild(row);
  scrollToBottom();
  return row;
}

function _triggerLabel(trigger) {
  return { idle: 'idle reflection', conversation_end: 'end of conversation',
           session_start: 'session start', context_threshold: 'context filling',
           manual: 'manual trigger' }[trigger] || trigger;
}

// ── Settings reload ───────────────────────────────────────────────────────────
function heartbeatReload() {
  if (spSettings?.active_companion?.heartbeat) {
    config.active_heartbeat = spSettings.active_companion.heartbeat;
  }
  heartbeatInit();
}

// api.js — Model communication + tool execution
//
// callModel(system, messages) — sends to llama-server, handles both:
//   • Structured tool_calls (OpenAI format)
//   • Inline text calls written by Gemma: memory({"action":"write",...})
//
// onToolCall(name, args, status, result) — UI callback, set by chat.js
//
// Depends on: tool-parser.js (TOOL_DEFINITIONS, TOOL_NAMES, parseInlineToolCalls,
//             parseXmlToolCalls, stripToolCalls)

let onToolCall    = null;
let onThinking    = null;  // set by chat.js: (thinkText) => void
let onUsageUpdate = null;  // set by chat.js: (promptTokens, totalTokens) => void

// ── callModel ─────────────────────────────────────────────────────────────────
async function callModel(system, messages, abortSignal = null) {
  const port      = config.port_model || 8081;
  const url       = `http://localhost:${port}/v1/chat/completions`;
  const gen       = config.generation || {};
  const maxRounds = gen.max_tool_rounds ?? 8;

  _clearReadCache();

  const _activeTab = (typeof _tabs !== "undefined") && _tabs.find(t => t.id === _activeTabId);
  const visionMode = _activeTab?.visionMode || config.generation?.vision_mode || "always";

  let lastUserIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") { lastUserIdx = i; break; }
  }

  const msgs = messages.map((m, idx) => {
    if (!m._attachments?.length) return { role: m.role, content: m.content };
    const images = m._attachments.filter(a => a.type === "image");
    if (!images.length) return { role: m.role, content: m.content };

    if (visionMode === "once" && idx !== lastUserIdx) {
      return {
        role: m.role,
        content: (m.content || "") + images.map(img =>
          ` [Image: ${img.name || "image"} — described in previous response]`
        ).join("")
      };
    }

    return {
      role: m.role,
      content: [
        { type: "text", text: m.content || "" },
        ...images.map(img => ({
          type: "image_url",
          image_url: { url: `data:${img.mimeType};base64,${img.content}` }
        }))
      ]
    };
  });

  for (let round = 0; round < maxRounds; round++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: abortSignal,
      body: JSON.stringify({
        model:             "local",
        messages:          [{ role: "system", content: system }, ...msgs],
        tools:             TOOL_DEFINITIONS,
        tool_choice:       "auto",
        max_tokens:        gen.max_tokens       || 1024,
        temperature:       gen.temperature      ?? 0.8,
        top_p:             gen.top_p            ?? 0.95,
        top_k:             gen.top_k            ?? 40,
        min_p:             gen.min_p            ?? 0.0,
        repeat_penalty:    gen.repeat_penalty   ?? 1.1,
        presence_penalty:  gen.presence_penalty  ?? 0.0,
        frequency_penalty: gen.frequency_penalty ?? 0.0,
        ...(gen.dry_multiplier ? { dry_multiplier: gen.dry_multiplier, dry_base: gen.dry_base ?? 1.75, dry_allowed_length: gen.dry_allowed_length ?? 2 } : {}),
        stream:            false,
      }),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => String(res.status));
      throw new Error(`Model server ${res.status}: ${err.slice(0, 200)}`);
    }

    const data   = await res.json();
    const choice = data.choices?.[0];
    if (!choice) throw new Error("No choices in model response");

    if (data.usage && typeof onUsageUpdate === "function") {
      onUsageUpdate(data.usage.prompt_tokens || 0, data.usage.total_tokens || 0);
    }

    const msg = choice.message;

    let thinkContent = msg.reasoning_content || null;
    let rawText      = (msg.content || "").trim();

    if (!thinkContent) {
      const thinkMatch = rawText.match(/^<think>([\s\S]*?)<\/think>\s*/);
      if (thinkMatch) {
        thinkContent = thinkMatch[1].trim();
        rawText      = rawText.slice(thinkMatch[0].length).trim();
      }
    }

    if (thinkContent && typeof onThinking === "function") {
      onThinking(thinkContent);
    }

    // ── Path A: structured tool_calls ────────────────────────────────────
    if (choice.finish_reason === "tool_calls" && msg.tool_calls?.length) {
      msgs.push({ role: "assistant", content: msg.content || null, tool_calls: msg.tool_calls });
      for (const tc of msg.tool_calls) {
        let args = {};
        try {
          args = typeof tc.function.arguments === "string"
            ? JSON.parse(tc.function.arguments || "{}")
            : (tc.function.arguments || {});
        } catch {}
        const result = await _execTool(tc.function.name, args);
        msgs.push({ role: "tool", tool_call_id: tc.id, content: String(result) });
      }
      continue;
    }

    // ── Path B: inline text tool calls ───────────────────────────────────
    const inlineCalls = parseInlineToolCalls(rawText);
    if (inlineCalls.length > 0) {
      const results = [];
      for (const { name, args } of inlineCalls) {
        const result = await _execTool(name, args);
        results.push(`[${name}]: ${result}`);
      }
      const cleaned = stripToolCalls(rawText, inlineCalls);
      if (cleaned) msgs.push({ role: "assistant", content: cleaned });
      msgs.push({
        role: "user",
        content: `[Tool results]\n${results.join("\n")}\n\nPlease continue naturally.`
      });
      continue;
    }

    // ── Path C: XML-style tool calls ─────────────────────────────────────
    const xmlCalls = parseXmlToolCalls(rawText);
    if (xmlCalls.length > 0) {
      const results = [];
      for (const { name, args } of xmlCalls) {
        const result = await _execTool(name, args);
        results.push(`[${name}]: ${result}`);
      }
      const cleaned = rawText.replace(/<tool_use>[\s\S]*?<\/tool_call>/g, '').trim();
      if (cleaned) msgs.push({ role: "assistant", content: cleaned });
      msgs.push({
        role: "user",
        content: `[Tool results]\n${results.join("\n")}\n\nPlease continue naturally.`
      });
      continue;
    }

    // ── Path D: tool call in thinking block ───────────────────────────────
    // Qwen3 often places tool calls inside <think> even when it also outputs
    // some text. Run this check unconditionally (not just when rawText is empty)
    // so those calls aren't silently dropped.
    if (thinkContent) {
      const rescuedCalls = parseXmlToolCalls(thinkContent);
      if (rescuedCalls.length > 0) {
        console.log("[api] rescued", rescuedCalls.length, "tool call(s) from thinking block");
        // If the model also produced text, push it as the assistant turn first
        if (rawText) msgs.push({ role: "assistant", content: rawText });
        const results = [];
        for (const { name, args } of rescuedCalls) {
          const result = await _execTool(name, args);
          results.push(`[${name}]: ${result}`);
        }
        msgs.push({
          role: "user",
          content: `[Tool results]\n${results.join("\n")}\n\nPlease continue naturally.`
        });
        continue;
      }
    }

    // ── Plain reply — stream it live ──────────────────────────────────────
    const streamedText = await _streamFinalReply(url, system, msgs, gen, abortSignal);
    return streamedText ?? rawText;
  }

  // Fallback after max rounds
  const fb = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model:      "local",
      messages:   [{ role: "system", content: system }, ...msgs],
      max_tokens: Math.min(gen.max_tokens || 1024, 512),
      stream:     false,
    }),
  });
  const fd = await fb.json();
  return (fd.choices?.[0]?.message?.content || "").trim();
}

// ── Streaming final reply ─────────────────────────────────────────────────────
async function _streamFinalReply(url, system, msgs, gen, abortSignal) {
  let bubbleHandle = null;
  let accumulated  = "";
  let thinkAccum   = "";
  let thinkShown   = false;

  const ensureBubble = () => {
    if (!bubbleHandle) {
      document.querySelector(".typing-row")?.remove();
      bubbleHandle = _createStreamBubble();
    }
    return bubbleHandle;
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: abortSignal,
      body: JSON.stringify({
        model:             "local",
        messages:          [{ role: "system", content: system }, ...msgs],
        tools:             TOOL_DEFINITIONS,
        tool_choice:       "auto",
        max_tokens:        gen.max_tokens       || 1024,
        temperature:       gen.temperature      ?? 0.8,
        top_p:             gen.top_p            ?? 0.95,
        top_k:             gen.top_k            ?? 40,
        min_p:             gen.min_p            ?? 0.0,
        repeat_penalty:    gen.repeat_penalty   ?? 1.1,
        presence_penalty:  gen.presence_penalty  ?? 0.0,
        frequency_penalty: gen.frequency_penalty ?? 0.0,
        ...(gen.dry_multiplier ? { dry_multiplier: gen.dry_multiplier, dry_base: gen.dry_base ?? 1.75, dry_allowed_length: gen.dry_allowed_length ?? 2 } : {}),
        stream: true,
      }),
    });

    if (!res.ok) return null;

    const reader  = res.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split("\n");

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const raw = line.slice(6).trim();
        if (raw === "[DONE]") break;

        let parsed;
        try { parsed = JSON.parse(raw); } catch { continue; }

        const delta = parsed.choices?.[0]?.delta;
        if (!delta) continue;

        if (delta.reasoning_content) {
          thinkAccum += delta.reasoning_content;
          if (!thinkShown && typeof onThinking === "function") {
            onThinking(thinkAccum);
            thinkShown = true;
          } else if (thinkShown) {
            const thinkEl = document.querySelector(".think-wrap:last-of-type .think-content");
            if (thinkEl) thinkEl.textContent = thinkAccum;
          }
          continue;
        }

        const token = delta.content || "";
        if (!token) continue;

        accumulated += token;
        const bh = ensureBubble();
        if (bh) {
          if (typeof setPresenceState === "function") setPresenceState("streaming");
          _updateStreamBubble(bh, accumulated);
        }

        if (parsed.usage && typeof onUsageUpdate === "function") {
          onUsageUpdate(parsed.usage.prompt_tokens || 0);
        }
      }
    }
  } catch(e) {
    if (e.name === "AbortError") {
      if (bubbleHandle) _finaliseStreamBubble(bubbleHandle, accumulated);
      throw e;
    }
    if (bubbleHandle) _removeStreamBubble(bubbleHandle);
    return null;
  }

  if (typeof setPresenceState === "function") setPresenceState("idle");
  if (bubbleHandle) {
    _finaliseStreamBubble(bubbleHandle, accumulated);
  }
  return accumulated.trim() || null;
}

// ── Stream bubble helpers ─────────────────────────────────────────────────────
// Flag: true when a stream bubble was fully rendered — chat.js checks this
// instead of looking for the (already-removed) stream-bubble-row id.
let _streamBubbleRendered = false;
function streamWasRendered() {
  const v = _streamBubbleRendered;
  _streamBubbleRendered = false;  // reset after reading
  return v;
}

function _createStreamBubble() {
  document.querySelector(".typing-row")?.remove();

  const list = document.getElementById("messages");
  if (!list) return null;

  const row    = document.createElement("div");
  row.className = "msg-row companion stream-row";
  row.id        = "stream-bubble-row";

  const wrap   = document.createElement("div");
  const bubble = document.createElement("div");
  bubble.className       = "bubble stream-bubble";
  bubble.dataset.rawText = "";

  const time = document.createElement("div");
  time.className   = "msg-time";
  time.textContent = new Date().toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" });

  wrap.appendChild(bubble);
  wrap.appendChild(time);
  row.appendChild(wrap);

  list.appendChild(row);

  if (typeof scrollToBottom === "function") scrollToBottom();
  return { row, bubble, wrap };
}

function _updateStreamBubble({ bubble }, text) {
  if (!bubble) return;
  bubble.dataset.rawText = text;
  const rendered = typeof renderMarkdown === "function" ? renderMarkdown(text) : text;
  bubble.innerHTML = rendered;
  // Use scrollIfFollowing so we don't fight the user if they've scrolled up
  if (typeof scrollIfFollowing === "function") scrollIfFollowing();
  else if (typeof scrollToBottom === "function") scrollToBottom();
}

function _finaliseStreamBubble({ row, bubble }, text) {
  if (!bubble) return;
  bubble.dataset.rawText = text;
  bubble.classList.remove("stream-bubble");
  const rendered = typeof renderMarkdown === "function" ? renderMarkdown(text) : text;
  bubble.innerHTML = rendered;
  row.classList.remove("stream-row");
  row.removeAttribute("id");
  _streamBubbleRendered = true;  // tell chat.js the bubble is already in the DOM
  // Orb stays in its fixed home — just set state to idle
  if (typeof setPresenceState === "function") setPresenceState("idle");
  if (typeof _attachMessageControls === "function") {
    _attachMessageControls(row, "companion");
  }
}

function _removeStreamBubble({ row } = {}) {
  row?.remove();
}

// ── Read-before-write enforcer ────────────────────────────────────────────────
const _readCache = {};

function _clearReadCache() {
  Object.keys(_readCache).forEach(k => delete _readCache[k]);
}

async function _enforceReadBeforeWrite(args) {
  if (args.action !== "write" || !args.filename) return;
  const key = `${args.folder}/${args.filename}`;
  if (_readCache[key] !== undefined) return;

  console.log(`[rbw] auto-reading ${key} before write`);
  try {
    const current = await callTool("memory", { action: "read", folder: args.folder, filename: args.filename });
    _readCache[key] = current;
    console.log(`[rbw] current content (${current.length} chars)`);
  } catch {
    _readCache[key] = "";
  }
}

// ── Execute one tool ──────────────────────────────────────────────────────────
async function _execTool(name, args) {
  console.log(`[tool] ${name}`, args);
  if (typeof onToolCall === "function") onToolCall(name, args, "loading");

  let result = "";
  try {
    if (name === "memory") {
      if (args.action === "read" && args.filename) {
        _readCache[`${args.folder}/${args.filename}`] = "__pending__";
      }
      if (args.action === "write") {
        await _enforceReadBeforeWrite(args);
      }
    }

    result = await callTool(name, args);

    if (name === "memory" && args.action === "read" && args.filename) {
      _readCache[`${args.folder}/${args.filename}`] = result;
    }

    if (name === "memory" && args.action === "write" && args.folder === "soul") {
      await reloadSoulFiles();
    }
    if (name === "memory" && args.action === "write") {
      if (typeof updateMemoryCounts === "function") updateMemoryCounts();
    }

  } catch (e) {
    result = `Error: ${e.message}`;
  }

  if (typeof onToolCall === "function") onToolCall(name, args, "done", result);
  console.log(`[tool result] ${name}:`, String(result).slice(0, 120));
  return result;
}

// ── callTool — MCP bridge ─────────────────────────────────────────────────────
async function callTool(name, args) {
  const res = await fetch("/irina/message", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0", id: 1,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
  if (!res.ok) throw new Error(`Bridge ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || "Tool error");
  return data.result?.content?.[0]?.text ?? String(data.result ?? "");
}

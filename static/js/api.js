// api.js — Model communication + tool execution
//
// callModel(system, messages) — sends to llama-server, handles:
//   • Structured tool_calls (OpenAI format)                           → Path A
//   • Inline text calls (Gemma 3 style): memory({"action":"write"})  → Path B
//   • XML-style calls: <tool_use><function=name>...                   → Path C
//   • Tool calls rescued from thinking block (Qwen3)                  → Path D
//   • Gemma 4 native: <|tool_call>call:name{...}<tool_call|>          → Path E
//
// onToolCall(name, args, status, result) — UI callback, set by chat.js
//
// Depends on: tool-parser.js (TOOL_DEFINITIONS, TOOL_NAMES, parseInlineToolCalls,
//             parseXmlToolCalls, parseGemma4ToolCalls, formatGemma4ToolResponse,
//             stripToolCalls)
//             chat.js (modelFamily) — read-only, never written here

let onToolCall    = null;
let onThinking    = null;  // set by chat.js: (thinkText) => void
let onUsageUpdate = null;  // set by chat.js: (promptTokens, totalTokens) => void
let onTtsToken    = null;  // set by tts.js: (token) => void — feeds sentence buffer

// ── Tool result injection helpers ─────────────────────────────────────────────
// Each model family expects tool results to arrive in a specific format.
// Using the wrong format causes the model to ignore results or hallucinate.
//
// _injectToolResults(msgs, assistantText, results, callsRaw)
//   assistantText — visible text from the assistant turn (may be empty → "…")
//   results       — array of { name, result } objects
//   callsRaw      — raw text of the tool call block (for stripping from display)

// _injectToolResults(msgs, cleanedText, results, rawText)
//   cleanedText — assistant visible text with tool call block(s) stripped out.
//                 Used as the assistant turn for generic models, and as a
//                 fallback placeholder if rawText is empty.
//   results     — array of { name, result } objects, one per executed tool call.
//   rawText     — the full unstripped assistant response (tool call block included).
//                 Gemma 4's chat template needs to see the original call tokens
//                 in the assistant turn so it can make sense of the response
//                 coming back — pushing cleanedText instead causes it to lose
//                 the call context and hallucinate or ignore the result.
function _injectToolResults(msgs, cleanedText, results, rawText) {
  // modelFamily is defined in chat.js (loaded before api.js).
  const family = (typeof modelFamily !== "undefined") ? modelFamily : "generic";

  if (family === "gemma4") {
    // Gemma 4 assistant turn must contain the raw call tokens, not the cleaned text.
    // The cleaned text (Gemma's prose response) will appear in the *next* round
    // after the tool result has been processed.
    if (msgs[msgs.length - 1]?.role !== "assistant") {
      msgs.push({ role: "assistant", content: rawText || cleanedText || "…" });
    }
    const responseParts = results.map(({ name, result }) =>
      formatGemma4ToolResponse(name, result)
    );
    msgs.push({ role: "user", content: responseParts.join("\n") });
  } else {
    // Generic: plain [Tool results] user turn.
    // Always ensure an assistant turn precedes it — strict chat templates
    // (Llama, Mistral, etc.) return 500 on consecutive user turns.
    if (msgs[msgs.length - 1]?.role !== "assistant") {
      msgs.push({ role: "assistant", content: cleanedText || "…" });
    }
    const lines = results.map(({ name, result }) => `[${name}]: ${result}`);
    msgs.push({
      role: "user",
      content: `[Tool results]\n${lines.join("\n")}\n\nPlease continue naturally.`
    });
  }
}

// ── callModel ─────────────────────────────────────────────────────────────────
async function callModel(system, messages, abortSignal = null) {
  const port      = config.port_model || 8081;
  const url       = `http://localhost:${port}/v1/chat/completions`;
  const gen       = config.generation || {};
  const maxRounds = gen.max_tool_rounds ?? 8;

  _clearReadCache();

  const _activeTab = (typeof _tabs !== "undefined") && _tabs.find(t => t.id === _activeTabId);
  // visionMode drives how images in conversationHistory are sent to the model.
  // 'once'   = encode only on the message that introduced the image; substitute text for older turns.
  // 'always' = re-encode the image on every turn (default).
  // 'ask'    is a UI-only setting — per-message choice is resolved before callModel is called
  //          and stored on the tab as 'once' or 'always'. It should never reach here as-is,
  //          but guard against it by treating it the same as 'always'.
  const _rawVisionMode = _activeTab?.visionMode || config.generation?.vision_mode || "always";
  const visionMode = (_rawVisionMode === "ask") ? "always" : _rawVisionMode;

  let lastUserIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") { lastUserIdx = i; break; }
  }

  const msgs = messages.map((m, idx) => {
    if (!m._attachments?.length) return { role: m.role, content: m.content };
    const images = m._attachments.filter(a => a.type === "image");
    const audios = m._attachments.filter(a => a.type === "audio");
    if (!images.length && !audios.length) return { role: m.role, content: m.content };

    if (visionMode === "once" && idx !== lastUserIdx) {
      // Non-final messages in once mode: substitute text placeholders for images.
      // Audio text note is already in m.content (histContent), no extra needed.
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
        })),
        // Audio: only sent for the current message (always "once" — never re-sent).
        // llama-server format (PR #13714): type "input_audio", raw base64 (no data: prefix).
        // Format string derived from mimeType: audio/webm → "webm", audio/ogg → "ogg", etc.
        ...(idx === lastUserIdx ? audios.map(aud => ({
          type: "input_audio",
          input_audio: {
            data:   aud.content,
            format: aud.mimeType.split("/")[1]?.split(";")[0] || "webm"
          }
        })) : [])
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

    // ── Path A: structured tool_calls (OpenAI format) ─────────────────────
    // llama-server may parse some model formats natively into tool_calls.
    // Gemma 4 via llama-server currently lands here only if the peg-gemma4
    // grammar successfully parses the call — otherwise it falls through to Path E.
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

    // ── Path B: inline text tool calls ────────────────────────────────────
    // Gemma 3 / older models that write: toolName({"key": "value"})
    const inlineCalls = parseInlineToolCalls(rawText);
    if (inlineCalls.length > 0) {
      const results = [];
      for (const { name, args } of inlineCalls) {
        const result = await _execTool(name, args);
        results.push({ name, result });
      }
      const cleaned = stripToolCalls(rawText, inlineCalls);
      // rawText passed as fourth arg so Gemma 4 can preserve the call in its assistant turn.
      _injectToolResults(msgs, cleaned, results, rawText);
      continue;
    }

    // ── Path C: XML-style tool calls ──────────────────────────────────────
    // <tool_call><function=name><parameter=key>value</parameter></tool_call>
    // Also accepts <tool_use> as the opening tag (older/variant format).
    //
    // Both Qwen3 and Gemma 4 (when not using its native token format) land here.
    // _injectToolResults handles feeding results back in the right format:
    //   Gemma 4  → assistant turn gets rawText (call block intact) so the template
    //              can match call to response; <|tool_response> tokens as user turn.
    //   Generic  → assistant turn gets cleaned text; [Tool results] as user turn.
    const xmlCalls = parseXmlToolCalls(rawText);
    if (xmlCalls.length > 0) {
      const results = [];
      for (const { name, args } of xmlCalls) {
        const result = await _execTool(name, args);
        results.push({ name, result });
      }
      const cleaned = rawText.replace(/<(?:tool_call|tool_use)>[\s\S]*?<\/tool_call>/g, "").trim();
      // rawText passed as fourth arg so Gemma 4 can preserve the call block in its assistant turn.
      _injectToolResults(msgs, cleaned, results, rawText);
      continue;
    }

    // ── Path D: tool call rescued from thinking block ─────────────────────
    // Qwen3 often places tool calls inside <think> even when it also outputs
    // some text. Run this check unconditionally (not just when rawText is empty)
    // so those calls aren't silently dropped.
    if (thinkContent) {
      const rescuedCalls = parseXmlToolCalls(thinkContent);
      if (rescuedCalls.length > 0) {
        console.log("[api] rescued", rescuedCalls.length, "tool call(s) from thinking block");
        const results = [];
        for (const { name, args } of rescuedCalls) {
          const result = await _execTool(name, args);
          results.push({ name, result });
        }
        // rawText is the prose output that accompanied the thinking block.
        // For Gemma 4 this goes in the assistant turn; for generic it's the fallback placeholder.
        _injectToolResults(msgs, rawText, results, rawText);
        continue;
      }
    }

    // ── Path E: Gemma 4 native tool calls ────────────────────────────────
    // Format: <|tool_call>call:name{param:<|"|>value<|"|>}<tool_call|>
    //
    // llama-server passes these through as raw content when the peg-gemma4
    // grammar doesn't convert them to structured tool_calls (Path A). We
    // parse the raw tokens ourselves and feed results back using Gemma 4's
    // own <|tool_response>...</tool_response|> token syntax, which its chat
    // template understands natively.
    //
    // Note: this path does NOT go through _injectToolResults because Gemma 4
    // native calls have their own assistant-turn push semantics (raw token
    // content preserved) that differ from the XML path.
    const gemma4Calls = parseGemma4ToolCalls(rawText);
    if (gemma4Calls.length > 0) {
      console.log("[api] gemma4 tool call(s):", gemma4Calls.map(c => c.name));
      // Push the raw assistant turn so the model retains context of its own call
      msgs.push({ role: "assistant", content: rawText });
      const responseParts = [];
      for (const { name, args } of gemma4Calls) {
        const result = await _execTool(name, args);
        responseParts.push(formatGemma4ToolResponse(name, result));
      }
      // Inject all tool responses as a single user turn using Gemma 4's token syntax.
      // The model reads these response tokens before generating its final reply.
      msgs.push({
        role: "user",
        content: responseParts.join("\n")
      });
      continue;
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

  if (typeof ttsStartGeneration === "function") ttsStartGeneration();

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
        stream:            true,
      }),
    });

    if (!res.ok) throw new Error(`Stream ${res.status}`);

    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let   buffer  = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop();

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
        if (typeof onTtsToken === "function") onTtsToken(token);
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
    if (typeof sealThinkingBlock === "function") sealThinkingBlock();
    if (e.name === "AbortError") {
      if (typeof ttsStop === "function") ttsStop();
      if (bubbleHandle) _finaliseStreamBubble(bubbleHandle, accumulated);
      throw e;
    }
    if (bubbleHandle) _removeStreamBubble(bubbleHandle);
    return null;
  }

  // Seal any streaming thinking block — handles the case where the model goes
  // straight from thinking into a tool call with no text preamble (in which case
  // _createStreamBubble is never called and the dots would otherwise stay).
  if (typeof sealThinkingBlock === "function") sealThinkingBlock();
  if (typeof setPresenceState === "function") setPresenceState("idle");
  if (bubbleHandle) {
    _finaliseStreamBubble(bubbleHandle, accumulated);
  }
  if (typeof ttsEndGeneration === "function") ttsEndGeneration();
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
  // Thinking phase just ended — seal the streaming thinking block (collapse + remove cursor).
  if (typeof sealThinkingBlock === "function") sealThinkingBlock();

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
  // Insert cursor INSIDE the last block element so it sits inline with the
  // text rather than below it (appending after </p> creates a new block).
  const cursor = '<span class="stream-cursor"></span>';
  const html = rendered.endsWith('</p>')
    ? rendered.slice(0, -4) + cursor + '</p>'
    : rendered + cursor;
  bubble.innerHTML = html;
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

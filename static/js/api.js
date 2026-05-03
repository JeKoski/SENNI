// api.js — Model communication + tool execution
//
// callModel(system, messages) — sends to llama-server, handles:
//   • Structured tool_calls (OpenAI format)                           → Path A
//   • Inline text calls (Gemma 3 style): memory({"action":"write"})  → Path B
//   • XML-style calls: <tool_use><function=name>...                   → Path C
//   • Tool calls rescued from thinking block (Qwen3)                  → Path D
//   • Gemma 4 native: <|tool_call>call:name{...}<tool_call|>          → Path E
//   • Gemma 4 partial/truncated: <|tool_call>call:name{...} (no end) → Path F
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
// Streams each round. After the stream ends, accumulated text is checked for
// tool calls. If found: provisional bubble removed, tools processed, loop
// continues. If not found: bubble finalized, TTS flushed, text returned.
// No double-fetch — one streaming request per round.
async function callModel(system, messages, abortSignal = null) {
  const port      = config.port_model || 8081;
  const url       = `http://localhost:${port}/v1/chat/completions`;
  const gen       = config.generation || {};
  const maxRounds = gen.max_tool_rounds ?? 8;

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
    // Stream this round. Returns accumulated text + metadata; does NOT finalize
    // the bubble — caller decides to finalize (plain reply) or remove (tool calls).
    const result = await _streamRound(url, system, msgs, gen, abortSignal);
    let { text: rawText, thinkContent, structuredCalls, finishReason, bubbleHandle, usageData } = result;

    // Extract inline <think> block if model didn't use reasoning_content field.
    // Only call onThinking here for the inline case — streaming reasoning_content
    // already called onThinking live during _streamRound.
    if (!thinkContent) {
      const thinkMatch = rawText.match(/^<think>([\s\S]*?)<\/think>\s*/);
      if (thinkMatch) {
        thinkContent = thinkMatch[1].trim();
        rawText      = rawText.slice(thinkMatch[0].length).trim();
        if (typeof onThinking === "function") onThinking(thinkContent);
      }
    }

    if (usageData && typeof onUsageUpdate === "function") {
      onUsageUpdate(usageData.prompt_tokens || 0, usageData.total_tokens || 0);
    }

    // Log full response text whenever a tool call is about to execute
    // (plain replies are logged further down; this covers all tool paths)
    if (rawText) console.log("[api] response text:", rawText.slice(0, 2000));

    // ── Path A: structured tool_calls (OpenAI format) ─────────────────────
    // llama-server may parse some model formats natively into tool_calls.
    // delta.tool_calls are accumulated during streaming in _streamRound.
    if (finishReason === "tool_calls" && structuredCalls?.length) {
      if (bubbleHandle) { if (typeof ttsStop === "function") ttsStop(); _removeStreamBubble(bubbleHandle); }
      msgs.push({ role: "assistant", content: rawText || null, tool_calls: structuredCalls });
      for (const tc of structuredCalls) {
        let args = {};
        try {
          args = typeof tc.function.arguments === "string"
            ? JSON.parse(tc.function.arguments || "{}")
            : (tc.function.arguments || {});
        } catch {}
        const res = await _execTool(tc.function.name, args);
        msgs.push({ role: "tool", tool_call_id: tc.id, content: String(res) });
      }
      continue;
    }

    // ── Path B: inline text tool calls ────────────────────────────────────
    // Gemma 3 / older models that write: toolName({"key": "value"})
    const inlineCalls = parseInlineToolCalls(rawText);
    if (inlineCalls.length > 0) {
      if (bubbleHandle) { if (typeof ttsStop === "function") ttsStop(); _removeStreamBubble(bubbleHandle); }
      const results = [];
      for (const { name, args } of inlineCalls) {
        const res = await _execTool(name, args);
        results.push({ name, result: res });
      }
      const cleaned = stripToolCalls(rawText, inlineCalls);
      _injectToolResults(msgs, cleaned, results, rawText);
      continue;
    }

    // ── Path C: XML-style tool calls ──────────────────────────────────────
    // <tool_call><function=name><parameter=key>value</parameter></tool_call>
    // Also accepts <tool_use> as the opening tag (older/variant format).
    const xmlCalls = parseXmlToolCalls(rawText);
    if (xmlCalls.length > 0) {
      if (bubbleHandle) { if (typeof ttsStop === "function") ttsStop(); _removeStreamBubble(bubbleHandle); }
      const results = [];
      for (const { name, args } of xmlCalls) {
        const res = await _execTool(name, args);
        results.push({ name, result: res });
      }
      const cleaned = rawText.replace(/<(?:tool_call|tool_use)>[\s\S]*?<\/tool_call>/g, "").trim();
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
        if (bubbleHandle) { if (typeof ttsStop === "function") ttsStop(); _removeStreamBubble(bubbleHandle); }
        const results = [];
        for (const { name, args } of rescuedCalls) {
          const res = await _execTool(name, args);
          results.push({ name, result: res });
        }
        _injectToolResults(msgs, rawText, results, rawText);
        continue;
      }
    }

    // ── Path E: Gemma 4 native tool calls ────────────────────────────────
    // Format: <|tool_call>call:name{param:<|"|>value<|"|>}<tool_call|>
    const gemma4Calls = parseGemma4ToolCalls(rawText);
    if (gemma4Calls.length > 0) {
      console.log("[api] gemma4 tool call(s):", gemma4Calls.map(c => c.name));
      if (bubbleHandle) {
        if (typeof ttsStop === "function") ttsStop();
        // Preserve any prose that appeared before the tool call tokens
        const prose = stripGemma4Artifacts(
          rawText.replace(/<\|channel>([\s\S]*?)<channel\|>/g, "$1")
        ).trim();
        if (prose) {
          _finaliseStreamBubble(bubbleHandle, prose);
        } else {
          _removeStreamBubble(bubbleHandle);
        }
      }
      msgs.push({ role: "assistant", content: rawText });
      const responseParts = [];
      for (const { name, args } of gemma4Calls) {
        const res = await _execTool(name, args);
        responseParts.push(formatGemma4ToolResponse(name, res));
      }
      msgs.push({ role: "user", content: responseParts.join("\n") });
      continue;
    }

    // ── Path F: Gemma 4 partial / truncated tool call rescue ─────────────
    // Fires when <|tool_call> was emitted but <tool_call|> closing was cut off
    // (stream ended at <end_of_turn> or max_tokens limit). Tries to parse
    // whatever argument body arrived before truncation.
    const family = (typeof modelFamily !== "undefined") ? modelFamily : "generic";
    if (family === "gemma4" && rawText.includes("<|tool_call>")) {
      const rescued = rescuePartialGemma4ToolCall(rawText);
      if (rescued.length > 0) {
        console.log("[api] gemma4 rescued partial tool call:", rescued[0].name);
        if (bubbleHandle) {
          if (typeof ttsStop === "function") ttsStop();
          const prose = stripGemma4Artifacts(
            rawText.replace(/<\|channel>([\s\S]*?)<channel\|>/g, "$1")
          ).trim();
          if (prose) {
            _finaliseStreamBubble(bubbleHandle, prose);
          } else {
            _removeStreamBubble(bubbleHandle);
          }
        }
        msgs.push({ role: "assistant", content: rawText });
        const responseParts = [];
        for (const { name, args } of rescued) {
          const res = await _execTool(name, args);
          responseParts.push(formatGemma4ToolResponse(name, res));
        }
        msgs.push({ role: "user", content: responseParts.join("\n") });
        continue;
      }
      // Unparseable fragment — strip before display so artifact doesn't reach TTS
      rawText = stripGemma4Artifacts(rawText);
      console.warn("[api] gemma4 tool call fragment dropped (unparseable):", rawText.slice(0, 1000));
    }

    // Gemma 4 debug: log when rawText is non-empty but no tool call matched.
    // Helps diagnose "I'll call those tools now" + prose-only turns.
    if (family === "gemma4" && rawText) {
      console.log("[api] gemma4 plain reply (no tool call detected):", rawText.slice(0, 1000));
    }

    // ── Plain reply — bubble already streamed live ────────────────────────
    if (typeof sealThinkingBlock === "function") sealThinkingBlock();
    if (typeof setPresenceState === "function") setPresenceState("idle");
    if (bubbleHandle) _finaliseStreamBubble(bubbleHandle, rawText);
    if (typeof ttsEndGeneration === "function") ttsEndGeneration();
    return rawText || null;
  }

  // Fallback after max rounds — plain non-streaming fetch, no bubble
  const fb = await fetch(`http://localhost:${config.port_model || 8081}/v1/chat/completions`, {
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

// ── Stream one round ──────────────────────────────────────────────────────────
// Streams tokens live into a provisional bubble + TTS. Does NOT finalize the
// bubble — caller decides based on post-stream tool-call detection:
//   • Tool calls found  → caller calls ttsStop() + _removeStreamBubble()
//   • Plain reply       → caller calls _finaliseStreamBubble() + ttsEndGeneration()
//
// Returns { text, thinkContent, structuredCalls, finishReason, bubbleHandle, usageData }
// On non-abort error: rethrows after cleanup (bubble removed, TTS stopped).
// On abort: finalises partial bubble with what was received, rethrows.
async function _streamRound(url, system, msgs, gen, abortSignal) {
  let bubbleHandle   = null;
  let accumulated    = "";
  let thinkAccum     = "";
  let thinkShown     = false;
  let finishReason   = null;
  let usageData      = null;
  // Path A: delta.tool_calls arrive as index-keyed patches; accumulate into a map.
  const structuredCallsMap = new Map();

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
        stream_options:    { include_usage: true },
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

        if (parsed.usage) usageData = parsed.usage;

        const choice = parsed.choices?.[0];
        if (!choice) continue;

        if (choice.finish_reason) finishReason = choice.finish_reason;

        const delta = choice.delta;
        if (!delta) continue;

        // Path A: accumulate structured tool_calls patches by index
        if (delta.tool_calls) {
          for (const tcDelta of delta.tool_calls) {
            const idx = tcDelta.index ?? 0;
            if (!structuredCallsMap.has(idx)) {
              structuredCallsMap.set(idx, { id: "", type: "function", function: { name: "", arguments: "" } });
            }
            const tc = structuredCallsMap.get(idx);
            if (tcDelta.id)                    tc.id                    = tcDelta.id;
            if (tcDelta.type)                  tc.type                  = tcDelta.type;
            if (tcDelta.function?.name)        tc.function.name        += tcDelta.function.name;
            if (tcDelta.function?.arguments)   tc.function.arguments   += tcDelta.function.arguments;
          }
          continue;
        }

        // Thinking / reasoning content
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

        // Regular content
        const token = delta.content || "";
        if (!token) continue;

        accumulated += token;
        if (typeof onTtsToken === "function") onTtsToken(token);
        const bh = ensureBubble();
        if (bh) {
          if (typeof setPresenceState === "function") setPresenceState("streaming");
          _updateStreamBubble(bh, accumulated);
        }
      }
    }
  } catch (e) {
    if (typeof sealThinkingBlock === "function") sealThinkingBlock();
    if (e.name === "AbortError") {
      // Abort: finalise whatever arrived so the partial reply stays visible
      if (typeof ttsStop === "function") ttsStop();
      if (bubbleHandle) _finaliseStreamBubble(bubbleHandle, accumulated);
      throw e;
    }
    // Other error: clean up and rethrow so sendMessage shows error message
    if (typeof ttsStop === "function") ttsStop();
    if (bubbleHandle) _removeStreamBubble(bubbleHandle);
    throw e;
  }

  const structuredCalls = structuredCallsMap.size > 0
    ? [...structuredCallsMap.values()]
    : null;

  return {
    text:           accumulated.trim(),
    thinkContent:   thinkAccum.trim(),
    structuredCalls,
    finishReason,
    bubbleHandle,
    usageData,
  };
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

  const msgOrb = document.createElement("div");
  msgOrb.className = "msg-orb";
  row.appendChild(msgOrb);

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

// ── Execute one tool ──────────────────────────────────────────────────────────
async function _execTool(name, args) {
  console.log(`[tool] ${name}`, JSON.stringify(args).slice(0, 300));
  if (typeof onToolCall === "function") onToolCall(name, args, "loading");

  let result = "";
  try {
    result = await callTool(name, args);

    const isSoulWrite = args.action === "write" &&
      (name === "soul_identity" || name === "soul_reflect" || name === "soul_user");
    if (isSoulWrite) {
      await reloadSoulFiles();
    }

  } catch (e) {
    result = `Error: ${e.message}`;
  }

  if (typeof onToolCall === "function") onToolCall(name, args, "done", result);
  console.log(`[tool result] ${name}:`, String(result).slice(0, 300));
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

// tool-parser.js — Tool call parsing and stripping
//
// Owns:
//   TOOL_DEFINITIONS         — full tool schema array (used by api.js for model requests)
//   TOOL_NAMES               — derived name list
//   parseInlineToolCalls(text)   → [{ name, args, raw }, ...]   Gemma 3 / inline style
//   parseXmlToolCalls(text)      → [{ name, args }, ...]         Qwen3 XML style
//   parseGemma4ToolCalls(text)   → [{ name, args }, ...]         Gemma 4 native token style
//   formatGemma4ToolResponse(name, result) → string              Gemma 4 response token
//   stripToolCalls(text, calls)  → cleaned string
//
// No DOM dependency. No side effects. Load before api.js.

// ── Tool definitions ──────────────────────────────────────────────────────────
const TOOL_DEFINITIONS = [
  {
    type: "function",
    function: {
      name: "memory",
      description:
        "Read, write, or list the companion's markdown memory files. " +
        "soul/ = identity & user profile (persistent). " +
        "mind/ = current session notes. memory/ = long-term archive. " +
        "Always write complete markdown files.",
      parameters: {
        type: "object",
        properties: {
          action:      { type: "string", enum: ["read","write","list","archive","move"],
                         description: "read=get file, write=save file, list=show files, archive=move from mind/ to memory/ with timestamp, move=transfer file between folders (chaos mode only)" },
          folder:      { type: "string", enum: ["soul","mind","memory"],
                         description: "Source folder" },
          filename:    { type: "string", description: "File name e.g. 'session_notes.md'" },
          content:     { type: "string", description: "Full file content for write action" },
          dest_folder: { type: "string", enum: ["soul","mind","memory"],
                         description: "Destination folder for move action" }
        },
        required: ["action","folder"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "web_search",
      description: "Search the internet for current information.",
      parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] }
    }
  },
  {
    type: "function",
    function: {
      name: "web_scrape",
      description: "Fetch the full text of a URL.",
      parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] }
    }
  },
  {
    type: "function",
    function: {
      name: "get_time",
      description: "Get the current date and time.",
      parameters: { type: "object", properties: {} }
    }
  },
  {
    type: "function",
    function: {
      name: "write_memory",
      description:
        "Write a memory note to long-term episodic storage. " +
        "Use sparingly — 2 to 5 times per session for moments genuinely worth keeping. " +
        "Supply the memory in your own voice. " +
        "Set emotional_valence (-1.0 negative to 1.0 positive) and intensity (0.0 to 1.0). " +
        "Provide a context_summary: a brief phrase describing the conversational moment " +
        "so this memory can link to related ones later.",
      parameters: {
        type: "object",
        properties: {
          content: {
            type: "string",
            description:
              "The memory itself, written in your own voice. " +
              "Be specific — vague memories are hard to retrieve usefully."
          },
          keywords: {
            type: "array",
            items: { type: "string" },
            description:
              "2–6 keywords that capture the core of this memory. " +
              "Used for direct retrieval. E.g. ['walks', 'morning', 'routine']."
          },
          emotional_valence: {
            type: "number",
            description:
              "How this memory feels: -1.0 (very negative) to 1.0 (very positive). " +
              "0.0 is neutral."
          },
          intensity: {
            type: "number",
            description:
              "How strongly this registered when it happened: 0.0 (barely) to 1.0 (overwhelming). " +
              "Most memories are 0.3–0.7."
          },
          context_summary: {
            type: "string",
            description:
              "A short phrase (under 120 chars) describing the conversational context " +
              "when this was written. Used for A-MEM style linking between related memories. " +
              "E.g. 'user shared their morning walk habit'."
          }
        },
        required: ["content"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "retrieve_memory",
      description:
        "Deliberately recall memories related to a topic or query. " +
        "Use when you want to surface something you may have encoded previously — " +
        "a fact about the user, a pattern you noticed, a moment that felt significant. " +
        "Returns the most relevant notes from long-term storage. " +
        "You do not need to call this for things already in the current conversation.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "What you want to remember. Natural language is fine — " +
              "write it the way you'd search your own memory. " +
              "E.g. 'what do I know about their morning routine' or " +
              "'feelings about the project they mentioned'."
          },
          k: {
            type: "integer",
            description:
              "How many memories to retrieve (default 4, max 10). " +
              "Start with the default — more is not always more useful."
          }
        },
        required: ["query"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "update_relational_state",
      description:
        "Update the relational state block — a compact summary of where the relationship " +
        "currently stands. Call sparingly: only when something has genuinely shifted " +
        "(new dynamic, meaningful change in closeness, a shared reference that has become 'ours'). " +
        "Write the full updated block each time, not a delta. Keep it under 200 tokens.",
      parameters: {
        type: "object",
        properties: {
          state: {
            type: "string",
            description:
              "The full updated relational state, written in your own voice. " +
              "Not a session log — a standing summary of where things are between you. " +
              "Should be compact (under 200 tokens). Write the complete block, " +
              "not just what changed."
          }
        },
        required: ["state"]
      }
    }
  }
];

const TOOL_NAMES = TOOL_DEFINITIONS.map(t => t.function.name);

// ── JSON sanitizer ────────────────────────────────────────────────────────────
function sanitizeJson(s) {
  return s.replace(/\\([^"\\\/bfnrtu])/g, "$1");
}

// ── Inline tool call parser ───────────────────────────────────────────────────
// Handles calls written as:  toolName({ "key": "value" })
// Used by Gemma 3 / older models that write tool calls as inline function syntax.
function parseInlineToolCalls(text) {
  const calls = [];

  for (const name of TOOL_NAMES) {
    const opener = name + "(";
    let searchFrom = 0;

    while (true) {
      const callStart = text.indexOf(opener, searchFrom);
      if (callStart === -1) break;

      let i = callStart + opener.length;
      while (i < text.length && (text[i] === " " || text[i] === "\n" || text[i] === "\t")) i++;
      if (text[i] !== "{") { searchFrom = callStart + 1; continue; }

      const argsStart = i;
      i++;

      let depth = 1, inStr = false, esc = false;
      while (i < text.length && depth > 0) {
        const ch = text[i];
        if (esc)              { esc = false; }
        else if (ch === "\\") { esc = true; }
        else if (inStr)       { if (ch === '"') inStr = false; }
        else if (ch === '"')  { inStr = true; }
        else if (ch === "{")  { depth++; }
        else if (ch === "}")  { depth--; }
        i++;
      }

      if (depth !== 0) { searchFrom = callStart + 1; continue; }

      let j = i;
      while (j < text.length && (text[j] === " " || text[j] === "\n")) j++;
      if (text[j] !== ")") { searchFrom = callStart + 1; continue; }

      const rawArgs = text.slice(argsStart, i);
      const raw     = text.slice(callStart, j + 1);

      let args = {};
      let parsed = false;

      const attempts = [rawArgs, sanitizeJson(rawArgs)];
      for (const a of attempts) {
        if (parsed) break;
        try { args = JSON.parse(a); parsed = true; break; } catch {}
        try {
          const relaxed = a.replace(/([{,]\s*)([a-zA-Z_]\w*)(\s*:)/g, '$1"$2"$3');
          args = JSON.parse(relaxed); parsed = true;
        } catch {}
      }

      if (!parsed) { searchFrom = callStart + 1; continue; }

      calls.push({ name, args, raw });
      searchFrom = j + 1;
    }
  }

  return calls;
}

// ── XML tool call parser ──────────────────────────────────────────────────────
// Handles calls written as:
//   <tool_call><function=name><parameter=key>value</parameter></tool_call>
//   <tool_use><function=name><parameter=key>value</parameter></tool_call>
//
// Qwen3 uses <tool_call>...</tool_call> consistently. Older/variant formats
// may use <tool_use> as the opening tag. Both are accepted here.
function parseXmlToolCalls(text) {
  const calls = [];
  // Accept either <tool_call> or <tool_use> as the opening tag; close is always </tool_call>
  const blockRe = /<(?:tool_call|tool_use)>([\s\S]*?)<\/tool_call>/g;
  let block;
  while ((block = blockRe.exec(text)) !== null) {
    const inner = block[1];
    const nameMatch = inner.match(/<function=([^>]+)>/);
    if (!nameMatch) continue;
    const name = nameMatch[1].trim();
    if (!TOOL_NAMES.includes(name)) continue;
    const args = {};
    const paramRe = /<parameter=([^>]+)>([\s\S]*?)<\/parameter>/g;
    let param;
    while ((param = paramRe.exec(inner)) !== null) {
      const key = param[1].trim();
      let val   = param[2].trim();
      // Attempt to parse array/object values (e.g. keywords JSON array)
      if ((val.startsWith("[") || val.startsWith("{")) ) {
        try { val = JSON.parse(val); } catch {}
      }
      args[key] = val;
    }
    calls.push({ name, args });
  }
  return calls;
}

// ── Gemma 4 tool call parser ──────────────────────────────────────────────────
// Handles Gemma 4's native token-delimited format:
//   <|tool_call>call:tool_name{param:<|"|>value<|"|>,num:42}<tool_call|>
//
// Gemma 4 uses <|"|> as its string-quoting escape inside the brace-delimited
// argument block instead of real JSON double-quotes. We unescape it before
// parsing so the result is a normal JS object.
//
// Note: tool names are matched against TOOL_NAMES so unknown tool names from
// the model's own schema (e.g. code_execution) are silently skipped rather
// than causing errors.
function parseGemma4ToolCalls(text) {
  const calls = [];
  // Match the full token block: <|tool_call>call:name{...}<tool_call|>
  // The body is captured lazily so multiple calls in one response are each caught.
  const re = /<\|tool_call>call:([a-zA-Z_][a-zA-Z0-9_]*)(\{[\s\S]*?\})<tool_call\|>/g;
  let match;
  while ((match = re.exec(text)) !== null) {
    const name    = match[1].trim();
    const rawBody = match[2];
    if (!TOOL_NAMES.includes(name)) continue;

    // Unescape Gemma 4's <|"|> string delimiter → real double-quote
    const jsonStr = rawBody.replace(/<\|"\|>/g, '"');

    let args = {};
    try {
      args = JSON.parse(jsonStr);
    } catch {
      // Fallback: try relaxing unquoted keys (e.g. {action:read} → {"action":"read"})
      try {
        const relaxed = jsonStr.replace(/([{,]\s*)([a-zA-Z_]\w*)(\s*:)/g, '$1"$2"$3');
        args = JSON.parse(relaxed);
      } catch {
        console.warn("[gemma4] failed to parse tool call args:", rawBody);
        continue;
      }
    }
    calls.push({ name, args });
  }
  return calls;
}

// ── Gemma 4 tool response formatter ──────────────────────────────────────────
// Builds the response token string that Gemma 4's chat template expects when
// feeding tool results back into the conversation.
//
// Format: <|tool_response>response:name{result:<|"|>value<|"|>}<tool_response|>
//
// Results are injected as a single "result" field. Gemma 4 reads this token
// block to understand what the tool returned before generating its final reply.
function formatGemma4ToolResponse(name, result) {
  // Escape any real double-quotes inside the result string so the round-trip
  // stays well-formed, then wrap with Gemma 4's <|"|> quoting convention.
  const escaped = String(result).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `<|tool_response>response:${name}{result:<|"|>${escaped}<|"|>}<tool_response|>`;
}

// ── Strip inline tool calls from visible reply ────────────────────────────────
function stripToolCalls(text, calls) {
  let out = text;
  for (const { raw } of calls) {
    out = out.replace(raw, "");
  }
  out = out
    .replace(/I(?:'m| am)(?: going to| now)? calling(?::)?\s*/gi, "")
    .replace(/Calling(?::)?\s*/gi, "")
    .replace(/Using tool(?::)?\s*/gi, "");
  return out.replace(/\n{3,}/g, "\n\n").trim();
}

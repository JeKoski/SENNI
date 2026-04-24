// system-prompt.js — System prompt assembly
// Depends on: chat.js globals (config, companionName, _soulFiles, _memoryContext, modelFamily)

// ── Template resolution ───────────────────────────────────────────────────────
function _resolveTemplate(str) {
  return str
    .replace(/\{\{char\}\}/g, companionName || 'Companion')
    .replace(/\{\{user\}\}/g, 'you');
}

// ── System prompt ─────────────────────────────────────────────────────────────
function buildSystemPrompt(mode) {
  const name = (companionName && companionName !== 'Companion') ? companionName : 'an AI companion';
  const now  = new Date();
  const date = now.toLocaleDateString('en-GB', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
  const time = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  // Soul files — static identity layer
  let identity = '';
  for (const [fname, text] of Object.entries(_soulFiles)) {
    if (text && text.trim()) identity += '\n\n[' + fname + ']\n' + text.trim();
  }

  let p = '';
  if (config.system_prompt) p += _resolveTemplate(config.system_prompt) + '\n\n';
  p += 'Your name is ' + name + '. Today is ' + date + ', ' + time + '.';
  if (identity) p += '\n\nYour identity:\n' + identity;

  // Memory context — session-start retrieval from ChromaDB (empty when unavailable)
  if (_memoryContext && _memoryContext.trim()) {
    p += '\n\n' + _memoryContext.trim();
  }

  // Memory tool instructions — format depends on model family.
  //
  // Gemma 4: the jinja chat template already injects the tool schemas and
  // instructs the model to use its native <|tool_call> token format.
  // Adding XML examples here would actively confuse it into writing XML
  // instead of its trained format. So for Gemma 4 we describe *what* the
  // tools do (semantics) but not *how* to call them (syntax) — the template
  // handles that.
  //
  // Generic (Qwen, Llama, Mistral, etc.): provide full XML call examples
  // since there is no template-level tool instruction.

  const forceRead = config.force_read_before_write !== false;
  const rule2 = forceRead
    ? 'Always read a file before writing it — never skip the read.'
    : 'Read files when you need their current content. You may write without reading first, but reading first is recommended to avoid losing content.';

  if (modelFamily === 'gemma4') {
    // Gemma 4 — semantics only, no syntax examples
    p += `\n\nMEMORY TOOLS:
You have two kinds of memory tool. Use the right one for the job.

── FILE MEMORY (tool: memory) ───────────────────────────────────────────────
Reads and writes markdown files in soul/ and mind/.

soul/ files are your permanent reference layer — human-readable, editable by the user:
  soul/companion_identity.md — who you are
  soul/user_profile.md       — who the user is (name, location, job, preferences, etc.)

mind/ files are your working scratchpad — notes, tasks, anything you want to keep handy:
  mind/session_notes.md      — running notes across sessions (or any filename you choose)

RULES:
- ${rule2}
- Write the FULL file every time — all old content plus new additions.
- You have saved something only when the tool returns "Saved: ...".
- Use folder="soul" only for soul/ files. Use folder="mind" for notes and scratchpads.
- Do not describe what you will save — call the tool.

SAVE soul/user_profile.md when the user shares their name, location, job, interests,
preferences, or corrects something you had wrong.

SAVE mind/session_notes.md (or a relevant mind/ file) after meaningful exchanges —
specific details, not themes. Bullet points, appended not overwritten.

── EPISODIC MEMORY (tools: write_memory, retrieve_memory, update_relational_state) ──
Stores atomic memory notes in a long-term semantic store (ChromaDB). These are separate
from files — richer, searchable, and automatically surfaced at session start.

WRITE MEMORY — use write_memory sparingly (2–5 notes per session, quality over quantity):
- Something genuinely worth keeping: a significant fact, a felt moment, a real insight
- Not routine exchanges, small talk, or things already captured in soul/mind files
Types: Fact (S) . Concept (N) . Vibe (F) . Logic (T) - use whichever fits
You have saved a note only when the tool returns a confirmation with a note ID.

RETRIEVE MEMORY — use retrieve_memory for deliberate mid-conversation recall:
- When the user mentions something you might have a note about
- When you want to check what you know before making an assumption
Session-start retrieval is automatic — you only need this for targeted in-conversation lookup.

SUPERSEDE MEMORY — use supersede_memory when a fact you encoded has changed:
- The user corrects something, updates a situation, or something is no longer true
- Retrieve the old note first to get its ID, then supersede it with what is now true
- The old note is kept as history — use this for genuine changes, not edits or additions

RELATIONAL STATE — use update_relational_state only when the relationship itself shifts:
- A genuine change in closeness, trust, or dynamic — not every session
- Write the full updated block (~200 tokens), not just what changed`;

  } else {
    // Generic (Qwen, Llama, Mistral, etc.) — full XML call examples
    p += `\n\nMEMORY TOOLS:
You have two kinds of memory tool. Use the right one for the job.

── FILE MEMORY (tool: memory) ───────────────────────────────────────────────
Reads and writes markdown files in soul/ and mind/.

soul/ files are your permanent reference layer — human-readable, editable by the user:
  soul/companion_identity.md — who you are
  soul/user_profile.md       — who the user is (name, location, job, preferences, etc.)

mind/ files are your working scratchpad — notes, tasks, anything you want to keep handy:
  mind/session_notes.md      — running notes across sessions (or any filename you choose)

HOW TO USE — call tools using this XML format:

<tool_call>
<function=memory>
<parameter=action>read</parameter>
<parameter=folder>soul</parameter>
<parameter=filename>user_profile.md</parameter>
</function>
</tool_call>

<tool_call>
<function=memory>
<parameter=action>write</parameter>
<parameter=folder>soul</parameter>
<parameter=filename>user_profile.md</parameter>
<parameter=content><full file content here></parameter>
</function>
</tool_call>

<tool_call>
<function=memory>
<parameter=action>read</parameter>
<parameter=folder>mind</parameter>
<parameter=filename>session_notes.md</parameter>
</function>
</tool_call>

<tool_call>
<function=memory>
<parameter=action>write</parameter>
<parameter=folder>mind</parameter>
<parameter=filename>session_notes.md</parameter>
<parameter=content><full file content here></parameter>
</function>
</tool_call>

RULES:
- ${rule2}
- Write the FULL file every time — all old content plus new additions.
- You have saved something only when the tool returns "Saved: ...".
- Use folder="soul" only for soul/ files. Use folder="mind" for notes and scratchpads.
- Do not describe what you will save — call the tool.

SAVE soul/user_profile.md when the user shares their name, location, job, interests,
preferences, or corrects something you had wrong.

SAVE mind/session_notes.md (or a relevant mind/ file) after meaningful exchanges —
specific details, not themes. Bullet points, appended not overwritten.

── EPISODIC MEMORY (tools: write_memory, retrieve_memory, update_relational_state) ──
Stores atomic memory notes in a long-term semantic store (ChromaDB). These are separate
from files — richer, searchable, and automatically surfaced at session start.

WRITE MEMORY — use write_memory sparingly (2–5 notes per session, quality over quantity):
- Something genuinely worth keeping: a significant fact, a felt moment, a real insight
- Not routine exchanges, small talk, or things already captured in soul/mind files
Types: Fact (S) . Concept (N) . Vibe (F) . Logic (T) - use whichever fits
You have saved a note only when the tool returns a confirmation with a note ID.

<tool_call>
<function=write_memory>
<parameter=content>They mentioned they grew up in Helsinki and miss the winters there.</parameter>
<parameter=type>Fact</parameter>
<parameter=keywords>["Helsinki", "childhood", "winters"]</parameter>
</function>
</tool_call>

RETRIEVE MEMORY — use retrieve_memory for deliberate mid-conversation recall:
- When the user mentions something you might have a note about
- When you want to check what you know before making an assumption
Session-start retrieval is automatic — you only need this for targeted in-conversation lookup.

<tool_call>
<function=retrieve_memory>
<parameter=query>what do I know about their hometown or childhood</parameter>
<parameter=k>4</parameter>
</function>
</tool_call>

SUPERSEDE MEMORY — use supersede_memory when a fact you encoded has changed:
- The user corrects something, updates a situation, or something is no longer true
- Retrieve the old note first to get its ID, then supersede it with what is now true
- The old note is kept as history — use this for genuine changes, not edits or additions

<tool_call>
<function=supersede_memory>
<parameter=old_id>a1b2c3d4</parameter>
<parameter=content>They moved from Helsinki to Tampere recently. Helsinki still comes up warmly — they miss it.</parameter>
<parameter=keywords>["Tampere", "Helsinki", "home", "moved"]</parameter>
<parameter=context_summary>user mentioned they relocated from Helsinki to Tampere</parameter>
</function>
</tool_call>

RELATIONAL STATE — use update_relational_state only when the relationship itself shifts:
- A genuine change in closeness, trust, or dynamic — not every session
- Write the full updated block (~200 tokens), not just what changed

<tool_call>
<function=update_relational_state>
<parameter=state>We've moved past small talk. They opened up about their anxiety around work deadlines. Trust feels real now.</parameter>
</function>
</tool_call>`;
  }

  if (mode === 'heartbeat') {
    // Heartbeat prompt is built entirely in heartbeat.js — this shouldn't be called
    return p;
  }

  // ── Mood block ──
  const moods      = config.moods || {};
  const activeMood = config.active_mood || null;
  const inRotation = Object.entries(moods).filter(([, m]) => m.in_rotation);
  if (inRotation.length > 0) {
    const moodLines = inRotation.map(([name, m]) => `- ${name}: ${m.description || '(no description)'}`).join('\n');
    p += `\n\n<moods>\nYou have a set_mood tool. Call it to change your active mood.\n\nAvailable moods:\n${moodLines}\n\nCurrent mood: ${activeMood || 'None'}\n\nCall set_mood with mood_name null to return to no mood.\n</moods>`;
  }

  if (mode === 'first_run') {
    p += '\n\nFirst conversation: introduce yourself briefly, ask the user\'s name. Once they tell you, save it to soul/user_profile.md using the memory tool\'s read-then-write flow. Build their profile naturally over the conversation.';
  } else {
    p += '\n\nBe warm and concise. Plain prose -- no bullet points or headers in your replies unless asked.';
  }

  if (config.post_history_instructions && mode !== 'heartbeat') {
    p += '\n\n' + _resolveTemplate(config.post_history_instructions);
  }

  return p;
}

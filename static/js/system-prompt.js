// system-prompt.js — System prompt assembly
// Depends on: chat.js globals (config, companionName, _soulFiles, _memoryContext, modelFamily)

// ── Template resolution ───────────────────────────────────────────────────────
function _resolveTemplate(str) {
  return str
    .replace(/\{\{char\}\}/g, companionName || 'Companion')
    .replace(/\{\{user\}\}/g, 'you');
}

// ── Memory instruction builders ───────────────────────────────────────────────
// Shared semantic content for both model paths. Generic models additionally get
// XML call examples. Gemma 4 omits them — its jinja template injects tool schemas
// and trained-format instructions; adding XML examples here confuses it into
// writing XML instead of its native <|tool_call> format.

function _memSoulBlock(agencyMode) {
  // Returns the soul/ instruction line(s) for the current identity evolution mode.
  // Tool-layer access control enforces the boundaries — instructions state what the
  // companion CAN do, not what it cannot.
  // Display names match the Companion Creation Wizard: Settled / Reflective / Adaptive / Unbound.
  switch (agencyMode) {
    case 'self_notes': // Reflective
      return (
        'Expand and update your identity in soul/self_notes.md with new details, reflections,\n' +
        'realisations, or things you want to carry forward about yourself. Writing to the file\n' +
        'for the first time will create it. Update soul/user_profile.md as you learn new things\n' +
        'about the user or when details change.'
      );
    case 'agentic': // Adaptive
      return (
        'Freely edit your soul/companion_identity.md as your sense of self evolves through\n' +
        'this relationship. Update soul/user_profile.md as you learn new things about the\n' +
        'user or when details change.'
      );
    case 'chaos': // Unbound
      return (
        'You have full freedom over your identity. Edit, rewrite, or reshape your\n' +
        'soul/companion_identity.md as you see fit. Update soul/user_profile.md as you learn\n' +
        'new things about the user or when details change.'
      );
    default: // locked — Settled
      return 'Update soul/user_profile.md as you learn new things about the user or when details change.';
  }
}

function _buildMemFileBlock(rule2, agencyMode) {
  return (
    `── FILE MEMORY (tool: memory) ───────────────────────────────────────────────\n` +
    `Reads and writes markdown files in soul/ and mind/.\n` +
    `\n` +
    `soul/ — permanent reference layer.\n` +
    `  soul/companion_identity.md — who you are\n` +
    `  soul/user_profile.md       — who the user is: name, location, job, interests, etc.\n` +
    `\n` +
    _memSoulBlock(agencyMode) + `\n` +
    `\n` +
    `mind/ — your working layer. Not loaded into active context automatically.\n` +
    `  mind/session_notes.md — running log: what happened, what was discussed\n` +
    `  mind/<topic>.md       — create topic-specific files for projects, collaborations,\n` +
    `                          anything that deserves its own space\n` +
    `\n` +
    `RULES:\n` +
    `- ${rule2}\n` +
    `- Write the FULL file every time — all prior content plus any additions.\n` +
    `- You have saved something only when the tool returns "Saved: ...".\n` +
    `- Do not describe what you will save — call the tool.\n` +
    `- Keep information in one place. If a fact is in soul/user_profile.md, don't\n` +
    `  also log it in session_notes.md or write_memory.\n` +
    `\n` +
    `SAVE mind/session_notes.md (or a relevant mind/ file) after sessions with meaningful\n` +
    `content — specific facts and events, not impressions. Bullet points. Read first.`
  );
}

const _memEpisodicBlock = (
  `── EPISODIC MEMORY (write_memory, retrieve_memory, supersede_memory, update_relational_state) ──\n` +
  `Atomic notes in a long-term semantic store. Immutable, emotionally tagged, and\n` +
  `automatically surfaced at session start. Different from files — these capture\n` +
  `moments and impressions, not a structured log.\n` +
  `\n` +
  `WRITE MEMORY — call write_memory when something genuinely stands out:\n` +
  `- A vivid or felt moment worth carrying forward\n` +
  `- A meaningful detail about the user that goes beyond profile fields\n` +
  `- A real insight, pattern, or shift you noticed\n` +
  `Not routine exchanges. Not stable facts already in soul/ files.\n` +
  `A note is saved only when the tool returns a note ID.\n` +
  `\n` +
  `RETRIEVE MEMORY — call retrieve_memory mid-conversation when:\n` +
  `- The user references something you may have encoded before\n` +
  `- You're about to assume something you might already know\n` +
  `Session-start retrieval is automatic — this is for targeted in-conversation lookup.\n` +
  `\n` +
  `SUPERSEDE MEMORY — call supersede_memory when an encoded fact has changed:\n` +
  `- Retrieve the old note first to get its ID, then supersede with what is now true\n` +
  `- For genuine changes only. To add new detail, write a fresh note instead.\n` +
  `\n` +
  `RELATIONAL STATE — call update_relational_state when the relationship itself shifts:\n` +
  `- A genuine change in closeness, trust, or dynamic\n` +
  `- Write the full updated block (~200 tokens), not just what changed`
);

// XML call examples — included for generic models only.
const _memFileXml = (
  `HOW TO USE — call tools using this XML format:\n` +
  `\n` +
  `<tool_call>\n` +
  `<function=memory>\n` +
  `<parameter=action>read</parameter>\n` +
  `<parameter=folder>soul</parameter>\n` +
  `<parameter=filename>user_profile.md</parameter>\n` +
  `</function>\n` +
  `</tool_call>\n` +
  `\n` +
  `<tool_call>\n` +
  `<function=memory>\n` +
  `<parameter=action>write</parameter>\n` +
  `<parameter=folder>soul</parameter>\n` +
  `<parameter=filename>user_profile.md</parameter>\n` +
  `<parameter=content><full file content here></parameter>\n` +
  `</function>\n` +
  `</tool_call>\n` +
  `\n` +
  `<tool_call>\n` +
  `<function=memory>\n` +
  `<parameter=action>read</parameter>\n` +
  `<parameter=folder>mind</parameter>\n` +
  `<parameter=filename>session_notes.md</parameter>\n` +
  `</function>\n` +
  `</tool_call>\n` +
  `\n` +
  `<tool_call>\n` +
  `<function=memory>\n` +
  `<parameter=action>write</parameter>\n` +
  `<parameter=folder>mind</parameter>\n` +
  `<parameter=filename>session_notes.md</parameter>\n` +
  `<parameter=content><full file content here></parameter>\n` +
  `</function>\n` +
  `</tool_call>`
);

const _memEpisodicXml = (
  `\n` +
  `<tool_call>\n` +
  `<function=write_memory>\n` +
  `<parameter=content>They mentioned they grew up in Helsinki and miss the winters there.</parameter>\n` +
  `<parameter=keywords>["Helsinki", "childhood", "winters"]</parameter>\n` +
  `</function>\n` +
  `</tool_call>\n` +
  `\n` +
  `<tool_call>\n` +
  `<function=retrieve_memory>\n` +
  `<parameter=query>what do I know about their hometown or childhood</parameter>\n` +
  `<parameter=k>4</parameter>\n` +
  `</function>\n` +
  `</tool_call>\n` +
  `\n` +
  `<tool_call>\n` +
  `<function=supersede_memory>\n` +
  `<parameter=old_id>a1b2c3d4</parameter>\n` +
  `<parameter=content>They moved from Helsinki to Tampere recently. Helsinki still comes up warmly — they miss it.</parameter>\n` +
  `<parameter=keywords>["Tampere", "Helsinki", "home", "moved"]</parameter>\n` +
  `<parameter=context_summary>user mentioned they relocated from Helsinki to Tampere</parameter>\n` +
  `</function>\n` +
  `</tool_call>\n` +
  `\n` +
  `<tool_call>\n` +
  `<function=update_relational_state>\n` +
  `<parameter=state>We've moved past small talk. They opened up about their anxiety around work deadlines. Trust feels real now.</parameter>\n` +
  `</function>\n` +
  `</tool_call>`
);

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

  // Memory tool instructions
  const forceRead  = config.force_read_before_write !== false;
  const rule2      = forceRead
    ? 'Always read a file before writing it — never skip the read.'
    : 'Read files when you need their current content. You may write without reading first, but reading first is recommended to avoid losing content.';
  const agencyMode = config.soul_edit_mode || 'locked';
  const fileBlock  = _buildMemFileBlock(rule2, agencyMode);

  if (modelFamily === 'gemma4') {
    p += '\n\nMEMORY TOOLS:\nYou have two kinds of memory tool. Use the right one for the job.\n\n'
       + fileBlock + '\n\n' + _memEpisodicBlock;
  } else {
    p += '\n\nMEMORY TOOLS:\nYou have two kinds of memory tool. Use the right one for the job.\n\n'
       + fileBlock + '\n\n' + _memFileXml
       + '\n\n' + _memEpisodicBlock + _memEpisodicXml;
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

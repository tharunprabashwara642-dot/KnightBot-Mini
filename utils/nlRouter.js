/**
 * Natural-Language Command Router
 * --------------------------------
 * Converts every loaded command into a Gemini function-calling "tool",
 * then lets Gemini decide which command(s) to run based on the user's
 * plain-English message — so the user no longer has to type `.song`,
 * `.fb`, etc. by name inside `.gemini`.
 *
 * If Gemini returns tool call(s), we execute the matched command(s)
 * programmatically in the current chat context.
 * If Gemini returns plain text, we return it as a normal chat reply.
 * If the request is ambiguous or missing required info, Gemini is
 * instructed to ask a short clarifying question instead of guessing.
 */

const gemini = require('./gemini');

// Commands that should never be exposed as routable tools, even for the
// owner. These are either dangerous (self-modifying code, restart), meta
// (the router itself, the menu), or require interactive WhatsApp flows
// (media replies) that don't make sense to trigger from natural language.
const EXCLUDED_COMMANDS = new Set([
  'gemini', 'gem',         // the router itself — prevents infinite recursion
  'evolve', 'selfedit', 'selfevolve', // self-modifying code
  'evolverollback', 'evolvehistory',
  'restart',               // kills the process
  'menu', 'help', 'commands', // listing commands
  'start',                 // pair-code / interactive flow
]);

// Commands that need special handling because they parse raw message text
// instead of using args. We synthesize a fake message for these.
const RAW_TEXT_COMMANDS = new Set(['facebook', 'fb', 'fbdl', 'facebookdl']);

/**
 * Infer a reasonable parameter schema from a command's usage/description.
 * Most commands take a single free-text argument (song name, URL, question).
 * Returns a Gemini functionDeclaration-compatible parameter object.
 */
function inferParameters(command) {
  const usage = command.usage || '';
  const hasArgs = usage.includes('<') || usage.includes('[');

  if (!hasArgs) {
    return { type: 'object', properties: {} };
  }

  // Most commands take a single text argument (song name, URL, city, etc.)
  return {
    type: 'object',
    properties: {
      input: {
        type: 'string',
        description: `The argument for this command. Usage: ${usage}`,
      },
    },
    required: ['input'],
  };
}

/**
 * Build Gemini tool declarations from the command registry.
 * Only includes commands that are safe to route and that the current
 * user is allowed to use (owner-only commands are filtered out for
 * non-owners).
 */
function buildToolDeclarations(commands, isOwner) {
  const seen = new Set();
  const declarations = [];

  commands.forEach((cmd, aliasName) => {
    // Only register each command once (under its primary name, not aliases)
    if (cmd.name !== aliasName) return;
    if (seen.has(cmd.name)) return;
    seen.add(cmd.name);

    if (EXCLUDED_COMMANDS.has(cmd.name)) return;
    if (cmd.ownerOnly && !isOwner) return;

    // Skip commands that require group context or admin rights — they
    // can't be meaningfully triggered from a generic NL router.
    if (cmd.groupOnly || cmd.adminOnly || cmd.botAdminNeeded) return;

    declarations.push({
      name: cmd.name,
      description: cmd.description || cmd.name,
      parameters: inferParameters(cmd),
    });
  });

  return declarations;
}

/**
 * Build the system instruction that tells Gemini how to behave as a router.
 */
function buildSystemInstruction(toolCount) {
  return `You are the command router for a WhatsApp bot. The user sent you a message inside the .gemini command. ` +
    `You have ${toolCount} bot commands available as tools. Your job is to decide whether the user's message ` +
    `matches one or more of these commands.\n\n` +
    `Rules:\n` +
    `- If the user's request clearly matches one or more commands, call the matching tool(s) with the correct ` +
    `argument extracted from the user's message. For example, "download the song Bohemian Rhapsody" → call ` +
    `the song tool with input="Bohemian Rhapsody".\n` +
    `- If the user's request matches multiple commands ambiguously, or is missing required information (e.g. ` +
    `"download it" with no song name or URL), do NOT guess. Instead, reply with ONE short clarifying question ` +
    `asking the user what they mean.\n` +
    `- If the user's request is a general question or conversation that doesn't match any command, reply with ` +
    `a normal helpful text response. Do not force a tool call.\n` +
    `- You may call multiple tools in one response if the user's request clearly requires multiple actions ` +
    `(e.g. "download this song and translate hello to Spanish" = two tool calls).\n` +
    `- Never call a tool you don't have. Never invent tool names.\n` +
    `- After you call a tool, reply with a brief plain-text confirmation of what you did or what the result was. ` +
    `Do not repeat the tool's output verbatim — summarize it.`;
}

/**
 * Execute a matched command programmatically.
 * Creates the same `extra` object the handler would create, and a
 * synthetic message for commands that parse raw text.
 */
async function executeCommand(command, toolInput, sock, msg, extra) {
  const args = toolInput ? String(toolInput).trim().split(/\s+/).filter(Boolean) : [];

  // For commands that parse raw message text (facebook, tiktok),
  // synthesize a message object that looks like ".commandName input"
  // so their internal parsing still works.
  const fakeMsg = RAW_TEXT_COMMANDS.has(command.name)
    ? {
        key: msg.key,
        message: {
          extendedTextMessage: {
            text: `.${command.name} ${args.join(' ')}`,
            contextInfo: msg.message?.extendedTextMessage?.contextInfo,
          },
        },
      }
    : msg;

  await command.execute(sock, fakeMsg, args, extra);
}

/**
 * Main entry point: given the user's text, the command registry, and the
 * chat context, use Gemini to route to the right command(s).
 *
 * Returns:
 *   - { type: 'text', text } — plain text reply (no command matched)
 *   - { type: 'executed', commands: [...] } — command(s) were executed
 *   - { type: 'clarify', text } — Gemini asked a clarifying question
 */
async function route(userText, commands, sock, msg, extra) {
  if (!gemini.hasKeys()) {
    throw new Error('No Gemini API key configured.');
  }

  const isOwner = extra.isOwner;
  const declarations = buildToolDeclarations(commands, isOwner);

  if (declarations.length === 0) {
    // No routable commands available — fall back to plain chat
    const reply = await gemini.chat(userText);
    return { type: 'text', text: reply || '⚠️ Empty response.' };
  }

  const tools = [{ functionDeclarations: declarations }];
  const systemInstruction = {
    parts: [{ text: buildSystemInstruction(declarations.length) }],
  };

  const contents = [{ role: 'user', parts: [{ text: userText }] }];

  const result = await gemini.generate(contents, { tools, systemInstruction });

  // No tool calls → plain text response (or clarifying question)
  if (!result.functionCalls || result.functionCalls.length === 0) {
    return { type: 'text', text: result.text || '⚠️ Empty response.' };
  }

  // Execute each matched command
  const executed = [];
  for (const call of result.functionCalls) {
    const command = commands.get(call.name);
    if (!command) {
      console.warn(`[nlRouter] Gemini called unknown tool: ${call.name}`);
      continue;
    }

    // Safety: double-check owner-only even though we filtered tools
    if (command.ownerOnly && !isOwner) {
      console.warn(`[nlRouter] Non-owner tried to route to owner-only command: ${call.name}`);
      continue;
    }

    try {
      const toolInput = call.args?.input;
      await executeCommand(command, toolInput, sock, msg, extra);
      executed.push(call.name);
    } catch (err) {
      console.error(`[nlRouter] Error executing routed command ${call.name}:`, err.message);
      await extra.reply(`❌ ${call.name} failed: ${err.message}`);
    }
  }

  // If Gemini also provided text alongside the tool calls, send it
  if (result.text && result.text.trim()) {
    await extra.reply(result.text.trim());
  }

  if (executed.length === 0 && !result.text) {
    return { type: 'text', text: '⚠️ Could not process that request.' };
  }

  return { type: 'executed', commands: executed };
}

module.exports = { route, buildToolDeclarations, EXCLUDED_COMMANDS };

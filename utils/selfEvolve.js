/**
 * Self-Evolve Engine
 * ------------------
 * Lets the bot owner hand Gemini a plain-English instruction (via the
 * .evolve command) and have Gemini read and rewrite the bot's OWN source
 * files to carry it out, autonomously — a small agent loop with
 * function-calling tools (list_files / read_file / write_file).
 *
 * Safety measures:
 *  - Always owner-gated (checked in commands/owner/evolve.js) and only
 *    runs at all if config.selfEvolve.enabled (or ALLOW_SELF_EVOLVE=true).
 *  - Every write is confined to the project root (path traversal blocked).
 *  - node_modules/, .git/, session (auth folder), database/, .env,
 *    package-lock.json can never be touched.
 *  - Before the first write of a run, a checkpoint is taken (a git commit
 *    if the project is a git repo, otherwise a timestamped file backup) so
 *    the whole run can be rolled back with .evolverollback.
 *  - Every write is syntax-checked with `node --check` immediately after
 *    writing; if it fails, the file is restored to what it was before that
 *    write and Gemini is told the error so it can try again.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const gemini = require('./gemini');

const ROOT = path.join(__dirname, '..');
const STATE_FILE = path.join(ROOT, 'database', 'evolve_state.json');
const BACKUP_ROOT = path.join(ROOT, '.evolve_backups');

const EXCLUDED_TOP_LEVEL = new Set([
  'node_modules', '.git', 'session', 'database', 'tmp', 'temp',
  '.evolve_backups', '.env', 'package-lock.json'
]);

const MAX_STEPS = 8;
const MAX_FILE_BYTES = 300000;

// ---------- small persisted state (last checkpoint, for rollback) ----------

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function saveState(state) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// ---------------------------- path safety ----------------------------

function isExcluded(relPath) {
  const first = relPath.split(path.sep)[0];
  return EXCLUDED_TOP_LEVEL.has(first) || first.startsWith('.');
}

function safePath(relPath) {
  const clean = String(relPath || '').replace(/^[/\\]+/, '');
  const resolved = path.resolve(ROOT, clean);
  const rel = path.relative(ROOT, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('Path escapes project root');
  }
  if (isExcluded(rel)) {
    throw new Error(`Path "${rel}" is protected and cannot be read/written by evolve`);
  }
  return { abs: resolved, rel };
}

// ---------------------------- git helpers ----------------------------

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' });
}

function isGitRepo() {
  try {
    git(['rev-parse', '--is-inside-work-tree']);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------- checkpoint / rollback ----------------------------

function createCheckpoint() {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  if (isGitRepo()) {
    try {
      git(['add', '-A']);
      git(['commit', '-m', `evolve checkpoint ${ts}`, '--allow-empty']);
      const sha = git(['log', '--format=%H', '-1']).trim();
      saveState({ type: 'git', sha, ts });
      return { type: 'git', sha, ts };
    } catch (e) {
      // fall through to file backup if git commit fails for any reason
    }
  }
  const dir = path.join(BACKUP_ROOT, ts);
  fs.mkdirSync(dir, { recursive: true });
  saveState({ type: 'files', dir, ts, files: [] });
  return { type: 'files', dir, ts };
}

function backupFileBeforeWrite(checkpoint, rel, abs) {
  if (checkpoint.type !== 'files') return;
  const dest = path.join(checkpoint.dir, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (fs.existsSync(abs)) {
    fs.copyFileSync(abs, dest);
  } else {
    fs.writeFileSync(dest + '.__new__', ''); // marker: file did not exist before
  }
  const state = loadState();
  if (state && state.type === 'files') {
    state.files = state.files || [];
    if (!state.files.includes(rel)) state.files.push(rel);
    saveState(state);
  }
}

function rollbackLast() {
  const state = loadState();
  if (!state) {
    throw new Error('No evolve checkpoint found to roll back to.');
  }
  if (state.type === 'git') {
    if (!isGitRepo()) throw new Error('Checkpoint was git-based but this is no longer a git repo.');
    git(['reset', '--hard', state.sha]);
    return `Rolled back to git checkpoint ${state.sha.slice(0, 10)} (${state.ts}).`;
  }
  // file-backup based rollback
  const files = state.files || [];
  let restored = 0;
  for (const rel of files) {
    const backupPath = path.join(state.dir, rel);
    const abs = path.join(ROOT, rel);
    if (fs.existsSync(backupPath)) {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.copyFileSync(backupPath, abs);
      restored++;
    } else if (fs.existsSync(backupPath + '.__new__')) {
      // file didn't exist before the run — remove it
      try { fs.unlinkSync(abs); } catch {}
      restored++;
    }
  }
  return `Restored ${restored} file(s) from backup taken at ${state.ts}.`;
}

// ---------------------------- syntax check ----------------------------

function syntaxCheck(abs) {
  if (!abs.endsWith('.js')) return { ok: true };
  try {
    execFileSync(process.execPath, ['--check', abs], { encoding: 'utf8' });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e.stderr || e.message || '').toString().slice(0, 2000) };
  }
}

// ---------------------------- file tools ----------------------------

function listFiles() {
  const out = [];
  function walk(dir, rel) {
    for (const entry of fs.readdirSync(dir)) {
      const abs = path.join(dir, entry);
      const relPath = path.join(rel, entry);
      if (isExcluded(relPath)) continue;
      const stat = fs.statSync(abs);
      if (stat.isDirectory()) {
        walk(abs, relPath);
      } else {
        out.push(relPath.split(path.sep).join('/'));
      }
      if (out.length > 2000) return;
    }
  }
  walk(ROOT, '');
  return out;
}

function readFile(relPathIn) {
  const { abs, rel } = safePath(relPathIn);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
    throw new Error(`File not found: ${rel}`);
  }
  const content = fs.readFileSync(abs, 'utf8');
  return content.length > MAX_FILE_BYTES
    ? content.slice(0, MAX_FILE_BYTES) + '\n\n[...truncated...]'
    : content;
}

function writeFile(relPathIn, content, checkpoint) {
  const { abs, rel } = safePath(relPathIn);
  backupFileBeforeWrite(checkpoint, rel, abs);

  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const previousExisted = fs.existsSync(abs);
  const previousContent = previousExisted ? fs.readFileSync(abs, 'utf8') : null;

  fs.writeFileSync(abs, content, 'utf8');

  const check = syntaxCheck(abs);
  if (!check.ok) {
    // discard: restore previous content (or delete if it's a new file)
    if (previousExisted) {
      fs.writeFileSync(abs, previousContent, 'utf8');
    } else {
      try { fs.unlinkSync(abs); } catch {}
    }
    return { ok: false, path: rel, error: `Syntax check failed, change discarded: ${check.error}` };
  }

  if (checkpoint.type === 'git' && isGitRepo()) {
    try {
      git(['add', '--', rel]);
      git(['commit', '-m', `evolve: ${rel}`]);
    } catch {
      // nothing to commit or commit failed — write itself still succeeded
    }
  }

  return { ok: true, path: rel, bytes: Buffer.byteLength(content) };
}

// ---------------------------- Gemini tool declarations ----------------------------

const TOOL_DECLARATIONS = [{
  functionDeclarations: [
    {
      name: 'list_files',
      description: 'List all project files (relative paths), excluding node_modules, .git, session, database, and other protected paths.',
      parameters: { type: 'object', properties: {} }
    },
    {
      name: 'read_file',
      description: 'Read the full UTF-8 contents of a project file.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: 'Path relative to the project root' } },
        required: ['path']
      }
    },
    {
      name: 'write_file',
      description: 'Create or overwrite a project file with new full content. The file is syntax-checked immediately; if it fails, the change is discarded and you will be told the error so you can fix it and try again.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path relative to the project root' },
          content: { type: 'string', description: 'The complete new file content' }
        },
        required: ['path', 'content']
      }
    }
  ]
}];

const SYSTEM_INSTRUCTION = `You are the self-evolution engine for a WhatsApp bot (KnightBot Mini, Node.js, ` +
  `Baileys-based). The bot owner will give you a task. Use the list_files, read_file, and ` +
  `write_file tools to inspect the project and make the requested change directly in the source ` +
  `code. Rules:\n` +
  `- Always read a file with read_file before rewriting it with write_file, so you don't lose ` +
  `existing code — write_file replaces the ENTIRE file content.\n` +
  `- Never invent file paths; use list_files/read_file to confirm a file exists first.\n` +
  `- You cannot access node_modules/, .git/, session/, database/, .env, or package-lock.json — ` +
  `don't try.\n` +
  `- Keep changes minimal and focused on the request. Don't refactor unrelated code.\n` +
  `- If a write_file call fails its syntax check, fix the specific error and call write_file again.\n` +
  `- When you are done, reply with plain text only (no more tool calls): a short summary of what ` +
  `files you changed and why. If you cannot complete the task, explain what's blocking you.`;

// ---------------------------- agent loop ----------------------------

async function runEvolve(instruction) {
  if (!gemini.hasKeys()) {
    throw new Error('No Gemini API key configured. Add one in config.js (gemini.apiKeys) or set GEMINI_API_KEY / GEMINI_API_KEYS.');
  }

  const checkpoint = createCheckpoint();
  const changedFiles = [];
  const contents = [{ role: 'user', parts: [{ text: instruction }] }];

  for (let step = 0; step < MAX_STEPS; step++) {
    const result = await gemini.generate(contents, {
      tools: TOOL_DECLARATIONS,
      systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] }
    });

    if (!result.functionCalls || result.functionCalls.length === 0) {
      return {
        summary: result.text || '(no summary provided)',
        changedFiles,
        checkpoint,
        steps: step + 1
      };
    }

    // Echo the model's function-call turn back, then supply function results.
    contents.push({ role: 'model', parts: result.functionCalls.map(fc => ({ functionCall: fc })) });

    const responseParts = [];
    for (const call of result.functionCalls) {
      let response;
      try {
        if (call.name === 'list_files') {
          response = { files: listFiles() };
        } else if (call.name === 'read_file') {
          response = { content: readFile(call.args?.path) };
        } else if (call.name === 'write_file') {
          const res = writeFile(call.args?.path, call.args?.content ?? '', checkpoint);
          if (res.ok) changedFiles.push(res.path);
          response = res;
        } else {
          response = { ok: false, error: `Unknown tool: ${call.name}` };
        }
      } catch (e) {
        response = { ok: false, error: e.message };
      }
      responseParts.push({ functionResponse: { name: call.name, response } });
    }
    contents.push({ role: 'function', parts: responseParts });
  }

  return {
    summary: `Stopped after ${MAX_STEPS} steps without a final summary from Gemini.`,
    changedFiles,
    checkpoint,
    steps: MAX_STEPS
  };
}

module.exports = { runEvolve, rollbackLast, isGitRepo, ROOT };

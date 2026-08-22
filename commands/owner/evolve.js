/**
 * Evolve Command — Self-Evolution (Owner Only)
 * Hands your instruction to Gemini, which reads and rewrites the bot's own
 * source files to carry it out, then restarts the bot to apply the change.
 * See utils/selfEvolve.js for the safety mechanics (checkpoint, syntax
 * check, rollback).
 */

const { exec } = require('child_process');
const config = require('../../config');
const { runEvolve } = require('../../utils/selfEvolve');

function isEnabled() {
  return config.selfEvolve?.enabled === true || process.env.ALLOW_SELF_EVOLVE === 'true';
}

function tryRestart() {
  return new Promise((resolve) => {
    exec('pm2 restart all', (error) => {
      if (!error) return resolve(true);
      setTimeout(() => process.exit(0), 500);
      resolve(false);
    });
  });
}

module.exports = {
  name: 'evolve',
  aliases: ['selfedit', 'selfevolve'],
  category: 'owner',
  description: 'Let the bot rewrite its own code to carry out an instruction (Owner Only)',
  usage: '.evolve <what to change>',
  ownerOnly: true,

  async execute(sock, msg, args, extra) {
    if (!isEnabled()) {
      return extra.reply(
        '❌ Self-evolve is disabled.\n\n' +
        'Enable it by setting `selfEvolve.enabled = true` in config.js ' +
        '(or the ALLOW_SELF_EVOLVE=true env var), then try again.\n\n' +
        'Only do this if the project is a git repo (for safe rollback) and ' +
        'you trust whoever has owner access to this bot.'
      );
    }

    const instruction = args.join(' ').trim();
    if (!instruction) {
      return extra.reply('❌ Usage: .evolve <describe what you want changed>\n\nExample: .evolve add a .coinflip command in commands/fun/');
    }

    try {
      await extra.reply('🧬 Evolving… reading the codebase and making the change. This can take a bit.');

      const result = await runEvolve(instruction);

      if (result.changedFiles.length === 0) {
        return extra.reply(`ℹ️ No files were changed.\n\n${result.summary}`);
      }

      const fileList = result.changedFiles.map(f => `• ${f}`).join('\n');
      await sock.sendMessage(msg.key.remoteJid, {
        text: `✅ Evolve complete (${result.steps} step(s)).\n\nChanged files:\n${fileList}\n\n${result.summary}\n\n🔁 Restarting to apply the change…\nIf something looks wrong after restart, use .evolverollback.`
      }, { quoted: msg });

      await tryRestart();
    } catch (error) {
      console.error('Evolve error:', error);
      await extra.reply(`❌ Evolve failed: ${error.message}`);
    }
  }
};

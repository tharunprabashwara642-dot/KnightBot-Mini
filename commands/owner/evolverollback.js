/**
 * Evolve Rollback Command (Owner Only)
 * Undoes the most recent .evolve run (git reset to the checkpoint, or
 * restores the pre-run file backups) and restarts the bot.
 */

const { exec } = require('child_process');
const { rollbackLast } = require('../../utils/selfEvolve');

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
  name: 'evolverollback',
  aliases: ['evolveundo'],
  category: 'owner',
  description: 'Undo the most recent .evolve change (Owner Only)',
  usage: '.evolverollback',
  ownerOnly: true,

  async execute(sock, msg, args, extra) {
    try {
      const message = rollbackLast();
      await sock.sendMessage(msg.key.remoteJid, {
        text: `✅ ${message}\n\n🔁 Restarting to apply the rollback…`
      }, { quoted: msg });
      await tryRestart();
    } catch (error) {
      await extra.reply(`❌ Rollback failed: ${error.message}`);
    }
  }
};

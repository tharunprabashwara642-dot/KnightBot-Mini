/**
 * Evolve History Command (Owner Only)
 * Shows recent .evolve checkpoints/commits so the owner knows what
 * .evolverollback would undo.
 */

const { execFileSync } = require('child_process');
const { isGitRepo, ROOT } = require('../../utils/selfEvolve');

module.exports = {
  name: 'evolvehistory',
  aliases: ['evolvelog'],
  category: 'owner',
  description: 'Show recent self-evolve changes (Owner Only)',
  usage: '.evolvehistory',
  ownerOnly: true,

  async execute(sock, msg, args, extra) {
    if (!isGitRepo()) {
      return extra.reply(
        'ℹ️ This project is not a git repo, so evolve history is limited to a ' +
        'single rollback point — the most recent .evolve run. Run .evolverollback ' +
        'to undo it if needed.'
      );
    }
    try {
      const log = execFileSync(
        'git',
        ['log', '--format=%h|%s|%ci', '-15'],
        { cwd: ROOT, encoding: 'utf8' }
      ).trim();

      const lines = log.split('\n').filter(l => l.includes('evolve'));
      if (lines.length === 0) {
        return extra.reply('ℹ️ No evolve commits found yet.');
      }
      const formatted = lines.map(l => {
        const [sha, subject, date] = l.split('|');
        return `• ${sha} — ${subject} (${date.split(' ')[0]})`;
      }).join('\n');

      await extra.reply(`📜 Recent evolve history:\n\n${formatted}\n\n.evolverollback undoes the most recent run.`);
    } catch (error) {
      await extra.reply(`❌ Could not read history: ${error.message}`);
    }
  }
};

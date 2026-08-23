/**
 * .issues <owner/repo> — list open issues for a GitHub repo.
 * Owner-only, read-only.
 */

const github = require('../../utils/github');

module.exports = {
  name: 'issues',
  aliases: ['ghissues'],
  category: 'owner',
  description: 'List open issues for a GitHub repo',
  usage: '.issues <owner/repo>',
  ownerOnly: true,

  async execute(sock, msg, args, extra) {
    if (!github.hasToken()) {
      return extra.reply('❌ No GitHub token configured. Set GITHUB_TOKEN as an environment variable.');
    }
    const target = (args[0] || '').trim();
    if (!target.includes('/')) {
      return extra.reply('❌ Usage: .issues <owner/repo>\n\nExample: .issues tharunprabashwara642-dot/KnightBot-Mini');
    }
    const [owner, repo] = target.split('/');
    try {
      const issues = await github.listIssues(owner, repo);
      if (!issues.length) return extra.reply(`No open issues in ${target}.`);
      const lines = issues.slice(0, 15).map((i) => `#${i.number} ${i.title}\n${i.url}`);
      await extra.reply(`🐛 *Open issues in ${target}:*\n\n${lines.join('\n\n')}`);
    } catch (error) {
      console.error('[issues]', error.message);
      await extra.reply(`❌ Failed to fetch issues: ${error.response?.data?.message || error.message}`);
    }
  },
};

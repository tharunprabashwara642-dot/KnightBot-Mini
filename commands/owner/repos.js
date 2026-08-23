/**
 * .repos — list GitHub repos the connected token can see.
 * .issues <owner/repo> — list open issues for a repo.
 * Owner-only, read-only.
 */

const github = require('../../utils/github');

module.exports = {
  name: 'repos',
  aliases: ['ghrepos'],
  category: 'owner',
  description: 'List GitHub repos connected to this bot',
  usage: '.repos',
  ownerOnly: true,

  async execute(sock, msg, args, extra) {
    if (!github.hasToken()) {
      return extra.reply('❌ No GitHub token configured. Set GITHUB_TOKEN as an environment variable (repo scope, no delete permission).');
    }
    try {
      const repos = await github.listRepos();
      if (!repos.length) return extra.reply('No repositories found for this token.');
      const lines = repos.slice(0, 20).map((r) => `• ${r.fullName} (${r.defaultBranch})${r.private ? ' 🔒' : ''}`);
      await extra.reply(`📦 *Connected repos:*\n\n${lines.join('\n')}`);
    } catch (error) {
      console.error('[repos]', error.message);
      await extra.reply(`❌ Failed to fetch repos: ${error.response?.data?.message || error.message}`);
    }
  },
};



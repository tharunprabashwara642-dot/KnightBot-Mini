/**
 * Gemini Chat Command — talks to Google Gemini directly.
 * Supports automatic multi-key rotation (see utils/gemini.js) so if one
 * API key hits its rate limit, the bot switches to the next configured key.
 */

const gemini = require('../../utils/gemini');

module.exports = {
  name: 'gemini',
  aliases: ['gem'],
  category: 'ai',
  description: 'Chat with Google Gemini',
  usage: '.gemini <question>',

  async execute(sock, msg, args, extra) {
    if (!gemini.hasKeys()) {
      return extra.reply(
        '❌ No Gemini API key configured.\n\n' +
        'Add one in config.js under `gemini.apiKeys` (or set GEMINI_API_KEY / ' +
        'GEMINI_API_KEYS as environment variables) and restart the bot.'
      );
    }

    if (args.length === 0) {
      return extra.reply('❌ Usage: .gemini <question>\n\nExample: .gemini What is the capital of France?');
    }

    const question = args.join(' ');

    try {
      const answer = await gemini.chat(question);
      await extra.reply(answer || '⚠️ Gemini returned an empty response.');
    } catch (error) {
      await extra.reply(`❌ Gemini Error: ${error.message}`);
    }
  }
};

/**
 * Gemini Chat Command — talks to Google Gemini directly.
 * Supports automatic multi-key rotation (see utils/gemini.js).
 *
 * With the natural-language router (utils/nlRouter.js), `.gemini <text>`
 * first tries to match the user's request to an existing bot command
 * (song, facebook, translate, weather, etc.) and executes it directly —
 * so users no longer need to type `.song`, `.fb` by name.
 * If no command fits, it falls back to a normal Gemini chat reply.
 * Direct commands like `.song`, `.fb` etc. still work as before.
 */

const gemini = require('../../utils/gemini');
const { route } = require('../../utils/nlRouter');
const { loadCommands } = require('../../utils/commandLoader');

module.exports = {
  name: 'gemini',
  aliases: ['gem'],
  category: 'ai',
  description: 'Chat with Google Gemini — also auto-routes to bot commands',
  usage: '.gemini <question or request>',

  async execute(sock, msg, args, extra) {
    if (!gemini.hasKeys()) {
      return extra.reply(
        '❌ No Gemini API key configured.\n\n' +
        'Add one in config.js under `gemini.apiKeys` (or set GEMINI_API_KEY / ' +
        'GEMINI_API_KEYS as environment variables) and restart the bot.'
      );
    }

    if (args.length === 0) {
      return extra.reply('❌ Usage: .gemini <question>\n\nExample: .gemini What is the capital of France?\nExample: .gemini download the song Bohemian Rhapsody');
    }

    const userText = args.join(' ');

    try {
      const commands = loadCommands();
      const result = await route(userText, commands, sock, msg, extra);

      // Only send a text reply if the router didn't already execute a
      // command (commands handle their own replies). If Gemini returned
      // text alongside tool calls, the router already sent it.
      if (result.type === 'text') {
        await extra.reply(result.text || '⚠️ Gemini returned an empty response.');
      }
    } catch (error) {
      // If the router fails, fall back to plain chat so .gemini never
      // breaks entirely
      console.error('[gemini] router error, falling back to chat:', error.message);
      try {
        const answer = await gemini.chat(userText);
        await extra.reply(answer || '⚠️ Gemini returned an empty response.');
      } catch (fallbackError) {
        await extra.reply(`❌ Gemini Error: ${fallbackError.message}`);
      }
    }
  }
};

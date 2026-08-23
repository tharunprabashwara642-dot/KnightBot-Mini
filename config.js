/**
 * Global Configuration for WhatsApp MD Bot
 */

module.exports = {
    // Bot Owner Configuration
    ownerNumber: ['94775585251'], // Add your number without + or spaces (e.g., 919876543210)
    ownerName: ['THARUN PRABASHWARA'], // Owner names corresponding to ownerNumber array
    
    // Bot Configuration
    botName: 'THARUN-AI ASSISTANT V2',
    prefix: '.',
    sessionName: 'session',
    sessionID: process.env.SESSION_ID || '',
    newsletterJid: '120363161513685998@newsletter', // Newsletter JID for menu forwarding
    updateZipUrl: 'https://github.com/mruniquehacker/KnightBot-Mini/archive/refs/heads/main.zip', // URL to latest code zip for .update command
    
    // Sticker Configuration
    packname: 'Knight Bot',
    
    // Bot Behavior
    selfMode: true, // Private mode - only owner can use commands
    autoRead: false,
    autoTyping: false,
    autoBio: false,
    autoSticker: false,
    autoReact: false,
    autoReactMode: 'bot',
    autoDownload: false,
    
    // Group Settings Defaults
    defaultGroupSettings: {
      antilink: false,
      antilinkAction: 'delete', // 'delete', 'kick', 'warn'
      antitag: false,
      antitagAction: 'delete',
      antiall: false, // Owner only - blocks all messages from non-admins
      antiviewonce: false,
      antibot: false,
      antibotAction: 'warn', // 'warn' | 'kick'
      anticall: false, // Anti-call feature
      antigroupmention: false, // Anti-group mention feature
      antigroupmentionAction: 'delete', // 'delete', 'kick'
      antigroupstatus: false, // Block group status posts
      antigroupstatusAction: 'delete', // 'delete', 'kick'
      antisticker: false, // Stickers not allowed in group
      antistickerAction: 'delete', // 'delete', 'kick'
      antibadword: false, // Block bad words in group
      antibadwordAction: 'delete', // 'delete', 'kick', 'warn'
      welcome: false,
      welcomeMessage: '╭╼━≪•𝙽𝙴𝚆 𝙼𝙴𝙼𝙱𝙴𝚁•≫━╾╮\n┃𝚆𝙴𝙻𝙲𝙾𝙼𝙴: @user 👋\n┃Member count: #memberCount\n┃𝚃𝙸𝙼𝙴: time⏰\n╰━━━━━━━━━━━━━━━╯\n\n*@user* Welcome to *@group*! 🎉\n*Group 𝙳𝙴𝚂𝙲𝚁𝙸𝙿𝚃𝙸𝙾𝙽*\ngroupDesc\n\n> *ᴘᴏᴡᴇʀᴇᴅ ʙʏ botName*',
      goodbye: false,
      goodbyeMessage: 'Goodbye @user 👋 We will never miss you!',
      antiSpam: false,
      antidelete: false,
      nsfw: false,
      detect: false,
      chatbot: false,
      autosticker: false // Auto-convert images/videos to stickers
    },
    
    // API Keys (add your own)
    apiKeys: {
      // Add API keys here if needed
      openai: '',
      deepai: '',
      remove_bg: ''
    },

    // Gemini Configuration — used by the .gemini chat command and by the
    // self-evolve agent (see selfEvolve below). You can add as many keys as
    // you want; when the currently active key hits its rate limit, the bot
    // automatically switches to the next one — no restart needed.
    // Keys can also be supplied via env vars instead of editing this file:
    //   GEMINI_API_KEY=single_key
    //   GEMINI_API_KEYS=key_one,key_two,key_three
    gemini: {
      apiKeys: ['AQ.Ab8RN6LnmIKaFje1BVYzeFY3yR4AdHonkWV4H1WS9Q6Z20JWAw',
        // 'YOUR_GEMINI_API_KEY_1',
        // 'YOUR_GEMINI_API_KEY_2',
      ],
      model: 'gemini-3.6-flash' // or 'gemini-2.5-pro', etc.
    },

    // Self-Evolve Configuration (autonomous self-code-editing via .evolve).
    // WARNING: When enabled, the bot owner can tell the bot (in Gemini chat)
    // to read and rewrite its OWN source files, then restart itself. It's
    // always owner-only regardless of this flag. Off by default — turn on
    // only if you understand the risk, and keep the project in a git repo
    // so changes can be checked out / rolled back.
    // Can also be enabled via env var: ALLOW_SELF_EVOLVE=true
    selfEvolve: {
      enabled: true
    },
    
    // Message Configuration
    messages: {
      wait: '⏳ Please wait...',
      success: '✅ Success!',
      error: '❌ Error occurred!',
      ownerOnly: '👑 This command is only for bot owner!',
      adminOnly: '🛡️ This command is only for group admins!',
      roupOnly: '👥 This command can only be used in groups!',
      privateOnly: '💬 This command can only be used in private chat!',
      botAdminNeeded: '🤖 Bot needs to be admin to execute this command!',
      invalidCommand: '❓ Invalid command! Type .menu for help'
    },
    
    // Timezone
    timezone: 'Asia/colombo',
    
    // Limits
    maxWarnings: 3,
    
    // Social Links (optional)
    social: {
      github: 'https://github.com/tharunprabashwara642-dot',
      whatsapp: 'https://wa.me/qr/F44PLLVHT35EH1',
      facebook: 'https://www.facebook.com/share/19PnykWkum/?mibextid=wwXIfr'
    }
};

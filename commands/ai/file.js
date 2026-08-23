/**
 * Smart File Creator — ONE command, no need to specify a file type.
 *
 * Just describe what you want (in Sinhala, English, mixed — doesn't
 * matter), and Gemini decides the best file format for it (PDF, Word
 * .docx, HTML, plain text, etc.), writes the content, and the bot
 * builds the actual file and sends it to you in chat.
 *
 * Usage:
 *   .file <ඕන දෙයක් විස්තර කරන්න>
 *   e.g. .file මට software engineer කෙනෙක්ගේ resume එකක් හදලා දෙන්න
 *   e.g. .file write a short report about climate change as a pdf
 *   e.g. .file simple webpage that says hello
 *
 * If the user's request clearly says "pdf", "word/doc", "html", "excel/csv"
 * etc., that's respected. Otherwise Gemini picks whatever fits best
 * (usually pdf or docx for anything document-like, txt for quick notes).
 *
 * Requires (install once): npm install pdfkit docx
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const gemini = require('../../utils/gemini');

const MIME_TYPES = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  html: 'text/html',
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  json: 'application/json',
  js: 'application/javascript',
  css: 'text/css',
  xml: 'application/xml',
};

const ALLOWED_TYPES = Object.keys(MIME_TYPES);

function stripCodeFences(text) {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/^```[a-zA-Z0-9]*\n([\s\S]*?)\n```$/);
  return fenceMatch ? fenceMatch[1] : trimmed;
}

function safeFileName(name) {
  return (name || 'file').replace(/[^\w\-. ]/g, '').trim().slice(0, 60) || 'file';
}

async function buildPdf(title, bodyText) {
  const PDFDocument = require('pdfkit');
  const chunks = [];
  const doc = new PDFDocument({ margin: 50 });
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve) => doc.on('end', resolve));

  if (title) {
    doc.fontSize(20).text(title, { align: 'center' });
    doc.moveDown();
  }
  doc.fontSize(12).text(bodyText, { align: 'left' });
  doc.end();

  await done;
  return Buffer.concat(chunks);
}

async function buildDocx(title, bodyText) {
  const { Document, Packer, Paragraph, HeadingLevel, TextRun } = require('docx');

  const paragraphs = [];
  if (title) {
    paragraphs.push(new Paragraph({ text: title, heading: HeadingLevel.HEADING_1 }));
  }
  const lines = bodyText.split('\n');
  for (const line of lines) {
    paragraphs.push(new Paragraph({ children: [new TextRun(line)] }));
  }

  const doc = new Document({ sections: [{ children: paragraphs }] });
  return Packer.toBuffer(doc);
}

module.exports = {
  name: 'file',
  aliases: ['createfile', 'filegen', 'makefile', 'document', 'doc'],
  category: 'ai',
  description: 'Describe anything and get it back as a real file (PDF, Word, HTML, etc. — auto-chosen)',
  usage: '.file <describe what you want, any language>',

  async execute(sock, msg, args, extra) {
    if (!gemini.hasKeys()) {
      return extra.reply(
        '❌ No Gemini API key configured.\n\n' +
        'Add one in config.js under `gemini.apiKeys` (or set GEMINI_API_KEY / ' +
        'GEMINI_API_KEYS) and restart the bot.'
      );
    }

    const description = args.join(' ').trim();
    if (!description) {
      return extra.reply(
        '❌ Usage: .file <describe what you want>\n\n' +
        'Examples:\n' +
        '.file resume for a software engineer\n' +
        '.file simple webpage that says hello\n' +
        '.file report about climate change as a pdf\n\n' +
        'ඕන දෙයක් ඕන භාෂාවකින් describe කරන්න — file type එකත් තෝරාගන්නවා.'
      );
    }

    await sock.sendMessage(extra.from, { react: { text: '📝', key: msg.key } });

    const systemInstruction =
      `You decide the best file format for a user's request and generate the content. ` +
      `Reply with ONLY a single valid JSON object, nothing else (no markdown fences, no explanation). ` +
      `The JSON must have these fields:\n` +
      `{"type": one of ${JSON.stringify(ALLOWED_TYPES)}, "filename": a short descriptive filename WITHOUT extension, ` +
      `"title": a short title for the document (used as heading in pdf/docx, empty string if not needed), ` +
      `"content": the full raw content}\n` +
      `Rules: pick "pdf" or "docx" for anything resembling a document, report, letter, resume, essay, or article ` +
      `(prefer "docx" if the user mentions word/google doc/editable, otherwise "pdf"). ` +
      `Pick "html" only if the user explicitly wants a webpage. Pick "csv"/"json" for tabular/structured data. ` +
      `Pick "txt" only for very short simple notes/lists. ` +
      `For "pdf" and "docx", "content" must be plain text with \\n line breaks (no HTML, no markdown syntax). ` +
      `For "html", "content" must be complete valid HTML starting with <!DOCTYPE html>. ` +
      `Respond in the same language the user used for any text content.`;

    let tempPath;
    try {
      const raw = await gemini.chat(description, systemInstruction);
      if (!raw || !raw.trim()) {
        return extra.reply('⚠️ Gemini returned empty content. Try rephrasing your request.');
      }

      let parsed;
      try {
        parsed = JSON.parse(stripCodeFences(raw));
      } catch (e) {
        return extra.reply('⚠️ Could not understand the generated file structure. Try rephrasing your request.');
      }

      let type = String(parsed.type || 'txt').toLowerCase();
      if (!ALLOWED_TYPES.includes(type)) type = 'txt';
      const title = parsed.title || '';
      const content = String(parsed.content || '').trim();
      if (!content) {
        return extra.reply('⚠️ Gemini returned empty content. Try rephrasing your request.');
      }

      const baseName = safeFileName(parsed.filename);
      const fileName = `${baseName}.${type}`;

      let buffer;
      if (type === 'pdf') {
        buffer = await buildPdf(title, content);
      } else if (type === 'docx') {
        buffer = await buildDocx(title, content);
      } else {
        buffer = Buffer.from(content, 'utf8');
      }

      tempPath = path.join(os.tmpdir(), `file_${Date.now()}_${fileName}`);
      fs.writeFileSync(tempPath, buffer);

      await sock.sendMessage(extra.from, {
        document: fs.readFileSync(tempPath),
        mimetype: MIME_TYPES[type],
        fileName,
        caption: `📄 ${fileName}`,
      }, { quoted: msg });
    } catch (error) {
      console.error('[file]', error.message);
      if (/Cannot find module 'pdfkit'/.test(error.message)) {
        await extra.reply('❌ PDF support not installed. Run: npm install pdfkit');
      } else if (/Cannot find module 'docx'/.test(error.message)) {
        await extra.reply('❌ Word document support not installed. Run: npm install docx');
      } else {
        await extra.reply(`❌ Failed to create file: ${error.message}`);
      }
    } finally {
      if (tempPath) fs.unlink(tempPath, () => {});
    }
  },
};

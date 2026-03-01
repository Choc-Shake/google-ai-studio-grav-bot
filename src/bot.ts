import { Bot, InputFile } from 'grammy';
import { generateResponse } from './llm.js';
import { transcribeAudio } from './voice/transcribe.js';
import { generateSpeech } from './voice/speak.js';
import fs from 'fs';
import path from 'path';

if (!process.env.TELEGRAM_BOT_TOKEN) {
  console.warn('TELEGRAM_BOT_TOKEN is not set in .env. Bot will not start.');
}

if (!process.env.TELEGRAM_USER_ID) {
  console.warn('TELEGRAM_USER_ID is not set in .env. Whitelist will not work.');
}

const ALLOWED_USER_ID = process.env.TELEGRAM_USER_ID ? parseInt(process.env.TELEGRAM_USER_ID, 10) : 0;

export const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN || 'dummy_token');

export async function startBot() {
  if (!process.env.TELEGRAM_BOT_TOKEN) {
    console.log('Skipping bot start due to missing TELEGRAM_BOT_TOKEN');
    return;
  }

  // Middleware for User ID Whitelist
  bot.use(async (ctx, next) => {
    if (ctx.from?.id !== ALLOWED_USER_ID) {
      console.log(`Unauthorized access attempt from user ID: ${ctx.from?.id}`);
      return; // Silently ignore
    }
    await next();
  });

  bot.command('start', (ctx) => {
    ctx.reply('Gravity Claw initialized. Awaiting input.');
  });

  bot.on('message:text', async (ctx) => {
    const userMessage = ctx.message.text;
    
    // Send a typing indicator
    await ctx.replyWithChatAction('typing');

    try {
      let response = await generateResponse(userMessage);
      
      let useVoice = false;
      if (response.startsWith('[VOICE]')) {
        useVoice = true;
        response = response.replace('[VOICE]', '').trim();
      }

      if (useVoice) {
        await ctx.replyWithChatAction('record_voice');
        const audioBuffer = await generateSpeech(response);
        await ctx.replyWithVoice(new InputFile(audioBuffer, 'response.ogg'));
      }
      
      await ctx.reply(response);
    } catch (error) {
      console.error('Error generating response:', error);
      await ctx.reply('An error occurred while processing your request.');
    }
  });

  bot.on('message:voice', async (ctx) => {
    try {
      await ctx.replyWithChatAction('record_voice');
      
      const fileId = ctx.message.voice.file_id;
      const file = await ctx.api.getFile(fileId);
      const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
      
      const tempFilePath = path.join(process.cwd(), 'data', `${fileId}.ogg`);
      
      const response = await fetch(fileUrl);
      if (!response.ok) throw new Error('Failed to download voice message');
      
      const arrayBuffer = await response.arrayBuffer();
      fs.writeFileSync(tempFilePath, Buffer.from(arrayBuffer));
      
      // Transcribe
      const text = await transcribeAudio(tempFilePath);
      fs.unlinkSync(tempFilePath); // Cleanup
      
      await ctx.reply(`🎤 *You:* ${text}`, { parse_mode: 'Markdown' });
      
      // Generate Response
      await ctx.replyWithChatAction('typing');
      let replyText = await generateResponse(text);
      
      let useVoice = false;
      if (replyText.startsWith('[VOICE]')) {
        useVoice = true;
        replyText = replyText.replace('[VOICE]', '').trim();
      }
      
      if (useVoice) {
        // Generate TTS
        await ctx.replyWithChatAction('record_voice');
        const audioBuffer = await generateSpeech(replyText);
        
        // Send back
        await ctx.replyWithVoice(new InputFile(audioBuffer, 'response.ogg'));
      }
      
      await ctx.reply(replyText);
      
    } catch (error) {
      console.error('Error processing voice:', error);
      await ctx.reply('An error occurred while processing your voice message.');
    }
  });

  console.log('Starting Gravity Claw (Long Polling)...');
  await bot.start();
}

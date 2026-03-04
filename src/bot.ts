import { Bot, InputFile } from 'grammy';
import { generateResponse } from './llm.js';
import { transcribeAudio } from './voice/transcribe.js';
import { TypingIndicator } from './ux/typing.js';
import { commands, commandDescriptions } from './commands/index.js';
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

  // Register slash commands
  for (const [name, handler] of Object.entries(commands)) {
    bot.command(name, handler);
  }

  // Set command menu in Telegram for autocomplete
  bot.api.setMyCommands(commandDescriptions).catch(err => {
    console.error('Failed to set command menu:', err);
  });

  bot.command('start', (ctx) => {
    ctx.reply('IRIS initialized. Awaiting input.');
  });

  bot.on('message:text', async (ctx) => {
    const userMessage = ctx.message.text;
    
    // Start continuous typing indicator
    const typing = new TypingIndicator(ctx);
    typing.start();

    try {
      const response = await generateResponse(userMessage);
      typing.stop();
      await ctx.reply(response);
    } catch (error) {
      typing.stop();
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
      
      // Start continuous typing indicator for LLM response
      const typing = new TypingIndicator(ctx);
      typing.start();
      const replyText = await generateResponse(text);
      typing.stop();
      
      await ctx.reply(replyText);
      
    } catch (error) {
      console.error('Error processing voice:', error);
      await ctx.reply('An error occurred while processing your voice message.');
    }
  });

  console.log('Starting IRIS (Long Polling)...');
  
  // Send welcome message
  if (ALLOWED_USER_ID) {
    bot.api.sendMessage(ALLOWED_USER_ID, `✨ *IRIS ONLINE* ✨\n\nHello Ishaan, how can I help?`, { parse_mode: 'Markdown' }).catch(err => {
      console.error('Failed to send welcome message:', err);
    });
  }

  await bot.start();
}

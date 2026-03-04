import { Context } from 'grammy';
import { mcpClients, mcpServerConfigs, getAvailableMCPServers } from '../mcp.js';
import { clearMessages, getMessageCount } from '../memory/sqlite.js';

/** /status - Show bot status, loaded MCP servers, model info */
async function handleStatus(ctx: Context) {
  const model = process.env.OPENROUTER_MODEL || 'openrouter/free';
  const servers = getAvailableMCPServers();
  const loadedCount = Object.keys(mcpClients).length;
  const totalConfigured = Object.keys(mcpServerConfigs).length;

  const serverList = servers.map(s => {
    const loaded = mcpClients[s.name] ? '🟢' : '🔴';
    return `  ${loaded} ${s.name}`;
  }).join('\n');

  const uptime = process.uptime();
  const hours = Math.floor(uptime / 3600);
  const minutes = Math.floor((uptime % 3600) / 60);
  const seconds = Math.floor(uptime % 60);

  const tz = process.env.TIMEZONE || 'America/Edmonton';
  const now = new Date().toLocaleString('en-US', { timeZone: tz, dateStyle: 'full', timeStyle: 'short' });

  const msgCount = getMessageCount();

  const status = [
    `⚙️ *IRIS Status*`,
    ``,
    `📅 *Date:* ${now}`,
    `⏱ *Uptime:* ${hours}h ${minutes}m ${seconds}s`,
    `🧠 *Model:* \`${model}\``,
    `💬 *Messages in Memory:* ${msgCount}`,
    ``,
    `🔌 *MCP Servers (${loadedCount}/${totalConfigured}):*`,
    serverList,
  ].join('\n');

  await ctx.reply(status, { parse_mode: 'Markdown' });
}

/** /new - Clear conversation history and start fresh */
async function handleNew(ctx: Context) {
  clearMessages();
  await ctx.reply('🔄 *Conversation cleared.* Starting fresh.', { parse_mode: 'Markdown' });
}

/** /compact - Summarize and compress context (placeholder for now) */
async function handleCompact(ctx: Context) {
  const msgCount = getMessageCount();
  if (msgCount <= 10) {
    await ctx.reply('💬 Context is already compact (≤10 messages). No action needed.');
    return;
  }
  // For now, just trim to last 10 messages
  // A future version could use the LLM to summarize before clearing
  clearMessages();
  await ctx.reply(`🗜 *Compacted.* Cleared ${msgCount} messages. Context reset.`, { parse_mode: 'Markdown' });
}

/** /model [name] - Show or switch the active model */
async function handleModel(ctx: Context) {
  const text = ctx.message?.text || '';
  const args = text.split(/\s+/).slice(1); // Everything after /model

  if (args.length === 0) {
    const currentModel = process.env.OPENROUTER_MODEL || 'openrouter/free';
    await ctx.reply(`🧠 *Current Model:* \`${currentModel}\`\n\nTo switch: /model <model-name>`, { parse_mode: 'Markdown' });
    return;
  }

  const newModel = args.join(' ').trim();
  process.env.OPENROUTER_MODEL = newModel;
  await ctx.reply(`🧠 *Model switched to:* \`${newModel}\``, { parse_mode: 'Markdown' });
}

/** /usage - Show usage statistics */
async function handleUsage(ctx: Context) {
  const msgCount = getMessageCount();
  const uptime = process.uptime();
  const hours = Math.floor(uptime / 3600);
  const minutes = Math.floor((uptime % 3600) / 60);

  const loadedServers = Object.keys(mcpClients).length;

  const usage = [
    `📊 *Usage Statistics*`,
    ``,
    `💬 *Total Messages:* ${msgCount}`,
    `🔌 *Active MCP Servers:* ${loadedServers}`,
    `⏱ *Session Duration:* ${hours}h ${minutes}m`,
    `🧠 *Model:* \`${process.env.OPENROUTER_MODEL || 'openrouter/free'}\``,
  ].join('\n');

  await ctx.reply(usage, { parse_mode: 'Markdown' });
}

/**
 * Register all slash commands on the bot.
 * Returns a map of command names to handlers for use in bot.ts.
 */
export const commands: Record<string, (ctx: Context) => Promise<void>> = {
  'status': handleStatus,
  'new': handleNew,
  'compact': handleCompact,
  'model': handleModel,
  'usage': handleUsage,
};

/** List of command descriptions for Telegram's command menu */
export const commandDescriptions = [
  { command: 'status', description: 'Show bot status, servers, and model info' },
  { command: 'new', description: 'Clear conversation and start fresh' },
  { command: 'compact', description: 'Compress conversation context' },
  { command: 'model', description: 'Show or switch the active LLM model' },
  { command: 'usage', description: 'Show usage statistics' },
];

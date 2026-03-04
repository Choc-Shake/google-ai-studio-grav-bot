import 'dotenv/config';
import express from 'express';
import { startBot } from './bot.js';
import { loadMCPConfigs, startAllMCPServers } from './mcp.js';

const app = express();
const PORT = 3000;

// AI Studio requires a web server on port 3000 to keep the container alive and pass health checks.
// We expose a simple health endpoint, but the bot itself uses Telegram long-polling.
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'IRIS' });
});

const server = app.listen(PORT, '0.0.0.0', async () => {
  console.log(`Health check server running on port ${PORT}`);
  
  // Load MCP configurations
  loadMCPConfigs();
  
  // Start all non-disabled MCP servers in the background
  startAllMCPServers();
  
  // Start the Telegram bot
  startBot().catch(console.error);
});

server.on('error', (e: any) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is in use. The health check server could not start, but IRIS will attempt to boot anyway.`);
    // We can still try to run the bot even if the port is busy
    loadMCPConfigs();
    startAllMCPServers();
    startBot().catch(console.error);
  } else {
    console.error('Server error:', e);
  }
});

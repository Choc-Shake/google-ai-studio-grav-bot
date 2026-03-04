
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import fs from 'fs';
import path from 'path';

async function inspectTools() {
    const configPath = path.join(process.cwd(), 'mcp-servers.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    const zapierConfig = config.mcpServers.zapier;

    const logFile = path.join(process.cwd(), 'zapier-inspection.log');
    const log = (msg: string) => {
        console.log(msg);
        fs.appendFileSync(logFile, msg + "\n");
    };

    if (fs.existsSync(logFile)) fs.unlinkSync(logFile);

    log("Connecting to Zapier MCP...");
    const transport = new StdioClientTransport({
        command: zapierConfig.command,
        args: zapierConfig.args,
        env: { ...process.env, ...(zapierConfig.env || {}) }
    });

    const client = new Client({
        name: "test-inspector",
        version: "1.0.0"
    }, {
        capabilities: {}
    });

    try {
        await client.connect(transport);
        log("Connected.");

        const response = await client.listTools();
        log(`Total tools found: ${response.tools.length}`);

        log("Full Tool Names:");
        response.tools.forEach(t => log(` - ${t.name}`));

        const calendarTools = response.tools.filter(t => t.name.toLowerCase().includes('calendar'));
        log("Calendar Tools Details:");
        log(JSON.stringify(calendarTools, null, 2));

        const emailTool = response.tools.find(t => t.name === 'gmail_find_email');
        if (emailTool) {
            log("Gmail Find Email Schema (Raw):");
            log(JSON.stringify(emailTool.inputSchema, null, 2));
        }
    } catch (err: any) {
        log(`Error: ${err.message}`);
    }

    process.exit(0);
}

inspectTools().catch(err => {
    console.error(err);
    process.exit(1);
});

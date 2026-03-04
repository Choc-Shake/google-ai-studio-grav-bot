import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import fs from 'fs';
import path from 'path';

export const mcpClients: Record<string, Client> = {};
export const mcpServerConfigs: Record<string, any> = {};

let cachedTools: any[] | null = null;

// Local LLMs (like Llama 3.1/Qwen) often fail when given complex JSON schemas (like anyOf, not, etc.)
// This function simplifies the schema to basic types so the LLM can understand it.
function simplifySchema(schema: any): any {
  if (!schema || typeof schema !== 'object') return schema;

  if (Array.isArray(schema)) {
    return schema.map(simplifySchema);
  }

  const simplified = { ...schema };

  if (simplified.anyOf || simplified.allOf || simplified.oneOf) {
    const logicalBlock = simplified.anyOf || simplified.allOf || simplified.oneOf;
    
    // Try to extract a dominant type (like string) from the logical block
    let extractedType = null;
    let extractedDescription = null;
    
    if (Array.isArray(logicalBlock)) {
      for (const item of logicalBlock) {
        if (item.type && item.type !== 'null') {
          extractedType = item.type;
          if (item.description) extractedDescription = item.description;
          break; // Take the first non-null type
        }
      }
    }

    delete simplified.anyOf;
    delete simplified.allOf;
    delete simplified.oneOf;
    
    if (extractedType) {
      simplified.type = extractedType;
    } else if (!simplified.type) {
      simplified.type = 'string';
    }
    
    if (extractedDescription && !simplified.description) {
      simplified.description = extractedDescription;
    }
  }

  if (simplified.not) {
    delete simplified.not;
  }

  if (simplified.properties) {
    for (const key of Object.keys(simplified.properties)) {
      simplified.properties[key] = simplifySchema(simplified.properties[key]);
    }
  }

  if (simplified.items) {
    simplified.items = simplifySchema(simplified.items);
  }

  return simplified;
}

export function loadMCPConfigs() {
  const configPath = path.join(process.cwd(), 'mcp_config.json');
  if (fs.existsSync(configPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      const servers = config.mcpServers || {};
      
      // Only load servers that are not explicitly disabled
      for (const [name, serverConfig] of Object.entries(servers)) {
        if ((serverConfig as any).disabled !== true) {
          mcpServerConfigs[name] = serverConfig;
        } else {
          console.log(`MCP server ${name} is disabled. Skipping.`);
        }
      }
      
      console.log(`Loaded ${Object.keys(mcpServerConfigs).length} active MCP server configurations.`);
    } catch (e) {
      console.error('Error reading mcp_config.json:', e);
    }
  } else {
    console.log('No mcp_config.json found.');
  }
}

export async function startMCPServer(serverName: string) {
  if (mcpClients[serverName]) return; // Already started
  
  const serverConfig = mcpServerConfigs[serverName];
  if (!serverConfig) throw new Error(`Server ${serverName} not found in config`);

  console.log(`Initializing MCP server: ${serverName}...`);
  const transport = new StdioClientTransport({
    command: serverConfig.command,
    args: serverConfig.args || [],
    env: { ...process.env, ...(serverConfig.env || {}) }
  });

  const client = new Client({
    name: `iris-client-${serverName}`,
    version: "1.0.0"
  }, {
    capabilities: {}
  });

  try {
    await client.connect(transport);
    mcpClients[serverName] = client;
    cachedTools = null; // Invalidate cache when a new server connects
    console.log(`Connected to MCP server: ${serverName}`);
  } catch (error) {
    console.error(`Failed to connect to MCP server ${serverName}:`, error);
    throw error;
  }
}

export function getAvailableMCPServers() {
  return Object.keys(mcpServerConfigs).map(name => ({
    name,
    description: mcpServerConfigs[name].description || `MCP Server: ${name}`,
    isLoaded: !!mcpClients[name]
  }));
}

export async function startAllMCPServers() {
  // mcpServerConfigs already contains only non-disabled servers
  const servers = Object.keys(mcpServerConfigs).map(name => ({
    name,
    description: mcpServerConfigs[name].description || `MCP Server: ${name}`
  }));
  console.log(`[MCP] Starting ${servers.length} servers in the background...`);
  for (const server of servers) {
    // Start them without awaiting so it doesn't block startup
    startMCPServer(server.name).catch(e => {
      console.error(`[MCP] Failed to background start server ${server.name}:`, e);
    });
  }
}

export async function getAllLoadedMCPTools(allowedTools?: string[]) {
  // Return cached tools if available and no specific filter is requested
  if (cachedTools !== null && !allowedTools) {
    return cachedTools;
  }

  const allTools: any[] = [];
  for (const [serverName, client] of Object.entries(mcpClients)) {
    try {
      const response = await client.listTools();
      for (const tool of response.tools) {
        const fullToolName = `${serverName}__${tool.name}`;
        
        // If allowedTools is provided, only include tools in that list
        if (allowedTools && !allowedTools.includes(fullToolName)) {
          continue;
        }

        allTools.push({
          type: 'function',
          function: {
            name: fullToolName,
            description: tool.description || `Tool ${tool.name} from ${serverName}`,
            parameters: simplifySchema(tool.inputSchema)
          }
        });
      }
    } catch (error) {
      console.error(`Failed to list tools for ${serverName}:`, error);
    }
  }

  // Only cache if we didn't filter
  if (!allowedTools) {
    cachedTools = allTools;
  }
  
  return allTools;
}

export async function callMCPTool(serverName: string, toolName: string, args: any) {
  const client = mcpClients[serverName];
  if (!client) throw new Error(`MCP server ${serverName} not loaded`);
  
  console.log(`Calling MCP tool: ${serverName}__${toolName} with args:`, args);
  const result = await client.callTool({
    name: toolName,
    arguments: args
  });
  
  return result;
}

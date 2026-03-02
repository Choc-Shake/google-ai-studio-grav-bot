import OpenAI from 'openai';
import { addMessage, getRecentMessages } from './memory/sqlite.js';
import { searchSemanticMemory, upsertSemanticMemory } from './memory/pinecone.js';
import { getAllLoadedMCPTools, callMCPTool, getAvailableMCPServers, startMCPServer } from './mcp.js';

// Initialize Ollama via OpenAI SDK
const openai = new OpenAI({
  baseURL: process.env.OLLAMA_BASE_URL || 'http://localhost:11434/v1',
  apiKey: 'ollama', // OpenAI SDK requires an API key, but Ollama ignores it
});

// Define the get_current_time tool (OpenAI format)
const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'get_current_time',
      description: 'Get the current local time.',
      // Zero-parameter tools should either omit properties entirely or use strict empty object
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false
      }
    }
  }
];

function getCurrentTime() {
  const tz = process.env.TIMEZONE || 'America/Edmonton';
  return new Date().toLocaleString('en-US', { 
    timeZone: tz,
    dateStyle: 'full', 
    timeStyle: 'long' 
  });
}

export async function generateResponse(userMessage: string): Promise<string> {
  // 1. Save user message to exact memory (SQLite)
  addMessage('user', userMessage);

  // 2. Retrieve semantic memories (Pinecone)
  const semanticMemories = await searchSemanticMemory(userMessage);
  const memoryContext = semanticMemories.length > 0 
    ? `\n\nRelevant past memories:\n${semanticMemories.map(m => `- ${m}`).join('\n')}`
    : '';

  // 3. Build message history
  const availableServers = getAvailableMCPServers();
  const serverDescriptions = availableServers.map(s => `- ${s.name}: ${s.description} (Loaded: ${s.isLoaded})`).join('\n');

  const systemPrompt = `You are IRIS (Intelligent Response and Insight System), a personal AI agent. You have access to tools. Use them if necessary.
You can load additional tool servers if needed for the user's request.
Available MCP Servers:
${serverDescriptions}

CRITICAL RULES FOR TOOLS:
1. ZAPIER 'instructions' PARAMETER: Every Zapier tool REQUIRES an 'instructions' parameter. You MUST include it. Example: { "instructions": "Find events for tomorrow" }.
2. CALENDAR ACCESS: You DO have access to Google Calendar via Zapier. Look for tools starting with 'zapier__google_calendar_'.
3. CONVERSATIONAL RESPONSES: When a tool returns data (like emails or calendar events), read the data and answer the user naturally. DO NOT say "Here is the JSON" or list execution metadata. Act like a human assistant who just looked up the info.
4. LATEST EMAIL: When asked to find the latest email, use the 'zapier__gmail_find_email' tool with query="in:inbox" and instructions="find the latest email".
${memoryContext}`;
  
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt }
  ];

  // Load recent history (last 10 messages)
  const history = getRecentMessages(10);
  for (const msg of history) {
    if (msg.role === 'user' || msg.role === 'assistant' || msg.role === 'tool') {
      const messageParam: any = { role: msg.role, content: msg.content };
      if (msg.tool_calls) messageParam.tool_calls = msg.tool_calls;
      if (msg.tool_call_id) messageParam.tool_call_id = msg.tool_call_id;
      messages.push(messageParam);
    }
  }

  let iteration = 0;
  const MAX_ITERATIONS = 5;

  while (iteration < MAX_ITERATIONS) {
    iteration++;

    // Fetch dynamic MCP tools
    const mcpTools = await getAllLoadedMCPTools();
    const allTools = [...tools, ...mcpTools];

    // Add the load_mcp_server tool dynamically
    allTools.push({
      type: 'function',
      function: {
        name: 'load_mcp_server',
        description: 'Load an MCP server to access its tools. Do this FIRST if the user asks for something related to an unloaded server.',
        parameters: {
          type: 'object',
          properties: {
            serverName: { type: 'string', description: 'The name of the server to load' }
          },
          required: ['serverName']
        }
      }
    });

    const requestPayload: any = {
      model: process.env.OLLAMA_MODEL || 'qwen3:14b',
      messages: messages,
    };
    
    if (allTools.length > 0) {
      requestPayload.tools = allTools;
      requestPayload.tool_choice = 'auto';
    }

    console.log(`[DEBUG] Iteration ${iteration}. Sending ${allTools.length} tools to Ollama.`);
    // Call Ollama
    const response = await openai.chat.completions.create(requestPayload);

    const responseMessage = response.choices[0].message;
    console.log(`[DEBUG] Ollama response: tool_calls=${responseMessage.tool_calls?.length || 0}, content=${!!responseMessage.content}`);
    messages.push(responseMessage);

    // Handle Tool Calls
    if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
      // Save assistant message with tool calls to SQLite
      addMessage('assistant', responseMessage.content, JSON.stringify(responseMessage.tool_calls));

      for (const toolCall of responseMessage.tool_calls) {
        let toolResult: string;
        
        if (toolCall.type === 'function') {
          const functionName = toolCall.function.name;
          
          if (functionName === 'get_current_time') {
            toolResult = JSON.stringify({ time: getCurrentTime() });
          } else if (functionName === 'load_mcp_server') {
            const args = JSON.parse(toolCall.function.arguments || '{}');
            try {
              await startMCPServer(args.serverName);
              toolResult = JSON.stringify({ 
                success: true, 
                message: `Server ${args.serverName} loaded successfully. Its tools are now available. You MUST now use these newly available tools to fulfill the user's original request. Do not stop here.` 
              });
            } catch (err: any) {
              toolResult = JSON.stringify({ error: err.message });
            }
          } else if (functionName.includes('__')) {
            // MCP Tool execution
            const [serverName, actualToolName] = functionName.split('__');
            try {
              const args = JSON.parse(toolCall.function.arguments || '{}');
              const result = await callMCPTool(serverName, actualToolName, args);
              // MCP tools usually return { content: [{ type: 'text', text: '...' }] }
              if (result && result.content && Array.isArray(result.content)) {
                toolResult = result.content.map((c: any) => c.text).join('\n');
              } else {
                toolResult = JSON.stringify(result);
              }
            } catch (err: any) {
              console.error(`Error calling MCP tool ${functionName}:`, err);
              toolResult = JSON.stringify({ error: err.message });
            }
          } else {
            toolResult = JSON.stringify({ error: 'Unknown function' });
          }
        } else {
          toolResult = JSON.stringify({ error: 'Unknown tool type' });
        }

        // Push the tool response back to the model, matching the tool_call_id
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: toolResult
        });
        
        // Save tool response to exact memory (SQLite)
        addMessage('tool', toolResult, undefined, toolCall.id);
      }
    } else {
      // No more tool calls, we have our final response
      const finalContent = responseMessage.content || 'No response generated.';
      
      // Save assistant response to exact memory (SQLite)
      addMessage('assistant', finalContent);
      
      // Async save to semantic memory (Pinecone) - don't block the response
      upsertSemanticMemory(`User: ${userMessage}\nIRIS: ${finalContent}`).catch(console.error);

      return finalContent;
    }
  }

  return "Error: Maximum agent iterations reached.";
}

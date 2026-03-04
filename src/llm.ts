import OpenAI from 'openai';
import { addMessage, getRecentMessages } from './memory/sqlite.js';
import { getAllLoadedMCPTools, callMCPTool, startMCPServer, mcpClients } from './mcp.js';
import { loadSkills } from './router.js';

// Helper function to wrap Promises with a timeout
async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, errorMessage: string): Promise<T> {
  let timeoutHandle: NodeJS.Timeout;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new Error(errorMessage)), timeoutMs);
  });
  return Promise.race([
    promise,
    timeoutPromise
  ]).finally(() => clearTimeout(timeoutHandle));
}

// Initialize OpenRouter
const cloudOpenai = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY || 'sk-or-v1-missing',
});

// Define the get_current_time tool (OpenAI format)
const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'get_current_time',
      description: 'Get the current local time.',
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

  // 2. Load recent history (last 10 messages)
  const history = getRecentMessages(10);
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
  
  for (const msg of history) {
    if (msg.role === 'user' || msg.role === 'assistant' || msg.role === 'tool') {
      const messageParam: any = { role: msg.role, content: msg.content };
      if (msg.tool_calls) messageParam.tool_calls = msg.tool_calls;
      if (msg.tool_call_id) messageParam.tool_call_id = msg.tool_call_id;
      messages.push(messageParam);
    }
  }

  // 3. Load Skills Context
  const skills = loadSkills();
  const skillsList = skills.map(s => `- ${s.name}: ${s.description}`).join('\n');

  // Pinecone is currently disabled per user request, so memoryContext is empty
  const memoryContext = '';

  const systemPrompt = `You are IRIS (Intelligent Response and Insight System), a personal AI agent. 
Today's Date: ${getCurrentTime()}

Available Sub-Skills (for your awareness):
${skillsList}

CRITICAL RULES FOR TOOLS:
1. ZAPIER 'instructions' PARAMETER: Every Zapier tool REQUIRES an 'instructions' parameter. You MUST include it. Example: { "instructions": "Find events for tomorrow" }.
2. CONVERSATIONAL RESPONSES: When a tool returns data (like emails or calendar events), read the data and answer the user naturally. DO NOT say "Here is the JSON" or list execution metadata. Act like a human assistant who just looked up the info and reply with a cleanly formatted and aesthetic response.
${memoryContext}`;
  
  // Prepend system prompt to messages
  messages.unshift({ role: 'system', content: systemPrompt });

  let iteration = 0;
  const MAX_ITERATIONS = 15;

  // Force OpenRouter use
  const openaiClient = cloudOpenai;
  const modelName = process.env.OPENROUTER_MODEL || 'openrouter/free';

  console.log(`[LLM] Executing with Model: ${modelName} (cloud)`);

  while (iteration < MAX_ITERATIONS) {
    iteration++;

    // Fetch dynamic MCP tools (all currently loaded servers)
    const mcpTools = await getAllLoadedMCPTools();
    const allTools = [...tools, ...mcpTools];

    const requestPayload: any = {
      model: modelName,
      messages: messages,
    };
    
    if (allTools.length > 0) {
      requestPayload.tools = allTools;
      requestPayload.tool_choice = 'auto';
    }

    console.log(`[DEBUG] Iteration ${iteration}. Sending ${allTools.length} tools to cloud model.`);
    
    // Call LLM
    try {
      const response = await withTimeout(
        openaiClient.chat.completions.create(requestPayload),
        45000,
        "OpenRouter LLM request timed out after 45 seconds"
      );

      const responseMessage = response.choices[0].message;
      console.log(`[DEBUG] LLM response: tool_calls=${responseMessage.tool_calls?.length || 0}, content=${!!responseMessage.content}`);
      messages.push({ role: responseMessage.role, content: responseMessage.content, tool_calls: responseMessage.tool_calls } as any);

      // Handle Tool Calls
      if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
        // Save assistant message with tool calls to SQLite
        addMessage('assistant', responseMessage.content || '', JSON.stringify(responseMessage.tool_calls));

        const toolResponses = await Promise.all(responseMessage.tool_calls.map(async (toolCall) => {
          let toolResult: string;
          
          if (toolCall.type === 'function') {
            const functionName = toolCall.function.name;
            
            if (functionName === 'get_current_time') {
              toolResult = JSON.stringify({ time: getCurrentTime() });
            } else if (functionName.includes('__')) {
              // MCP Tool execution
              const [serverName, actualToolName] = functionName.split('__');
              try {
                const args = JSON.parse(toolCall.function.arguments || '{}');
                
                // On-the-fly server loading (robustness second layer)
                if (!mcpClients[serverName]) {
                  console.log(`[LLM] Server ${serverName} requested by LLM but not loaded. Attempting on-the-fly start...`);
                  try {
                    await startMCPServer(serverName);
                  } catch (startErr) {
                    throw new Error(`Failed to start server ${serverName} on-the-fly: ${startErr}`);
                  }
                }

                const result = await withTimeout(
                  callMCPTool(serverName, actualToolName, args),
                  45000,
                  `MCP Tool ${functionName} timed out after 45 seconds`
                );
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

          return {
            role: 'tool',
            tool_call_id: toolCall.id,
            content: toolResult
          };
        }));

        // Push all tool responses to messages array
        for (const toolResponse of toolResponses) {
          messages.push(toolResponse as any);
          // Save tool response to exact memory (SQLite)
          addMessage('tool', toolResponse.content, undefined, toolResponse.tool_call_id);
        }
      } else {
        // No more tool calls, we have our final response
        const finalContent = responseMessage.content || 'No response generated.';
        
        // Save assistant response to exact memory (SQLite)
        addMessage('assistant', finalContent);
        
        return finalContent;
      }
    } catch (e: any) {
      console.error("[LLM] Error calling OpenRouter:", e.message);
      return `I encountered an error connecting to my core reasoning unit: ${e.message}`;
    }
  }

  return "Error: Maximum agent iterations reached.";
}

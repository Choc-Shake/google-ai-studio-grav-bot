import OpenAI from 'openai';
import { addMessage, getRecentMessages } from './memory/sqlite.js';
import { searchSemanticMemory, upsertSemanticMemory } from './memory/pinecone.js';
import { getAllLoadedMCPTools, callMCPTool, getAvailableMCPServers, startMCPServer } from './mcp.js';
import { determineRoute, loadSkills } from './router.js';

// Initialize Ollama via OpenAI SDK
const localOpenai = new OpenAI({
  baseURL: process.env.OLLAMA_BASE_URL || 'http://localhost:11434/v1',
  apiKey: 'ollama', // OpenAI SDK requires an API key, but Ollama ignores it
});

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

  // 3. Determine Route
  const route = await determineRoute(userMessage, history);
  const skills = loadSkills();
  const activeSkill = skills.find(s => s.name === route.skill);
  
  // 4. Load Required MCP Servers
  let allowedTools: string[] | undefined = undefined;
  if (activeSkill && activeSkill.toolsRequired.length > 0) {
    allowedTools = activeSkill.toolsRequired;
    // Extract server names from tool names (e.g., 'zapier__google_calendar_find_events' -> 'zapier')
    const requiredServers = new Set(allowedTools.map(t => t.split('__')[0]));
    for (const serverName of requiredServers) {
      try {
        await startMCPServer(serverName);
      } catch (e) {
        console.error(`[LLM] Failed to load required server ${serverName} for skill ${activeSkill.name}:`, e);
      }
    }
  }

  // 5. Retrieve semantic memories (Pinecone)
  const semanticMemories = await searchSemanticMemory(userMessage);
  const memoryContext = semanticMemories.length > 0 
    ? `\n\nRelevant past memories:\n${semanticMemories.map(m => `- ${m}`).join('\n')}`
    : '';

  const systemPrompt = `You are IRIS (Intelligent Response and Insight System), a personal AI agent. You have access to tools. Use them if necessary.
Active Skill: ${activeSkill ? activeSkill.name : 'general'}
Description: ${activeSkill ? activeSkill.description : 'General conversation and tasks.'}

CRITICAL RULES FOR TOOLS:
1. ZAPIER 'instructions' PARAMETER: Every Zapier tool REQUIRES an 'instructions' parameter. You MUST include it. Example: { "instructions": "Find events for tomorrow" }.
2. CONVERSATIONAL RESPONSES: When a tool returns data (like emails or calendar events), read the data and answer the user naturally. DO NOT say "Here is the JSON" or list execution metadata. Act like a human assistant who just looked up the info.
3. LATEST EMAIL: When asked to find the latest email, use the 'zapier__gmail_find_email' tool with query="in:inbox" and instructions="find the latest email".
${memoryContext}`;
  
  // Prepend system prompt to messages
  messages.unshift({ role: 'system', content: systemPrompt });

  let iteration = 0;
  const MAX_ITERATIONS = 5;

  const openaiClient = route.model === 'cloud' ? cloudOpenai : localOpenai;
  const modelName = route.model === 'cloud' 
    ? (process.env.OPENROUTER_MODEL || 'openrouter/google/gemini-2.0-flash-exp:free')
    : (process.env.LOCAL_MODEL || 'qwen3:14b');

  console.log(`[LLM] Executing with Model: ${modelName} (${route.model})`);

  while (iteration < MAX_ITERATIONS) {
    iteration++;

    // Fetch dynamic MCP tools (filtered by active skill)
    const mcpTools = await getAllLoadedMCPTools(allowedTools);
    const allTools = [...tools, ...mcpTools];

    const requestPayload: any = {
      model: modelName,
      messages: messages,
    };
    
    if (allTools.length > 0) {
      requestPayload.tools = allTools;
      requestPayload.tool_choice = 'auto';
    }

    console.log(`[DEBUG] Iteration ${iteration}. Sending ${allTools.length} tools to ${route.model} model.`);
    
    // Call LLM
    const response = await openaiClient.chat.completions.create(requestPayload);

    const responseMessage = response.choices[0].message;
    console.log(`[DEBUG] LLM response: tool_calls=${responseMessage.tool_calls?.length || 0}, content=${!!responseMessage.content}`);
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

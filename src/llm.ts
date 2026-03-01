import OpenAI from 'openai';
import { addMessage, getRecentMessages } from './memory/sqlite.js';
import { searchSemanticMemory, upsertSemanticMemory } from './memory/pinecone.js';

// Initialize OpenRouter via OpenAI SDK
const openai = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY,
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
  const systemPrompt = `You are Gravity Claw, a personal AI agent. You have access to tools. Use them if necessary.${memoryContext}`;
  
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt }
  ];

  // Load recent history (last 10 messages)
  const history = getRecentMessages(10);
  for (const msg of history) {
    // Only push user/assistant messages from history to keep context clean
    if (msg.role === 'user' || msg.role === 'assistant') {
      messages.push({ role: msg.role, content: msg.content });
    }
  }

  let iteration = 0;
  const MAX_ITERATIONS = 5;

  while (iteration < MAX_ITERATIONS) {
    iteration++;

    // Call OpenRouter
    const response = await openai.chat.completions.create({
      model: 'openai/gpt-4o-mini', // Reliable tool-calling model on OpenRouter
      messages: messages,
      tools: tools,
      tool_choice: 'auto',
    });

    const responseMessage = response.choices[0].message;
    messages.push(responseMessage);

    // Handle Tool Calls
    if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
      for (const toolCall of responseMessage.tool_calls) {
        let toolResult: string;
        
        if (toolCall.type === 'function' && toolCall.function.name === 'get_current_time') {
          toolResult = JSON.stringify({ time: getCurrentTime() });
        } else {
          toolResult = JSON.stringify({ error: 'Unknown function' });
        }

        // Push the tool response back to the model, matching the tool_call_id
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: toolResult
        });
      }
    } else {
      // No more tool calls, we have our final response
      const finalContent = responseMessage.content || 'No response generated.';
      
      // Save assistant response to exact memory (SQLite)
      addMessage('assistant', finalContent);
      
      // Async save to semantic memory (Pinecone) - don't block the response
      upsertSemanticMemory(`User: ${userMessage}\nGravity Claw: ${finalContent}`).catch(console.error);

      return finalContent;
    }
  }

  return "Error: Maximum agent iterations reached.";
}

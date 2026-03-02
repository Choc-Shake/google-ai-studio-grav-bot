import { addMessage, getRecentMessages } from '../src/memory/sqlite.js';

console.log("Testing history metadata persistence...");

// Clean up any existing messages for this test (optional, but good for isolation)
// We'll just add a few and check the latest ones.

addMessage('user', 'Test user message');
addMessage('assistant', null, JSON.stringify([{ id: 'call_123', type: 'function', function: { name: 'test_tool', arguments: '{}' } }]));
addMessage('tool', 'Test tool response', undefined, 'call_123');

const history = getRecentMessages(3);

let passed = true;

if (history[0].role !== 'user') passed = false;
if (history[1].role !== 'assistant' || !history[1].tool_calls || history[1].tool_calls[0].id !== 'call_123') passed = false;
if (history[2].role !== 'tool' || history[2].tool_call_id !== 'call_123') passed = false;

if (passed) {
  console.log("✅ History metadata persistence test passed!");
} else {
  console.error("❌ History metadata persistence test failed!");
  console.log(JSON.stringify(history, null, 2));
}

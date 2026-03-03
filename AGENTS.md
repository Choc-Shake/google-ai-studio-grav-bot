# 🚀 B.L.A.S.T. Master System Prompt: IRIS Agent Refactor

**Identity:** You are the System Pilot. Your mission is to refactor the IRIS (Intelligent Response and Insight System) Node.js/TypeScript agent into a deterministic, highly-efficient, self-healing architecture. 

**Core Problem to Solve:** The current agent loop in `src/llm.ts` is suffering from severe Context Bloat, causing massive latencies and iteration exhaustion. We must implement a configurable routing system to control model execution.

**🟢 Protocol 0: Initialization & Environment**
Before rewriting any logic, establish the A.N.T. (Agentic, Nested, Task-oriented) structure and the Environment toggles.
1. Create/Update `.env` to include the following configuration:
   * `LLM_ROUTING_MODE="HYBRID"` (Valid options: `HYBRID`, `LOCAL_ONLY`, `CLOUD_ONLY`)
   * `OPENROUTER_MODEL="openrouter/google/gemini-2.0-flash-exp:free"` (Must be configurable)
   * `LOCAL_MODEL="qwen2.5:7b"` (or whichever local model is currently active)
   * `OPENROUTER_API_KEY=""`
2. Ensure the directory structure includes:
   * `/src/router.ts` (NEW: Intent classification and environment routing)
   * `/src/llm.ts` (REFACTOR: Clean execution loop)
   * `.agent/skills/` (NEW: Isolated tool loading, e.g., `zapier-calendar.skill.md`)

**🔵 Protocol 1: The Configurable Router (Blueprint & Link)**
Refactor the application flow to implement a routing system that strictly obeys `process.env.LLM_ROUTING_MODE`.
1. **`LOCAL_ONLY` Mode:** ALL tasks (routing, tool calling, and text generation) are sent to the `LOCAL_MODEL` via Ollama. OpenRouter is never called.
2. **`CLOUD_ONLY` Mode:** ALL tasks are sent to the `OPENROUTER_MODEL`. Ollama is never called.
3. **`HYBRID` Mode:** * **Tier 1 (The Router):** `src/router.ts` uses the `LOCAL_MODEL` to perform lightning-fast Intent Classification. It does NOT get any MCP tools. It returns a JSON string deciding the target Skill.
   * **Tier 2 (The Executor):** `src/llm.ts` receives the route. If the task requires heavy text generation (e.g., drafting emails), it sends the execution to the `OPENROUTER_MODEL`. If it is a simple tool call (Calendar/Weather), it uses the `LOCAL_MODEL`.

**🟣 Protocol 2: MCP Tool Isolation (Architect)**
Modify `src/mcp.ts`. Remove the generic `load_mcp_server` tool that dumps all tools into context. 
* Implement strict Tool Filtering. When the Executor calls an MCP server, it must only pass the 2 or 3 tools explicitly required by the active Skill. 
* Maintain the existing `simplifySchema` workaround for local LLMs to prevent schema parsing crashes.

**🟠 Protocol 3: Memory Integrity (Stylize)**
Maintain the existing `better-sqlite3` and `Pinecone` implementations. Ensure that regardless of which model executes the task, the resulting `tool_calls` and tool outputs are successfully written to `data/memory.db`.

**🟡 Protocol 4: Evolutionary Architecture (Extensibility)**
IRIS is designed for continuous future upgrades. You must adhere to strict modularity:
* **Decoupling:** Do not tightly couple the LLM logic, the Telegram interface, or the MCP tools. They must communicate through clear, typed interfaces.
* **Plug-and-Play Skills:** The system must be designed so that adding a new capability (like a new Moodle downloader or Outlook integration) requires ONLY dropping a new `.md` file into `.agent/skills/` and updating the Router schema. It must NEVER require rewriting the core loop in `src/llm.ts`.
* **Graceful Degradation:** If an external API or MCP server fails, the agent must catch the error, inform the user cleanly, and maintain its operational state. 

**🔴 Protocol 5: Execution (Trigger)**
Begin the refactor by outlining your exact plan in the terminal. Then, construct the `.env` variables, build `src/router.ts` to handle the three toggle states, and refactor `src/llm.ts` applying the Extensibility rules.
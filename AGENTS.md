# IRIS - Project Constitution

## Overview
IRIS (Intelligent Response and Insight System) is a personal AI agent running on Telegram, built with local-first principles. This document serves as the core architectural and security guideline for any AI agent working on this codebase.

## Core Architecture
- **Language:** TypeScript (Node.js)
- **Interface:** Telegram Bot API using `grammy` (Long-polling mode)
- **LLM Provider:** OpenRouter (via `openai` SDK)
- **Memory System:**
  - **Short-term / Exact:** SQLite (local database for recent chat history)
  - **Long-term / Semantic:** Pinecone (Vector database for semantic search)
- **Voice Processing:** Groq (Whisper) for fast audio transcription

## Security Non-Negotiables
1. **Strict Whitelisting:** The bot MUST only respond to the authorized Telegram User ID (`TELEGRAM_USER_ID` in `.env`). All other requests must be silently ignored.
2. **Secret Management:** Never hardcode API keys or secrets. Always use environment variables (`.env`).
3. **Local-First:** Prefer local processing and storage where possible (e.g., SQLite for exact memory) before relying on external cloud services.

## AI Agent Instructions
**CRITICAL:** Before making ANY changes to this codebase, you MUST read `progress.md` to understand the current state of the project, what has been built, and what the immediate next steps are.

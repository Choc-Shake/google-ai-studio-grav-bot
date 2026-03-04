import { Pinecone } from '@pinecone-database/pinecone';
import OpenAI from 'openai';

const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY || '' });
const indexName = 'iris';

// We use Ollama for embeddings too
const openai = new OpenAI({
  baseURL: process.env.OLLAMA_BASE_URL || 'http://localhost:11434/v1',
  apiKey: 'ollama',
});

async function getEmbedding(text: string): Promise<number[]> {
  try {
    const response = await openai.embeddings.create({
      model: process.env.OLLAMA_EMBEDDING_MODEL || 'nomic-embed-text',
      input: text,
    });
    return response.data[0].embedding;
  } catch (e: any) {
    if (e.message?.includes('fetch failed') || e.code === 'ECONNREFUSED') {
      console.warn('[Embedding] Local embedding service (Ollama) is offline or unreachable. Skipping semantic memory lookup/save.');
    } else {
      console.error('[Embedding] Error getting embedding:', e.message);
    }
    return [];
  }
}

export async function upsertSemanticMemory(text: string, metadata: any = {}) {
  if (!process.env.PINECONE_API_KEY) return;
  if (!text || text.trim() === '') return;
  
  try {
    const index = pc.index(indexName);
    const embedding = await getEmbedding(text);
    
    if (!embedding || embedding.length === 0) {
      console.error('Pinecone upsert skipped: Embedding is empty. Did Ollama return a valid embedding?');
      return;
    }

    const id = `mem_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    
    await index.upsert({
      records: [
        {
          id,
          values: embedding,
          metadata: { text, timestamp: new Date().toISOString(), ...metadata }
        }
      ]
    });
  } catch (e) {
    console.error('Pinecone upsert error (ensure index exists):', e);
  }
}

export async function searchSemanticMemory(query: string, topK: number = 3): Promise<string[]> {
  if (!process.env.PINECONE_API_KEY) return [];
  try {
    const index = pc.index(indexName);
    const queryEmbedding = await getEmbedding(query);
    if (!queryEmbedding || queryEmbedding.length === 0) {
      return [];
    }
    
    const results = await index.query({
      vector: queryEmbedding,
      topK,
      includeMetadata: true
    });
    
    return results.matches.map(m => m.metadata?.text).filter(Boolean) as string[];
  } catch (e) {
    console.error('Pinecone search error:', e);
    return [];
  }
}

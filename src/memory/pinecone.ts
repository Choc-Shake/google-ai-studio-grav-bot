import { Pinecone } from '@pinecone-database/pinecone';
import OpenAI from 'openai';

const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY || '' });
const indexName = 'gravity-claw';

// We use OpenRouter for embeddings too, or fallback to a free provider if needed.
// OpenRouter supports text-embedding-3-small via OpenAI routing.
const openai = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY,
});

async function getEmbedding(text: string): Promise<number[]> {
  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text,
    dimensions: 1024,
  });
  return response.data[0].embedding;
}

export async function upsertSemanticMemory(text: string, metadata: any = {}) {
  if (!process.env.PINECONE_API_KEY) return;
  try {
    const index = pc.index(indexName);
    const embedding = await getEmbedding(text);
    const id = `mem_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    
    await index.upsert([{
      id,
      values: embedding,
      metadata: { text, timestamp: new Date().toISOString(), ...metadata }
    }] as any);
  } catch (e) {
    console.error('Pinecone upsert error (ensure index exists):', e);
  }
}

export async function searchSemanticMemory(query: string, topK: number = 3): Promise<string[]> {
  if (!process.env.PINECONE_API_KEY) return [];
  try {
    const index = pc.index(indexName);
    const queryEmbedding = await getEmbedding(query);
    
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

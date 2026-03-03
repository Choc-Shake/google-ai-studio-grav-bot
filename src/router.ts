import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';

export type RoutingMode = 'HYBRID' | 'LOCAL_ONLY' | 'CLOUD_ONLY';

export interface RouteDecision {
  skill: string;
  model: 'local' | 'cloud';
}

const localOpenai = new OpenAI({
  baseURL: process.env.OLLAMA_BASE_URL || 'http://localhost:11434/v1',
  apiKey: 'ollama',
});

// Cache for loaded skills
let availableSkills: { name: string, description: string, modelPreference: string, toolsRequired: string[] }[] = [];

export function loadSkills() {
  if (availableSkills.length > 0) return availableSkills;
  
  const skillsDir = path.join(process.cwd(), '.agent', 'skills');
  if (!fs.existsSync(skillsDir)) return [];

  const files = fs.readdirSync(skillsDir).filter(f => f.endsWith('.skill.md'));
  
  for (const file of files) {
    const content = fs.readFileSync(path.join(skillsDir, file), 'utf-8');
    const name = file.replace('.skill.md', '');
    
    // Simple extraction of Description and Model Preference
    const descMatch = content.match(/\*\*Description:\*\*\n([\s\S]*?)(?=\n\*\*|$)/);
    const modelMatch = content.match(/\*\*Model Preference:\*\*\n(.*)/);
    
    // Extract tools required
    const toolsMatch = content.match(/\*\*Tools Required:\*\*\n([\s\S]*?)(?=\n\*\*|$)/);
    const toolsRequired = toolsMatch 
      ? toolsMatch[1].split('\n').map(t => t.replace(/^- `?|`?$/g, '').trim()).filter(t => t)
      : [];
    
    availableSkills.push({
      name,
      description: descMatch ? descMatch[1].trim() : 'No description',
      modelPreference: modelMatch ? modelMatch[1].trim() : 'local',
      toolsRequired
    });
  }
  
  return availableSkills;
}

export async function determineRoute(userMessage: string, recentHistory: any[]): Promise<RouteDecision> {
  const mode = (process.env.LLM_ROUTING_MODE || 'HYBRID') as RoutingMode;

  if (mode === 'LOCAL_ONLY') {
    return { skill: 'general', model: 'local' };
  }

  if (mode === 'CLOUD_ONLY') {
    return { skill: 'general', model: 'cloud' };
  }

  // HYBRID MODE: Use local model to classify intent
  const skills = loadSkills();
  const skillsList = skills.map(s => `- ${s.name}: ${s.description} (Prefers: ${s.modelPreference})`).join('\n');

  const systemPrompt = `You are the IRIS Router. Your ONLY job is to classify the user's intent and return a JSON object.
Available Skills:
${skillsList}
- general: General conversation, questions, or tasks not covered by specific skills. (Prefers: local)

Based on the user's request, determine the most appropriate skill and the preferred model ('local' or 'cloud').
If the task involves heavy text generation (like writing an email, essay, or complex reasoning), prefer 'cloud'.
If the task is a simple tool lookup (like checking calendar, weather, or simple facts), prefer 'local'.

You MUST respond with ONLY valid JSON in this exact format:
{
  "skill": "skill-name",
  "model": "local" | "cloud"
}`;

  try {
    const response = await localOpenai.chat.completions.create({
      model: process.env.LOCAL_MODEL || 'qwen3:14b',
      messages: [
        { role: 'system', content: systemPrompt },
        // Only send the last few messages for context to keep routing fast
        ...recentHistory.slice(-3).map(m => ({ role: m.role, content: m.content || '' })),
        { role: 'user', content: userMessage }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1, // Low temperature for deterministic routing
    });

    const content = response.choices[0].message.content || '{}';
    const decision = JSON.parse(content);

    // Validate the decision
    const validSkills = [...skills.map(s => s.name), 'general'];
    const finalSkill = validSkills.includes(decision.skill) ? decision.skill : 'general';
    const finalModel = decision.model === 'cloud' ? 'cloud' : 'local';

    console.log(`[ROUTER] Decision: Skill=${finalSkill}, Model=${finalModel}`);
    return { skill: finalSkill, model: finalModel };

  } catch (error) {
    console.error('[ROUTER] Error determining route, falling back to local/general:', error);
    return { skill: 'general', model: 'local' };
  }
}

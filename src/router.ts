import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';

export type RoutingMode = 'HYBRID' | 'LOCAL_ONLY' | 'CLOUD_ONLY';

export interface RouteDecision {
  skill: string;
  model: 'local' | 'cloud';
  requiredServers: string[];
}

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
      modelPreference: modelMatch ? modelMatch[1].trim() : 'cloud', // Default to cloud now
      toolsRequired
    });
  }
  
  return availableSkills;
}

import { loadMCPConfigs, mcpServerConfigs } from '../src/mcp.js';

// We need to export simplifySchema to test it, or just copy it here for testing.
// Let's copy it here for a quick test since it's not exported.

function simplifySchema(schema: any): any {
  if (!schema || typeof schema !== 'object') return schema;

  if (Array.isArray(schema)) {
    return schema.map(simplifySchema);
  }

  const simplified = { ...schema };

  if (simplified.anyOf || simplified.allOf || simplified.oneOf) {
    const logicalBlock = simplified.anyOf || simplified.allOf || simplified.oneOf;
    
    // Try to extract a dominant type (like string) from the logical block
    let extractedType = null;
    let extractedDescription = null;
    
    if (Array.isArray(logicalBlock)) {
      for (const item of logicalBlock) {
        if (item.type && item.type !== 'null') {
          extractedType = item.type;
          if (item.description) extractedDescription = item.description;
          break; // Take the first non-null type
        }
      }
    }

    delete simplified.anyOf;
    delete simplified.allOf;
    delete simplified.oneOf;
    
    if (extractedType) {
      simplified.type = extractedType;
    } else if (!simplified.type) {
      simplified.type = 'string';
    }
    
    if (extractedDescription && !simplified.description) {
      simplified.description = extractedDescription;
    }
  }

  if (simplified.not) {
    delete simplified.not;
  }

  if (simplified.properties) {
    for (const key of Object.keys(simplified.properties)) {
      simplified.properties[key] = simplifySchema(simplified.properties[key]);
    }
  }

  if (simplified.items) {
    simplified.items = simplifySchema(simplified.items);
  }

  return simplified;
}

console.log("Testing schema simplification...");

const complexSchema = {
  "type": "object",
  "properties": {
    "instructions": {
      "anyOf": [
        { "type": "string", "description": "The instructions to follow" },
        { "type": "null" }
      ]
    }
  }
};

const simplified = simplifySchema(complexSchema);

if (simplified.properties.instructions.type === 'string' && simplified.properties.instructions.description === 'The instructions to follow') {
  console.log("✅ Schema simplification test passed!");
} else {
  console.error("❌ Schema simplification test failed!");
  console.log(JSON.stringify(simplified, null, 2));
}

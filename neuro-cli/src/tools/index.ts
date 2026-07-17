// ============================================================
// NeuroCLI - Tool Registration
// Registers all built-in tools (15+ tools)
// ============================================================

import { ToolRegistry, globalRegistry } from './registry.js';
import { fileTools } from './file.js';
import { shellTools } from './bash.js';
import { webTools } from './web.js';
import { memoryTools } from './memory.js';
import { extendedTools } from './extended.js';

export function registerAllTools(registry: ToolRegistry = globalRegistry): ToolRegistry {
  // Register file tools (7)
  for (const tool of fileTools) {
    registry.register(tool);
  }

  // Register shell/bash tools (2)
  for (const tool of shellTools) {
    registry.register(tool);
  }

  // Register web tools (3)
  for (const tool of webTools) {
    registry.register(tool);
  }

  // Register memory/knowledge tools (3)
  for (const tool of memoryTools) {
    registry.register(tool);
  }

  // Register extended tools: Todo, AskUser, Monitor (3)
  for (const tool of extendedTools) {
    registry.register(tool);
  }

  return registry;
}

export { globalRegistry } from './registry.js';
export { fileTools } from './file.js';
export { shellTools } from './bash.js';
export { webTools } from './web.js';
export { memoryTools } from './memory.js';
export { extendedTools } from './extended.js';

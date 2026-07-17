// ============================================================
// NeuroCLI - Tool Registration
// Registers all built-in tools
// ============================================================
import { globalRegistry } from './registry.js';
import { fileTools } from './file.js';
import { shellTools } from './bash.js';
import { webTools } from './web.js';
import { memoryTools } from './memory.js';
export function registerAllTools(registry = globalRegistry) {
    // Register file tools
    for (const tool of fileTools) {
        registry.register(tool);
    }
    // Register shell/bash tools
    for (const tool of shellTools) {
        registry.register(tool);
    }
    // Register web tools
    for (const tool of webTools) {
        registry.register(tool);
    }
    // Register memory/knowledge tools
    for (const tool of memoryTools) {
        registry.register(tool);
    }
    return registry;
}
export { globalRegistry } from './registry.js';
export { fileTools } from './file.js';
export { shellTools } from './bash.js';
export { webTools } from './web.js';
export { memoryTools } from './memory.js';
//# sourceMappingURL=index.js.map
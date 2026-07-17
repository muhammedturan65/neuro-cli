// ============================================================
// NeuroCLI - Tool Registry
// Central tool management and execution system
// ============================================================
export class ToolRegistry {
    tools = new Map();
    register(tool) {
        this.tools.set(tool.name, tool);
    }
    unregister(name) {
        this.tools.delete(name);
    }
    get(name) {
        return this.tools.get(name);
    }
    getAll() {
        return Array.from(this.tools.values());
    }
    getDefinitions(toolNames) {
        if (toolNames) {
            return toolNames
                .map(name => this.tools.get(name)?.definition)
                .filter((d) => d !== undefined);
        }
        return this.getAll().map(t => t.definition);
    }
    async execute(name, args, context) {
        const tool = this.tools.get(name);
        if (!tool) {
            return {
                toolCallId: `error_${Date.now()}`,
                content: `Unknown tool: ${name}`,
                isError: true,
            };
        }
        try {
            const content = await tool.execute(args, context);
            return {
                toolCallId: `tool_${Date.now()}`,
                content,
                isError: false,
            };
        }
        catch (error) {
            return {
                toolCallId: `error_${Date.now()}`,
                content: `Tool execution error (${name}): ${error instanceof Error ? error.message : String(error)}`,
                isError: true,
            };
        }
    }
    getApprovalRequest(name, args) {
        const tool = this.tools.get(name);
        if (!tool || !tool.getApprovalRequest)
            return null;
        return tool.getApprovalRequest(args);
    }
    has(name) {
        return this.tools.has(name);
    }
}
// Global singleton
export const globalRegistry = new ToolRegistry();
//# sourceMappingURL=registry.js.map
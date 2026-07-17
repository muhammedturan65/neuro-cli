// ============================================================
// NeuroCLI - LSP Integration
// Real-time code intelligence via Language Servers
// (Like OpenCode/CRUSH - unique killer feature)
// ============================================================
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { join, extname } from 'path';
export class LSPManager {
    servers = new Map();
    workingDirectory;
    diagnostics = new Map();
    initialized = false;
    constructor(workingDirectory) {
        this.workingDirectory = workingDirectory;
    }
    /**
     * Initialize LSP servers based on project tech stack
     */
    async initialize() {
        if (this.initialized)
            return;
        const detectedServers = this.detectLanguageServers();
        for (const config of detectedServers) {
            try {
                const server = new LSPServer(config, this.workingDirectory);
                await server.start();
                this.servers.set(config.language, server);
            }
            catch (error) {
                // Silently skip servers that can't start
            }
        }
        this.initialized = true;
    }
    /**
     * Get diagnostics for a file
     */
    getDiagnostics(filePath) {
        return this.diagnostics.get(filePath) || [];
    }
    /**
     * Get all diagnostics across all files
     */
    getAllDiagnostics() {
        const all = [];
        for (const diags of this.diagnostics.values()) {
            all.push(...diags);
        }
        return all;
    }
    /**
     * Get diagnostics as context string for LLM
     */
    getDiagnosticsContext() {
        const all = this.getAllDiagnostics();
        if (all.length === 0)
            return '';
        const errors = all.filter(d => d.severity === 'error');
        const warnings = all.filter(d => d.severity === 'warning');
        const lines = [];
        if (errors.length > 0) {
            lines.push(`⚠️ LSP Errors (${errors.length}):`);
            for (const e of errors.slice(0, 20)) {
                lines.push(`  ${e.file}:${e.line} - ${e.message}`);
            }
        }
        if (warnings.length > 0) {
            lines.push(`🟡 LSP Warnings (${warnings.length}):`);
            for (const w of warnings.slice(0, 10)) {
                lines.push(`  ${w.file}:${w.line} - ${w.message}`);
            }
        }
        return lines.join('\n');
    }
    /**
     * Request diagnostics for a file after edit
     */
    async requestDiagnostics(filePath) {
        const ext = extname(filePath);
        const server = this.findServerForFile(ext);
        if (!server)
            return [];
        try {
            const diags = await server.getDiagnostics(filePath);
            this.diagnostics.set(filePath, diags);
            return diags;
        }
        catch {
            return [];
        }
    }
    /**
     * Go to definition
     */
    async gotoDefinition(filePath, line, column) {
        const server = this.findServerForFile(extname(filePath));
        if (!server)
            return null;
        try {
            return await server.gotoDefinition(filePath, line, column);
        }
        catch {
            return null;
        }
    }
    /**
     * Find references
     */
    async findReferences(filePath, line, column) {
        const server = this.findServerForFile(extname(filePath));
        if (!server)
            return [];
        try {
            return await server.findReferences(filePath, line, column);
        }
        catch {
            return [];
        }
    }
    /**
     * Shutdown all LSP servers
     */
    shutdown() {
        for (const server of this.servers.values()) {
            server.shutdown();
        }
        this.servers.clear();
        this.initialized = false;
    }
    // ---- Private ----
    detectLanguageServers() {
        const servers = [];
        const cwd = this.workingDirectory;
        // TypeScript
        if (existsSync(join(cwd, 'tsconfig.json')) || existsSync(join(cwd, 'package.json'))) {
            servers.push({
                language: 'typescript',
                command: 'typescript-language-server',
                args: ['--stdio'],
                extensions: ['.ts', '.tsx', '.js', '.jsx'],
            });
        }
        // Python
        if (existsSync(join(cwd, 'pyproject.toml')) || existsSync(join(cwd, 'setup.py'))) {
            servers.push({
                language: 'python',
                command: 'pyright-langserver',
                args: ['--stdio'],
                extensions: ['.py', '.pyi'],
            });
        }
        // Go
        if (existsSync(join(cwd, 'go.mod'))) {
            servers.push({
                language: 'go',
                command: 'gopls',
                args: [],
                extensions: ['.go'],
            });
        }
        // Rust
        if (existsSync(join(cwd, 'Cargo.toml'))) {
            servers.push({
                language: 'rust',
                command: 'rust-analyzer',
                args: [],
                extensions: ['.rs'],
            });
        }
        return servers;
    }
    findServerForFile(ext) {
        for (const [_, server] of this.servers) {
            if (server.config.extensions.includes(ext)) {
                return server;
            }
        }
        return undefined;
    }
}
class LSPServer {
    config;
    process = null;
    workingDirectory;
    requestId = 0;
    pendingRequests = new Map();
    buffer = '';
    constructor(config, workingDirectory) {
        this.config = config;
        this.workingDirectory = workingDirectory;
    }
    async start() {
        this.process = spawn(this.config.command, this.config.args, {
            cwd: this.workingDirectory,
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        if (!this.process.stdin || !this.process.stdout) {
            throw new Error(`Failed to start LSP server: ${this.config.command}`);
        }
        this.process.stdout.on('data', (data) => {
            this.handleData(data.toString());
        });
        // Initialize
        await this.sendRequest('initialize', {
            processId: process.pid,
            rootUri: `file://${this.workingDirectory}`,
            capabilities: {
                textDocument: {
                    publishDiagnostics: { relatedInformation: true },
                    definition: { linkSupport: true },
                    references: {},
                },
            },
        });
        // Send initialized notification
        this.sendNotification('initialized', {});
    }
    async getDiagnostics(filePath) {
        // Request document symbols/diagnostics
        this.sendNotification('textDocument/didOpen', {
            textDocument: {
                uri: `file://${filePath}`,
                languageId: this.config.language,
                version: 1,
                text: '',
            },
        });
        // Wait a bit for diagnostics
        await new Promise(resolve => setTimeout(resolve, 1000));
        return this.diagnostics;
    }
    async gotoDefinition(filePath, line, column) {
        const result = await this.sendRequest('textDocument/definition', {
            textDocument: { uri: `file://${filePath}` },
            position: { line: line - 1, character: column - 1 },
        });
        if (result) {
            const loc = Array.isArray(result) ? result[0] : result;
            if (loc?.targetUri || loc?.uri) {
                const uri = loc.targetUri || loc.uri;
                const range = loc.targetRange || loc.range;
                return {
                    file: uri.replace('file://', ''),
                    line: (range?.start?.line || 0) + 1,
                    column: (range?.start?.character || 0) + 1,
                    name: '',
                    kind: 'definition',
                };
            }
        }
        return null;
    }
    async findReferences(filePath, line, column) {
        const result = await this.sendRequest('textDocument/references', {
            textDocument: { uri: `file://${filePath}` },
            position: { line: line - 1, character: column - 1 },
            context: { includeDeclaration: true },
        });
        if (Array.isArray(result)) {
            return result.map((ref) => ({
                file: (ref.uri || '').replace('file://', ''),
                line: (ref.range?.start?.line || 0) + 1,
                column: (ref.range?.start?.character || 0) + 1,
            }));
        }
        return [];
    }
    diagnostics = [];
    sendRequest(method, params) {
        return new Promise((resolve, reject) => {
            const id = ++this.requestId;
            this.pendingRequests.set(id, { resolve, reject });
            const message = JSON.stringify({
                jsonrpc: '2.0',
                id,
                method,
                params,
            });
            this.sendMessage(message);
        });
    }
    sendNotification(method, params) {
        const message = JSON.stringify({
            jsonrpc: '2.0',
            method,
            params,
        });
        this.sendMessage(message);
    }
    sendMessage(message) {
        if (!this.process?.stdin)
            return;
        const header = `Content-Length: ${Buffer.byteLength(message)}\r\n\r\n`;
        this.process.stdin.write(header + message);
    }
    handleData(data) {
        this.buffer += data;
        while (true) {
            const headerEnd = this.buffer.indexOf('\r\n\r\n');
            if (headerEnd === -1)
                break;
            const header = this.buffer.slice(0, headerEnd);
            const contentLengthMatch = header.match(/Content-Length:\s*(\d+)/i);
            if (!contentLengthMatch)
                break;
            const contentLength = parseInt(contentLengthMatch[1], 10);
            const bodyStart = headerEnd + 4;
            const bodyEnd = bodyStart + contentLength;
            if (this.buffer.length < bodyEnd)
                break;
            const body = this.buffer.slice(bodyStart, bodyEnd);
            this.buffer = this.buffer.slice(bodyEnd);
            try {
                const message = JSON.parse(body);
                if (message.id && this.pendingRequests.has(message.id)) {
                    const { resolve } = this.pendingRequests.get(message.id);
                    this.pendingRequests.delete(message.id);
                    resolve(message.result);
                }
                if (message.method === 'textDocument/publishDiagnostics') {
                    const uri = message.params?.uri || '';
                    const diags = (message.params?.diagnostics || []).map((d) => ({
                        file: uri.replace('file://', ''),
                        line: (d.range?.start?.line || 0) + 1,
                        column: (d.range?.start?.character || 0) + 1,
                        severity: ['hint', 'info', 'warning', 'error'][d.severity - 1] || 'info',
                        message: d.message || '',
                        source: d.source,
                        code: d.code?.toString(),
                    }));
                    this.diagnostics = diags;
                }
            }
            catch { }
        }
    }
    shutdown() {
        if (this.process) {
            this.process.kill();
            this.process = null;
        }
    }
}
//# sourceMappingURL=lsp-manager.js.map
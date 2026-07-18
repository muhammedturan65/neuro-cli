// ============================================================
// NeuroCLI - NEURO.md Persistent Context System
// Hierarchical project instructions (like CLAUDE.md / GEMINI.md)
// ============================================================
import { readFileSync, existsSync, watchFile, unwatchFile } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
export class NeuroMdSystem {
    workingDirectory;
    layers = [];
    watchers = [];
    onChange;
    constructor(workingDirectory, onChange) {
        this.workingDirectory = workingDirectory;
        this.onChange = onChange;
    }
    /**
     * Load all NEURO.md layers in priority order
     * Global → User → Project → Local → Directory
     */
    load() {
        this.layers = [];
        // 1. Global: ~/.neuro/NEURO.md
        this.tryLoadLayer('global', join(homedir(), '.neuro', 'NEURO.md'));
        // 2. User: ~/.neuro/NEURO.md (same as global for now)
        // Already loaded above
        // 3. Project: NEURO.md in project root
        this.tryLoadLayer('project', join(this.workingDirectory, 'NEURO.md'));
        // 4. Project (alt): .neuro/NEURO.md
        this.tryLoadLayer('project', join(this.workingDirectory, '.neuro', 'NEURO.md'));
        // 5. Local: NEURO.local.md (gitignored)
        this.tryLoadLayer('local', join(this.workingDirectory, 'NEURO.local.md'));
        // 6. Rules: .neuro/rules/*.md
        this.loadRulesDirectory();
        return this.layers;
    }
    /**
     * Get the combined context from all NEURO.md layers
     */
    getCombinedContext() {
        if (this.layers.length === 0)
            return '';
        const parts = [];
        parts.push('## Project Context (NEURO.md)\n');
        for (const layer of this.layers) {
            parts.push(`### [${layer.scope}] ${layer.path}\n${layer.content}\n`);
        }
        return parts.join('\n');
    }
    /**
     * Get total size of all layers
     */
    getTotalSize() {
        return this.layers.reduce((sum, l) => sum + l.size, 0);
    }
    /**
     * Initialize a new NEURO.md in the project
     */
    initProject() {
        const { writeFileSync } = require('fs');
        const projectMd = join(this.workingDirectory, 'NEURO.md');
        if (existsSync(projectMd)) {
            return `NEURO.md already exists at ${projectMd}`;
        }
        // Auto-detect tech stack
        const techStack = this.detectTechStack();
        const content = this.generateStarterMd(techStack);
        writeFileSync(projectMd, content, 'utf-8');
        return `Created NEURO.md at ${projectMd}`;
    }
    /**
     * Watch NEURO.md files for changes
     */
    startWatching() {
        this.stopWatching();
        const paths = [
            join(homedir(), '.neuro', 'NEURO.md'),
            join(this.workingDirectory, 'NEURO.md'),
            join(this.workingDirectory, '.neuro', 'NEURO.md'),
            join(this.workingDirectory, 'NEURO.local.md'),
        ];
        for (const path of paths) {
            if (existsSync(path)) {
                try {
                    watchFile(path, { interval: 5000 }, () => {
                        this.load(); // Reload on change
                        this.onChange?.();
                    });
                    this.watchers.push({ path, close: () => unwatchFile(path) });
                }
                catch { }
            }
        }
    }
    /**
     * Stop watching NEURO.md files
     */
    stopWatching() {
        for (const w of this.watchers) {
            w.close();
        }
        this.watchers = [];
    }
    // ---- Private Methods ----
    tryLoadLayer(scope, path) {
        if (!existsSync(path))
            return;
        try {
            const content = readFileSync(path, 'utf-8');
            // Process @import references
            const processed = this.processImports(content, path);
            this.layers.push({ scope, path, content: processed, size: content.length });
        }
        catch { }
    }
    loadRulesDirectory() {
        const rulesDir = join(this.workingDirectory, '.neuro', 'rules');
        if (!existsSync(rulesDir))
            return;
        try {
            const { readdirSync } = require('fs');
            const files = readdirSync(rulesDir).filter((f) => f.endsWith('.md'));
            for (const file of files) {
                this.tryLoadLayer('directory', join(rulesDir, file));
            }
        }
        catch { }
    }
    /**
     * Process @import references in NEURO.md
     * e.g. @path/to/file.md → injects file contents
     */
    processImports(content, basePath) {
        const importRegex = /@([^\s\n]+\.(?:md|txt|json5?|yaml|yml))/g;
        return content.replace(importRegex, (match, refPath) => {
            const fullPath = refPath.startsWith('/')
                ? refPath
                : join(basePath, '..', refPath);
            if (existsSync(fullPath)) {
                try {
                    return readFileSync(fullPath, 'utf-8');
                }
                catch {
                    return match;
                }
            }
            return match;
        });
    }
    detectTechStack() {
        const stack = [];
        const checks = [
            { file: 'package.json', tech: 'Node.js/JavaScript' },
            { file: 'tsconfig.json', tech: 'TypeScript' },
            { file: 'pyproject.toml', tech: 'Python' },
            { file: 'Cargo.toml', tech: 'Rust' },
            { file: 'go.mod', tech: 'Go' },
            { file: 'pom.xml', tech: 'Java/Maven' },
            { file: 'build.gradle', tech: 'Java/Gradle' },
            { file: 'Dockerfile', tech: 'Docker' },
            { file: 'docker-compose.yml', tech: 'Docker Compose' },
            { file: '.github/workflows', tech: 'GitHub Actions' },
            { file: 'Gemfile', tech: 'Ruby' },
            { file: 'mix.exs', tech: 'Elixir' },
            { file: 'composer.json', tech: 'PHP' },
        ];
        for (const { file, tech } of checks) {
            if (existsSync(join(this.workingDirectory, file))) {
                stack.push(tech);
            }
        }
        return stack;
    }
    generateStarterMd(techStack) {
        return `# NeuroCLI Project Context

## Tech Stack
${techStack.map(t => `- ${t}`).join('\n') || '- Auto-detected on first run'}

## Project Structure
<!-- Describe your project structure here -->

## Conventions
<!-- Add your coding conventions and preferences -->
- Follow existing code style
- Write tests for new features
- Use meaningful variable names

## Common Commands
<!-- Add frequently used commands -->
\`\`\`bash
# Build
# Test
# Deploy
\`\`\`

## Important Notes
<!-- Any important context for the AI assistant -->
`;
    }
}
//# sourceMappingURL=neuro-md.js.map
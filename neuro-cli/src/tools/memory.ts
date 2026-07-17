// ============================================================
// NeuroCLI - Memory & Knowledge Tools
// Persistent memory for cross-session learning
// ============================================================

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { ToolExecutor, ToolContext } from './registry.js';
import { ToolDefinition } from '../core/types.js';

const MEMORY_DIR = join(homedir(), '.neuro', 'memory');

interface MemoryEntry {
  key: string;
  value: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
  accessCount: number;
}

interface MemoryStore {
  entries: Record<string, MemoryEntry>;
}

function loadMemory(): MemoryStore {
  const memFile = join(MEMORY_DIR, 'store.json');
  if (existsSync(memFile)) {
    try {
      return JSON.parse(readFileSync(memFile, 'utf-8'));
    } catch {
      return { entries: {} };
    }
  }
  return { entries: {} };
}

function saveMemory(store: MemoryStore): void {
  if (!existsSync(MEMORY_DIR)) {
    mkdirSync(MEMORY_DIR, { recursive: true });
  }
  writeFileSync(join(MEMORY_DIR, 'store.json'), JSON.stringify(store, null, 2), 'utf-8');
}

// ---- Save Memory ----
const saveMemoryDef: ToolDefinition = {
  name: 'save_memory',
  description: 'Save important information to persistent memory. Information persists across sessions. Use for project conventions, user preferences, API patterns, etc.',
  parameters: {
    type: 'object',
    properties: {
      key: { type: 'string', description: 'Unique key for this memory entry' },
      value: { type: 'string', description: 'The information to save' },
      tags: { type: 'string', description: 'Comma-separated tags for categorization' },
    },
    required: ['key', 'value'],
  },
};

export const saveMemoryTool: ToolExecutor = {
  name: 'save_memory',
  definition: saveMemoryDef,
  risk: 'low',
  async execute(args) {
    const store = loadMemory();
    const key = args.key as string;
    const tags = ((args.tags as string) || '').split(',').map(t => t.trim()).filter(Boolean);
    const now = Date.now();

    if (store.entries[key]) {
      store.entries[key].value = args.value as string;
      store.entries[key].tags = tags;
      store.entries[key].updatedAt = now;
      store.entries[key].accessCount++;
    } else {
      store.entries[key] = {
        key,
        value: args.value as string,
        tags,
        createdAt: now,
        updatedAt: now,
        accessCount: 1,
      };
    }

    saveMemory(store);
    return `Memory saved: "${key}" (${(args.value as string).length} chars, ${tags.length} tags)`;
  },
};

// ---- Recall Memory ----
const recallMemoryDef: ToolDefinition = {
  name: 'recall_memory',
  description: 'Recall information from persistent memory. Search by key or tags.',
  parameters: {
    type: 'object',
    properties: {
      key: { type: 'string', description: 'Exact key to recall' },
      tag: { type: 'string', description: 'Tag to search for' },
      query: { type: 'string', description: 'Free-text search across all memories' },
    },
    required: [],
  },
};

export const recallMemoryTool: ToolExecutor = {
  name: 'recall_memory',
  definition: recallMemoryDef,
  risk: 'low',
  async execute(args) {
    const store = loadMemory();
    const entries = Object.values(store.entries);

    if (entries.length === 0) return 'No memories stored yet.';

    let results: MemoryEntry[] = [];

    if (args.key) {
      const entry = store.entries[args.key as string];
      if (entry) {
        entry.accessCount++;
        saveMemory(store);
        return `Memory: "${entry.key}"\n${entry.value}\nTags: ${entry.tags.join(', ')}\nCreated: ${new Date(entry.createdAt).toISOString()}`;
      }
      return `No memory found with key: "${args.key}"`;
    }

    if (args.tag) {
      const tag = (args.tag as string).toLowerCase();
      results = entries.filter(e => e.tags.some(t => t.toLowerCase().includes(tag)));
    }

    if (args.query) {
      const query = (args.query as string).toLowerCase();
      results = entries.filter(e =>
        e.key.toLowerCase().includes(query) ||
        e.value.toLowerCase().includes(query) ||
        e.tags.some(t => t.toLowerCase().includes(query))
      );
    }

    if (!args.key && !args.tag && !args.query) {
      results = entries;
    }

    if (results.length === 0) return 'No matching memories found.';

    return results.map(e =>
      `📝 "${e.key}" [${e.tags.join(', ')}]\n   ${e.value.slice(0, 200)}${e.value.length > 200 ? '...' : ''}\n   Last updated: ${new Date(e.updatedAt).toISOString()}`
    ).join('\n\n');
  },
};

// ---- Project Context ----
const projectContextDef: ToolDefinition = {
  name: 'project_context',
  description: 'Gather context about the current project: tech stack, dependencies, structure, git status.',
  parameters: {
    type: 'object',
    properties: {
      depth: { type: 'string', description: 'How much context to gather', enum: ['quick', 'standard', 'deep'] },
    },
    required: [],
  },
};

export const projectContextTool: ToolExecutor = {
  name: 'project_context',
  definition: projectContextDef,
  risk: 'low',
  async execute(args, context: ToolContext) {
    const depth = (args.depth as string) || 'standard';
    const lines: string[] = [];

    lines.push(`📂 Working Directory: ${context.workingDirectory}`);

    // Check for common project files
    const projectFiles = [
      'package.json', 'tsconfig.json', 'Cargo.toml', 'pyproject.toml',
      'go.mod', 'pom.xml', 'build.gradle', 'Makefile', 'Dockerfile',
      'docker-compose.yml', '.env.example', 'README.md',
    ];

    const found: string[] = [];
    for (const file of projectFiles) {
      if (existsSync(join(context.workingDirectory, file))) {
        found.push(file);
      }
    }
    lines.push(`\n📋 Project Files: ${found.join(', ') || 'none detected'}`);

    // Parse package.json if exists
    const pkgPath = join(context.workingDirectory, 'package.json');
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
        lines.push(`\n📦 Name: ${pkg.name || 'unnamed'}`);
        lines.push(`📦 Version: ${pkg.version || '0.0.0'}`);
        if (pkg.dependencies) {
          const deps = Object.keys(pkg.dependencies);
          lines.push(`📦 Dependencies: ${deps.join(', ')}`);
        }
        if (pkg.devDependencies) {
          const devDeps = Object.keys(pkg.devDependencies);
          lines.push(`📦 Dev Dependencies: ${devDeps.join(', ')}`);
        }
      } catch {}
    }

    // Parse pyproject.toml if exists
    const pyPath = join(context.workingDirectory, 'pyproject.toml');
    if (existsSync(pyPath)) {
      try {
        const content = readFileSync(pyPath, 'utf-8');
        const nameMatch = content.match(/name\s*=\s*"([^"]+)"/);
        if (nameMatch) lines.push(`🐍 Python Project: ${nameMatch[1]}`);
      } catch {}
    }

    // Git info
    try {
      const { execSync } = await import('child_process');
      const branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8', cwd: context.workingDirectory }).trim();
      lines.push(`\n🌿 Git Branch: ${branch}`);

      const status = execSync('git status --short', { encoding: 'utf-8', cwd: context.workingDirectory }).trim();
      const changedFiles = status ? status.split('\n').length : 0;
      lines.push(`🌿 Changed Files: ${changedFiles}`);
    } catch {}

    return lines.join('\n');
  },
};

export const memoryTools: ToolExecutor[] = [saveMemoryTool, recallMemoryTool, projectContextTool];

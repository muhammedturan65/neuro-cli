// ============================================================
// NeuroCLI - Extended Tools: Todo, AskUser, Monitor, Sandbox
// ============================================================

import { ToolExecutor, ToolContext } from '../tools/registry.js';
import { ToolDefinition } from '../core/types.js';
import { spawn, ChildProcess } from 'child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// ---- Todo List Tool ----
const todoDef: ToolDefinition = {
  name: 'todowrite',
  description: 'Create and manage a todo list for the current session. Track tasks, priorities, and completion status.',
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', description: 'Action: "create", "update", "list", "delete"', enum: ['create', 'update', 'list', 'delete'] },
      id: { type: 'string', description: 'Todo item ID (for update/delete)' },
      content: { type: 'string', description: 'Todo item content/description' },
      status: { type: 'string', description: 'Status: "pending", "in_progress", "completed"', enum: ['pending', 'in_progress', 'completed'] },
      priority: { type: 'string', description: 'Priority: "high", "medium", "low"', enum: ['high', 'medium', 'low'] },
    },
    required: ['action'],
  },
};

interface TodoItem {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  priority: 'high' | 'medium' | 'low';
  createdAt: number;
}

const TODO_FILE = join(homedir(), '.neuro', 'todos.json');

function loadTodos(): TodoItem[] {
  if (!existsSync(TODO_FILE)) return [];
  try { return JSON.parse(readFileSync(TODO_FILE, 'utf-8')); } catch { return []; }
}

function saveTodos(todos: TodoItem[]): void {
  mkdirSync(join(homedir(), '.neuro'), { recursive: true });
  writeFileSync(TODO_FILE, JSON.stringify(todos, null, 2), 'utf-8');
}

export const todoTool: ToolExecutor = {
  name: 'todowrite',
  definition: todoDef,
  risk: 'low',
  async execute(args) {
    const todos = loadTodos();
    const action = args.action as string;

    switch (action) {
      case 'create': {
        const item: TodoItem = {
          id: `todo_${Date.now()}`,
          content: (args.content as string) || 'Untitled task',
          status: 'pending',
          priority: (args.priority as any) || 'medium',
          createdAt: Date.now(),
        };
        todos.push(item);
        saveTodos(todos);
        return `Created todo: [${item.priority}] ${item.content} (${item.id})`;
      }
      case 'update': {
        const id = args.id as string;
        const item = todos.find(t => t.id === id);
        if (!item) return `Todo not found: ${id}`;
        if (args.content) item.content = args.content as string;
        if (args.status) item.status = args.status as any;
        if (args.priority) item.priority = args.priority as any;
        saveTodos(todos);
        return `Updated todo ${id}: [${item.priority}] ${item.content} - ${item.status}`;
      }
      case 'list': {
        if (todos.length === 0) return 'No todos. Use action="create" to add one.';
        return todos.map(t =>
          `${t.status === 'completed' ? '✅' : t.status === 'in_progress' ? '🔄' : '⬜'} [${t.priority}] ${t.content} (${t.id})`
        ).join('\n');
      }
      case 'delete': {
        const id = args.id as string;
        const idx = todos.findIndex(t => t.id === id);
        if (idx === -1) return `Todo not found: ${id}`;
        const removed = todos.splice(idx, 1)[0];
        saveTodos(todos);
        return `Deleted todo: ${removed.content}`;
      }
      default:
        return `Unknown action: ${action}. Use create, update, list, or delete.`;
    }
  },
};

// ---- AskUserQuestion Tool ----
const askUserDef: ToolDefinition = {
  name: 'ask_user',
  description: 'Ask the user a question with multiple-choice options. Use when you need clarification or decisions.',
  parameters: {
    type: 'object',
    properties: {
      question: { type: 'string', description: 'The question to ask the user' },
      options: { type: 'string', description: 'Comma-separated list of options' },
      default: { type: 'string', description: 'Default option if user does not respond' },
    },
    required: ['question'],
  },
};

export const askUserTool: ToolExecutor = {
  name: 'ask_user',
  definition: askUserDef,
  risk: 'low',
  async execute(args) {
    const question = args.question as string;
    const options = (args.options as string)?.split(',').map(o => o.trim()) || [];
    const defaultOption = args.default as string | undefined;

    // In non-interactive mode, use default
    if (defaultOption) {
      return `User selected (default): ${defaultOption}`;
    }

    // In interactive mode, this would prompt the user
    // For now, return the question with options
    let prompt = `❓ ${question}`;
    if (options.length > 0) {
      prompt += `\nOptions: ${options.map((o, i) => `${i + 1}. ${o}`).join(', ')}`;
    }
    prompt += '\n\n[Waiting for user input - using auto-approve in non-interactive mode]';

    return prompt;
  },
};

// ---- Monitor Tool ----
const monitorDef: ToolDefinition = {
  name: 'monitor',
  description: 'Run a command in the background and monitor its output. Returns each output line as it becomes available.',
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'Command to run in background' },
      duration: { type: 'number', description: 'Maximum monitoring duration in seconds (default: 60)' },
    },
    required: ['command'],
  },
};

const activeMonitors: Map<string, ChildProcess> = new Map();

export const monitorTool: ToolExecutor = {
  name: 'monitor',
  definition: monitorDef,
  risk: 'medium',
  async execute(args, context: ToolContext) {
    const command = args.command as string;
    const duration = ((args.duration as number) || 60) * 1000;

    try {
      const child = spawn('sh', ['-c', command], {
        cwd: context.workingDirectory,
        env: { ...process.env, FORCE_COLOR: '0' },
      });

      const monitorId = `mon_${Date.now()}`;
      activeMonitors.set(monitorId, child);

      const outputLines: string[] = [];
      let timedOut = false;

      const timeout = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, duration);

      return new Promise<string>((resolve) => {
        child.stdout?.on('data', (data: Buffer) => {
          const lines = data.toString().split('\n').filter(l => l.trim());
          outputLines.push(...lines.slice(0, 50)); // Limit lines
        });

        child.stderr?.on('data', (data: Buffer) => {
          const lines = data.toString().split('\n').filter(l => l.trim());
          outputLines.push(...lines.slice(0, 20));
        });

        child.on('close', (code) => {
          clearTimeout(timeout);
          activeMonitors.delete(monitorId);

          const status = timedOut ? 'TIMEOUT' : `exit code ${code}`;
          const output = outputLines.join('\n').slice(0, 10000);
          resolve(`Monitor [${monitorId}] ${status}\nOutput:\n${output || '(no output)'}`);
        });
      });
    } catch (error) {
      return `Monitor error: ${error}`;
    }
  },
};

// ---- All Extended Tools ----
export const extendedTools: ToolExecutor[] = [
  todoTool,
  askUserTool,
  monitorTool,
];

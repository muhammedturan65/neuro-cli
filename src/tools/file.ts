// ============================================================
// NeuroCLI - File Operation Tools
// read, write, edit, delete, list, search
// ============================================================

import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync, statSync, readdirSync } from 'fs';
import { join, relative, extname, basename } from 'path';
import { execSync } from 'child_process';
import { ToolExecutor, ToolContext } from './registry.js';
import { ToolDefinition } from '../core/types.js';

const MAX_FILE_SIZE = 1024 * 1024; // 1MB
const MAX_OUTPUT_LENGTH = 50000;

function truncateOutput(output: string, maxLength: number = MAX_OUTPUT_LENGTH): string {
  if (output.length <= maxLength) return output;
  const half = Math.floor(maxLength / 2);
  return output.slice(0, half) + '\n\n... [truncated] ...\n\n' + output.slice(-half);
}

// ---- Read File ----
const readFileDef: ToolDefinition = {
  name: 'read_file',
  description: 'Read the contents of a file. Returns the file content with line numbers. Supports reading specific line ranges.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path to the file (relative to working directory or absolute)' },
      start_line: { type: 'number', description: 'Starting line number (1-based, optional)' },
      end_line: { type: 'number', description: 'Ending line number (inclusive, optional)' },
    },
    required: ['path'],
  },
};

export const readFileTool: ToolExecutor = {
  name: 'read_file',
  definition: readFileDef,
  risk: 'low',
  async execute(args, context: ToolContext) {
    const filePath = join(context.workingDirectory, args.path as string);
    if (!existsSync(filePath)) return `Error: File not found: ${args.path}`;
    const stat = statSync(filePath);
    if (stat.isDirectory()) return `Error: Path is a directory, not a file: ${args.path}`;
    if (stat.size > MAX_FILE_SIZE) return `Error: File too large (${(stat.size / 1024).toFixed(1)}KB). Use search_files for large files.`;

    const content = readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    const start = (args.start_line as number) || 1;
    const end = (args.end_line as number) || lines.length;
    const selected = lines.slice(start - 1, end);

    const numbered = selected.map((line, i) => {
      const lineNum = (start + i).toString().padStart(5, ' ');
      return `${lineNum}│ ${line}`;
    }).join('\n');

    return truncateOutput(`File: ${args.path} (${lines.length} lines)\n${numbered}`);
  },
};

// ---- Write File ----
const writeFileDef: ToolDefinition = {
  name: 'write_file',
  description: 'Create or overwrite a file with the given content. Creates parent directories if needed.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path to the file (relative to working directory or absolute)' },
      content: { type: 'string', description: 'Content to write to the file' },
    },
    required: ['path', 'content'],
  },
};

export const writeFileTool: ToolExecutor = {
  name: 'write_file',
  definition: writeFileDef,
  risk: 'high',
  getApprovalRequest(args) {
    return {
      toolName: 'write_file',
      args,
      risk: 'high',
      description: `Write file: ${args.path} (${(String(args.content).length / 1024).toFixed(1)}KB)`,
    };
  },
  async execute(args, context: ToolContext) {
    const filePath = join(context.workingDirectory, args.path as string);
    const dir = join(filePath, '..');
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(filePath, args.content as string, 'utf-8');
    return `Successfully wrote ${String(args.content).length} bytes to ${args.path}`;
  },
};

// ---- Edit File ----
const editFileDef: ToolDefinition = {
  name: 'edit_file',
  description: 'Make targeted edits to an existing file by replacing specific text. Supports multiple edits in one call.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path to the file' },
      old_text: { type: 'string', description: 'Text to find in the file' },
      new_text: { type: 'string', description: 'Text to replace it with' },
    },
    required: ['path', 'old_text', 'new_text'],
  },
};

export const editFileTool: ToolExecutor = {
  name: 'edit_file',
  definition: editFileDef,
  risk: 'medium',
  getApprovalRequest(args) {
    return {
      toolName: 'edit_file',
      args,
      risk: 'medium',
      description: `Edit file: ${args.path}`,
    };
  },
  async execute(args, context: ToolContext) {
    const filePath = join(context.workingDirectory, args.path as string);
    if (!existsSync(filePath)) return `Error: File not found: ${args.path}`;

    let content = readFileSync(filePath, 'utf-8');
    const old_text = args.old_text as string;
    const new_text = args.new_text as string;

    if (!content.includes(old_text)) {
      return `Error: Could not find the specified text in ${args.path}. The text to replace was not found exactly.`;
    }
    const occurrences = content.split(old_text).length - 1;
    if (occurrences > 1) {
      return `Error: Found ${occurrences} occurrences of the text in ${args.path}. Please provide more context to make the match unique.`;
    }
    content = content.replace(old_text, new_text);

    writeFileSync(filePath, content, 'utf-8');
    return `Successfully applied edit to ${args.path}`;
  },
};

// ---- Delete File ----
const deleteFileDef: ToolDefinition = {
  name: 'delete_file',
  description: 'Delete a file. Use with extreme caution.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path to the file to delete' },
    },
    required: ['path'],
  },
};

export const deleteFileTool: ToolExecutor = {
  name: 'delete_file',
  definition: deleteFileDef,
  risk: 'high',
  getApprovalRequest(args) {
    return {
      toolName: 'delete_file',
      args,
      risk: 'high',
      description: `DELETE file: ${args.path}`,
    };
  },
  async execute(args, context: ToolContext) {
    const filePath = join(context.workingDirectory, args.path as string);
    if (!existsSync(filePath)) return `Error: File not found: ${args.path}`;
    unlinkSync(filePath);
    return `Successfully deleted ${args.path}`;
  },
};

// ---- List Directory ----
const listDirDef: ToolDefinition = {
  name: 'list_directory',
  description: 'List files and directories in a path. Shows file sizes and types.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Directory path (default: current working directory)' },
      recursive: { type: 'boolean', description: 'Whether to list recursively (default: false)' },
      max_depth: { type: 'number', description: 'Maximum depth for recursive listing (default: 3)' },
    },
    required: [],
  },
};

export const listDirectoryTool: ToolExecutor = {
  name: 'list_directory',
  definition: listDirDef,
  risk: 'low',
  async execute(args, context: ToolContext) {
    const dirPath = join(context.workingDirectory, (args.path as string) || '.');
    if (!existsSync(dirPath)) return `Error: Directory not found: ${args.path}`;
    const stat = statSync(dirPath);
    if (!stat.isDirectory()) return `Error: Path is not a directory: ${args.path}`;

    const recursive = (args.recursive as boolean) || false;
    const maxDepth = (args.max_depth as number) || 3;

    function listDir(path: string, prefix: string, depth: number): string {
      if (depth > maxDepth) return `${prefix}... (max depth reached)`;
      const entries = readdirSync(path, { withFileTypes: true });
      // Sort: directories first, then files
      const sorted = entries.sort((a, b) => {
        if (a.isDirectory() && !b.isDirectory()) return -1;
        if (!a.isDirectory() && b.isDirectory()) return 1;
        return a.name.localeCompare(b.name);
      });

      // Skip common noise directories
      const skipDirs = new Set(['node_modules', '.git', '__pycache__', '.next', 'dist', '.turbo', '.cache']);
      
      const lines: string[] = [];
      for (const entry of sorted) {
        if (skipDirs.has(entry.name) && entry.isDirectory()) {
          lines.push(`${prefix}📁 ${entry.name}/ (skipped)`);
          continue;
        }
        const fullPath = join(path, entry.name);
        if (entry.isDirectory()) {
          lines.push(`${prefix}📁 ${entry.name}/`);
          if (recursive) {
            lines.push(listDir(fullPath, `${prefix}  `, depth + 1));
          }
        } else {
          try {
            const size = statSync(fullPath).size;
            const sizeStr = size < 1024 ? `${size}B` : size < 1024 * 1024 ? `${(size / 1024).toFixed(1)}KB` : `${(size / (1024 * 1024)).toFixed(1)}MB`;
            const ext = extname(entry.name);
            const icon = getFileIcon(ext);
            lines.push(`${prefix}${icon} ${entry.name} (${sizeStr})`);
          } catch {
            lines.push(`${prefix}📄 ${entry.name}`);
          }
        }
      }
      return lines.join('\n');
    }

    const result = listDir(dirPath, '', 0);
    return truncateOutput(`Directory: ${args.path || '.'}\n${result}`);
  },
};

// ---- Search Files (ripgrep) ----
const searchFilesDef: ToolDefinition = {
  name: 'search_files',
  description: 'Search for patterns in files using ripgrep. Supports regex patterns and file type filtering.',
  parameters: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Search pattern (supports regex)' },
      path: { type: 'string', description: 'Directory or file to search in (default: current directory)' },
      file_type: { type: 'string', description: 'File type filter (e.g., "ts", "py", "js")' },
      max_results: { type: 'number', description: 'Maximum number of results (default: 50)' },
      case_insensitive: { type: 'boolean', description: 'Case insensitive search (default: false)' },
    },
    required: ['pattern'],
  },
};

export const searchFilesTool: ToolExecutor = {
  name: 'search_files',
  definition: searchFilesDef,
  risk: 'low',
  async execute(args, context: ToolContext) {
    const pattern = args.pattern as string;
    const searchPath = join(context.workingDirectory, (args.path as string) || '.');
    const fileType = args.file_type as string;
    const maxResults = (args.max_results as number) || 50;
    const caseInsensitive = (args.case_insensitive as boolean) || false;

    let cmd = 'rg';
    cmd += ` --line-number`;
    cmd += ` --column`;
    cmd += ` --max-count ${maxResults}`;
    cmd += caseInsensitive ? ' -i' : '';
    if (fileType) cmd += ` --type ${fileType}`;
    cmd += ` --color never`;
    cmd += ` --no-heading`;
    cmd += ` '${pattern.replace(/'/g, "'\\''")}'`;
    cmd += ` "${searchPath}"`;

    try {
      const result = execSync(cmd, {
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024,
        cwd: context.workingDirectory,
        timeout: 30000,
      }).trim();

      if (!result) return `No matches found for pattern: "${pattern}"`;

      const lines = result.split('\n').slice(0, maxResults);
      const formatted = lines.map(line => {
        const match = line.match(/^(.+?):(\d+):(\d+):(.*)$/);
        if (match) {
          const [, file, lineNum, col, text] = match;
          const relPath = relative(context.workingDirectory, file);
          return `${relPath}:${lineNum}:${col}: ${text.trim()}`;
        }
        return line;
      }).join('\n');

      const totalLines = result.split('\n').length;
      const suffix = totalLines > maxResults ? `\n... and ${totalLines - maxResults} more results` : '';

      return truncateOutput(`Search results for "${pattern}":\n${formatted}${suffix}`);
    } catch (error: any) {
      if (error.status === 1) return `No matches found for pattern: "${pattern}"`;
      if (error.status === 2) return `Search error: ${error.message}`;
      return `Search error: ${error.message}`;
    }
  },
};

// ---- Apply Diff ----
const applyDiffDef: ToolDefinition = {
  name: 'apply_diff',
  description: 'Apply a unified diff to a file. Use for precise code modifications.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path to the file to modify' },
      diff: { type: 'string', description: 'Unified diff to apply' },
    },
    required: ['path', 'diff'],
  },
};

export const applyDiffTool: ToolExecutor = {
  name: 'apply_diff',
  definition: applyDiffDef,
  risk: 'medium',
  getApprovalRequest(args) {
    return {
      toolName: 'apply_diff',
      args,
      risk: 'medium',
      description: `Apply diff to: ${args.path}`,
    };
  },
  async execute(args, context: ToolContext) {
    const filePath = join(context.workingDirectory, args.path as string);
    if (!existsSync(filePath)) return `Error: File not found: ${args.path}`;

    try {
      // Write diff to temp file and apply with patch
      const diffContent = args.diff as string;
      const tmpDiffPath = join(context.workingDirectory, `.neuro-diff-${Date.now()}.patch`);
      writeFileSync(tmpDiffPath, diffContent, 'utf-8');

      const result = execSync(`patch --no-backup-if-mismatch -p0 < "${tmpDiffPath}"`, {
        encoding: 'utf-8',
        cwd: context.workingDirectory,
        timeout: 10000,
      });

      // Clean up temp file
      try { unlinkSync(tmpDiffPath); } catch {}

      return `Successfully applied diff to ${args.path}\n${result}`;
    } catch (error: any) {
      return `Error applying diff: ${error.message}`;
    }
  },
};

// ---- Helper Functions ----
function getFileIcon(ext: string): string {
  const icons: Record<string, string> = {
    '.ts': '🔷', '.tsx': '⚛️', '.js': '🟨', '.jsx': '⚛️',
    '.py': '🐍', '.rs': '🦀', '.go': '🐹', '.java': '☕',
    '.css': '🎨', '.scss': '🎨', '.html': '🌐', '.json': '📋',
    '.md': '📝', '.yml': '⚙️', '.yaml': '⚙️', '.toml': '⚙️',
    '.sql': '🗃️', '.sh': '🖥️', '.bash': '🖥️', '.zsh': '🖥️',
    '.env': '🔒', '.lock': '🔒', '.gitignore': '🚫',
  };
  return icons[ext] || '📄';
}

// Export all file tools
export const fileTools: ToolExecutor[] = [
  readFileTool,
  writeFileTool,
  editFileTool,
  deleteFileTool,
  listDirectoryTool,
  searchFilesTool,
  applyDiffTool,
];

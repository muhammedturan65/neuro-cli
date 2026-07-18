// ============================================================
// NeuroCLI - Tree-sitter Integration
// Regex-based AST parser for repository mapping
// Inspired by Aider's lightweight "good enough" approach
// No external dependencies - uses only Node.js built-ins
// ============================================================

import { readFileSync, existsSync, readdirSync, statSync, writeFileSync } from 'fs';
import { join, extname, relative, basename, dirname } from 'path';
import { execSync } from 'child_process';

// ============================================================
// Exported Interfaces
// ============================================================

export interface RepoMap {
  root: string;
  files: FileMap[];
  totalSymbols: number;
  totalFiles: number;
  languageBreakdown: Record<string, number>;
  generatedAt: number;
}

export interface FileMap {
  path: string;
  language: string;
  symbols: SymbolInfo[];
  imports: ImportInfo[];
  exports: ExportInfo[];
  summary: string;
}

export interface SymbolInfo {
  name: string;
  kind: 'class' | 'function' | 'method' | 'variable' | 'interface' | 'type' | 'enum' | 'constant' | 'namespace' | 'import';
  line: number;
  endLine: number;
  signature?: string;
  modifiers?: string[];
  children?: SymbolInfo[];
}

export interface ImportInfo {
  source: string;
  items: string[];
  line: number;
  isTypeOnly: boolean;
}

export interface ExportInfo {
  name: string;
  kind: string;
  line: number;
  isDefault: boolean;
  isReexport: boolean;
}

export interface CallGraphNode {
  name: string;
  kind: string;
  line: number;
  calls: string[];
  calledBy: string[];
}

export interface DiagnosticInfo {
  line: number;
  column: number;
  severity: 'error' | 'warning';
  message: string;
  rule?: string;
}

export interface OutlineNode {
  name: string;
  kind: SymbolInfo['kind'];
  line: number;
  endLine: number;
  icon: string;
  children: OutlineNode[];
  signature?: string;
}

// ============================================================
// Language Configuration
// ============================================================

const LANGUAGE_EXTENSIONS: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.py': 'python',
  '.pyi': 'python',
  '.pyx': 'python',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
  '.kt': 'kotlin',
  '.css': 'css',
  '.scss': 'css',
  '.less': 'css',
  '.html': 'html',
  '.htm': 'html',
  '.vue': 'vue',
  '.svelte': 'svelte',
};

const LANGUAGE_NAMES: Record<string, string> = {
  'typescript': 'TypeScript',
  'javascript': 'JavaScript',
  'python': 'Python',
  'go': 'Go',
  'rust': 'Rust',
  'java': 'Java',
  'kotlin': 'Kotlin',
  'css': 'CSS',
  'html': 'HTML',
  'vue': 'Vue',
  'svelte': 'Svelte',
};

const SKIP_DIRS = new Set([
  'node_modules', '.git', '__pycache__', '.next', 'dist', '.turbo', '.cache',
  'build', 'out', 'target', '.cargo', 'vendor', '.venv', 'venv', 'env',
  '.tox', '.mypy_cache', '.pytest_cache', '.hg', '.svn', 'coverage',
]);

const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.bmp',
  '.mp3', '.mp4', '.wav', '.avi', '.mov', '.mkv', '.flac',
  '.zip', '.tar', '.gz', '.bz2', '.xz', '.7z', '.rar',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.wasm', '.so', '.dll', '.dylib', '.exe',
]);

// ============================================================
// Regex-based Language Parsers
// ============================================================

interface ParseResult {
  symbols: SymbolInfo[];
  imports: ImportInfo[];
  exports: ExportInfo[];
}

// ---- TypeScript / JavaScript Parser ----

function parseTypeScript(content: string): ParseResult {
  const lines = content.split('\n');
  const symbols: SymbolInfo[] = [];
  const imports: ImportInfo[] = [];
  const exports: ExportInfo[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // ---- Imports ----
    const importMatch = line.match(/^import\s+(?:type\s+)?(?:(\{[^}]*\})|(\*\s+as\s+\w+)|(\w+))\s+from\s+['"]([^'"]+)['"]/);
    if (importMatch) {
      const [, namedImports, namespaceImport, defaultImport, source] = importMatch;
      const items: string[] = [];
      if (namedImports) {
        items.push(...namedImports.replace(/[{}]/g, '').split(',').map(s => s.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean));
      }
      if (namespaceImport) {
        items.push(namespaceImport.replace(/\*\s+as\s+/, '').trim());
      }
      if (defaultImport) {
        items.push(defaultImport.trim());
      }
      imports.push({
        source,
        items,
        line: lineNum,
        isTypeOnly: line.includes('import type'),
      });
      continue;
    }

    // Side-effect import
    const sideEffectImport = line.match(/^import\s+['"]([^'"]+)['"]/);
    if (sideEffectImport) {
      imports.push({
        source: sideEffectImport[1],
        items: [],
        line: lineNum,
        isTypeOnly: false,
      });
      continue;
    }

    // Require import
    const requireMatch = line.match(/(?:const|let|var)\s+(?:\{([^}]*)\}|(\w+))\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/);
    if (requireMatch) {
      const [, namedImports, defaultImport, source] = requireMatch;
      const items: string[] = [];
      if (namedImports) {
        items.push(...namedImports.split(',').map(s => s.trim().split(/\s*:\s*/)[0].trim()).filter(Boolean));
      }
      if (defaultImport) {
        items.push(defaultImport.trim());
      }
      imports.push({ source, items, line: lineNum, isTypeOnly: false });
    }

    // ---- Exports ----
    const exportDefaultMatch = line.match(/^export\s+default\s+(?:function\s+)?(\w+)/);
    if (exportDefaultMatch) {
      exports.push({
        name: exportDefaultMatch[1],
        kind: 'function',
        line: lineNum,
        isDefault: true,
        isReexport: false,
      });
    }

    const reexportMatch = line.match(/^export\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/);
    if (reexportMatch) {
      const items = reexportMatch[1].split(',').map(s => {
        const parts = s.trim().split(/\s+as\s+/);
        return parts[parts.length - 1].trim();
      });
      for (const item of items) {
        exports.push({
          name: item,
          kind: 'reexport',
          line: lineNum,
          isDefault: false,
          isReexport: true,
        });
      }
      continue;
    }

    // ---- Classes ----
    const classMatch = line.match(/^(export\s+)?(default\s+)?(declare\s+)?(abstract\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+([^{]+))?/);
    if (classMatch) {
      const [, exportKw, defaultKw, , abstractKw, name, extendsCls, implementsIf] = classMatch;
      const modifiers: string[] = [];
      if (exportKw) modifiers.push('export');
      if (defaultKw) modifiers.push('default');
      if (abstractKw) modifiers.push('abstract');

      const endLine = findBlockEnd(lines, i);
      const signature = line.trim().replace(/\{$/, '').trim();

      const symbol: SymbolInfo = {
        name,
        kind: 'class',
        line: lineNum,
        endLine,
        signature,
        modifiers,
        children: [],
      };

      // Parse class members (methods, properties)
      const classBody = lines.slice(i, endLine);
      for (let j = 0; j < classBody.length; j++) {
        const memberLine = classBody[j];
        const methodMatch = memberLine.match(/^\s+(?:(?:public|private|protected|static|abstract|readonly|async|override|declare)\s+)*(?:(?:get|set)\s+)?(\w+)\s*[<(]/);
        if (methodMatch) {
          const methodModifiers = extractModifiers(memberLine);
          const methodName = methodMatch[1];
          // Skip constructor - it's implicit
          if (methodName === 'constructor') {
            symbol.children!.push({
              name: 'constructor',
              kind: 'method',
              line: lineNum + j,
              endLine: findBlockEnd(classBody, j) + lineNum,
              signature: memberLine.trim().replace(/\{$/, '').trim(),
              modifiers: methodModifiers,
            });
            continue;
          }
          // Determine if it's a getter/setter or regular method
          const isAccessor = /^\s+(?:public|private|protected|static)\s+(?:get|set)\s+/.test(memberLine);
          symbol.children!.push({
            name: methodName,
            kind: isAccessor ? 'method' : 'method',
            line: lineNum + j,
            endLine: findBlockEnd(classBody, j) + lineNum,
            signature: memberLine.trim().replace(/\{$/, '').trim(),
            modifiers: methodModifiers,
          });
        }

        // Class properties
        const propMatch = memberLine.match(/^\s+(?:(?:public|private|protected|static|abstract|readonly|declare)\s+)+(\w+)\s*[?:!]/);
        if (propMatch && !memberLine.includes('(')) {
          symbol.children!.push({
            name: propMatch[1],
            kind: 'variable',
            line: lineNum + j,
            endLine: lineNum + j,
            modifiers: extractModifiers(memberLine),
          });
        }
      }

      symbols.push(symbol);

      if (exportKw) {
        exports.push({
          name,
          kind: 'class',
          line: lineNum,
          isDefault: !!defaultKw,
          isReexport: false,
        });
      }
      continue;
    }

    // ---- Interfaces ----
    const interfaceMatch = line.match(/^(export\s+)?(declare\s+)?interface\s+(\w+)(?:\s+extends\s+([^{]+))?/);
    if (interfaceMatch) {
      const [, exportKw, , name, extendsIf] = interfaceMatch;
      const modifiers: string[] = [];
      if (exportKw) modifiers.push('export');

      const endLine = findBlockEnd(lines, i);
      const signature = line.trim().replace(/\{$/, '').trim();

      const symbol: SymbolInfo = {
        name,
        kind: 'interface',
        line: lineNum,
        endLine,
        signature,
        modifiers,
        children: [],
      };

      // Parse interface members
      const ifaceBody = lines.slice(i, endLine);
      for (let j = 0; j < ifaceBody.length; j++) {
        const memberLine = ifaceBody[j];
        const methodMatch = memberLine.match(/^\s+(\w+)\s*[<(]/);
        if (methodMatch) {
          symbol.children!.push({
            name: methodMatch[1],
            kind: 'method',
            line: lineNum + j,
            endLine: lineNum + j,
            signature: memberLine.trim().replace(/[;,{]$/, '').trim(),
          });
        }
        const propMatch = memberLine.match(/^\s+(\w+)\s*[?!:]/);
        if (propMatch && !memberLine.includes('(')) {
          symbol.children!.push({
            name: propMatch[1],
            kind: 'variable',
            line: lineNum + j,
            endLine: lineNum + j,
            signature: memberLine.trim().replace(/[;,{]$/, '').trim(),
          });
        }
      }

      symbols.push(symbol);

      if (exportKw) {
        exports.push({
          name,
          kind: 'interface',
          line: lineNum,
          isDefault: false,
          isReexport: false,
        });
      }
      continue;
    }

    // ---- Type Aliases ----
    const typeMatch = line.match(/^(export\s+)?(declare\s+)?type\s+(\w+)\s*(?:<[^>]+>)?\s*=/);
    if (typeMatch) {
      const [, exportKw, , name] = typeMatch;
      const endLine = findTypeEnd(lines, i);
      symbols.push({
        name,
        kind: 'type',
        line: lineNum,
        endLine,
        signature: line.trim().slice(0, 120),
        modifiers: exportKw ? ['export'] : [],
      });
      if (exportKw) {
        exports.push({
          name,
          kind: 'type',
          line: lineNum,
          isDefault: false,
          isReexport: false,
        });
      }
      continue;
    }

    // ---- Enums ----
    const enumMatch = line.match(/^(export\s+)?(declare\s+)?(?:const\s+)?enum\s+(\w+)/);
    if (enumMatch) {
      const [, exportKw, , name] = enumMatch;
      const endLine = findBlockEnd(lines, i);
      symbols.push({
        name,
        kind: 'enum',
        line: lineNum,
        endLine,
        signature: line.trim().replace(/\{$/, '').trim(),
        modifiers: exportKw ? ['export'] : [],
      });
      if (exportKw) {
        exports.push({
          name,
          kind: 'enum',
          line: lineNum,
          isDefault: false,
          isReexport: false,
        });
      }
      continue;
    }

    // ---- Functions ----
    const funcMatch = line.match(/^(export\s+)?(default\s+)?(declare\s+)?(async\s+)?function\s+(\w+)\s*([<(])/);
    if (funcMatch) {
      const [, exportKw, defaultKw, , asyncKw, name] = funcMatch;
      const modifiers: string[] = [];
      if (exportKw) modifiers.push('export');
      if (defaultKw) modifiers.push('default');
      if (asyncKw) modifiers.push('async');

      const endLine = findBlockEnd(lines, i);
      const signature = line.trim().replace(/\{$/, '').trim();

      symbols.push({
        name,
        kind: 'function',
        line: lineNum,
        endLine,
        signature: signature.slice(0, 200),
        modifiers,
      });

      if (exportKw) {
        exports.push({
          name,
          kind: 'function',
          line: lineNum,
          isDefault: !!defaultKw,
          isReexport: false,
        });
      }
      continue;
    }

    // ---- Arrow Functions / Const Declarations ----
    const constArrowMatch = line.match(/^(export\s+)?(declare\s+)?const\s+(\w+)\s*(?::\s*[^=]+)?\s*=\s*(?:async\s+)?(?:\([^)]*\)|[^=])\s*=>/);
    if (constArrowMatch) {
      const [, exportKw, , name] = constArrowMatch;
      const modifiers: string[] = [];
      if (exportKw) modifiers.push('export');

      symbols.push({
        name,
        kind: 'function',
        line: lineNum,
        endLine: findStatementEnd(lines, i),
        signature: line.trim().slice(0, 200),
        modifiers,
      });

      if (exportKw) {
        exports.push({
          name,
          kind: 'function',
          line: lineNum,
          isDefault: false,
          isReexport: false,
        });
      }
      continue;
    }

    // ---- Regular Const/Let/Var ----
    const varMatch = line.match(/^(export\s+)?(declare\s+)?const\s+(\w+)\s*(?::\s*[^=]+)?\s*=/);
    if (varMatch) {
      const [, exportKw, , name] = varMatch;
      // Skip if it's an arrow function (already handled)
      if (!line.includes('=>')) {
        symbols.push({
          name,
          kind: 'constant',
          line: lineNum,
          endLine: lineNum,
          signature: line.trim().slice(0, 120),
          modifiers: exportKw ? ['export'] : [],
        });
        if (exportKw) {
          exports.push({
            name,
            kind: 'constant',
            line: lineNum,
            isDefault: false,
            isReexport: false,
          });
        }
      }
      continue;
    }

    const letMatch = line.match(/^(export\s+)?let\s+(\w+)\s*(?::\s*[^=]+)?\s*=/);
    if (letMatch) {
      const [, exportKw, name] = letMatch;
      symbols.push({
        name,
        kind: 'variable',
        line: lineNum,
        endLine: lineNum,
        modifiers: exportKw ? ['export'] : [],
      });
      continue;
    }

    // ---- Namespaces ----
    const namespaceMatch = line.match(/^(export\s+)?namespace\s+(\w+)/);
    if (namespaceMatch) {
      const [, exportKw, name] = namespaceMatch;
      const endLine = findBlockEnd(lines, i);
      symbols.push({
        name,
        kind: 'namespace',
        line: lineNum,
        endLine,
        signature: line.trim().replace(/\{$/, '').trim(),
        modifiers: exportKw ? ['export'] : [],
      });
      continue;
    }
  }

  return { symbols, imports, exports };
}

// ---- Python Parser ----

function parsePython(content: string): ParseResult {
  const lines = content.split('\n');
  const symbols: SymbolInfo[] = [];
  const imports: ImportInfo[] = [];
  const exports: ExportInfo[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;
    const indent = line.match(/^(\s*)/)?.[1].length || 0;

    // Skip comments and empty lines
    if (line.trim().startsWith('#') || line.trim() === '') continue;

    // ---- Imports ----
    const importMatch = line.match(/^(\s*)import\s+([^\n]+)/);
    if (importMatch) {
      const modules = importMatch[2].split(',').map(s => s.trim().split(/\s+as\s+/)[0].trim());
      for (const mod of modules) {
        imports.push({ source: mod, items: [], line: lineNum, isTypeOnly: false });
      }
      continue;
    }

    const fromImportMatch = line.match(/^(\s*)from\s+([^\s]+)\s+import\s+([^\n]+)/);
    if (fromImportMatch) {
      const source = fromImportMatch[2];
      const items = fromImportMatch[3].split(',').map(s => {
        const parts = s.trim().split(/\s+as\s+/);
        return parts[0].trim();
      }).filter(Boolean);
      imports.push({ source, items, line: lineNum, isTypeOnly: false });
      continue;
    }

    // Only process top-level symbols (indent === 0)
    if (indent > 0) continue;

    // ---- Decorators ----
    const decorators: string[] = [];
    let j = i;
    while (j < lines.length && lines[j].trimStart().startsWith('@')) {
      const decMatch = lines[j].trim().match(/@(\w+)/);
      if (decMatch) decorators.push(decMatch[1]);
      j++;
    }
    // Adjust i if we consumed decorators
    if (j > i) {
      i = j - 1;
      continue; // The actual def/class will be on next iteration
    }

    // ---- Classes ----
    const classMatch = line.match(/^class\s+(\w+)(?:\(([^)]*)\))?\s*:/);
    if (classMatch) {
      const name = classMatch[1];
      const baseClasses = classMatch[2]?.split(',').map(s => s.trim()).filter(Boolean) || [];
      const endLine = findPythonBlockEnd(lines, i);

      // Collect decorators from lines above
      const classDecorators: string[] = [];
      for (let k = i - 1; k >= 0; k--) {
        if (lines[k].trimStart().startsWith('@')) {
          const dMatch = lines[k].trim().match(/@(\w+)/);
          if (dMatch) classDecorators.unshift(dMatch[1]);
        } else {
          break;
        }
      }

      const symbol: SymbolInfo = {
        name,
        kind: 'class',
        line: lineNum,
        endLine,
        signature: line.trim().replace(/:\s*$/, ''),
        modifiers: classDecorators.length > 0 ? classDecorators : undefined,
        children: [],
      };

      // Parse class methods
      const classBody = lines.slice(i + 1, endLine);
      let methodIndent = -1;
      for (let k = 0; k < classBody.length; k++) {
        const mLine = classBody[k];
        const mIndent = mLine.match(/^(\s*)/)?.[1].length || 0;

        if (methodIndent === -1 && mLine.trim().startsWith('def ')) {
          methodIndent = mIndent;
        }

        if (mIndent === methodIndent && mLine.trim().startsWith('def ')) {
          const methodMatch = mLine.match(/^\s+(?:(?:async|staticmethod|classmethod)\s+)*def\s+(\w+)\s*\(([^)]*)\)/);
          if (methodMatch) {
            const methodName = methodMatch[1];
            const methodModifiers: string[] = [];

            // Check decorators above method
            for (let d = k - 1; d >= 0; d--) {
              if (classBody[d].trimStart().startsWith('@')) {
                const dMatch = classBody[d].trim().match(/@(\w+)/);
                if (dMatch) methodModifiers.unshift(dMatch[1]);
              } else {
                break;
              }
            }

            if (mLine.includes('async ')) methodModifiers.push('async');

            symbol.children!.push({
              name: methodName,
              kind: 'method',
              line: lineNum + k + 1,
              endLine: findPythonBlockEnd(lines, i + 1 + k),
              signature: mLine.trim().replace(/:\s*$/, ''),
              modifiers: methodModifiers.length > 0 ? methodModifiers : undefined,
            });
          }
        }
      }

      symbols.push(symbol);
      continue;
    }

    // ---- Functions ----
    const funcMatch = line.match(/^(?:async\s+)?def\s+(\w+)\s*\(([^)]*)\)/);
    if (funcMatch) {
      const name = funcMatch[1];
      const isAsync = line.includes('async ');
      const endLine = findPythonBlockEnd(lines, i);

      // Collect decorators
      const funcDecorators: string[] = [];
      for (let k = i - 1; k >= 0; k--) {
        if (lines[k].trimStart().startsWith('@')) {
          const dMatch = lines[k].trim().match(/@(\w+)/);
          if (dMatch) funcDecorators.unshift(dMatch[1]);
        } else {
          break;
        }
      }

      const modifiers: string[] = [];
      if (isAsync) modifiers.push('async');
      if (funcDecorators.length > 0) modifiers.push(...funcDecorators);

      symbols.push({
        name,
        kind: 'function',
        line: lineNum,
        endLine,
        signature: line.trim().replace(/:\s*$/, ''),
        modifiers: modifiers.length > 0 ? modifiers : undefined,
      });
      continue;
    }

    // ---- Top-level Variables ----
    const varMatch = line.match(/^([A-Z_][A-Z_0-9]*)\s*=/);
    if (varMatch) {
      symbols.push({
        name: varMatch[1],
        kind: 'constant',
        line: lineNum,
        endLine: lineNum,
      });
      continue;
    }

    const pyVarMatch = line.match(/^(\w+)\s*[:=]\s*(?:(?:async\s+)?def|class)\b/);
    if (!pyVarMatch) {
      const simpleVarMatch = line.match(/^(\w+)\s*=\s*/);
      if (simpleVarMatch && !line.trim().startsWith('_')) {
        symbols.push({
          name: simpleVarMatch[1],
          kind: 'variable',
          line: lineNum,
          endLine: lineNum,
        });
      }
    }
  }

  // Python doesn't have explicit exports - use __all__ if present
  const allMatch = content.match(/__all__\s*=\s*\[([^\]]+)\]/);
  if (allMatch) {
    const items = allMatch[1].split(',').map(s => s.trim().replace(/['"]/g, '')).filter(Boolean);
    for (const item of items) {
      exports.push({
        name: item,
        kind: 'unknown',
        line: content.substring(0, content.indexOf('__all__')).split('\n').length,
        isDefault: false,
        isReexport: false,
      });
    }
  }

  return { symbols, imports, exports };
}

// ---- Go Parser ----

function parseGo(content: string): ParseResult {
  const lines = content.split('\n');
  const symbols: SymbolInfo[] = [];
  const imports: ImportInfo[] = [];
  const exports: ExportInfo[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // ---- Package ----
    const pkgMatch = line.match(/^package\s+(\w+)/);
    if (pkgMatch) {
      symbols.push({
        name: pkgMatch[1],
        kind: 'namespace',
        line: lineNum,
        endLine: lineNum,
        signature: line.trim(),
      });
      continue;
    }

    // ---- Imports ----
    const singleImport = line.match(/^import\s+["']([^"']+)["']/);
    if (singleImport) {
      imports.push({ source: singleImport[1], items: [], line: lineNum, isTypeOnly: false });
      continue;
    }

    // Multi-line import block
    if (line.match(/^import\s*\(/)) {
      let j = i + 1;
      while (j < lines.length && !lines[j].includes(')')) {
        const impMatch = lines[j].match(/^\s*(?:(\w+)\s+)?"([^"]+)"/);
        if (impMatch) {
          imports.push({
            source: impMatch[2],
            items: impMatch[1] ? [impMatch[1]] : [],
            line: j + 1,
            isTypeOnly: false,
          });
        }
        j++;
      }
      continue;
    }

    // ---- Functions ----
    const funcMatch = line.match(/^func\s+(?:\(([^)]+)\)\s+)?(\w+)\s*\(([^)]*)\)/);
    if (funcMatch) {
      const [, receiver, name, params] = funcMatch;
      const isExported = /^[A-Z]/.test(name);
      const endLine = findBlockEnd(lines, i, '{');
      const signature = line.trim().replace(/\{$/, '').trim();

      const symbol: SymbolInfo = {
        name,
        kind: receiver ? 'method' : 'function',
        line: lineNum,
        endLine,
        signature: signature.slice(0, 200),
        modifiers: isExported ? ['exported'] : [],
      };
      symbols.push(symbol);

      if (isExported) {
        exports.push({
          name: receiver ? `(${receiver}).${name}` : name,
          kind: 'function',
          line: lineNum,
          isDefault: false,
          isReexport: false,
        });
      }
      continue;
    }

    // ---- Types (structs, interfaces) ----
    const typeMatch = line.match(/^type\s+(\w+)\s+(struct|interface)/);
    if (typeMatch) {
      const name = typeMatch[1];
      const kind = typeMatch[2];
      const isExported = /^[A-Z]/.test(name);
      const endLine = findBlockEnd(lines, i, '{');

      const symbol: SymbolInfo = {
        name,
        kind: kind === 'struct' ? 'class' : 'interface',
        line: lineNum,
        endLine,
        signature: line.trim().replace(/\{$/, '').trim(),
        modifiers: isExported ? ['exported'] : [],
        children: [],
      };

      // Parse struct/interface members
      const body = lines.slice(i + 1, endLine);
      for (let k = 0; k < body.length; k++) {
        const memberLine = body[k].trim();
        // Struct field
        const fieldMatch = memberLine.match(/^(\w+)\s+[\w*.\[\]]+/);
        if (fieldMatch && !memberLine.startsWith('//') && kind === 'struct') {
          symbol.children!.push({
            name: fieldMatch[1],
            kind: 'variable',
            line: lineNum + k + 1,
            endLine: lineNum + k + 1,
          });
        }
        // Interface method
        const methodMatch = memberLine.match(/^(\w+)\s*\(/);
        if (methodMatch && !memberLine.startsWith('//') && kind === 'interface') {
          symbol.children!.push({
            name: methodMatch[1],
            kind: 'method',
            line: lineNum + k + 1,
            endLine: lineNum + k + 1,
            signature: memberLine.replace(/,$/, '').trim(),
          });
        }
      }

      symbols.push(symbol);
      if (isExported) {
        exports.push({
          name,
          kind: kind === 'struct' ? 'class' : 'interface',
          line: lineNum,
          isDefault: false,
          isReexport: false,
        });
      }
      continue;
    }

    // ---- Type aliases ----
    const typeAliasMatch = line.match(/^type\s+(\w+)\s+[^{]/);
    if (typeAliasMatch && !typeMatch) {
      const name = typeAliasMatch[1];
      const isExported = /^[A-Z]/.test(name);
      symbols.push({
        name,
        kind: 'type',
        line: lineNum,
        endLine: lineNum,
        signature: line.trim(),
        modifiers: isExported ? ['exported'] : [],
      });
      continue;
    }

    // ---- Variables ----
    const varMatch = line.match(/^var\s+(\w+)\s+/);
    if (varMatch) {
      const name = varMatch[1];
      const isExported = /^[A-Z]/.test(name);
      symbols.push({
        name,
        kind: 'variable',
        line: lineNum,
        endLine: lineNum,
        modifiers: isExported ? ['exported'] : [],
      });
      continue;
    }

    // ---- Constants ----
    const constMatch = line.match(/^const\s+(?:\(\s*)?(\w+)/);
    if (constMatch) {
      const name = constMatch[1];
      const isExported = /^[A-Z]/.test(name);
      symbols.push({
        name,
        kind: 'constant',
        line: lineNum,
        endLine: lineNum,
        modifiers: isExported ? ['exported'] : [],
      });
    }
  }

  return { symbols, imports, exports };
}

// ---- Rust Parser ----

function parseRust(content: string): ParseResult {
  const lines = content.split('\n');
  const symbols: SymbolInfo[] = [];
  const imports: ImportInfo[] = [];
  const exports: ExportInfo[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // ---- Use statements ----
    const useMatch = line.match(/^use\s+([^;]+);/);
    if (useMatch) {
      const usePath = useMatch[1].replace(/\{[^}]*\}/, '').trim();
      const items: string[] = [];
      const namedItems = useMatch[1].match(/\{([^}]+)\}/);
      if (namedItems) {
        items.push(...namedItems[1].split(',').map(s => s.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean));
      }
      imports.push({
        source: usePath.replace(/::\{.*$/, ''),
        items,
        line: lineNum,
        isTypeOnly: false,
      });
      continue;
    }

    // ---- Functions ----
    const funcMatch = line.match(/^(pub\s+)?(?:async\s+)?(?:const\s+)?(?:unsafe\s+)?fn\s+(\w+)\s*[<(]/);
    if (funcMatch) {
      const [, pubKw, name] = funcMatch;
      const endLine = findBlockEnd(lines, i, '{');
      const signature = line.trim().replace(/\{$/, '').trim();

      symbols.push({
        name,
        kind: 'function',
        line: lineNum,
        endLine,
        signature: signature.slice(0, 200),
        modifiers: pubKw ? ['pub'] : [],
      });

      if (pubKw) {
        exports.push({
          name,
          kind: 'function',
          line: lineNum,
          isDefault: false,
          isReexport: false,
        });
      }
      continue;
    }

    // ---- Structs ----
    const structMatch = line.match(/^(pub\s+)?struct\s+(\w+)/);
    if (structMatch) {
      const [, pubKw, name] = structMatch;
      const endLine = findBlockEnd(lines, i, '{');

      const symbol: SymbolInfo = {
        name,
        kind: 'class',
        line: lineNum,
        endLine,
        signature: line.trim().replace(/\{$/, '').trim(),
        modifiers: pubKw ? ['pub'] : [],
        children: [],
      };

      // Parse struct fields
      const body = lines.slice(i + 1, endLine);
      for (let k = 0; k < body.length; k++) {
        const fieldMatch = body[k].match(/^\s+(pub\s+)?(\w+)\s*:/);
        if (fieldMatch) {
          symbol.children!.push({
            name: fieldMatch[2],
            kind: 'variable',
            line: lineNum + k + 1,
            endLine: lineNum + k + 1,
            modifiers: fieldMatch[1] ? ['pub'] : [],
          });
        }
      }

      symbols.push(symbol);
      if (pubKw) {
        exports.push({
          name,
          kind: 'class',
          line: lineNum,
          isDefault: false,
          isReexport: false,
        });
      }
      continue;
    }

    // ---- Enums ----
    const enumMatch = line.match(/^(pub\s+)?enum\s+(\w+)/);
    if (enumMatch) {
      const [, pubKw, name] = enumMatch;
      const endLine = findBlockEnd(lines, i, '{');

      const symbol: SymbolInfo = {
        name,
        kind: 'enum',
        line: lineNum,
        endLine,
        signature: line.trim().replace(/\{$/, '').trim(),
        modifiers: pubKw ? ['pub'] : [],
        children: [],
      };

      // Parse enum variants
      const body = lines.slice(i + 1, endLine);
      for (let k = 0; k < body.length; k++) {
        const variantMatch = body[k].match(/^\s+(\w+)/);
        if (variantMatch && !body[k].trim().startsWith('//')) {
          symbol.children!.push({
            name: variantMatch[1],
            kind: 'constant',
            line: lineNum + k + 1,
            endLine: lineNum + k + 1,
          });
        }
      }

      symbols.push(symbol);
      if (pubKw) {
        exports.push({
          name,
          kind: 'enum',
          line: lineNum,
          isDefault: false,
          isReexport: false,
        });
      }
      continue;
    }

    // ---- Traits ----
    const traitMatch = line.match(/^(pub\s+)?trait\s+(\w+)/);
    if (traitMatch) {
      const [, pubKw, name] = traitMatch;
      const endLine = findBlockEnd(lines, i, '{');

      const symbol: SymbolInfo = {
        name,
        kind: 'interface',
        line: lineNum,
        endLine,
        signature: line.trim().replace(/\{$/, '').trim(),
        modifiers: pubKw ? ['pub'] : [],
        children: [],
      };

      // Parse trait methods
      const body = lines.slice(i + 1, endLine);
      for (let k = 0; k < body.length; k++) {
        const methodMatch = body[k].match(/^\s+(?:async\s+)?fn\s+(\w+)/);
        if (methodMatch) {
          symbol.children!.push({
            name: methodMatch[1],
            kind: 'method',
            line: lineNum + k + 1,
            endLine: findBlockEnd(body, k, '{') + lineNum + 1,
            signature: body[k].trim().replace(/\{$/, '').trim(),
          });
        }
      }

      symbols.push(symbol);
      if (pubKw) {
        exports.push({
          name,
          kind: 'interface',
          line: lineNum,
          isDefault: false,
          isReexport: false,
        });
      }
      continue;
    }

    // ---- Impl blocks ----
    const implMatch = line.match(/^(pub\s+)?impl\s+(?:<[^>]+>\s*)?(?:trait\s+\w+\s+for\s+)?(\w+)/);
    if (implMatch) {
      const name = implMatch[2];
      const endLine = findBlockEnd(lines, i, '{');

      symbols.push({
        name: `impl ${name}`,
        kind: 'namespace',
        line: lineNum,
        endLine,
        signature: line.trim().replace(/\{$/, '').trim(),
        modifiers: implMatch[1] ? ['pub'] : [],
      });
      continue;
    }

    // ---- Type aliases ----
    const typeAliasMatch = line.match(/^(pub\s+)?type\s+(\w+)\s*(?:<[^>]+>)?\s*=/);
    if (typeAliasMatch) {
      const [, pubKw, name] = typeAliasMatch;
      symbols.push({
        name,
        kind: 'type',
        line: lineNum,
        endLine: lineNum,
        signature: line.trim(),
        modifiers: pubKw ? ['pub'] : [],
      });
      continue;
    }

    // ---- Static/Const ----
    const staticMatch = line.match(/^(pub\s+)?(?:static|const)\s+(?:mut\s+)?(\w+)/);
    if (staticMatch) {
      const [, pubKw, name] = staticMatch;
      symbols.push({
        name,
        kind: 'constant',
        line: lineNum,
        endLine: lineNum,
        modifiers: pubKw ? ['pub'] : [],
      });
    }
  }

  return { symbols, imports, exports };
}

// ---- Java Parser ----

function parseJava(content: string): ParseResult {
  const lines = content.split('\n');
  const symbols: SymbolInfo[] = [];
  const imports: ImportInfo[] = [];
  const exports: ExportInfo[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // ---- Imports ----
    const importMatch = line.match(/^import\s+(?:static\s+)?([^;]+);/);
    if (importMatch) {
      const source = importMatch[1];
      const parts = source.split('.');
      const isStatic = line.includes('import static');
      imports.push({
        source: isStatic ? parts.slice(0, -1).join('.') : source,
        items: isStatic ? [parts[parts.length - 1]] : [],
        line: lineNum,
        isTypeOnly: false,
      });
      continue;
    }

    // ---- Package ----
    const pkgMatch = line.match(/^package\s+([^;]+);/);
    if (pkgMatch) {
      symbols.push({
        name: pkgMatch[1],
        kind: 'namespace',
        line: lineNum,
        endLine: lineNum,
        signature: line.trim(),
      });
      continue;
    }

    // ---- Classes ----
    const classMatch = line.match(/(?:(?:public|private|protected)\s+)?(?:static\s+)?(?:final\s+)?(?:abstract\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+([^{]+))?/);
    if (classMatch) {
      const name = classMatch[1];
      const isPublic = line.includes('public ');
      const endLine = findBlockEnd(lines, i, '{');
      const modifiers = extractJavaModifiers(line);
      const signature = line.trim().replace(/\{$/, '').trim();

      const symbol: SymbolInfo = {
        name,
        kind: 'class',
        line: lineNum,
        endLine,
        signature: signature.slice(0, 200),
        modifiers,
        children: [],
      };

      // Parse class members
      const body = lines.slice(i + 1, endLine);
      for (let k = 0; k < body.length; k++) {
        const memberLine = body[k];

        // Methods
        const methodMatch = memberLine.match(/^\s+(?:(?:public|private|protected|static|final|abstract|synchronized|native|strictfp)\s+)+(?:<[^>]+>\s+)?(?:\w+(?:\[\])*\s+)?(\w+)\s*\(/);
        if (methodMatch && !memberLine.includes('new ') && !memberLine.match(/^\s+(?:if|while|for|switch|catch)\s*\(/)) {
          const methodModifiers = extractJavaModifiers(memberLine);
          symbol.children!.push({
            name: methodMatch[1],
            kind: 'method',
            line: lineNum + k + 1,
            endLine: findBlockEnd(body, k, '{') + lineNum + 1,
            signature: memberLine.trim().replace(/\{$/, '').trim().slice(0, 200),
            modifiers: methodModifiers,
          });
        }

        // Fields (simplified)
        const fieldMatch = memberLine.match(/^\s+(?:(?:public|private|protected|static|final|volatile|transient)\s+)+(?:\w+(?:<[^>]+>)?(?:\[\])*\s+)(\w+)\s*[;=]/);
        if (fieldMatch) {
          symbol.children!.push({
            name: fieldMatch[1],
            kind: 'variable',
            line: lineNum + k + 1,
            endLine: lineNum + k + 1,
            modifiers: extractJavaModifiers(memberLine),
          });
        }
      }

      symbols.push(symbol);
      if (isPublic) {
        exports.push({
          name,
          kind: 'class',
          line: lineNum,
          isDefault: false,
          isReexport: false,
        });
      }
      continue;
    }

    // ---- Interfaces ----
    const ifaceMatch = line.match(/(?:(?:public|private|protected)\s+)?(?:static\s+)?interface\s+(\w+)/);
    if (ifaceMatch) {
      const name = ifaceMatch[1];
      const isPublic = line.includes('public ');
      const endLine = findBlockEnd(lines, i, '{');
      const modifiers = extractJavaModifiers(line);

      const symbol: SymbolInfo = {
        name,
        kind: 'interface',
        line: lineNum,
        endLine,
        signature: line.trim().replace(/\{$/, '').trim(),
        modifiers,
        children: [],
      };

      // Parse interface methods
      const body = lines.slice(i + 1, endLine);
      for (let k = 0; k < body.length; k++) {
        const methodMatch = body[k].match(/^\s+(?:default\s+|static\s+)?(?:<[^>]+>\s+)?(?:\w+\s+)?(\w+)\s*\(/);
        if (methodMatch) {
          symbol.children!.push({
            name: methodMatch[1],
            kind: 'method',
            line: lineNum + k + 1,
            endLine: findBlockEnd(body, k, '{') + lineNum + 1,
            signature: body[k].trim().replace(/[;{]$/, '').trim(),
          });
        }
      }

      symbols.push(symbol);
      if (isPublic) {
        exports.push({
          name,
          kind: 'interface',
          line: lineNum,
          isDefault: false,
          isReexport: false,
        });
      }
      continue;
    }

    // ---- Enums ----
    const enumMatch = line.match(/(?:(?:public|private|protected)\s+)?(?:static\s+)?enum\s+(\w+)/);
    if (enumMatch) {
      const name = enumMatch[1];
      const endLine = findBlockEnd(lines, i, '{');
      const modifiers = extractJavaModifiers(line);

      const symbol: SymbolInfo = {
        name,
        kind: 'enum',
        line: lineNum,
        endLine,
        signature: line.trim().replace(/\{$/, '').trim(),
        modifiers,
        children: [],
      };

      // Parse enum constants
      const body = lines.slice(i + 1, endLine);
      for (let k = 0; k < body.length; k++) {
        const constantMatch = body[k].match(/^\s+([A-Z_][A-Z_0-9]*)(?:\s*[,(;])/);
        if (constantMatch) {
          symbol.children!.push({
            name: constantMatch[1],
            kind: 'constant',
            line: lineNum + k + 1,
            endLine: lineNum + k + 1,
          });
        }
      }

      symbols.push(symbol);
    }
  }

  return { symbols, imports, exports };
}

// ---- CSS Parser ----

function parseCSS(content: string): ParseResult {
  const lines = content.split('\n');
  const symbols: SymbolInfo[] = [];
  const imports: ImportInfo[] = [];
  const exports: ExportInfo[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // ---- Imports ----
    const importMatch = line.match(/@import\s+(?:url\()?['"]?([^'")\s;]+)['"]?\)?/);
    if (importMatch) {
      imports.push({
        source: importMatch[1],
        items: [],
        line: lineNum,
        isTypeOnly: false,
      });
      continue;
    }

    // ---- Selectors ----
    const selectorMatch = line.match(/^([.#][\w-]+|[\w-]+\s*\{)/);
    if (selectorMatch) {
      const name = selectorMatch[1].replace(/\s*\{$/, '').trim();
      const kind = name.startsWith('.') ? 'variable' : name.startsWith('#') ? 'constant' : 'class';
      const endLine = findBlockEnd(lines, i, '{');
      symbols.push({
        name,
        kind,
        line: lineNum,
        endLine,
        signature: line.trim(),
      });
      continue;
    }

    // ---- Media queries ----
    const mediaMatch = line.match(/^@media\s+([^{]+)\s*\{/);
    if (mediaMatch) {
      const endLine = findBlockEnd(lines, i, '{');
      symbols.push({
        name: `@media ${mediaMatch[1].trim()}`,
        kind: 'namespace',
        line: lineNum,
        endLine,
        signature: line.trim(),
      });
      continue;
    }

    // ---- Keyframes ----
    const keyframesMatch = line.match(/^@keyframes\s+([\w-]+)/);
    if (keyframesMatch) {
      const endLine = findBlockEnd(lines, i, '{');
      symbols.push({
        name: keyframesMatch[1],
        kind: 'function',
        line: lineNum,
        endLine,
        signature: line.trim(),
      });
    }
  }

  return { symbols, imports, exports };
}

// ---- HTML Parser ----

function parseHTML(content: string): ParseResult {
  const lines = content.split('\n');
  const symbols: SymbolInfo[] = [];
  const imports: ImportInfo[] = [];
  const exports: ExportInfo[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // ---- Script imports ----
    const scriptSrc = line.match(/<script[^>]+src=["']([^"']+)["']/);
    if (scriptSrc) {
      imports.push({
        source: scriptSrc[1],
        items: [],
        line: lineNum,
        isTypeOnly: false,
      });
      continue;
    }

    // ---- Style imports ----
    const styleHref = line.match(/<link[^>]+href=["']([^"']+)["'][^>]*rel=["']stylesheet["']/);
    if (styleHref) {
      imports.push({
        source: styleHref[1],
        items: [],
        line: lineNum,
        isTypeOnly: false,
      });
      continue;
    }

    // ---- IDs ----
    const idMatch = line.match(/id=["']([^"']+)["']/);
    if (idMatch) {
      symbols.push({
        name: `#${idMatch[1]}`,
        kind: 'constant',
        line: lineNum,
        endLine: lineNum,
      });
    }

    // ---- Template/component tags ----
    const templateMatch = line.match(/<template\s+id=["']([^"']+)["']/);
    if (templateMatch) {
      const endLine = findHTMLTagEnd(lines, i, 'template');
      symbols.push({
        name: templateMatch[1],
        kind: 'class',
        line: lineNum,
        endLine,
        signature: line.trim(),
      });
    }
  }

  return { symbols, imports, exports };
}

// ============================================================
// Helper Functions for Block Detection
// ============================================================

function findBlockEnd(lines: string[], startLine: number, openChar: string = '{'): number {
  let depth = 0;
  const closeChar = openChar === '{' ? '}' : openChar === '(' ? ')' : openChar === '[' ? ']' : '';

  for (let i = startLine; i < lines.length; i++) {
    const line = lines[i];
    // Skip strings (rough approximation)
    const cleaned = line.replace(/(["'`])(?:(?!\1).|\\\1)*\1/g, '');

    for (const ch of cleaned) {
      if (ch === openChar) depth++;
      if (ch === closeChar) depth--;
    }

    if (depth <= 0 && i > startLine) {
      return i + 1;
    }

    // Handle single-line blocks
    if (i === startLine && depth === 0) {
      return i + 1;
    }
  }

  return lines.length;
}

function findTypeEnd(lines: string[], startLine: number): number {
  // Type aliases can span multiple lines with unions/intersections
  let depth = 0;
  let foundEquals = false;

  for (let i = startLine; i < lines.length; i++) {
    const line = lines[i];

    if (line.includes('=')) foundEquals = true;

    if (foundEquals) {
      // Count parentheses and brackets for generics
      for (const ch of line) {
        if (ch === '(' || ch === '[' || ch === '{') depth++;
        if (ch === ')' || ch === ']' || ch === '}') depth--;
      }

      // End of type when depth is 0 and line doesn't end with continuation
      if (depth <= 0 && !line.trim().endsWith('|') && !line.trim().endsWith('&') && i > startLine) {
        return i + 1;
      }

      // Simple single-line type
      if (depth === 0 && i === startLine && !line.trim().endsWith('|') && !line.trim().endsWith('&')) {
        return i + 1;
      }
    }
  }

  return lines.length;
}

function findStatementEnd(lines: string[], startLine: number): number {
  // For const/let arrow functions, find the end of the statement
  let depth = 0;
  let parenDepth = 0;

  for (let i = startLine; i < lines.length; i++) {
    const line = lines[i];
    const cleaned = line.replace(/(["'`])(?:(?!\1).|\\\1)*\1/g, '');

    for (const ch of cleaned) {
      if (ch === '{') depth++;
      if (ch === '}') depth--;
      if (ch === '(') parenDepth++;
      if (ch === ')') parenDepth--;
    }

    if (depth === 0 && parenDepth === 0 && i > startLine) {
      return i + 1;
    }
  }

  return Math.min(startLine + 30, lines.length);
}

function findPythonBlockEnd(lines: string[], startLine: number): number {
  if (startLine >= lines.length) return lines.length;

  // Find the indentation of the block start
  const startIndent = lines[startLine].match(/^(\s*)/)?.[1].length || 0;

  for (let i = startLine + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '') continue;
    const currentIndent = line.match(/^(\s*)/)?.[1].length || 0;

    if (currentIndent <= startIndent && line.trim() !== '') {
      return i;
    }
  }

  return lines.length;
}

function findHTMLTagEnd(lines: string[], startLine: number, tagName: string): number {
  const closeTag = `</${tagName}>`;
  for (let i = startLine + 1; i < lines.length; i++) {
    if (lines[i].includes(closeTag)) {
      return i + 1;
    }
  }
  return lines.length;
}

function extractModifiers(line: string): string[] {
  const modifiers: string[] = [];
  const modifierKeywords = ['export', 'default', 'declare', 'abstract', 'async', 'static', 'public', 'private', 'protected', 'readonly', 'override', 'const', 'let', 'var'];

  for (const kw of modifierKeywords) {
    // Use word boundary check
    const regex = new RegExp(`\\b${kw}\\b`);
    if (regex.test(line)) {
      modifiers.push(kw);
    }
  }

  return modifiers;
}

function extractJavaModifiers(line: string): string[] {
  const modifiers: string[] = [];
  const modifierKeywords = ['public', 'private', 'protected', 'static', 'final', 'abstract', 'synchronized', 'native', 'strictfp', 'volatile', 'transient', 'default'];

  for (const kw of modifierKeywords) {
    const regex = new RegExp(`\\b${kw}\\b`);
    if (regex.test(line)) {
      modifiers.push(kw);
    }
  }

  return modifiers;
}

// ============================================================
// Main Integration Class
// ============================================================

export class TreeSitterIntegration {
  private projectRoot: string;
  private fileCache: Map<string, { content: string; parsedAt: number; result: ParseResult }> = new Map();
  private repoMapCache: RepoMap | null = null;
  private repoMapCacheTime: number = 0;
  private readonly CACHE_TTL = 60000; // 1 minute

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  // ---- Core Analysis Methods ----

  analyzeFile(filePath: string): FileMap | null {
    const absolutePath = this.resolvePath(filePath);
    if (!existsSync(absolutePath)) return null;

    const content = this.readFile(absolutePath);
    if (content === null) return null;

    const language = this.detectLanguage(absolutePath);
    if (language === 'unknown') return null;

    const parsed = this.parseContent(content, language);
    const summary = this.generateFileSummary(absolutePath, language, parsed);

    return {
      path: relative(this.projectRoot, absolutePath),
      language,
      symbols: parsed.symbols,
      imports: parsed.imports,
      exports: parsed.exports,
      summary,
    };
  }

  analyzeDirectory(dirPath: string, maxDepth: number = 5): FileMap[] {
    const absoluteDir = this.resolvePath(dirPath);
    if (!existsSync(absoluteDir) || !statSync(absoluteDir).isDirectory()) return [];

    const files: FileMap[] = [];
    this.walkDirectory(absoluteDir, files, 0, maxDepth);
    return files;
  }

  buildRepoMap(projectRoot?: string): RepoMap {
    const root = projectRoot ? this.resolvePath(projectRoot) : this.projectRoot;

    // Check cache
    if (this.repoMapCache && Date.now() - this.repoMapCacheTime < this.CACHE_TTL) {
      return this.repoMapCache;
    }

    const files = this.analyzeDirectory(root);
    const languageBreakdown: Record<string, number> = {};
    let totalSymbols = 0;

    for (const file of files) {
      const langName = LANGUAGE_NAMES[file.language] || file.language;
      languageBreakdown[langName] = (languageBreakdown[langName] || 0) + 1;
      totalSymbols += file.symbols.length;
    }

    this.repoMapCache = {
      root,
      files,
      totalSymbols,
      totalFiles: files.length,
      languageBreakdown,
      generatedAt: Date.now(),
    };
    this.repoMapCacheTime = Date.now();

    return this.repoMapCache;
  }

  // ---- Symbol Methods ----

  getSymbols(filePath: string): SymbolInfo[] {
    const fileMap = this.analyzeFile(filePath);
    return fileMap?.symbols || [];
  }

  getCallGraph(filePath: string): CallGraphNode[] {
    const absolutePath = this.resolvePath(filePath);
    const content = this.readFile(absolutePath);
    if (!content) return [];

    const language = this.detectLanguage(absolutePath);
    const parsed = this.parseContent(content, language);
    const nodes: CallGraphNode[] = [];

    for (const symbol of parsed.symbols) {
      if (symbol.kind === 'function' || symbol.kind === 'method') {
        // Extract function calls from the function body
        const lines = content.split('\n');
        const body = lines.slice(symbol.line - 1, symbol.endLine).join('\n');
        const calls = this.extractCalls(body, language);

        nodes.push({
          name: symbol.name,
          kind: symbol.kind,
          line: symbol.line,
          calls: Array.from(new Set(calls)),
          calledBy: [], // Filled in by cross-referencing
        });
      }
    }

    // Cross-reference: who calls whom
    const allCalls = new Map<string, Set<string>>();
    for (const node of nodes) {
      for (const call of node.calls) {
        if (!allCalls.has(call)) allCalls.set(call, new Set());
        allCalls.get(call)!.add(node.name);
      }
    }

    for (const node of nodes) {
      const callers = allCalls.get(node.name);
      node.calledBy = callers ? Array.from(callers) : [];
    }

    return nodes;
  }

  getDependencies(filePath: string): ImportInfo[] {
    const fileMap = this.analyzeFile(filePath);
    return fileMap?.imports || [];
  }

  findDefinition(symbol: string, projectRoot?: string): Array<{ file: string; line: number; kind: string }> {
    const root = projectRoot ? this.resolvePath(projectRoot) : this.projectRoot;
    const files = this.analyzeDirectory(root);
    const results: Array<{ file: string; line: number; kind: string }> = [];

    for (const file of files) {
      for (const sym of file.symbols) {
        if (sym.name === symbol) {
          results.push({
            file: file.path,
            line: sym.line,
            kind: sym.kind,
          });
        }

        // Check children
        if (sym.children) {
          for (const child of sym.children) {
            if (child.name === symbol) {
              results.push({
                file: file.path,
                line: child.line,
                kind: child.kind,
              });
            }
          }
        }
      }
    }

    return results;
  }

  findReferences(symbol: string, projectRoot?: string): Array<{ file: string; line: number; context: string }> {
    const root = projectRoot ? this.resolvePath(projectRoot) : this.projectRoot;
    const results: Array<{ file: string; line: number; context: string }> = [];

    // Try using ripgrep first for speed
    try {
      const rgResult = execSync(
        `rg --line-number --color never --max-count 50 "\\b${symbol}\\b" "${root}"`,
        { encoding: 'utf-8', timeout: 30000, cwd: root }
      );

      for (const line of rgResult.trim().split('\n')) {
        const match = line.match(/^(.+?):(\d+):(.+)$/);
        if (match) {
          const [, file, lineNum, context] = match;
          // Skip binary files and common non-source directories
          const ext = extname(file);
          if (!BINARY_EXTENSIONS.has(ext) && !SKIP_DIRS.has(dirname(file).split('/')[0])) {
            results.push({
              file: relative(root, file),
              line: parseInt(lineNum, 10),
              context: context.trim(),
            });
          }
        }
      }
    } catch {
      // Fallback: search in analyzed files
      const files = this.analyzeDirectory(root);
      for (const file of files) {
        const absolutePath = join(root, file.path);
        const content = this.readFile(absolutePath);
        if (!content) continue;

        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (new RegExp(`\\b${symbol}\\b`).test(lines[i])) {
            results.push({
              file: file.path,
              line: i + 1,
              context: lines[i].trim(),
            });
          }
        }
      }
    }

    return results.slice(0, 100);
  }

  getOutline(filePath: string): OutlineNode[] {
    const fileMap = this.analyzeFile(filePath);
    if (!fileMap) return [];

    return fileMap.symbols.map(sym => this.symbolToOutline(sym));
  }

  detectLanguage(filePath: string): string {
    const ext = extname(filePath).toLowerCase();
    return LANGUAGE_EXTENSIONS[ext] || 'unknown';
  }

  getDiagnostics(filePath: string): DiagnosticInfo[] {
    const absolutePath = this.resolvePath(filePath);
    const content = this.readFile(absolutePath);
    if (!content) return [];

    const language = this.detectLanguage(absolutePath);
    const diagnostics: DiagnosticInfo[] = [];
    const lines = content.split('\n');

    // Basic syntax checks - common issues across languages

    // 1. Unmatched brackets
    const bracketStack: Array<{ char: string; line: number; col: number }> = [];
    const pairs: Record<string, string> = { '(': ')', '[': ']', '{': '}' };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Skip string content (rough)
      const cleaned = line.replace(/(["'`])(?:(?!\1).|\\\1)*\1/g, '').replace(/\/\/.*$|\/\*[\s\S]*?\*\//g, '');

      for (let j = 0; j < cleaned.length; j++) {
        const ch = cleaned[j];
        if (pairs[ch]) {
          bracketStack.push({ char: ch, line: i + 1, col: j + 1 });
        } else if (Object.values(pairs).includes(ch)) {
          const last = bracketStack.pop();
          if (!last) {
            diagnostics.push({
              line: i + 1,
              column: j + 1,
              severity: 'warning',
              message: `Unexpected closing bracket '${ch}'`,
              rule: 'unmatched-bracket',
            });
          } else if (pairs[last.char] !== ch) {
            diagnostics.push({
              line: i + 1,
              column: j + 1,
              severity: 'warning',
              message: `Mismatched bracket: expected '${pairs[last.char]}' but found '${ch}' (opened at line ${last.line})`,
              rule: 'mismatched-bracket',
            });
          }
        }
      }
    }

    // Remaining unclosed brackets
    for (const bracket of bracketStack) {
      diagnostics.push({
        line: bracket.line,
        column: bracket.col,
        severity: 'warning',
        message: `Unclosed bracket '${bracket.char}'`,
        rule: 'unclosed-bracket',
      });
    }

    // 2. Language-specific checks
    if (language === 'typescript' || language === 'javascript') {
      // Check for missing semicolons in specific patterns
      for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        if (trimmed.length > 0 && !trimmed.startsWith('//') && !trimmed.startsWith('*') && !trimmed.startsWith('/*')) {
          // Detect potential issues
          if (/^(?:export\s+)?(?:const|let|var)\s+\w+\s*=\s*[^;{]+$/.test(trimmed) && !trimmed.endsWith(',')) {
            // This could be a missing semicolon, but it's too noisy to report all
          }
        }
      }
    }

    if (language === 'python') {
      // Check for mixed tabs/spaces
      let usesTabs = false;
      let usesSpaces = false;
      for (const line of lines) {
        if (line.startsWith('\t')) usesTabs = true;
        if (line.startsWith('  ')) usesSpaces = true;
      }
      if (usesTabs && usesSpaces) {
        diagnostics.push({
          line: 1,
          column: 1,
          severity: 'warning',
          message: 'Mixed tabs and spaces for indentation',
          rule: 'mixed-indentation',
        });
      }
    }

    return diagnostics;
  }

  formatRepoMap(projectRoot?: string, maxTokens?: number): string {
    const repoMap = this.buildRepoMap(projectRoot);
    const maxChars = (maxTokens || 4000) * 4; // ~4 chars per token

    const lines: string[] = [];
    lines.push(`# Repository Map: ${basename(repoMap.root)}`);
    lines.push(`# ${repoMap.totalFiles} files | ${repoMap.totalSymbols} symbols | Generated: ${new Date(repoMap.generatedAt).toISOString()}`);
    lines.push('');

    // Language breakdown
    const langEntries = Object.entries(repoMap.languageBreakdown)
      .sort(([, a], [, b]) => b - a);
    lines.push(`Languages: ${langEntries.map(([l, c]) => `${l}(${c})`).join(', ')}`);
    lines.push('');

    // File listing with symbols
    for (const file of repoMap.files) {
      const langName = LANGUAGE_NAMES[file.language] || file.language;
      const relPath = file.path;

      // File header
      const importCount = file.imports.length;
      const exportCount = file.exports.length;
      lines.push(`## ${relPath} [${langName}]`);
      if (importCount > 0 || exportCount > 0) {
        lines.push(`   imports: ${importCount} | exports: ${exportCount}`);
      }

      // Symbols
      for (const sym of file.symbols) {
        const modifier = sym.modifiers?.length ? `[${sym.modifiers.join(',')}] ` : '';
        const icon = this.getSymbolIcon(sym.kind);
        const lineRange = sym.line === sym.endLine ? `:${sym.line}` : `:${sym.line}-${sym.endLine}`;
        const sig = sym.signature ? ` — ${sym.signature.slice(0, 80)}` : '';
        lines.push(`  ${icon} ${modifier}${sym.kind} ${sym.name}${lineRange}${sig}`);

        // Children
        if (sym.children) {
          for (const child of sym.children) {
            const childMod = child.modifiers?.length ? `[${child.modifiers.join(',')}] ` : '';
            const childIcon = this.getSymbolIcon(child.kind);
            const childRange = child.line === child.endLine ? `:${child.line}` : `:${child.line}-${child.endLine}`;
            lines.push(`    ${childIcon} ${childMod}${child.kind} ${child.name}${childRange}`);
          }
        }
      }

      lines.push('');

      // Check if we've exceeded the token limit
      const currentLength = lines.join('\n').length;
      if (currentLength > maxChars) {
        lines.push(`... [truncated, ${repoMap.files.length - repoMap.files.indexOf(file) - 1} more files]`);
        break;
      }
    }

    return lines.join('\n');
  }

  // ---- Cache Management ----

  invalidateCache(filePath?: string): void {
    if (filePath) {
      this.fileCache.delete(this.resolvePath(filePath));
    } else {
      this.fileCache.clear();
    }
    this.repoMapCache = null;
    this.repoMapCacheTime = 0;
  }

  // ---- Private Methods ----

  private resolvePath(filePath: string): string {
    if (filePath.startsWith('/')) return filePath;
    return join(this.projectRoot, filePath);
  }

  private readFile(absolutePath: string): string | null {
    try {
      if (!existsSync(absolutePath)) return null;
      const stat = statSync(absolutePath);
      if (stat.isDirectory()) return null;
      if (stat.size > 1024 * 1024) return null; // Skip files > 1MB
      return readFileSync(absolutePath, 'utf-8');
    } catch {
      return null;
    }
  }

  private parseContent(content: string, language: string): ParseResult {
    switch (language) {
      case 'typescript':
      case 'javascript':
        return parseTypeScript(content);
      case 'python':
        return parsePython(content);
      case 'go':
        return parseGo(content);
      case 'rust':
        return parseRust(content);
      case 'java':
      case 'kotlin':
        return parseJava(content);
      case 'css':
        return parseCSS(content);
      case 'html':
        return parseHTML(content);
      default:
        return { symbols: [], imports: [], exports: [] };
    }
  }

  private walkDirectory(dir: string, results: FileMap[], depth: number, maxDepth: number): void {
    if (depth > maxDepth) return;

    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name)) continue;
      if (entry.name.startsWith('.') && entry.name !== '.env') continue;

      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        this.walkDirectory(fullPath, results, depth + 1, maxDepth);
      } else if (entry.isFile()) {
        const ext = extname(entry.name).toLowerCase();
        if (BINARY_EXTENSIONS.has(ext)) continue;

        const language = LANGUAGE_EXTENSIONS[ext];
        if (!language) continue;

        const fileMap = this.analyzeFile(fullPath);
        if (fileMap) {
          results.push(fileMap);
        }
      }
    }
  }

  private generateFileSummary(filePath: string, language: string, parsed: ParseResult): string {
    const parts: string[] = [];
    const langName = LANGUAGE_NAMES[language] || language;
    parts.push(langName);

    if (parsed.symbols.length > 0) {
      const kinds = parsed.symbols.map(s => s.kind);
      const classCount = kinds.filter(k => k === 'class').length;
      const funcCount = kinds.filter(k => k === 'function').length;
      const ifaceCount = kinds.filter(k => k === 'interface').length;
      const typeCount = kinds.filter(k => k === 'type').length;
      const enumCount = kinds.filter(k => k === 'enum').length;

      const details: string[] = [];
      if (classCount) details.push(`${classCount} class${classCount > 1 ? 'es' : ''}`);
      if (funcCount) details.push(`${funcCount} fn${funcCount > 1 ? 's' : ''}`);
      if (ifaceCount) details.push(`${ifaceCount} iface${ifaceCount > 1 ? 's' : ''}`);
      if (typeCount) details.push(`${typeCount} type${typeCount > 1 ? 's' : ''}`);
      if (enumCount) details.push(`${enumCount} enum${enumCount > 1 ? 's' : ''}`);

      if (details.length > 0) {
        parts.push(details.join(', '));
      }
    }

    if (parsed.imports.length > 0) {
      parts.push(`${parsed.imports.length} import${parsed.imports.length > 1 ? 's' : ''}`);
    }

    if (parsed.exports.length > 0) {
      parts.push(`${parsed.exports.length} export${parsed.exports.length > 1 ? 's' : ''}`);
    }

    return parts.join(' | ');
  }

  private extractCalls(body: string, language: string): string[] {
    const calls: string[] = [];

    // Generic function call pattern
    const callPatterns: RegExp[] = [
      /(\w+)\s*\(/g,          // Direct calls: foo()
      /(\w+)\.\s*(\w+)\s*\(/g, // Method calls: obj.method()
    ];

    // Language-specific patterns
    switch (language) {
      case 'python':
        callPatterns.push(/self\.(\w+)\s*\(/g);
        break;
      case 'go':
        callPatterns.push(/(\w+)\.\s*(\w+)\s*\(/g);
        break;
      case 'rust':
        callPatterns.push(/(\w+)::(\w+)\s*\(/g);
        break;
    }

    // Keywords to exclude
    const keywords = new Set([
      'if', 'else', 'for', 'while', 'switch', 'case', 'return', 'new',
      'typeof', 'instanceof', 'throw', 'try', 'catch', 'finally',
      'class', 'function', 'const', 'let', 'var', 'import', 'export',
      'async', 'await', 'yield', 'from', 'as', 'extends', 'implements',
      'interface', 'type', 'enum', 'namespace', 'module', 'require',
      'console', 'process', 'Math', 'JSON', 'Object', 'Array', 'String',
      'Number', 'Boolean', 'Promise', 'Map', 'Set', 'Error', 'self',
      'super', 'this', 'def', 'elif', 'except', 'lambda', 'with',
      'assert', 'raise', 'pass', 'break', 'continue', 'del', 'global',
      'print', 'len', 'range', 'str', 'int', 'float', 'list', 'dict',
      'tuple', 'set', 'bool', 'type', 'isinstance', 'hasattr', 'getattr',
      'setattr', 'iter', 'next', 'enumerate', 'zip', 'map', 'filter',
      'sorted', 'reversed', 'min', 'max', 'sum', 'abs', 'round',
      'append', 'extend', 'insert', 'remove', 'pop', 'clear',
      'keys', 'values', 'items', 'get', 'update',
    ]);

    for (const pattern of callPatterns) {
      let match;
      while ((match = pattern.exec(body)) !== null) {
        const name = match[1] || match[2] || match[0];
        if (!keywords.has(name) && name.length > 1 && /^[a-zA-Z_]/.test(name)) {
          calls.push(name);
        }
      }
    }

    return Array.from(new Set(calls));
  }

  private symbolToOutline(sym: SymbolInfo): OutlineNode {
    return {
      name: sym.name,
      kind: sym.kind,
      line: sym.line,
      endLine: sym.endLine,
      icon: this.getSymbolIcon(sym.kind),
      children: sym.children?.map(c => this.symbolToOutline(c)) || [],
      signature: sym.signature,
    };
  }

  private getSymbolIcon(kind: SymbolInfo['kind']): string {
    const icons: Record<SymbolInfo['kind'], string> = {
      class: '🔷',
      function: '⚡',
      method: '🔹',
      variable: '📌',
      interface: '🔌',
      type: '🏷️',
      enum: '🎯',
      constant: '🔒',
      namespace: '📦',
      import: '📥',
    };
    return icons[kind] || '📄';
  }
}

import { readFileSync, writeFileSync, unlinkSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UndoAction {
  id: string;
  type: 'file_create' | 'file_modify' | 'file_delete';
  path: string;
  timestamp: number;
  /** Content before the change (used by modify / delete to restore). */
  originalContent?: string;
  /** Content after the change (used by create / modify to re-apply). */
  newContent?: string;
  description: string;
}

/** Shape accepted by {@link UndoRedoSystem.push} -- id and timestamp are generated. */
export type UndoActionInput = Omit<UndoAction, 'id' | 'timestamp'>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let _nextSeq = 0;

function generateId(): string {
  _nextSeq += 1;
  return `act_${Date.now().toString(36)}_${_nextSeq}`;
}

// ---------------------------------------------------------------------------
// UndoRedoSystem
// ---------------------------------------------------------------------------

/**
 * Production-quality undo/redo system for NeuroCLI.
 *
 * Tracks file-level create, modify and delete operations so that any change
 * can be rolled back (undo) or re-applied (redo). The redo stack is cleared
 * automatically whenever a new action is pushed -- this mirrors the behaviour
 * of most professional editors and prevents ambiguous redo states.
 */
export class UndoRedoSystem {
  private undoStack: UndoAction[] = [];
  private redoStack: UndoAction[] = [];

  // Cumulative counters -- survive clear() so that stats remain meaningful.
  private totalUndos = 0;
  private totalRedos = 0;
  private totalActionsPushed = 0;

  // -----------------------------------------------------------------------
  // Core mutators
  // -----------------------------------------------------------------------

  /**
   * Record a new action. The action is pushed onto the undo stack and the
   * redo stack is cleared (standard expectation: a new edit invalidates
   * previously undone changes).
   */
  push(action: UndoActionInput): void {
    const full: UndoAction = {
      ...action,
      id: generateId(),
      timestamp: Date.now(),
    };

    this.undoStack.push(full);
    this.redoStack = [];
    this.totalActionsPushed += 1;
  }

  /**
   * Undo the most recent action. Returns the undone action or `null` when
   * there is nothing to undo. The action is moved from the undo stack to
   * the redo stack and the file system change is reversed.
   */
  undo(): UndoAction | null {
    if (this.undoStack.length === 0) {
      return null;
    }

    const action = this.undoStack.pop()!;
    this.redoStack.push(action);
    this.totalUndos += 1;

    try {
      this.applyUndo(action);
    } catch (err) {
      // Re-throw with context so callers can decide how to handle a partial
      // failure -- the action has already been moved to the redo stack which
      // keeps the internal state consistent.
      throw new UndoRedoError(
        `Failed to apply undo for action "${action.id}" (${action.type}) on "${action.path}": ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    }

    return action;
  }

  /**
   * Redo the most recently undone action. Returns the re-applied action or
   * `null` when there is nothing to redo. The action is moved from the redo
   * stack back to the undo stack and the file system change is re-applied.
   */
  redo(): UndoAction | null {
    if (this.redoStack.length === 0) {
      return null;
    }

    const action = this.redoStack.pop()!;
    this.undoStack.push(action);
    this.totalRedos += 1;

    try {
      this.applyRedo(action);
    } catch (err) {
      throw new UndoRedoError(
        `Failed to apply redo for action "${action.id}" (${action.type}) on "${action.path}": ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    }

    return action;
  }

  // -----------------------------------------------------------------------
  // Batch undo / redo
  // -----------------------------------------------------------------------

  /**
   * Undo up to `n` actions. Stops early if the undo stack is exhausted.
   * Returns the list of actions that were undone (most-recent-first order --
   * i.e. the first element is the action that was on top of the stack).
   */
  undoN(n: number): UndoAction[] {
    if (n <= 0) {
      return [];
    }

    const results: UndoAction[] = [];

    for (let i = 0; i < n; i++) {
      const action = this.undo();
      if (action === null) {
        break;
      }
      results.push(action);
    }

    return results;
  }

  /**
   * Redo up to `n` actions. Stops early if the redo stack is exhausted.
   * Returns the list of actions that were re-applied (oldest-first order --
   * i.e. the first element was the earliest undone action).
   */
  redoN(n: number): UndoAction[] {
    if (n <= 0) {
      return [];
    }

    const results: UndoAction[] = [];

    for (let i = 0; i < n; i++) {
      const action = this.redo();
      if (action === null) {
        break;
      }
      results.push(action);
    }

    return results;
  }

  // -----------------------------------------------------------------------
  // Queries
  // -----------------------------------------------------------------------

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  getUndoStack(): UndoAction[] {
    // Return a shallow copy to prevent external mutation.
    return [...this.undoStack];
  }

  getRedoStack(): UndoAction[] {
    return [...this.redoStack];
  }

  /**
   * Returns a human-readable history combining both stacks.
   *
   * The undo entries are shown newest-first; the redo entries are shown
   * oldest-first (which is the order in which they would be re-applied).
   */
  getHistory(): { undo: UndoAction[]; redo: UndoAction[] } {
    return {
      undo: [...this.undoStack].reverse(),
      redo: [...this.redoStack],
    };
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  /**
   * Clear both stacks. Cumulative stats counters are intentionally NOT
   * reset so that `getStats()` retains a full session-level picture.
   */
  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }

  getSize(): { undo: number; redo: number } {
    return {
      undo: this.undoStack.length,
      redo: this.redoStack.length,
    };
  }

  getStats(): { totalUndos: number; totalRedos: number; totalActions: number } {
    return {
      totalUndos: this.totalUndos,
      totalRedos: this.totalRedos,
      totalActions: this.totalActionsPushed,
    };
  }

  // -----------------------------------------------------------------------
  // File-system helpers
  // -----------------------------------------------------------------------

  /**
   * Restore the file system to the state before `action` was performed.
   *
   * - **file_create**  : delete the created file.
   * - **file_modify**  : restore `originalContent` (must be present).
   * - **file_delete**  : re-create the file with `originalContent` (must be
   *                      present).
   */
  applyUndo(action: UndoAction): void {
    switch (action.type) {
      case 'file_create': {
        // The file was created; remove it to undo.
        if (!existsSync(action.path)) {
          // File already absent -- nothing to do, but this is worth noting.
          throw new UndoRedoError(
            `Cannot undo file_create: file does not exist at "${action.path}"`,
          );
        }
        unlinkSync(action.path);
        break;
      }

      case 'file_modify': {
        // Restore the previous content.
        if (action.originalContent === undefined) {
          throw new UndoRedoError(
            `Cannot undo file_modify: originalContent is missing for action "${action.id}"`,
          );
        }
        this.ensureDir(action.path);
        writeFileSync(action.path, action.originalContent, 'utf-8');
        break;
      }

      case 'file_delete': {
        // Re-create the deleted file.
        if (action.originalContent === undefined) {
          throw new UndoRedoError(
            `Cannot undo file_delete: originalContent is missing for action "${action.id}"`,
          );
        }
        this.ensureDir(action.path);
        writeFileSync(action.path, action.originalContent, 'utf-8');
        break;
      }

      default: {
        const exhaustive: never = action.type;
        throw new UndoRedoError(`Unknown action type: ${String(exhaustive)}`);
      }
    }
  }

  /**
   * Re-apply a previously undone action to the file system.
   *
   * - **file_create**  : re-create the file with `newContent` (must be
   *                      present).
   * - **file_modify**  : write `newContent` (must be present).
   * - **file_delete**  : delete the file again.
   */
  applyRedo(action: UndoAction): void {
    switch (action.type) {
      case 'file_create': {
        if (action.newContent === undefined) {
          throw new UndoRedoError(
            `Cannot redo file_create: newContent is missing for action "${action.id}"`,
          );
        }
        this.ensureDir(action.path);
        writeFileSync(action.path, action.newContent, 'utf-8');
        break;
      }

      case 'file_modify': {
        if (action.newContent === undefined) {
          throw new UndoRedoError(
            `Cannot redo file_modify: newContent is missing for action "${action.id}"`,
          );
        }
        this.ensureDir(action.path);
        writeFileSync(action.path, action.newContent, 'utf-8');
        break;
      }

      case 'file_delete': {
        if (!existsSync(action.path)) {
          throw new UndoRedoError(
            `Cannot redo file_delete: file does not exist at "${action.path}"`,
          );
        }
        unlinkSync(action.path);
        break;
      }

      default: {
        const exhaustive: never = action.type;
        throw new UndoRedoError(`Unknown action type: ${String(exhaustive)}`);
      }
    }
  }

  // -----------------------------------------------------------------------
  // Internal utilities
  // -----------------------------------------------------------------------

  /**
   * Make sure the parent directory of `filePath` exists before writing.
   */
  private ensureDir(filePath: string): void {
    const dir = dirname(filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
}

// ---------------------------------------------------------------------------
// Custom error
// ---------------------------------------------------------------------------

export class UndoRedoError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'UndoRedoError';
  }
}

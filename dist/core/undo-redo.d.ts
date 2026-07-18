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
/**
 * Production-quality undo/redo system for NeuroCLI.
 *
 * Tracks file-level create, modify and delete operations so that any change
 * can be rolled back (undo) or re-applied (redo). The redo stack is cleared
 * automatically whenever a new action is pushed -- this mirrors the behaviour
 * of most professional editors and prevents ambiguous redo states.
 */
export declare class UndoRedoSystem {
    private undoStack;
    private redoStack;
    private totalUndos;
    private totalRedos;
    private totalActionsPushed;
    /**
     * Record a new action. The action is pushed onto the undo stack and the
     * redo stack is cleared (standard expectation: a new edit invalidates
     * previously undone changes).
     */
    push(action: UndoActionInput): void;
    /**
     * Undo the most recent action. Returns the undone action or `null` when
     * there is nothing to undo. The action is moved from the undo stack to
     * the redo stack and the file system change is reversed.
     */
    undo(): UndoAction | null;
    /**
     * Redo the most recently undone action. Returns the re-applied action or
     * `null` when there is nothing to redo. The action is moved from the redo
     * stack back to the undo stack and the file system change is re-applied.
     */
    redo(): UndoAction | null;
    /**
     * Undo up to `n` actions. Stops early if the undo stack is exhausted.
     * Returns the list of actions that were undone (most-recent-first order --
     * i.e. the first element is the action that was on top of the stack).
     */
    undoN(n: number): UndoAction[];
    /**
     * Redo up to `n` actions. Stops early if the redo stack is exhausted.
     * Returns the list of actions that were re-applied (oldest-first order --
     * i.e. the first element was the earliest undone action).
     */
    redoN(n: number): UndoAction[];
    canUndo(): boolean;
    canRedo(): boolean;
    getUndoStack(): UndoAction[];
    getRedoStack(): UndoAction[];
    /**
     * Returns a human-readable history combining both stacks.
     *
     * The undo entries are shown newest-first; the redo entries are shown
     * oldest-first (which is the order in which they would be re-applied).
     */
    getHistory(): {
        undo: UndoAction[];
        redo: UndoAction[];
    };
    /**
     * Clear both stacks. Cumulative stats counters are intentionally NOT
     * reset so that `getStats()` retains a full session-level picture.
     */
    clear(): void;
    getSize(): {
        undo: number;
        redo: number;
    };
    getStats(): {
        totalUndos: number;
        totalRedos: number;
        totalActions: number;
    };
    /**
     * Restore the file system to the state before `action` was performed.
     *
     * - **file_create**  : delete the created file.
     * - **file_modify**  : restore `originalContent` (must be present).
     * - **file_delete**  : re-create the file with `originalContent` (must be
     *                      present).
     */
    applyUndo(action: UndoAction): void;
    /**
     * Re-apply a previously undone action to the file system.
     *
     * - **file_create**  : re-create the file with `newContent` (must be
     *                      present).
     * - **file_modify**  : write `newContent` (must be present).
     * - **file_delete**  : delete the file again.
     */
    applyRedo(action: UndoAction): void;
    /**
     * Make sure the parent directory of `filePath` exists before writing.
     */
    private ensureDir;
}
export declare class UndoRedoError extends Error {
    constructor(message: string, options?: ErrorOptions);
}
//# sourceMappingURL=undo-redo.d.ts.map
export interface DiffLine {
    type: 'add' | 'remove' | 'context';
    content: string;
    lineNumber?: number;
}
export interface FileDiff {
    filePath: string;
    added: number;
    removed: number;
    lines: DiffLine[];
}
export declare class DiffPreview {
    /**
     * Create a diff preview between old content and new content
     */
    static createDiff(oldContent: string, newContent: string, filePath: string): FileDiff;
    /**
     * Create diff for edit_file operation (old_text -> new_text replacement)
     */
    static createEditDiff(filePath: string, oldText: string, newText: string): FileDiff | null;
    /**
     * Render diff to terminal with colors
     */
    static renderDiff(diff: FileDiff, contextLines?: number): void;
    /**
     * Render a compact summary of multiple diffs
     */
    static renderSummary(diffs: FileDiff[]): void;
    /**
     * Ask user to confirm diff changes
     */
    static confirmDiff(diff: FileDiff): Promise<boolean>;
    private static lcs;
}
//# sourceMappingURL=diff-preview.d.ts.map
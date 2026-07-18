/**
 * Check if a path looks like a Windows absolute path (drive letter)
 * Matches: C:\, C:/, D:\foo, etc.
 */
export declare function isWindowsAbsolutePath(p: string): boolean;
/**
 * Normalize a path for cross-platform compatibility:
 * 1. Convert backslashes to forward slashes
 * 2. Detect Windows absolute paths (C:\...) and treat them as absolute
 * 3. Resolve ~ to home directory
 * 4. Handle relative paths correctly
 */
export declare function normalizeCrossPlatformPath(inputPath: string): string;
/**
 * Resolve a path relative to a working directory with cross-platform support.
 * This is the main function to use in file tools.
 *
 * - Absolute paths (POSIX or Windows) are used as-is after normalization
 * - Relative paths are resolved against workingDirectory
 * - Home directory (~) is expanded
 * - Backslashes are normalized to forward slashes
 */
export declare function resolvePath(workingDirectory: string, inputPath: string): string;
/**
 * Check if a path is absolute on any platform (POSIX or Windows)
 */
export declare function isAnyAbsolutePath(p: string): boolean;
//# sourceMappingURL=crosspath.d.ts.map
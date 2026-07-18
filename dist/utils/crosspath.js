// ============================================================
// NeuroCLI - Cross-Platform Path Utility
// Handles Windows, macOS, and Linux path differences
// ============================================================
import { join, resolve, isAbsolute, normalize } from 'path';
/**
 * Check if a path looks like a Windows absolute path (drive letter)
 * Matches: C:\, C:/, D:\foo, etc.
 */
export function isWindowsAbsolutePath(p) {
    return /^[A-Za-z]:[/\\]/.test(p);
}
/**
 * Normalize a path for cross-platform compatibility:
 * 1. Convert backslashes to forward slashes
 * 2. Detect Windows absolute paths (C:\...) and treat them as absolute
 * 3. Resolve ~ to home directory
 * 4. Handle relative paths correctly
 */
export function normalizeCrossPlatformPath(inputPath) {
    let p = inputPath;
    // Step 1: Expand home directory
    if (p.startsWith('~/') || p === '~') {
        const homeDir = process.env.HOME || process.env.USERPROFILE || '';
        p = p === '~' ? homeDir : join(homeDir, p.slice(2));
        return normalize(p);
    }
    // Step 2: Detect Windows absolute path with drive letter
    if (isWindowsAbsolutePath(p)) {
        // Normalize backslashes to forward slashes, then let Node normalize
        p = p.replace(/\\/g, '/');
        // On Windows, Node's path.resolve handles drive letters natively
        // On non-Windows, we still need to handle this for the case where
        // the LLM sends a Windows path from a user's context
        if (process.platform === 'win32') {
            return normalize(p);
        }
        // On non-Windows systems, a Windows path like C:/Users/foo
        // won't resolve. This likely means the LLM is confused about
        // the OS. We still normalize it so it can be used as-is.
        return normalize(p);
    }
    // Step 3: Convert backslashes to forward slashes for mixed paths
    // (handles cases where LLM or user provides backslash paths on any OS)
    p = p.replace(/\\/g, '/');
    // Step 4: If already absolute (POSIX), normalize directly
    if (isAbsolute(p)) {
        return normalize(p);
    }
    // Step 5: Relative path - return as-is (caller will resolve against working dir)
    return normalize(p);
}
/**
 * Resolve a path relative to a working directory with cross-platform support.
 * This is the main function to use in file tools.
 *
 * - Absolute paths (POSIX or Windows) are used as-is after normalization
 * - Relative paths are resolved against workingDirectory
 * - Home directory (~) is expanded
 * - Backslashes are normalized to forward slashes
 */
export function resolvePath(workingDirectory, inputPath) {
    const normalized = normalizeCrossPlatformPath(inputPath);
    // If it's already an absolute path after normalization, use it directly
    if (isAbsolute(normalized)) {
        return normalized;
    }
    // Windows absolute paths that became normalized (C:/...) 
    if (isWindowsAbsolutePath(normalized)) {
        return normalized;
    }
    // Relative path: resolve against working directory
    return resolve(workingDirectory, normalized);
}
/**
 * Check if a path is absolute on any platform (POSIX or Windows)
 */
export function isAnyAbsolutePath(p) {
    return isAbsolute(p) || isWindowsAbsolutePath(p);
}
//# sourceMappingURL=crosspath.js.map
// ============================================================
// NeuroCLI - Plugin Bundle System
// Packages Skills + Hooks + MCP servers into installable units
// ============================================================
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync, copyFileSync, statSync, } from 'fs';
import { join, basename, dirname, resolve, extname } from 'path';
import { homedir } from 'os';
import { createHash } from 'crypto';
import { execSync } from 'child_process';
import { pipeline as pipelineCallback } from 'stream';
import { promisify } from 'util';
const pipelineAsync = promisify(pipelineCallback);
// ---- Constants ----
const BUNDLES_DIR = join(homedir(), '.neuro', 'bundles');
const REGISTRY_FILE = join(homedir(), '.neuro', 'bundle-registry.json');
const MANIFEST_FILE = 'bundle.json';
const SKILLS_DIR = 'skills';
const HOOKS_DIR = 'hooks';
const MCP_DIR = 'mcp';
const TOOLS_DIR = 'tools';
// ---- Helper Functions ----
function ensureDir(dir) {
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
    }
}
function computeChecksum(filePath) {
    const content = readFileSync(filePath);
    return createHash('sha256').update(content).digest('hex');
}
function computeDirectoryChecksum(dirPath) {
    const hash = createHash('sha256');
    function walk(dir) {
        const entries = readdirSync(dir, { withFileTypes: true });
        // Sort for deterministic ordering
        entries.sort((a, b) => a.name.localeCompare(b.name));
        for (const entry of entries) {
            const fullPath = join(dir, entry.name);
            if (entry.isDirectory()) {
                hash.update(`dir:${entry.name}`);
                walk(fullPath);
            }
            else if (entry.isFile()) {
                const content = readFileSync(fullPath);
                hash.update(`file:${entry.name}:${content.length}:`);
                hash.update(content);
            }
        }
    }
    walk(dirPath);
    return hash.digest('hex');
}
function readJSONFile(filePath) {
    if (!existsSync(filePath))
        return null;
    try {
        return JSON.parse(readFileSync(filePath, 'utf-8'));
    }
    catch {
        return null;
    }
}
function writeJSONFile(filePath, data) {
    ensureDir(dirname(filePath));
    writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}
function copyRecursive(src, dest) {
    ensureDir(dest);
    const entries = readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
        const srcPath = join(src, entry.name);
        const destPath = join(dest, entry.name);
        if (entry.isDirectory()) {
            copyRecursive(srcPath, destPath);
        }
        else {
            copyFileSync(srcPath, destPath);
        }
    }
}
function execCommand(command, options) {
    try {
        const stdout = execSync(command, {
            encoding: 'utf-8',
            cwd: options?.cwd ?? process.cwd(),
            timeout: options?.timeout ?? 30000,
            maxBuffer: 10 * 1024 * 1024,
            env: { ...process.env, NO_COLOR: '1' },
        });
        return { stdout: stdout.trim(), stderr: '', exitCode: 0 };
    }
    catch (error) {
        return {
            stdout: error.stdout?.toString().trim() ?? '',
            stderr: error.stderr?.toString().trim() ?? '',
            exitCode: error.status ?? 1,
        };
    }
}
// ---- PluginBundleManager Class ----
export class PluginBundleManager {
    bundlesDir;
    registryFile;
    installedBundles = new Map();
    constructor(bundlesDir) {
        this.bundlesDir = bundlesDir ?? BUNDLES_DIR;
        this.registryFile = REGISTRY_FILE;
        ensureDir(this.bundlesDir);
        this.loadInstalledBundles();
    }
    // ---- Installation ----
    /**
     * Install a plugin bundle from URL, path, or registry
     */
    async installBundle(source) {
        const warnings = [];
        // Determine source type
        if (source.startsWith('http://') || source.startsWith('https://')) {
            return this.installFromURL(source);
        }
        if (source.startsWith('registry:') || !source.includes('/') && !source.includes('\\')) {
            const bundleId = source.replace(/^registry:/, '');
            return this.installFromRegistry(bundleId);
        }
        // Local path
        return this.installFromPath(source, warnings);
    }
    /**
     * Uninstall a plugin bundle
     */
    uninstallBundle(bundleId) {
        const bundle = this.installedBundles.get(bundleId);
        if (!bundle) {
            return { success: false, error: `Bundle "${bundleId}" is not installed` };
        }
        // Remove bundle directory
        try {
            if (existsSync(bundle.installPath)) {
                rmSync(bundle.installPath, { recursive: true, force: true });
            }
        }
        catch (error) {
            return { success: false, error: `Failed to remove bundle files: ${error instanceof Error ? error.message : String(error)}` };
        }
        // Remove from installed bundles
        this.installedBundles.delete(bundleId);
        this.saveInstalledBundles();
        // Run uninstall hooks if present
        this.runLifecycleHook(bundle, 'uninstall');
        return { success: true };
    }
    /**
     * List all installed bundles
     */
    listBundles() {
        return Array.from(this.installedBundles.values()).map(bundle => ({
            id: bundle.manifest.id,
            name: bundle.manifest.name,
            version: bundle.manifest.version,
            description: bundle.manifest.description,
            author: bundle.manifest.author,
            enabled: bundle.enabled,
            source: bundle.source,
        }));
    }
    /**
     * Get bundle details
     */
    getBundleInfo(bundleId) {
        return this.installedBundles.get(bundleId) ?? null;
    }
    /**
     * Update a bundle to the latest version
     */
    async updateBundle(bundleId) {
        const bundle = this.installedBundles.get(bundleId);
        if (!bundle) {
            return { success: false, error: `Bundle "${bundleId}" is not installed` };
        }
        const previousVersion = bundle.manifest.version;
        // Re-install from the original source
        const installResult = await this.installBundle(bundle.source);
        if (!installResult.success) {
            return {
                success: false,
                previousVersion,
                error: installResult.error ?? 'Update failed',
            };
        }
        const newBundle = this.installedBundles.get(bundleId);
        const newVersion = newBundle?.manifest.version ?? previousVersion;
        return {
            success: true,
            previousVersion,
            newVersion,
        };
    }
    /**
     * Validate a bundle before install
     */
    validateBundle(bundlePath) {
        const errors = [];
        const warnings = [];
        // Check path exists
        if (!existsSync(bundlePath)) {
            errors.push({
                code: 'PATH_NOT_FOUND',
                message: `Bundle path does not exist: ${bundlePath}`,
            });
            return { valid: false, errors, warnings };
        }
        // Check manifest exists
        const manifestPath = join(bundlePath, MANIFEST_FILE);
        if (!existsSync(manifestPath)) {
            errors.push({
                code: 'MANIFEST_MISSING',
                message: `No ${MANIFEST_FILE} found in bundle`,
                path: MANIFEST_FILE,
            });
            return { valid: false, errors, warnings };
        }
        // Parse manifest
        let manifest;
        try {
            const raw = JSON.parse(readFileSync(manifestPath, 'utf-8'));
            manifest = raw;
        }
        catch (error) {
            errors.push({
                code: 'MANIFEST_INVALID_JSON',
                message: `Failed to parse ${MANIFEST_FILE}: ${error instanceof Error ? error.message : String(error)}`,
                path: MANIFEST_FILE,
            });
            return { valid: false, errors, warnings };
        }
        // Validate manifest fields
        if (!manifest.id || typeof manifest.id !== 'string') {
            errors.push({
                code: 'MANIFEST_MISSING_ID',
                message: 'Bundle manifest must have a valid "id" field',
                path: MANIFEST_FILE,
            });
        }
        else if (!/^[a-zA-Z0-9_-]+$/.test(manifest.id)) {
            errors.push({
                code: 'MANIFEST_INVALID_ID',
                message: 'Bundle ID must contain only alphanumeric characters, hyphens, and underscores',
                path: MANIFEST_FILE,
            });
        }
        if (!manifest.name || typeof manifest.name !== 'string') {
            errors.push({
                code: 'MANIFEST_MISSING_NAME',
                message: 'Bundle manifest must have a "name" field',
                path: MANIFEST_FILE,
            });
        }
        if (!manifest.version || typeof manifest.version !== 'string') {
            errors.push({
                code: 'MANIFEST_MISSING_VERSION',
                message: 'Bundle manifest must have a "version" field',
                path: MANIFEST_FILE,
            });
        }
        else if (!/^\d+\.\d+\.\d+/.test(manifest.version)) {
            warnings.push({
                code: 'MANIFEST_INVALID_SEMVER',
                message: `Version "${manifest.version}" is not valid semver`,
                path: MANIFEST_FILE,
            });
        }
        if (!manifest.description || typeof manifest.description !== 'string') {
            errors.push({
                code: 'MANIFEST_MISSING_DESCRIPTION',
                message: 'Bundle manifest must have a "description" field',
                path: MANIFEST_FILE,
            });
        }
        if (!manifest.author || typeof manifest.author !== 'string') {
            errors.push({
                code: 'MANIFEST_MISSING_AUTHOR',
                message: 'Bundle manifest must have an "author" field',
                path: MANIFEST_FILE,
            });
        }
        if (!manifest.compatibility?.neuroVersion) {
            warnings.push({
                code: 'MANIFEST_MISSING_COMPATIBILITY',
                message: 'No "compatibility.neuroVersion" specified - bundle may not work with all NeuroCLI versions',
                path: MANIFEST_FILE,
            });
        }
        // Validate referenced files exist
        this.validateBundleReferences(bundlePath, manifest.skills, SKILLS_DIR, errors, warnings);
        this.validateBundleReferences(bundlePath, manifest.hooks, HOOKS_DIR, errors, warnings);
        this.validateBundleReferences(bundlePath, manifest.mcpServers, MCP_DIR, errors, warnings);
        this.validateBundleReferences(bundlePath, manifest.tools, TOOLS_DIR, errors, warnings);
        // Validate permissions
        const validPermissions = [
            'file:read', 'file:write', 'file:delete',
            'bash:execute', 'network:access',
            'env:read', 'env:write',
            'git:access', 'mcp:connect',
        ];
        if (manifest.permissions) {
            for (const perm of manifest.permissions) {
                if (!validPermissions.includes(perm)) {
                    warnings.push({
                        code: 'UNKNOWN_PERMISSION',
                        message: `Unknown permission: "${perm}"`,
                        path: MANIFEST_FILE,
                    });
                }
            }
        }
        // Check for dangerous permissions
        if (manifest.permissions?.includes('bash:execute')) {
            warnings.push({
                code: 'DANGEROUS_PERMISSION',
                message: 'Bundle requests "bash:execute" permission - this allows arbitrary command execution',
                path: MANIFEST_FILE,
            });
        }
        if (manifest.permissions?.includes('network:access')) {
            warnings.push({
                code: 'SENSITIVE_PERMISSION',
                message: 'Bundle requests "network:access" permission - this allows network connections',
                path: MANIFEST_FILE,
            });
        }
        // Check for hooks directory and executable scripts
        const hooksDir = join(bundlePath, HOOKS_DIR);
        if (existsSync(hooksDir)) {
            const hookFiles = readdirSync(hooksDir);
            for (const hookFile of hookFiles) {
                const hookPath = join(hooksDir, hookFile);
                const stat = statSync(hookPath);
                if (stat.isFile() && !(stat.mode & 0o111)) {
                    warnings.push({
                        code: 'HOOK_NOT_EXECUTABLE',
                        message: `Hook script "${hookFile}" is not executable`,
                        path: join(HOOKS_DIR, hookFile),
                    });
                }
            }
        }
        // Check MCP configs are valid JSON
        const mcpDir = join(bundlePath, MCP_DIR);
        if (existsSync(mcpDir)) {
            const mcpFiles = readdirSync(mcpDir).filter(f => f.endsWith('.json'));
            for (const mcpFile of mcpFiles) {
                const mcpPath = join(mcpDir, mcpFile);
                try {
                    JSON.parse(readFileSync(mcpPath, 'utf-8'));
                }
                catch {
                    errors.push({
                        code: 'INVALID_MCP_CONFIG',
                        message: `MCP config "${mcpFile}" is not valid JSON`,
                        path: join(MCP_DIR, mcpFile),
                    });
                }
            }
        }
        return {
            valid: errors.length === 0,
            errors,
            warnings,
            manifest: errors.length === 0 ? manifest : undefined,
        };
    }
    /**
     * Create a new plugin bundle
     */
    createBundle(options) {
        const { outputDir, manifest } = options;
        const bundleDir = join(outputDir, manifest.id);
        try {
            // Create bundle structure
            ensureDir(bundleDir);
            ensureDir(join(bundleDir, SKILLS_DIR));
            ensureDir(join(bundleDir, HOOKS_DIR));
            ensureDir(join(bundleDir, MCP_DIR));
            ensureDir(join(bundleDir, TOOLS_DIR));
            // Write manifest
            const fullManifest = {
                ...manifest,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            };
            writeJSONFile(join(bundleDir, MANIFEST_FILE), fullManifest);
            // Write skills
            if (options.skills) {
                for (const [skillName, content] of Object.entries(options.skills)) {
                    const skillDir = join(bundleDir, SKILLS_DIR, skillName);
                    ensureDir(skillDir);
                    writeFileSync(join(skillDir, 'SKILL.md'), content, 'utf-8');
                }
            }
            // Write hooks
            if (options.hooks) {
                for (const [filename, content] of Object.entries(options.hooks)) {
                    const hookPath = join(bundleDir, HOOKS_DIR, filename);
                    writeFileSync(hookPath, content, 'utf-8');
                    // Make executable
                    try {
                        const stat = statSync(hookPath);
                        chmodSync(hookPath, stat.mode | 0o111);
                    }
                    catch {
                        // Best-effort chmod
                    }
                }
            }
            // Write MCP server configs
            if (options.mcpServers) {
                for (const [filename, config] of Object.entries(options.mcpServers)) {
                    writeJSONFile(join(bundleDir, MCP_DIR, filename), config);
                }
            }
            // Write tools
            if (options.tools) {
                for (const [filename, content] of Object.entries(options.tools)) {
                    writeFileSync(join(bundleDir, TOOLS_DIR, filename), content, 'utf-8');
                }
            }
            return { success: true, path: bundleDir };
        }
        catch (error) {
            return { success: false, error: `Failed to create bundle: ${error instanceof Error ? error.message : String(error)}` };
        }
    }
    /**
     * Publish a bundle to the registry
     */
    publishBundle(bundlePath) {
        // Validate first
        const validation = this.validateBundle(bundlePath);
        if (!validation.valid) {
            return {
                success: false,
                error: `Bundle validation failed: ${validation.errors.map(e => e.message).join('; ')}`,
            };
        }
        const manifest = validation.manifest;
        // Add to local registry
        const registry = this.loadRegistry();
        const checksum = computeDirectoryChecksum(bundlePath);
        const entry = {
            id: manifest.id,
            name: manifest.name,
            version: manifest.version,
            description: manifest.description,
            author: manifest.author,
            url: `local://${bundlePath}`,
            checksum,
            keywords: manifest.keywords,
            downloads: 0,
            updatedAt: new Date().toISOString(),
        };
        // Check if already published
        const existingIndex = registry.findIndex(e => e.id === manifest.id);
        if (existingIndex >= 0) {
            registry[existingIndex] = entry;
        }
        else {
            registry.push(entry);
        }
        this.saveRegistry(registry);
        return { success: true };
    }
    /**
     * Search available bundles
     */
    searchBundles(query) {
        const registry = this.loadRegistry();
        const queryLower = query.toLowerCase();
        const terms = queryLower.split(/\s+/);
        return registry
            .filter(entry => {
            const searchText = [
                entry.id,
                entry.name,
                entry.description,
                entry.author,
                ...(entry.keywords ?? []),
            ]
                .join(' ')
                .toLowerCase();
            return terms.every(term => searchText.includes(term));
        })
            .map(entry => ({
            id: entry.id,
            name: entry.name,
            version: entry.version,
            description: entry.description,
            author: entry.author,
            keywords: entry.keywords,
            downloads: entry.downloads,
            url: entry.url,
        }))
            .sort((a, b) => (b.downloads ?? 0) - (a.downloads ?? 0));
    }
    // ---- Enable / Disable ----
    /**
     * Enable a bundle
     */
    enableBundle(bundleId) {
        const bundle = this.installedBundles.get(bundleId);
        if (!bundle) {
            return { success: false, error: `Bundle "${bundleId}" is not installed` };
        }
        bundle.enabled = true;
        this.saveInstalledBundles();
        // Run install hooks if present
        this.runLifecycleHook(bundle, 'enable');
        return { success: true };
    }
    /**
     * Disable a bundle
     */
    disableBundle(bundleId) {
        const bundle = this.installedBundles.get(bundleId);
        if (!bundle) {
            return { success: false, error: `Bundle "${bundleId}" is not installed` };
        }
        bundle.enabled = false;
        this.saveInstalledBundles();
        this.runLifecycleHook(bundle, 'disable');
        return { success: true };
    }
    // ---- Skill / Hook / MCP Resolution ----
    /**
     * Get all skill paths from enabled bundles
     */
    getBundleSkillPaths() {
        const results = [];
        for (const [bundleId, bundle] of this.installedBundles) {
            if (!bundle.enabled)
                continue;
            for (const skillRef of bundle.manifest.skills) {
                const skillPath = join(bundle.installPath, skillRef);
                if (existsSync(skillPath)) {
                    results.push({
                        bundleId,
                        skillPath,
                        skillName: basename(skillPath),
                    });
                }
            }
        }
        return results;
    }
    /**
     * Get all hook scripts from enabled bundles
     */
    getBundleHooks() {
        const results = [];
        for (const [bundleId, bundle] of this.installedBundles) {
            if (!bundle.enabled)
                continue;
            for (const hookRef of bundle.manifest.hooks) {
                const hookPath = join(bundle.installPath, hookRef);
                if (existsSync(hookPath)) {
                    results.push({
                        bundleId,
                        hookPath,
                        hookName: basename(hookRef),
                    });
                }
            }
        }
        return results;
    }
    /**
     * Get all MCP server configs from enabled bundles
     */
    getBundleMCPServers() {
        const results = [];
        for (const [bundleId, bundle] of this.installedBundles) {
            if (!bundle.enabled)
                continue;
            for (const mcpRef of bundle.manifest.mcpServers) {
                const configPath = join(bundle.installPath, mcpRef);
                if (existsSync(configPath)) {
                    const config = readJSONFile(configPath);
                    if (config) {
                        results.push({
                            bundleId,
                            configPath,
                            configName: basename(mcpRef),
                            config,
                        });
                    }
                }
            }
        }
        return results;
    }
    /**
     * Get all tool scripts from enabled bundles
     */
    getBundleTools() {
        const results = [];
        for (const [bundleId, bundle] of this.installedBundles) {
            if (!bundle.enabled)
                continue;
            for (const toolRef of bundle.manifest.tools) {
                const toolPath = join(bundle.installPath, toolRef);
                if (existsSync(toolPath)) {
                    results.push({
                        bundleId,
                        toolPath,
                        toolName: basename(toolRef, extname(toolRef)),
                    });
                }
            }
        }
        return results;
    }
    // ---- Private: Installation Methods ----
    async installFromPath(sourcePath, warnings) {
        const resolvedPath = resolve(sourcePath);
        // Validate the bundle
        const validation = this.validateBundle(resolvedPath);
        if (!validation.valid) {
            return {
                success: false,
                warnings: validation.warnings.map(w => w.message),
                error: `Validation failed: ${validation.errors.map(e => e.message).join('; ')}`,
            };
        }
        warnings.push(...validation.warnings.map(w => w.message));
        const manifest = validation.manifest;
        // Check if already installed
        const existing = this.installedBundles.get(manifest.id);
        if (existing) {
            // Uninstall old version
            this.uninstallBundle(manifest.id);
        }
        // Copy bundle to install directory
        const installPath = join(this.bundlesDir, manifest.id);
        try {
            if (existsSync(installPath)) {
                rmSync(installPath, { recursive: true, force: true });
            }
            copyRecursive(resolvedPath, installPath);
        }
        catch (error) {
            return {
                success: false,
                warnings,
                error: `Failed to copy bundle: ${error instanceof Error ? error.message : String(error)}`,
            };
        }
        // Compute checksum
        const checksum = computeDirectoryChecksum(installPath);
        // Create bundle record
        const bundle = {
            manifest,
            installPath,
            installedAt: new Date().toISOString(),
            source: resolvedPath,
            checksum,
            enabled: true,
        };
        // Run install hooks
        this.runLifecycleHook(bundle, 'install');
        // Save
        this.installedBundles.set(manifest.id, bundle);
        this.saveInstalledBundles();
        return { success: true, bundle, warnings };
    }
    async installFromURL(url) {
        // Download the bundle
        const tempDir = join(this.bundlesDir, '.temp', `download_${Date.now()}`);
        ensureDir(tempDir);
        try {
            // Use curl or wget to download
            const isTarball = url.endsWith('.tar.gz') || url.endsWith('.tgz');
            const isZip = url.endsWith('.zip');
            const downloadPath = join(tempDir, isTarball ? 'bundle.tar.gz' : isZip ? 'bundle.zip' : 'bundle.tar.gz');
            const downloadResult = execCommand(`curl -fsSL -o "${downloadPath}" "${url}"`, { timeout: 60000 });
            if (downloadResult.exitCode !== 0) {
                return {
                    success: false,
                    error: `Failed to download bundle from ${url}: ${downloadResult.stderr}`,
                };
            }
            // Extract
            const extractDir = join(tempDir, 'extracted');
            ensureDir(extractDir);
            if (isTarball) {
                const extractResult = execCommand(`tar -xzf "${downloadPath}" -C "${extractDir}"`);
                if (extractResult.exitCode !== 0) {
                    return { success: false, error: `Failed to extract tarball: ${extractResult.stderr}` };
                }
            }
            else if (isZip) {
                const extractResult = execCommand(`unzip -q -o "${downloadPath}" -d "${extractDir}"`);
                if (extractResult.exitCode !== 0) {
                    return { success: false, error: `Failed to extract zip: ${extractResult.stderr}` };
                }
            }
            else {
                // Try tarball by default
                const extractResult = execCommand(`tar -xzf "${downloadPath}" -C "${extractDir}"`);
                if (extractResult.exitCode !== 0) {
                    return { success: false, error: `Failed to extract archive: ${extractResult.stderr}` };
                }
            }
            // Find the bundle.json in the extracted directory
            const bundlePath = this.findBundleRoot(extractDir);
            if (!bundlePath) {
                return { success: false, error: `No ${MANIFEST_FILE} found in downloaded archive` };
            }
            // Install from the extracted path
            const result = await this.installFromPath(bundlePath, []);
            // Cleanup temp
            try {
                rmSync(tempDir, { recursive: true, force: true });
            }
            catch {
                // Best-effort cleanup
            }
            // Update source URL in installed bundle
            if (result.success && result.bundle) {
                result.bundle.source = url;
                this.installedBundles.set(result.bundle.manifest.id, result.bundle);
                this.saveInstalledBundles();
            }
            return result;
        }
        catch (error) {
            // Cleanup temp
            try {
                rmSync(tempDir, { recursive: true, force: true });
            }
            catch { }
            return {
                success: false,
                error: `Failed to install from URL: ${error instanceof Error ? error.message : String(error)}`,
            };
        }
    }
    async installFromRegistry(bundleId) {
        const registry = this.loadRegistry();
        const entry = registry.find(e => e.id === bundleId);
        if (!entry) {
            return { success: false, error: `Bundle "${bundleId}" not found in registry` };
        }
        // If it's a local path reference
        if (entry.url.startsWith('local://')) {
            const localPath = entry.url.replace('local://', '');
            return this.installFromPath(localPath, []);
        }
        // Install from URL
        return this.installFromURL(entry.url);
    }
    // ---- Private: Helper Methods ----
    findBundleRoot(searchDir) {
        // Check if bundle.json is at the root
        if (existsSync(join(searchDir, MANIFEST_FILE))) {
            return searchDir;
        }
        // Check one level down (common for GitHub archives)
        try {
            const entries = readdirSync(searchDir, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isDirectory()) {
                    const subDir = join(searchDir, entry.name);
                    if (existsSync(join(subDir, MANIFEST_FILE))) {
                        return subDir;
                    }
                }
            }
        }
        catch {
            // Ignore
        }
        return null;
    }
    validateBundleReferences(bundlePath, references, expectedDir, errors, warnings) {
        if (!references || references.length === 0)
            return;
        for (const ref of references) {
            const fullPath = join(bundlePath, ref);
            if (!existsSync(fullPath)) {
                // Check if it exists in the expected directory
                const altPath = join(bundlePath, expectedDir, basename(ref));
                if (existsSync(altPath)) {
                    warnings.push({
                        code: 'REFERENCE_PATH_MISMATCH',
                        message: `Referenced file "${ref}" not found at declared path, but exists at "${expectedDir}/${basename(ref)}"`,
                        path: ref,
                    });
                }
                else {
                    errors.push({
                        code: 'REFERENCE_FILE_MISSING',
                        message: `Referenced file "${ref}" does not exist in bundle`,
                        path: ref,
                    });
                }
            }
        }
    }
    runLifecycleHook(bundle, lifecycle) {
        const hooksDir = join(bundle.installPath, HOOKS_DIR);
        if (!existsSync(hooksDir))
            return;
        try {
            const hookFiles = readdirSync(hooksDir);
            for (const hookFile of hookFiles) {
                // Check if the hook file name contains the lifecycle event
                const hookName = hookFile.toLowerCase();
                if (hookName.includes(lifecycle)) {
                    const hookPath = join(hooksDir, hookFile);
                    const stat = statSync(hookPath);
                    if (stat.isFile()) {
                        try {
                            execCommand(`"${hookPath}"`, {
                                cwd: bundle.installPath,
                                timeout: 30000,
                            });
                        }
                        catch {
                            // Hook execution failure should not block operations
                        }
                    }
                }
            }
        }
        catch {
            // Ignore hook execution errors
        }
    }
    // ---- Persistence ----
    loadInstalledBundles() {
        const indexFile = join(this.bundlesDir, 'installed.json');
        const data = readJSONFile(indexFile);
        if (!data)
            return;
        for (const entry of data) {
            const manifestPath = join(this.bundlesDir, entry.id, MANIFEST_FILE);
            const manifest = readJSONFile(manifestPath);
            if (manifest) {
                this.installedBundles.set(entry.id, {
                    manifest,
                    installPath: join(this.bundlesDir, entry.id),
                    installedAt: entry.installedAt,
                    source: entry.source,
                    checksum: entry.checksum,
                    enabled: entry.enabled,
                });
            }
        }
    }
    saveInstalledBundles() {
        const indexFile = join(this.bundlesDir, 'installed.json');
        const data = Array.from(this.installedBundles.values()).map(bundle => ({
            id: bundle.manifest.id,
            source: bundle.source,
            installedAt: bundle.installedAt,
            checksum: bundle.checksum,
            enabled: bundle.enabled,
        }));
        writeJSONFile(indexFile, data);
    }
    loadRegistry() {
        return readJSONFile(this.registryFile) ?? [];
    }
    saveRegistry(registry) {
        writeJSONFile(this.registryFile, registry);
    }
}
// ---- chmodSync polyfill (Node.js built-in, but let's be safe) ----
function chmodSync(path, mode) {
    try {
        const { chmodSync: nodeChmod } = require('fs');
        nodeChmod(path, mode);
    }
    catch {
        // Ignore on platforms that don't support chmod
    }
}
//# sourceMappingURL=plugin-bundle.js.map
export interface BundleManifest {
    /** Unique bundle identifier */
    id: string;
    /** Human-readable bundle name */
    name: string;
    /** Semantic version */
    version: string;
    /** Bundle description */
    description: string;
    /** Author name or organization */
    author: string;
    /** List of skill directories (relative paths) */
    skills: string[];
    /** List of hook scripts (relative paths) */
    hooks: string[];
    /** List of MCP server config files (relative paths) */
    mcpServers: string[];
    /** List of custom tool scripts (relative paths) */
    tools: string[];
    /** Runtime dependencies */
    dependencies: Record<string, string>;
    /** Required permissions */
    permissions: BundlePermission[];
    /** Compatibility constraints */
    compatibility: {
        neuroVersion: string;
    };
    /** Bundle homepage or repository URL */
    homepage?: string;
    /** License identifier */
    license?: string;
    /** Keywords for search */
    keywords?: string[];
    /** Bundle entry point (optional) */
    entry?: string;
    /** Creation timestamp */
    createdAt?: string;
    /** Last update timestamp */
    updatedAt?: string;
}
export type BundlePermission = 'file:read' | 'file:write' | 'file:delete' | 'bash:execute' | 'network:access' | 'env:read' | 'env:write' | 'git:access' | 'mcp:connect';
export interface PluginBundle {
    manifest: BundleManifest;
    /** Absolute path to the installed bundle */
    installPath: string;
    /** Installation timestamp */
    installedAt: string;
    /** Source URL or path */
    source: string;
    /** Integrity hash of the bundle */
    checksum: string;
    /** Whether the bundle is currently enabled */
    enabled: boolean;
}
export interface BundleInstallResult {
    success: boolean;
    bundle?: PluginBundle;
    warnings?: string[];
    error?: string;
}
export interface BundleValidationResult {
    valid: boolean;
    errors: BundleValidationError[];
    warnings: BundleValidationWarning[];
    manifest?: BundleManifest;
}
export interface BundleValidationError {
    code: string;
    message: string;
    path?: string;
}
export interface BundleValidationWarning {
    code: string;
    message: string;
    path?: string;
}
export interface CreateBundleOptions {
    /** Output directory for the bundle */
    outputDir: string;
    /** Bundle manifest data */
    manifest: Omit<BundleManifest, 'createdAt' | 'updatedAt'>;
    /** Skill content map: skillName -> SKILL.md content */
    skills?: Record<string, string>;
    /** Hook content map: filename -> script content */
    hooks?: Record<string, string>;
    /** MCP server config map: filename -> JSON content */
    mcpServers?: Record<string, Record<string, unknown>>;
    /** Tool script map: filename -> script content */
    tools?: Record<string, string>;
}
export interface BundleSearchResult {
    id: string;
    name: string;
    version: string;
    description: string;
    author: string;
    keywords?: string[];
    downloads?: number;
    url: string;
}
export interface BundleUpdateResult {
    success: boolean;
    previousVersion?: string;
    newVersion?: string;
    error?: string;
}
export interface BundleRegistryEntry {
    id: string;
    name: string;
    version: string;
    description: string;
    author: string;
    url: string;
    checksum: string;
    keywords?: string[];
    downloads: number;
    updatedAt: string;
}
export declare class PluginBundleManager {
    private bundlesDir;
    private registryFile;
    private installedBundles;
    constructor(bundlesDir?: string);
    /**
     * Install a plugin bundle from URL, path, or registry
     */
    installBundle(source: string): Promise<BundleInstallResult>;
    /**
     * Uninstall a plugin bundle
     */
    uninstallBundle(bundleId: string): {
        success: boolean;
        error?: string;
    };
    /**
     * List all installed bundles
     */
    listBundles(): Array<{
        id: string;
        name: string;
        version: string;
        description: string;
        author: string;
        enabled: boolean;
        source: string;
    }>;
    /**
     * Get bundle details
     */
    getBundleInfo(bundleId: string): PluginBundle | null;
    /**
     * Update a bundle to the latest version
     */
    updateBundle(bundleId: string): Promise<BundleUpdateResult>;
    /**
     * Validate a bundle before install
     */
    validateBundle(bundlePath: string): BundleValidationResult;
    /**
     * Create a new plugin bundle
     */
    createBundle(options: CreateBundleOptions): {
        success: boolean;
        path?: string;
        error?: string;
    };
    /**
     * Publish a bundle to the registry
     */
    publishBundle(bundlePath: string): {
        success: boolean;
        error?: string;
    };
    /**
     * Search available bundles
     */
    searchBundles(query: string): BundleSearchResult[];
    /**
     * Enable a bundle
     */
    enableBundle(bundleId: string): {
        success: boolean;
        error?: string;
    };
    /**
     * Disable a bundle
     */
    disableBundle(bundleId: string): {
        success: boolean;
        error?: string;
    };
    /**
     * Get all skill paths from enabled bundles
     */
    getBundleSkillPaths(): Array<{
        bundleId: string;
        skillPath: string;
        skillName: string;
    }>;
    /**
     * Get all hook scripts from enabled bundles
     */
    getBundleHooks(): Array<{
        bundleId: string;
        hookPath: string;
        hookName: string;
    }>;
    /**
     * Get all MCP server configs from enabled bundles
     */
    getBundleMCPServers(): Array<{
        bundleId: string;
        configPath: string;
        configName: string;
        config: Record<string, unknown>;
    }>;
    /**
     * Get all tool scripts from enabled bundles
     */
    getBundleTools(): Array<{
        bundleId: string;
        toolPath: string;
        toolName: string;
    }>;
    private installFromPath;
    private installFromURL;
    private installFromRegistry;
    private findBundleRoot;
    private validateBundleReferences;
    private runLifecycleHook;
    private loadInstalledBundles;
    private saveInstalledBundles;
    private loadRegistry;
    private saveRegistry;
}
//# sourceMappingURL=plugin-bundle.d.ts.map
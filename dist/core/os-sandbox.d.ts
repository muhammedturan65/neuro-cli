export interface OSSandboxConfig {
    type: 'docker' | 'os-native' | 'hybrid';
    docker?: {
        image: string;
        mountProject: boolean;
        mountMode: 'ro' | 'rw';
        networkMode: 'none' | 'limited' | 'bridge';
        allowedDomains: string[];
        memory: string;
        cpus: number;
        timeout: number;
    };
    network?: {
        mode: 'open' | 'filtered' | 'blocked';
        allowedDomains: string[];
        allowedPorts: number[];
        blockPrivateNetworks: boolean;
    };
    filesystem?: {
        readOnlyPaths: string[];
        readWritePaths: string[];
        deniedPaths: string[];
        allowHiddenFiles: boolean;
    };
    commands?: {
        blockedCommands: string[];
        allowedPrefixes: string[];
        maxArgLength: number;
        allowPipes: boolean;
        allowBackground: boolean;
    };
}
export interface NetworkAccessEntry {
    timestamp: number;
    host: string;
    port: number;
    protocol: string;
    action: 'allowed' | 'blocked';
    reason?: string;
}
export interface FileAccessEntry {
    timestamp: number;
    path: string;
    mode: 'read' | 'write' | 'delete';
    action: 'allowed' | 'blocked';
    reason?: string;
}
export interface AuditLogEntry {
    timestamp: number;
    category: 'command' | 'network' | 'filesystem' | 'container' | 'config';
    action: string;
    detail: string;
    allowed: boolean;
    reason?: string;
}
export interface ExecOptions {
    cwd?: string;
    env?: Record<string, string>;
    timeout?: number;
    stdin?: string;
}
export interface SandboxResult {
    stdout: string;
    stderr: string;
    exitCode: number;
    networkAccessLog: NetworkAccessEntry[];
    fileAccessLog: FileAccessEntry[];
    duration: number;
    timedOut: boolean;
}
export declare const DEFAULT_OS_SANDBOX_CONFIG: OSSandboxConfig;
export declare class OSSandboxManager {
    private config;
    private networkPolicy;
    private commandFilter;
    private filesystemPolicy;
    private auditLog;
    private dockerAvailable;
    private sandboxImageBuilt;
    private activeContainers;
    private projectDir;
    constructor(config?: Partial<OSSandboxConfig>);
    isDockerAvailable(): Promise<boolean>;
    isNativeSandboxAvailable(): boolean;
    execute(command: string, options?: ExecOptions): Promise<SandboxResult>;
    createContainer(): Promise<string>;
    stopContainer(id: string): Promise<void>;
    validateCommand(command: string): {
        allowed: boolean;
        reason?: string;
    };
    validatePath(path: string, mode: 'read' | 'write'): {
        allowed: boolean;
        reason?: string;
    };
    validateNetwork(host: string, port: number): {
        allowed: boolean;
        reason?: string;
    };
    getAuditLog(): AuditLogEntry[];
    clearAuditLog(): void;
    cleanup(): Promise<void>;
    printStatus(): void;
    private mergeConfig;
    private addAuditLog;
    private executeInDocker;
    private executeNative;
    private executeLinuxSandbox;
    private executeMacOSSandbox;
    private executeFiltered;
    private ensureSandboxImage;
    private applyContainerNetworkRules;
    private truncateOutput;
}
export declare function createOSSandboxManager(config?: Partial<OSSandboxConfig>, projectDir?: string): OSSandboxManager;
export declare function checkSandboxCapabilities(): Promise<{
    docker: boolean;
    nativeSandbox: boolean;
    platform: string;
    recommendedType: OSSandboxConfig['type'];
}>;
//# sourceMappingURL=os-sandbox.d.ts.map
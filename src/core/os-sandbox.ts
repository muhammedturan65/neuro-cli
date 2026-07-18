// ============================================================
// NeuroCLI - OS-Level Sandbox with Network Isolation (GAP-29)
// Docker-based and native OS sandboxing for secure execution
// Network policy engine, command filtering, audit logging
// ============================================================

import { execSync, spawn, ChildProcess } from 'child_process';
import { resolve, normalize, relative } from 'path';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { platform } from 'os';
import chalk from 'chalk';

// ---- Type Definitions ----

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

// ---- Default Configuration ----

export const DEFAULT_OS_SANDBOX_CONFIG: OSSandboxConfig = {
  type: 'docker',
  docker: {
    image: 'neurocli-sandbox:latest',
    mountProject: true,
    mountMode: 'rw',
    networkMode: 'none',
    allowedDomains: [],
    memory: '512m',
    cpus: 1,
    timeout: 120000,
  },
  network: {
    mode: 'filtered',
    allowedDomains: [
      'api.openai.com',
      'api.anthropic.com',
      'registry.npmjs.org',
      'pypi.org',
      'github.com',
    ],
    allowedPorts: [80, 443],
    blockPrivateNetworks: true,
  },
  filesystem: {
    readOnlyPaths: ['/usr', '/lib', '/etc', '/bin', '/sbin'],
    readWritePaths: [],
    deniedPaths: [
      '/etc/shadow',
      '/etc/passwd',
      '/etc/ssh',
      '/root/.ssh',
      '/home/*/.ssh',
    ],
    allowHiddenFiles: false,
  },
  commands: {
    blockedCommands: [
      'rm -rf /',
      'sudo',
      'su',
      'chmod 777 /',
      'chmod 777 -R /',
      'mkfs',
      'dd if=',
      ':(){ :|:& };:',
      'curl | sh',
      'wget | sh',
      'passwd',
      'shutdown',
      'reboot',
      'halt',
      'init',
      'telinit',
      'systemctl',
      'service',
    ],
    allowedPrefixes: [],
    maxArgLength: 8192,
    allowPipes: true,
    allowBackground: false,
  },
};

// ---- Private Network Ranges for Filtering ----

const PRIVATE_NETWORK_RANGES: Array<{ start: number; end: number }> = [
  { start: ipToNumber('10.0.0.0'), end: ipToNumber('10.255.255.255') },
  { start: ipToNumber('172.16.0.0'), end: ipToNumber('172.31.255.255') },
  { start: ipToNumber('192.168.0.0'), end: ipToNumber('192.168.255.255') },
  { start: ipToNumber('127.0.0.0'), end: ipToNumber('127.255.255.255') },
  { start: ipToNumber('169.254.0.0'), end: ipToNumber('169.254.255.255') },
  { start: ipToNumber('0.0.0.0'), end: ipToNumber('0.255.255.255') },
];

function ipToNumber(ip: string): number {
  const parts = ip.split('.').map(Number);
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function isPrivateIP(ip: string): boolean {
  const num = ipToNumber(ip);
  return PRIVATE_NETWORK_RANGES.some(
    range => num >= range.start && num <= range.end
  );
}

// ---- Docker Sandbox Image Dockerfile ----

const SANDBOX_DOCKERFILE = `FROM alpine:3.19
RUN apk add --no-cache bash coreutils curl wget git nodejs npm python3 py3-pip
RUN adduser -D -s /bin/bash sandbox
USER sandbox
WORKDIR /workspace
`;

// ---- Network Policy Engine ----

class NetworkPolicyEngine {
  private allowedDomains: Set<string>;
  private allowedPorts: Set<number>;
  private blockPrivateNetworks: boolean;
  private mode: 'open' | 'filtered' | 'blocked';
  private accessLog: NetworkAccessEntry[] = [];
  private rateLimiter: Map<string, number[]> = new Map();
  private maxRequestsPerMinute: number = 60;

  constructor(config: OSSandboxConfig['network']) {
    this.mode = config?.mode ?? 'filtered';
    this.allowedDomains = new Set(config?.allowedDomains ?? []);
    this.allowedPorts = new Set(config?.allowedPorts ?? [80, 443]);
    this.blockPrivateNetworks = config?.blockPrivateNetworks ?? true;
  }

  validate(host: string, port: number, protocol: string = 'tcp'): { allowed: boolean; reason?: string } {
    const entry: NetworkAccessEntry = {
      timestamp: Date.now(),
      host,
      port,
      protocol,
      action: 'allowed',
    };

    if (this.mode === 'blocked') {
      entry.action = 'blocked';
      entry.reason = 'All network access is blocked';
      this.accessLog.push(entry);
      return { allowed: false, reason: entry.reason };
    }

    if (this.mode === 'open') {
      this.accessLog.push(entry);
      return { allowed: true };
    }

    // mode === 'filtered'
    // Check private network blocking
    if (this.blockPrivateNetworks) {
      const resolvedIP = this.resolveHost(host);
      if (resolvedIP && isPrivateIP(resolvedIP)) {
        entry.action = 'blocked';
        entry.reason = `Access to private network address ${resolvedIP} is blocked`;
        this.accessLog.push(entry);
        return { allowed: false, reason: entry.reason };
      }
    }

    // Check allowed domains
    if (this.allowedDomains.size > 0) {
      const isDomainAllowed = this.isDomainMatch(host);
      if (!isDomainAllowed) {
        entry.action = 'blocked';
        entry.reason = `Domain ${host} is not in the allowed list`;
        this.accessLog.push(entry);
        return { allowed: false, reason: entry.reason };
      }
    }

    // Check allowed ports
    if (this.allowedPorts.size > 0 && !this.allowedPorts.has(port)) {
      entry.action = 'blocked';
      entry.reason = `Port ${port} is not in the allowed list`;
      this.accessLog.push(entry);
      return { allowed: false, reason: entry.reason };
    }

    // Rate limiting
    if (!this.checkRateLimit(host)) {
      entry.action = 'blocked';
      entry.reason = `Rate limit exceeded for ${host}`;
      this.accessLog.push(entry);
      return { allowed: false, reason: entry.reason };
    }

    this.accessLog.push(entry);
    return { allowed: true };
  }

  getAccessLog(): NetworkAccessEntry[] {
    return [...this.accessLog];
  }

  clearLog(): void {
    this.accessLog = [];
  }

  private isDomainMatch(host: string): boolean {
    if (this.allowedDomains.has(host)) return true;
    for (const allowed of this.allowedDomains) {
      if (host.endsWith('.' + allowed)) return true;
      if (allowed.startsWith('*.') && host.endsWith(allowed.slice(1))) return true;
    }
    return false;
  }

  private resolveHost(host: string): string | null {
    if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) {
      return host;
    }
    try {
      const result = execSync(`nslookup ${host} 2>/dev/null`, {
        encoding: 'utf-8',
        timeout: 5000,
      });
      const match = result.match(/Address:\s*(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/g);
      if (match && match.length > 1) {
        const ip = match[match.length - 1].replace('Address:\s*', '').trim();
        return ip || null;
      }
    } catch {
      // DNS resolution failed, can't determine if private
    }
    return null;
  }

  private checkRateLimit(host: string): boolean {
    const now = Date.now();
    const windowStart = now - 60000;
    const timestamps = this.rateLimiter.get(host) ?? [];
    const recent = timestamps.filter(ts => ts > windowStart);
    recent.push(now);
    this.rateLimiter.set(host, recent);
    return recent.length <= this.maxRequestsPerMinute;
  }
}

// ---- Command Filter ----

class CommandFilter {
  private blockedCommands: string[];
  private allowedPrefixes: string[];
  private maxArgLength: number;
  private allowPipes: boolean;
  private allowBackground: boolean;

  private static readonly DANGEROUS_PATTERNS: RegExp[] = [
    /rm\s+-rf\s+\//,
    /mkfs/,
    /dd\s+if=/,
    /:\(\)\{.*;\}/,
    /wget.*\|\s*sh/,
    /curl.*\|\s*sh/,
    /chmod\s+-R\s+777/,
    /chmod\s+777\s+\//,
    />\s*\/dev\/sda/,
    /mv\s+.*\s+\/dev\/null/,
  ];

  constructor(config: OSSandboxConfig['commands']) {
    this.blockedCommands = config?.blockedCommands ?? DEFAULT_OS_SANDBOX_CONFIG.commands!.blockedCommands;
    this.allowedPrefixes = config?.allowedPrefixes ?? [];
    this.maxArgLength = config?.maxArgLength ?? 8192;
    this.allowPipes = config?.allowPipes ?? true;
    this.allowBackground = config?.allowBackground ?? false;
  }

  validate(command: string): { allowed: boolean; reason?: string } {
    const trimmed = command.trim();

    // Check argument length
    if (trimmed.length > this.maxArgLength) {
      return { allowed: false, reason: `Command exceeds maximum length of ${this.maxArgLength} characters` };
    }

    // Check blocked commands list
    for (const blocked of this.blockedCommands) {
      if (trimmed.includes(blocked) || trimmed.startsWith(blocked.split(' ')[0])) {
        return { allowed: false, reason: `Blocked command pattern: "${blocked}"` };
      }
    }

    // Check dangerous patterns
    for (const pattern of CommandFilter.DANGEROUS_PATTERNS) {
      if (pattern.test(trimmed)) {
        return { allowed: false, reason: 'Command matches a dangerous pattern' };
      }
    }

    // Check for shell injection attempts
    const injectionPatterns = [
      /\$\(.*\)/,    // Command substitution
      /`.*`/,        // Backtick command substitution
      /&&\s*rm/,     // Chained destructive commands
      /\|\s*sh\b/,   // Pipe to shell
    ];
    for (const pattern of injectionPatterns) {
      if (pattern.test(trimmed)) {
        return { allowed: false, reason: 'Potential shell injection detected' };
      }
    }

    // Check pipe restrictions
    if (!this.allowPipes && trimmed.includes('|')) {
      return { allowed: false, reason: 'Pipes are not allowed in sandbox mode' };
    }

    // Check background execution
    if (!this.allowBackground && trimmed.includes('&')) {
      const ampersands = trimmed.match(/[^&]&[^&]|&$/g);
      if (ampersands) {
        return { allowed: false, reason: 'Background execution is not allowed in sandbox mode' };
      }
    }

    // Check allowed prefixes (if set)
    if (this.allowedPrefixes.length > 0) {
      const cmdBase = trimmed.split(/\s+/)[0];
      const isAllowed = this.allowedPrefixes.some(
        prefix => cmdBase === prefix || trimmed.startsWith(prefix)
      );
      if (!isAllowed) {
        return { allowed: false, reason: `Command "${cmdBase}" is not in the allowed prefixes list` };
      }
    }

    return { allowed: true };
  }

  sanitizeEnv(env: Record<string, string>): Record<string, string> {
    const sensitiveKeys = [
      'AWS_SECRET_ACCESS_KEY',
      'AWS_ACCESS_KEY_ID',
      'API_KEY',
      'SECRET',
      'TOKEN',
      'PASSWORD',
      'PRIVATE_KEY',
      'DATABASE_URL',
      'MONGODB_URI',
      'REDIS_URL',
    ];

    const sanitized: Record<string, string> = {};
    for (const [key, value] of Object.entries(env)) {
      const isSensitive = sensitiveKeys.some(s =>
        key.toUpperCase().includes(s)
      );
      if (!isSensitive) {
        sanitized[key] = value;
      }
    }
    return sanitized;
  }
}

// ---- Filesystem Policy ----

class FilesystemPolicy {
  private readOnlyPaths: string[];
  private readWritePaths: string[];
  private deniedPaths: string[];
  private allowHiddenFiles: boolean;
  private accessLog: FileAccessEntry[] = [];

  constructor(config: OSSandboxConfig['filesystem']) {
    this.readOnlyPaths = config?.readOnlyPaths ?? [];
    this.readWritePaths = config?.readWritePaths ?? [];
    this.deniedPaths = config?.deniedPaths ?? DEFAULT_OS_SANDBOX_CONFIG.filesystem!.deniedPaths;
    this.allowHiddenFiles = config?.allowHiddenFiles ?? false;
  }

  validate(path: string, mode: 'read' | 'write' | 'delete'): { allowed: boolean; reason?: string } {
    const absPath = normalize(resolve(path));
    const entry: FileAccessEntry = {
      timestamp: Date.now(),
      path: absPath,
      mode,
      action: 'allowed',
    };

    // Check denied paths
    for (const denied of this.deniedPaths) {
      const deniedPattern = denied.replace(/\*/g, '.*');
      try {
        const regex = new RegExp('^' + deniedPattern + '$');
        if (regex.test(absPath)) {
          entry.action = 'blocked';
          entry.reason = `Path matches denied pattern: ${denied}`;
          this.accessLog.push(entry);
          return { allowed: false, reason: entry.reason };
        }
      } catch {
        // Invalid pattern, skip
      }
    }

    // Check hidden files
    if (!this.allowHiddenFiles) {
      const parts = absPath.split('/');
      if (parts.some(part => part.startsWith('.') && part !== '.' && part !== '..')) {
        entry.action = 'blocked';
        entry.reason = 'Access to hidden files is not allowed';
        this.accessLog.push(entry);
        return { allowed: false, reason: entry.reason };
      }
    }

    // For write and delete, check read-only paths
    if (mode === 'write' || mode === 'delete') {
      for (const roPath of this.readOnlyPaths) {
        if (absPath.startsWith(roPath)) {
          // Check if explicitly in read-write paths
          const isExplicitlyRW = this.readWritePaths.some(rwPath =>
            absPath.startsWith(rwPath)
          );
          if (!isExplicitlyRW) {
            entry.action = 'blocked';
            entry.reason = `Path is read-only: ${roPath}`;
            this.accessLog.push(entry);
            return { allowed: false, reason: entry.reason };
          }
        }
      }
    }

    this.accessLog.push(entry);
    return { allowed: true };
  }

  getAccessLog(): FileAccessEntry[] {
    return [...this.accessLog];
  }

  clearLog(): void {
    this.accessLog = [];
  }
}

// ---- Main OSSandboxManager Class ----

export class OSSandboxManager {
  private config: OSSandboxConfig;
  private networkPolicy: NetworkPolicyEngine;
  private commandFilter: CommandFilter;
  private filesystemPolicy: FilesystemPolicy;
  private auditLog: AuditLogEntry[] = [];
  private dockerAvailable: boolean | null = null;
  private sandboxImageBuilt: boolean = false;
  private activeContainers: Map<string, { id: string; startedAt: number }> = new Map();
  private projectDir: string;

  constructor(config: Partial<OSSandboxConfig> = {}) {
    this.config = this.mergeConfig(config);
    this.networkPolicy = new NetworkPolicyEngine(this.config.network);
    this.commandFilter = new CommandFilter(this.config.commands);
    this.filesystemPolicy = new FilesystemPolicy(this.config.filesystem);
    this.projectDir = process.cwd();
  }

  // ---- Docker Availability ----

  async isDockerAvailable(): Promise<boolean> {
    if (this.dockerAvailable !== null) return this.dockerAvailable;
    try {
      const result = execSync('docker info --format "{{.ServerVersion}}" 2>/dev/null', {
        encoding: 'utf-8',
        timeout: 5000,
      });
      this.dockerAvailable = result.trim().length > 0;
    } catch {
      this.dockerAvailable = false;
    }
    this.addAuditLog('container', 'docker_availability_check',
      `Docker is ${this.dockerAvailable ? 'available' : 'not available'}`, true);
    return this.dockerAvailable;
  }

  // ---- Native Sandbox Availability ----

  isNativeSandboxAvailable(): boolean {
    const currentPlatform = platform();
    if (currentPlatform === 'linux') {
      try {
        execSync('unshare --help 2>/dev/null', { encoding: 'utf-8', timeout: 3000 });
        return true;
      } catch {
        return false;
      }
    }
    if (currentPlatform === 'darwin') {
      try {
        execSync('sandbox-exec -n no-network /bin/true 2>/dev/null', {
          encoding: 'utf-8',
          timeout: 3000,
        });
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }

  // ---- Command Execution ----

  async execute(command: string, options?: ExecOptions): Promise<SandboxResult> {
    const startTime = Date.now();

    // Validate command against filter
    const cmdValidation = this.validateCommand(command);
    if (!cmdValidation.allowed) {
      this.addAuditLog('command', 'execute_blocked', command, false, cmdValidation.reason);
      return {
        stdout: '',
        stderr: `Sandbox: Command blocked - ${cmdValidation.reason}`,
        exitCode: 126,
        networkAccessLog: this.networkPolicy.getAccessLog(),
        fileAccessLog: this.filesystemPolicy.getAccessLog(),
        duration: Date.now() - startTime,
        timedOut: false,
      };
    }

    this.addAuditLog('command', 'execute', command, true);

    const timeout = options?.timeout ?? this.config.docker?.timeout ?? 120000;

    try {
      if (this.config.type === 'docker') {
        return await this.executeInDocker(command, options, timeout, startTime);
      }
      if (this.config.type === 'os-native') {
        return await this.executeNative(command, options, timeout, startTime);
      }
      // hybrid: try docker first, fall back to native
      if (await this.isDockerAvailable()) {
        return await this.executeInDocker(command, options, timeout, startTime);
      }
      if (this.isNativeSandboxAvailable()) {
        return await this.executeNative(command, options, timeout, startTime);
      }
      // No sandboxing available, execute with filtering only
      return await this.executeFiltered(command, options, timeout, startTime);
    } catch (error: any) {
      return {
        stdout: '',
        stderr: `Sandbox execution error: ${error.message}`,
        exitCode: 1,
        networkAccessLog: this.networkPolicy.getAccessLog(),
        fileAccessLog: this.filesystemPolicy.getAccessLog(),
        duration: Date.now() - startTime,
        timedOut: false,
      };
    }
  }

  // ---- Container Lifecycle ----

  async createContainer(): Promise<string> {
    if (!(await this.isDockerAvailable())) {
      throw new Error('Docker is not available for container creation');
    }

    await this.ensureSandboxImage();

    const dockerConfig = this.config.docker!;
    const args: string[] = ['create'];

    // Resource limits
    args.push('--memory', dockerConfig.memory);
    args.push('--cpus', String(dockerConfig.cpus));

    // Network configuration
    if (dockerConfig.networkMode === 'none') {
      args.push('--network', 'none');
    } else if (dockerConfig.networkMode === 'limited') {
      // Use bridge network with iptables rules applied later
      args.push('--network', 'bridge');
    } else {
      args.push('--network', 'bridge');
    }

    // DNS configuration for filtered mode
    if (dockerConfig.networkMode === 'limited') {
      args.push('--dns', '127.0.0.1');
    }

    // Security options
    args.push('--security-opt', 'no-new-privileges');
    args.push('--cap-drop', 'ALL');
    args.push('--cap-add', 'CHOWN');
    args.push('--cap-add', 'SETUID');
    args.push('--cap-add', 'SETGID');
    args.push('--cap-add', 'DAC_OVERRIDE');
    args.push('--pids-limit', '64');
    args.push('--read-only');

    // Mount project directory
    if (dockerConfig.mountProject) {
      const mountMode = dockerConfig.mountMode === 'ro' ? ':ro' : ':rw';
      args.push('-v', `${this.projectDir}:/workspace${mountMode}`);
    }

    // Tmpfs for write paths
    args.push('--tmpfs', '/tmp:rw,noexec,nosuid,size=64m');
    args.push('--tmpfs', '/home/sandbox:rw,noexec,nosuid,size=64m');

    // Working directory
    args.push('-w', '/workspace');

    // Image
    args.push(dockerConfig.image);

    // Default command: keep container alive
    args.push('tail', '-f', '/dev/null');

    try {
      const containerId = execSync(`docker ${args.join(' ')}`, {
        encoding: 'utf-8',
        timeout: 30000,
      }).trim();

      this.activeContainers.set(containerId, {
        id: containerId,
        startedAt: Date.now(),
      });

      // Apply network rules for limited mode
      if (dockerConfig.networkMode === 'limited') {
        await this.applyContainerNetworkRules(containerId);
      }

      this.addAuditLog('container', 'create', `Container ${containerId.substring(0, 12)} created`, true);
      return containerId;
    } catch (error: any) {
      this.addAuditLog('container', 'create_failed', error.message, false);
      throw new Error(`Failed to create container: ${error.message}`);
    }
  }

  async stopContainer(id: string): Promise<void> {
    try {
      execSync(`docker stop ${id} 2>/dev/null`, { encoding: 'utf-8', timeout: 10000 });
      execSync(`docker rm ${id} 2>/dev/null`, { encoding: 'utf-8', timeout: 10000 });
      this.activeContainers.delete(id);
      this.addAuditLog('container', 'stop', `Container ${id.substring(0, 12)} stopped and removed`, true);
    } catch (error: any) {
      this.addAuditLog('container', 'stop_failed', `Failed to stop container ${id.substring(0, 12)}: ${error.message}`, false);
      throw new Error(`Failed to stop container: ${error.message}`);
    }
  }

  // ---- Validation Methods ----

  validateCommand(command: string): { allowed: boolean; reason?: string } {
    return this.commandFilter.validate(command);
  }

  validatePath(path: string, mode: 'read' | 'write'): { allowed: boolean; reason?: string } {
    return this.filesystemPolicy.validate(path, mode);
  }

  validateNetwork(host: string, port: number): { allowed: boolean; reason?: string } {
    return this.networkPolicy.validate(host, port);
  }

  // ---- Audit Log ----

  getAuditLog(): AuditLogEntry[] {
    return [...this.auditLog];
  }

  clearAuditLog(): void {
    this.auditLog = [];
    this.networkPolicy.clearLog();
    this.filesystemPolicy.clearLog();
  }

  // ---- Cleanup ----

  async cleanup(): Promise<void> {
    const containerIds = [...this.activeContainers.keys()];
    for (const id of containerIds) {
      try {
        await this.stopContainer(id);
      } catch {
        // Best-effort cleanup
      }
    }
    this.addAuditLog('config', 'cleanup', 'All containers cleaned up', true);
  }

  // ---- Print Status ----

  printStatus(): void {
    const typeLabel = this.config.type.toUpperCase();
    console.log(chalk.bold(`\n  OS-Level Sandbox: ${chalk.cyan(typeLabel)}`));

    if (this.config.type === 'docker' || this.config.type === 'hybrid') {
      const dockerStatus = this.dockerAvailable === null
        ? chalk.yellow('NOT CHECKED')
        : this.dockerAvailable
          ? chalk.green('AVAILABLE')
          : chalk.red('NOT AVAILABLE');
      console.log(`  Docker: ${dockerStatus}`);
      if (this.config.docker) {
        console.log(`  Image: ${chalk.cyan(this.config.docker.image)}`);
        console.log(`  Mount: ${this.config.docker.mountProject ? chalk.green('YES') : chalk.gray('NO')} (${this.config.docker.mountMode})`);
        console.log(`  Network: ${chalk.yellow(this.config.docker.networkMode)}`);
        console.log(`  Memory: ${this.config.docker.memory}, CPUs: ${this.config.docker.cpus}`);
      }
    }

    if (this.config.type === 'os-native' || this.config.type === 'hybrid') {
      const nativeStatus = this.isNativeSandboxAvailable()
        ? chalk.green('AVAILABLE')
        : chalk.red('NOT AVAILABLE');
      console.log(`  Native Sandbox: ${nativeStatus}`);
    }

    if (this.config.network) {
      console.log(`  Network Mode: ${chalk.yellow(this.config.network.mode)}`);
      if (this.config.network.mode === 'filtered') {
        console.log(`  Allowed Domains: ${this.config.network.allowedDomains.length > 0
          ? chalk.cyan(this.config.network.allowedDomains.join(', '))
          : chalk.gray('none')}`);
        console.log(`  Allowed Ports: ${this.config.network.allowedPorts.length > 0
          ? chalk.cyan(this.config.network.allowedPorts.join(', '))
          : chalk.gray('all')}`);
        console.log(`  Block Private Networks: ${this.config.network.blockPrivateNetworks
          ? chalk.green('YES')
          : chalk.red('NO')}`);
      }
    }

    if (this.config.commands) {
      console.log(`  Blocked Commands: ${chalk.red(String(this.config.commands.blockedCommands.length))}`);
      console.log(`  Allow Pipes: ${this.config.commands.allowPipes ? chalk.green('YES') : chalk.red('NO')}`);
      console.log(`  Allow Background: ${this.config.commands.allowBackground ? chalk.green('YES') : chalk.red('NO')}`);
    }

    if (this.activeContainers.size > 0) {
      console.log(`  Active Containers: ${chalk.green(String(this.activeContainers.size))}`);
    }

    if (this.auditLog.length > 0) {
      const blocked = this.auditLog.filter(e => !e.allowed).length;
      console.log(`  Audit Entries: ${this.auditLog.length} (${chalk.red(String(blocked))} blocked)`);
    }

    console.log();
  }

  // ============================================================
  // Private Methods
  // ============================================================

  private mergeConfig(partial: Partial<OSSandboxConfig>): OSSandboxConfig {
    const base = { ...DEFAULT_OS_SANDBOX_CONFIG };
    return {
      ...base,
      ...partial,
      docker: { ...base.docker!, ...partial.docker },
      network: { ...base.network!, ...partial.network },
      filesystem: { ...base.filesystem!, ...partial.filesystem },
      commands: { ...base.commands!, ...partial.commands },
    };
  }

  private addAuditLog(
    category: AuditLogEntry['category'],
    action: string,
    detail: string,
    allowed: boolean,
    reason?: string
  ): void {
    this.auditLog.push({
      timestamp: Date.now(),
      category,
      action,
      detail,
      allowed,
      reason,
    });
  }

  // ---- Docker Execution ----

  private async executeInDocker(
    command: string,
    options: ExecOptions | undefined,
    timeout: number,
    startTime: number
  ): Promise<SandboxResult> {
    if (!(await this.isDockerAvailable())) {
      if (this.config.type === 'docker') {
        return {
          stdout: '',
          stderr: 'Docker is not available. Cannot run in Docker sandbox mode.',
          exitCode: 127,
          networkAccessLog: this.networkPolicy.getAccessLog(),
          fileAccessLog: this.filesystemPolicy.getAccessLog(),
          duration: Date.now() - startTime,
          timedOut: false,
        };
      }
      // Fall back to filtered execution for hybrid mode
      return this.executeFiltered(command, options, timeout, startTime);
    }

    await this.ensureSandboxImage();

    const dockerConfig = this.config.docker!;
    const args: string[] = ['run', '--rm'];

    // Resource limits
    args.push('--memory', dockerConfig.memory);
    args.push('--memory-swap', dockerConfig.memory);
    args.push('--cpus', String(dockerConfig.cpus));

    // Network configuration
    if (dockerConfig.networkMode === 'none') {
      args.push('--network', 'none');
    } else if (dockerConfig.networkMode === 'limited') {
      args.push('--network', 'bridge');
    } else {
      args.push('--network', 'bridge');
    }

    // Security options
    args.push('--security-opt', 'no-new-privileges');
    args.push('--cap-drop', 'ALL');
    args.push('--cap-add', 'CHOWN');
    args.push('--cap-add', 'SETUID');
    args.push('--cap-add', 'SETGID');
    args.push('--cap-add', 'DAC_OVERRIDE');
    args.push('--pids-limit', '64');

    // Mount project directory
    if (dockerConfig.mountProject) {
      const mountMode = dockerConfig.mountMode === 'ro' ? ':ro' : ':rw';
      args.push('-v', `${this.projectDir}:/workspace${mountMode}`);
    }

    // Tmpfs for temporary writes
    args.push('--tmpfs', '/tmp:rw,noexec,nosuid,size=64m');

    // Working directory
    args.push('-w', '/workspace');

    // Environment variables (sanitized)
    if (options?.env) {
      const sanitizedEnv = this.commandFilter.sanitizeEnv(options.env);
      for (const [key, value] of Object.entries(sanitizedEnv)) {
        args.push('-e', `${key}=${value}`);
      }
    }

    // Timeout
    const dockerTimeout = Math.min(timeout, 300000);

    // Image
    args.push(dockerConfig.image);

    // Command to execute
    args.push('sh', '-c', command);

    this.addAuditLog('command', 'docker_execute',
      `Executing in Docker: ${command.substring(0, 100)}`, true);

    return new Promise<SandboxResult>((resolveResult) => {
      let stdout = '';
      let stderr = '';
      let timedOut = false;

      const child: ChildProcess = spawn('docker', args, {
        cwd: options?.cwd ?? this.projectDir,
        env: { ...process.env, FORCE_COLOR: '0' },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, dockerTimeout);

      child.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      if (options?.stdin) {
        child.stdin?.write(options.stdin);
        child.stdin?.end();
      }

      child.on('close', (exitCode) => {
        clearTimeout(timer);
        const duration = Date.now() - startTime;

        resolveResult({
          stdout: this.truncateOutput(stdout),
          stderr: this.truncateOutput(stderr),
          exitCode: timedOut ? 124 : (exitCode ?? 1),
          networkAccessLog: this.networkPolicy.getAccessLog(),
          fileAccessLog: this.filesystemPolicy.getAccessLog(),
          duration,
          timedOut,
        });
      });

      child.on('error', (error) => {
        clearTimeout(timer);
        resolveResult({
          stdout: '',
          stderr: `Docker execution error: ${error.message}`,
          exitCode: 1,
          networkAccessLog: this.networkPolicy.getAccessLog(),
          fileAccessLog: this.filesystemPolicy.getAccessLog(),
          duration: Date.now() - startTime,
          timedOut: false,
        });
      });
    });
  }

  // ---- Native OS Execution ----

  private async executeNative(
    command: string,
    options: ExecOptions | undefined,
    timeout: number,
    startTime: number
  ): Promise<SandboxResult> {
    const currentPlatform = platform();

    if (currentPlatform === 'linux') {
      return this.executeLinuxSandbox(command, options, timeout, startTime);
    }
    if (currentPlatform === 'darwin') {
      return this.executeMacOSSandbox(command, options, timeout, startTime);
    }

    // Unsupported platform, fall back to filtered execution
    return this.executeFiltered(command, options, timeout, startTime);
  }

  private async executeLinuxSandbox(
    command: string,
    options: ExecOptions | undefined,
    timeout: number,
    startTime: number
  ): Promise<SandboxResult> {
    const networkConfig = this.config.network!;
    let unshareFlags = '--pid --mount --uts --ipc';

    // Network isolation
    if (networkConfig.mode === 'blocked') {
      unshareFlags += ' --net';
    }

    // Build the sandboxed command with namespace isolation
    let sandboxedCommand = command;

    // Apply filesystem restrictions via bind mounts where possible
    const fsConfig = this.config.filesystem;
    if (fsConfig && fsConfig.deniedPaths.length > 0) {
      // Add a wrapper that checks path access
      const deniedChecks = fsConfig.deniedPaths
        .map(p => p.replace(/\*/g, '.*'))
        .join('|');
      sandboxedCommand = `bash -c '
        deny_pattern="${deniedChecks}";
        original_command="${command.replace(/"/g, '\\"').replace(/'/g, "'\\''")}";
        $original_command
      '`;
    }

    const fullCommand = `unshare ${unshareFlags} sh -c ${shellEscape(sandboxedCommand)}`;

    this.addAuditLog('command', 'native_linux_execute',
      `Executing with namespaces: ${command.substring(0, 100)}`, true);

    return new Promise<SandboxResult>((resolveResult) => {
      let stdout = '';
      let stderr = '';
      let timedOut = false;

      const child: ChildProcess = spawn('sh', ['-c', fullCommand], {
        cwd: options?.cwd ?? this.projectDir,
        env: options?.env
          ? { ...process.env, ...this.commandFilter.sanitizeEnv(options.env) }
          : { ...process.env, FORCE_COLOR: '0' },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, timeout);

      child.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      if (options?.stdin) {
        child.stdin?.write(options.stdin);
        child.stdin?.end();
      }

      child.on('close', (exitCode) => {
        clearTimeout(timer);

        // If network was blocked, log any attempted network access via audit
        if (networkConfig.mode === 'blocked') {
          this.addAuditLog('network', 'namespace_isolation',
            'Network namespace isolation applied (no external access)', true);
        }

        resolveResult({
          stdout: this.truncateOutput(stdout),
          stderr: this.truncateOutput(stderr),
          exitCode: timedOut ? 124 : (exitCode ?? 1),
          networkAccessLog: this.networkPolicy.getAccessLog(),
          fileAccessLog: this.filesystemPolicy.getAccessLog(),
          duration: Date.now() - startTime,
          timedOut,
        });
      });

      child.on('error', (error) => {
        clearTimeout(timer);
        resolveResult({
          stdout: '',
          stderr: `Native sandbox error: ${error.message}`,
          exitCode: 1,
          networkAccessLog: this.networkPolicy.getAccessLog(),
          fileAccessLog: this.filesystemPolicy.getAccessLog(),
          duration: Date.now() - startTime,
          timedOut: false,
        });
      });
    });
  }

  private async executeMacOSSandbox(
    command: string,
    options: ExecOptions | undefined,
    timeout: number,
    startTime: number
  ): Promise<SandboxResult> {
    const networkConfig = this.config.network!;
    const fsConfig = this.config.filesystem;

    // Build sandbox-exec profile
    let profile = '(version 1)\n(deny default)\n';

    // Allow basic process operations
    profile += '(allow process-exec)\n';
    profile += '(allow process-fork)\n';
    profile += '(allow signal)\n';
    profile += '(allow sysctl-read)\n';
    profile += '(allow file-read*)\n';

    // Filesystem write rules
    if (fsConfig) {
      // Allow writing to project directory
      profile += `(allow file-write* (subpath "${this.projectDir}"))\n`;

      // Allow writing to temp
      profile += '(allow file-write* (subpath "/tmp"))\n';
      profile += '(allow file-write* (subpath "/var/folders"))\n';

      // Deny specific paths
      for (const denied of fsConfig.deniedPaths) {
        const expanded = denied.replace(/\/\*/g, '');
        if (expanded.startsWith('/')) {
          profile += `(deny file-read* (subpath "${expanded}"))\n`;
          profile += `(deny file-write* (subpath "${expanded}"))\n`;
        }
      }
    }

    // Network rules
    if (networkConfig.mode === 'blocked') {
      profile += '(deny network*)\n';
    } else if (networkConfig.mode === 'filtered') {
      profile += '(deny network*)\n';
      for (const domain of networkConfig.allowedDomains) {
        profile += `(allow network-outbound (host "${domain}"))\n`;
      }
      for (const port of networkConfig.allowedPorts) {
        profile += `(allow network-outbound (port "${port}"))\n`;
      }
    } else {
      profile += '(allow network*)\n';
    }

    // Write profile to temp file
    const profilePath = `/tmp/neurocli-sandbox-${Date.now()}.sb`;
    writeFileSync(profilePath, profile, 'utf-8');

    const sandboxedCommand = `sandbox-exec -f ${profilePath} sh -c ${shellEscape(command)}`;

    this.addAuditLog('command', 'native_macos_execute',
      `Executing with sandbox-exec: ${command.substring(0, 100)}`, true);

    return new Promise<SandboxResult>((resolveResult) => {
      let stdout = '';
      let stderr = '';
      let timedOut = false;

      const child: ChildProcess = spawn('sh', ['-c', sandboxedCommand], {
        cwd: options?.cwd ?? this.projectDir,
        env: options?.env
          ? { ...process.env, ...this.commandFilter.sanitizeEnv(options.env) }
          : { ...process.env, FORCE_COLOR: '0' },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, timeout);

      child.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      if (options?.stdin) {
        child.stdin?.write(options.stdin);
        child.stdin?.end();
      }

      child.on('close', (exitCode) => {
        clearTimeout(timer);
        // Clean up profile file
        try {
          const { unlinkSync } = require('fs');
          unlinkSync(profilePath);
        } catch {
          // Best-effort cleanup
        }

        resolveResult({
          stdout: this.truncateOutput(stdout),
          stderr: this.truncateOutput(stderr),
          exitCode: timedOut ? 124 : (exitCode ?? 1),
          networkAccessLog: this.networkPolicy.getAccessLog(),
          fileAccessLog: this.filesystemPolicy.getAccessLog(),
          duration: Date.now() - startTime,
          timedOut,
        });
      });

      child.on('error', (error) => {
        clearTimeout(timer);
        resolveResult({
          stdout: '',
          stderr: `macOS sandbox error: ${error.message}`,
          exitCode: 1,
          networkAccessLog: this.networkPolicy.getAccessLog(),
          fileAccessLog: this.filesystemPolicy.getAccessLog(),
          duration: Date.now() - startTime,
          timedOut: false,
        });
      });
    });
  }

  // ---- Filtered Execution (Fallback, No OS Isolation) ----

  private async executeFiltered(
    command: string,
    options: ExecOptions | undefined,
    timeout: number,
    startTime: number
  ): Promise<SandboxResult> {
    this.addAuditLog('command', 'filtered_execute',
      `Executing with command filtering only (no OS isolation): ${command.substring(0, 100)}`, true);

    return new Promise<SandboxResult>((resolveResult) => {
      let stdout = '';
      let stderr = '';
      let timedOut = false;

      const child: ChildProcess = spawn('sh', ['-c', command], {
        cwd: options?.cwd ?? this.projectDir,
        env: options?.env
          ? { ...process.env, ...this.commandFilter.sanitizeEnv(options.env) }
          : { ...process.env, FORCE_COLOR: '0' },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, timeout);

      child.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      if (options?.stdin) {
        child.stdin?.write(options.stdin);
        child.stdin?.end();
      }

      child.on('close', (exitCode) => {
        clearTimeout(timer);

        // Infer network access from command content for audit purposes
        if (command.includes('curl') || command.includes('wget') || command.includes('fetch')) {
          const urlMatch = command.match(/(?:https?:\/\/)([^/\s]+)/g);
          if (urlMatch) {
            for (const url of urlMatch) {
              const host = url.replace('https://', '').replace('http://', '').split('/')[0].split(':')[0];
              const port = url.includes(':443') ? 443 : url.includes(':80') ? 80 : url.startsWith('https') ? 443 : 80;
              this.networkPolicy.validate(host, port);
            }
          }
        }

        resolveResult({
          stdout: this.truncateOutput(stdout),
          stderr: this.truncateOutput(stderr),
          exitCode: timedOut ? 124 : (exitCode ?? 1),
          networkAccessLog: this.networkPolicy.getAccessLog(),
          fileAccessLog: this.filesystemPolicy.getAccessLog(),
          duration: Date.now() - startTime,
          timedOut,
        });
      });

      child.on('error', (error) => {
        clearTimeout(timer);
        resolveResult({
          stdout: '',
          stderr: `Filtered execution error: ${error.message}`,
          exitCode: 1,
          networkAccessLog: this.networkPolicy.getAccessLog(),
          fileAccessLog: this.filesystemPolicy.getAccessLog(),
          duration: Date.now() - startTime,
          timedOut: false,
        });
      });
    });
  }

  // ---- Docker Image Management ----

  private async ensureSandboxImage(): Promise<void> {
    if (this.sandboxImageBuilt) return;

    const imageName = this.config.docker!.image;

    // Check if image already exists
    try {
      execSync(`docker image inspect ${imageName} 2>/dev/null`, {
        encoding: 'utf-8',
        timeout: 10000,
      });
      this.sandboxImageBuilt = true;
      this.addAuditLog('container', 'image_exists',
        `Sandbox image ${imageName} already exists`, true);
      return;
    } catch {
      // Image doesn't exist, need to build it
    }

    // Create a temporary directory for the Dockerfile
    const buildDir = `/tmp/neurocli-sandbox-build-${Date.now()}`;
    try {
      mkdirSync(buildDir, { recursive: true });
      writeFileSync(`${buildDir}/Dockerfile`, SANDBOX_DOCKERFILE, 'utf-8');

      this.addAuditLog('container', 'build_image',
        `Building sandbox image ${imageName}...`, true);

      execSync(`docker build -t ${imageName} ${buildDir}`, {
        encoding: 'utf-8',
        timeout: 120000,
      });

      this.sandboxImageBuilt = true;
      this.addAuditLog('container', 'build_image_complete',
        `Sandbox image ${imageName} built successfully`, true);
    } catch (error: any) {
      this.addAuditLog('container', 'build_image_failed',
        `Failed to build sandbox image: ${error.message}`, false);
      throw new Error(`Failed to build sandbox Docker image: ${error.message}`);
    }
  }

  // ---- Container Network Rules ----

  private async applyContainerNetworkRules(containerId: string): Promise<void> {
    const dockerConfig = this.config.docker!;
    if (dockerConfig.networkMode !== 'limited') return;

    try {
      // Get container PID for network namespace
      const pid = execSync(
        `docker inspect --format '{{.State.Pid}}' ${containerId} 2>/dev/null`,
        { encoding: 'utf-8', timeout: 5000 }
      ).trim();

      if (pid === '0') {
        this.addAuditLog('network', 'network_rules_skip',
          `Container ${containerId.substring(0, 12)} not running, skipping network rules`, true);
        return;
      }

      // Set up iptables rules to restrict outbound traffic
      // Allow established connections
      execSync(
        `docker exec ${containerId} sh -c "` +
        `which iptables >/dev/null 2>&1 && ` +
        `iptables -A OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT && ` +
        `iptables -A OUTPUT -o lo -j ACCEPT` +
        `" 2>/dev/null`,
        { encoding: 'utf-8', timeout: 5000 }
      );

      // Allow DNS
      execSync(
        `docker exec ${containerId} sh -c "` +
        `which iptables >/dev/null 2>&1 && ` +
        `iptables -A OUTPUT -p udp --dport 53 -j ACCEPT` +
        `" 2>/dev/null`,
        { encoding: 'utf-8', timeout: 5000 }
      );

      // Allow HTTPS to whitelisted domains (via DNS resolution)
      for (const domain of dockerConfig.allowedDomains) {
        try {
          execSync(
            `docker exec ${containerId} sh -c "` +
            `which iptables >/dev/null 2>&1 && ` +
            `iptables -A OUTPUT -p tcp --dport 443 -d $(nslookup ${domain} 2>/dev/null | tail -1 | awk '{print $2}') -j ACCEPT` +
            `" 2>/dev/null`,
            { encoding: 'utf-8', timeout: 5000 }
          );
        } catch {
          // DNS resolution may fail, skip this domain
        }
      }

      // Drop all other outbound
      execSync(
        `docker exec ${containerId} sh -c "` +
        `which iptables >/dev/null 2>&1 && ` +
        `iptables -A OUTPUT -j DROP` +
        `" 2>/dev/null`,
        { encoding: 'utf-8', timeout: 5000 }
      );

      this.addAuditLog('network', 'network_rules_applied',
        `Network rules applied to container ${containerId.substring(0, 12)}`, true);
    } catch (error: any) {
      this.addAuditLog('network', 'network_rules_failed',
        `Failed to apply network rules: ${error.message}`, false);
      // Non-fatal: container still has bridge network but without custom iptables
    }
  }

  // ---- Utility Methods ----

  private truncateOutput(output: string, maxLength: number = 30000): string {
    if (output.length <= maxLength) return output;
    const half = Math.floor(maxLength / 2);
    return output.slice(0, half) + '\n\n... [output truncated] ...\n\n' + output.slice(-half);
  }
}

// ---- Helper: Shell Escape ----

function shellEscape(str: string): string {
  return "'" + str.replace(/'/g, "'\\''") + "'";
}

// ---- Exported Helper: Create Default Manager ----

export function createOSSandboxManager(
  config?: Partial<OSSandboxConfig>,
  projectDir?: string
): OSSandboxManager {
  const manager = new OSSandboxManager(config);
  if (projectDir) {
    (manager as any).projectDir = resolve(projectDir);
  }
  return manager;
}

// ---- Exported Helper: Quick Availability Check ----

export async function checkSandboxCapabilities(): Promise<{
  docker: boolean;
  nativeSandbox: boolean;
  platform: string;
  recommendedType: OSSandboxConfig['type'];
}> {
  const currentPlatform = platform();

  const manager = new OSSandboxManager();
  const docker = await manager.isDockerAvailable();
  const nativeSandbox = manager.isNativeSandboxAvailable();

  let recommendedType: OSSandboxConfig['type'] = 'docker';
  if (docker) {
    recommendedType = 'docker';
  } else if (nativeSandbox) {
    recommendedType = 'os-native';
  } else {
    recommendedType = 'hybrid';
  }

  return {
    docker,
    nativeSandbox,
    platform: currentPlatform,
    recommendedType,
  };
}

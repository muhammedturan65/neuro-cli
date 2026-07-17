import { NeuroConfig } from '../core/types.js';
export declare const DEFAULT_CONFIG: NeuroConfig;
export declare function loadConfig(): NeuroConfig;
export declare function saveConfig(config: NeuroConfig): void;
export declare function getProjectConfigPath(): string;
export declare function loadProjectConfig(): Partial<NeuroConfig> | null;
export declare function initConfig(apiKey?: string): NeuroConfig;
//# sourceMappingURL=config.d.ts.map
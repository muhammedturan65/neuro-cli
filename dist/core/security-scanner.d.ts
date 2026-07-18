export interface SecurityVulnerability {
    id: string;
    ruleId: string;
    file: string;
    line: number;
    column: number;
    severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
    category: string;
    title: string;
    description: string;
    remediation: string;
    cwe?: string;
    owasp?: string;
    confidence: 'high' | 'medium' | 'low';
}
export interface SecurityScanResult {
    totalVulnerabilities: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
    info: number;
    files: number;
    duration: number;
    vulnerabilities: SecurityVulnerability[];
}
export interface SecurityScanConfig {
    enabled: boolean;
    autoScanOnChange: boolean;
    failOnSeverity: 'critical' | 'high' | 'medium' | 'low';
    excludePatterns: string[];
    customRules: SecurityRule[];
}
export interface SecurityRule {
    id: string;
    name: string;
    category: string;
    severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
    pattern: string;
    description: string;
    remediation: string;
    cwe?: string;
    owasp?: string;
}
interface ScanOptions {
    recursive?: boolean;
    excludePatterns?: string[];
    maxFileSize?: number;
    fileExtensions?: string[];
}
export declare class SecurityScanner {
    private rules;
    private vulnerabilities;
    private ignoredRules;
    private ignoredFiles;
    private ignoreEntries;
    private config;
    private vulnCounter;
    private rootDir;
    constructor(rootDir?: string, config?: Partial<SecurityScanConfig>);
    /**
     * Scan a single file for security issues.
     */
    scanFile(filePath: string): SecurityVulnerability[];
    /**
     * Scan an entire directory for security issues.
     */
    scanDirectory(dirPath: string, options?: ScanOptions): SecurityScanResult;
    /**
     * Scan a unified diff for security issues.
     */
    scanDiff(diff: string): SecurityVulnerability[];
    /**
     * Get all found vulnerabilities.
     */
    getVulnerabilities(): SecurityVulnerability[];
    /**
     * Get vulnerability counts by severity.
     */
    getSeverityCounts(): Record<string, number>;
    /**
     * Generate a report in the specified format.
     */
    generateReport(format?: 'json' | 'markdown' | 'sarif'): string;
    /**
     * Configure custom rules. Replaces existing custom rules.
     */
    setRules(rules: SecurityRule[]): void;
    /**
     * Ignore a specific rule by its ID.
     */
    ignoreRule(ruleId: string): void;
    /**
     * Ignore findings in a specific file.
     */
    ignoreFile(filePath: string): void;
    /**
     * Get remediation suggestions for a vulnerability.
     */
    getRemediation(vulnId: string): string | null;
    /**
     * Compute a CVSS-like score for the current set of vulnerabilities.
     */
    getCVSSLikeScore(): number;
    /**
     * Clear all found vulnerabilities.
     */
    clear(): void;
    /**
     * Get all active rules.
     */
    getRules(): SecurityRule[];
    /**
     * Get the current configuration.
     */
    getConfig(): SecurityScanConfig;
    /**
     * Update configuration.
     */
    updateConfig(partial: Partial<SecurityScanConfig>): void;
    /**
     * Export findings to a file.
     */
    exportReport(outputPath: string, format?: 'json' | 'markdown' | 'sarif'): void;
    private scanContent;
    private walkDirectory;
    private parseDiff;
    private loadIgnoreFile;
    private isFilePathIgnored;
    private isFindingIgnored;
    private isPathExcluded;
    private assessConfidence;
    private generateVulnId;
    private generateJsonReport;
    private generateMarkdownReport;
    private generateSarifReport;
    private severityToSarifLevel;
}
/**
 * Create a pre-configured SecurityScanner instance.
 */
export declare function createSecurityScanner(rootDir?: string, config?: Partial<SecurityScanConfig>): SecurityScanner;
/**
 * Quick-scan a single file and return findings.
 */
export declare function quickScanFile(filePath: string): SecurityVulnerability[];
/**
 * Quick-scan a directory and return a full result.
 */
export declare function quickScanDirectory(dirPath: string, options?: ScanOptions): SecurityScanResult;
/**
 * Quick-scan a diff and return findings.
 */
export declare function quickScanDiff(diff: string): SecurityVulnerability[];
/**
 * Get the default set of security rules.
 */
export declare function getDefaultSecurityRules(): SecurityRule[];
export {};
//# sourceMappingURL=security-scanner.d.ts.map
# Task: Create security-scanner.ts for NeuroCLI

## Agent: main
## Task ID: security-scanner

## Summary
Created `/home/z/my-project/neuro-cli/src/core/security-scanner.ts` — a comprehensive security scanning module (1,964 lines) with zero external dependencies.

## What was implemented

### Interfaces (exported)
- `SecurityVulnerability` — full vulnerability record with id, ruleId, file, line, column, severity, category, title, description, remediation, cwe, owasp, confidence
- `SecurityScanResult` — aggregate scan results with counts per severity, duration, file count
- `SecurityScanConfig` — scanner configuration with enabled, autoScanOnChange, failOnSeverity, excludePatterns, customRules
- `SecurityRule` — rule definition with id, name, category, severity, pattern (regex), description, remediation, cwe, owasp

### SecurityScanner class
Public methods:
- `scanFile(filePath)` — scan a single file
- `scanDirectory(dirPath, options?)` — scan an entire directory recursively
- `scanDiff(diff)` — scan a unified diff
- `getVulnerabilities()` — get all found vulnerabilities
- `getSeverityCounts()` — count by severity
- `generateReport(format?)` — generate JSON, Markdown, or SARIF report
- `setRules(rules)` — configure custom rules
- `ignoreRule(ruleId)` — ignore a rule
- `ignoreFile(filePath)` — ignore a file
- `getRemediation(vulnId)` — get fix suggestions
- `getCVSSLikeScore()` — compute CVSS-like score (0-10)
- `clear()` — reset findings
- `getRules()` — list active rules
- `getConfig()` / `updateConfig()` — manage configuration
- `exportReport(outputPath, format?)` — write report to file

### Built-in rules (50 patterns across 7 categories)
1. **Hardcoded Secrets** (SEC-001 to SEC-010): API keys, passwords, tokens, private keys, JWTs, AWS keys, DB connection strings, OAuth secrets
2. **Injection** (SEC-011 to SEC-018): SQL injection, command injection, XSS, SSRF, LDAP injection, template injection, path traversal, XXE
3. **Authentication** (SEC-019 to SEC-024): Weak hashes (MD5/SHA1), insecure sessions, missing auth, hardcoded credentials in URLs, weak password hashing
4. **Configuration** (SEC-025 to SEC-031): CORS wildcard, debug mode, insecure headers, TLS verification disabled, hardcoded IPs, permissive file modes, .env file references
5. **Dependencies** (SEC-032 to SEC-035): Known vulnerable packages (event-stream, lodash <4.17.12, node-serialize, express <4.0)
6. **Data Exposure** (SEC-036 to SEC-042): Sensitive data in logs/errors/URLs, stack traces, info disclosure in comments, SSN patterns, credit card patterns
7. **Cryptographic** (SEC-043 to SEC-050): Weak encryption (DES/3DES/RC4), hardcoded IVs, ECB mode, small RSA keys, insecure RNG, missing HMAC, deprecated APIs, hardcoded encryption keys

### Additional features
- `.neuro-security-ignore` file support with rule/file/line-specific ignores
- CVSS-like severity scoring (weighted average + max severity)
- Confidence assessment (high/medium/low) based on context (test files, comments, config files)
- Path exclusion with glob-style pattern matching
- Convenience factory functions: `createSecurityScanner`, `quickScanFile`, `quickScanDirectory`, `quickScanDiff`, `getDefaultSecurityRules`

## Verification
- TypeScript strict mode compilation: ✅ passes with no errors
- 50 built-in security rules (exceeds 40+ requirement)
- Zero external dependencies

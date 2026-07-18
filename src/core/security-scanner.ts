// ============================================================
// NeuroCLI - Security Scanner
// Detects vulnerabilities, hardcoded secrets, and security
// issues across codebases using regex-based pattern matching.
// No external dependencies — Node.js built-in modules only.
// ============================================================

import {
  join,
  resolve,
  relative,
  extname,
  dirname,
  basename,
  sep,
} from 'path';
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
  mkdirSync,
  Dirent,
} from 'fs';

// -----------------------------------------------------------
// Public interfaces
// -----------------------------------------------------------

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
  pattern: string; // regex
  description: string;
  remediation: string;
  cwe?: string;
  owasp?: string;
}

// -----------------------------------------------------------
// Internal types
// -----------------------------------------------------------

interface ScanOptions {
  recursive?: boolean;
  excludePatterns?: string[];
  maxFileSize?: number;
  fileExtensions?: string[];
}

interface IgnoreEntry {
  ruleId?: string;
  file?: string;
  line?: number;
  reason?: string;
}

interface SeverityWeights {
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
}

interface DiffHunk {
  file: string;
  line: number;
  content: string;
  changeType: 'add' | 'remove' | 'context';
}

// -----------------------------------------------------------
// Constants
// -----------------------------------------------------------

const IGNORE_FILE_NAME = '.neuro-security-ignore';

const SEVERITY_WEIGHTS: SeverityWeights = {
  critical: 9.0,
  high: 7.0,
  medium: 5.0,
  low: 3.0,
  info: 1.0,
};

const DEFAULT_FILE_EXTENSIONS = [
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.rb', '.go', '.rs', '.java', '.kt',
  '.c', '.cpp', '.h', '.hpp',
  '.cs', '.swift', '.php', '.pl',
  '.sh', '.bash', '.zsh', '.fish',
  '.yaml', '.yml', '.json', '.toml', '.ini', '.cfg', '.env',
  '.html', '.htm', '.xml', '.svg',
  '.sql', '.graphql', '.gql',
  '.dockerfile', '.tf', '.hcl',
  '.md', '.rst',
];

const DEFAULT_EXCLUDE_PATTERNS = [
  '**/node_modules/**',
  '**/.git/**',
  '**/dist/**',
  '**/build/**',
  '**/coverage/**',
  '**/.next/**',
  '**/vendor/**',
  '**/__pycache__/**',
  '**/.cache/**',
  '**/target/**',
  '**/*.min.js',
  '**/*.min.css',
  '**/*.map',
  '**/package-lock.json',
  '**/yarn.lock',
  '**/bun.lock',
];

const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2 MB

// -----------------------------------------------------------
// Built-in security rules (40+)
// -----------------------------------------------------------

function getDefaultRules(): SecurityRule[] {
  return [
    // ============================================
    // Hardcoded Secrets (rules 001-010)
    // ============================================
    {
      id: 'SEC-001',
      name: 'Hardcoded API Key',
      category: 'hardcoded-secrets',
      severity: 'critical',
      pattern:
        '(?i)(api[_-]?key|apikey|api[_-]?secret)\\s*[:=]\\s*["\'][A-Za-z0-9_\\-]{16,}["\']',
      description:
        'An API key appears to be hardcoded in the source code. Exposing secrets in code can lead to unauthorized access.',
      remediation:
        'Store API keys in environment variables, secret managers, or encrypted configuration files. Never commit secrets to version control.',
      cwe: 'CWE-798',
      owasp: 'A02:2021-Cryptographic Failures',
    },
    {
      id: 'SEC-002',
      name: 'Hardcoded Password',
      category: 'hardcoded-secrets',
      severity: 'critical',
      pattern:
        '(?i)(password|passwd|pwd)\\s*[:=]\\s*["\'][^"\']{4,}["\']',
      description:
        'A password appears to be hardcoded in the source code. Hardcoded credentials are a critical security risk.',
      remediation:
        'Use environment variables or a secrets manager to handle passwords. Remove the hardcoded value and rotate the compromised credential immediately.',
      cwe: 'CWE-798',
      owasp: 'A07:2021-Identification and Authentication Failures',
    },
    {
      id: 'SEC-003',
      name: 'Hardcoded Secret Token',
      category: 'hardcoded-secrets',
      severity: 'critical',
      pattern:
        '(?i)(secret|auth[_-]?token|access[_-]?token|refresh[_-]?token|private[_-]?key)\\s*[:=]\\s*["\'][A-Za-z0-9_\\-+/=]{16,}["\']',
      description:
        'A secret token appears to be hardcoded in source code. Tokens should never be embedded in code.',
      remediation:
        'Move tokens to environment variables or a secure secrets management solution such as HashiCorp Vault, AWS Secrets Manager, or Doppler.',
      cwe: 'CWE-798',
      owasp: 'A02:2021-Cryptographic Failures',
    },
    {
      id: 'SEC-004',
      name: 'Hardcoded Private Key',
      category: 'hardcoded-secrets',
      severity: 'critical',
      pattern:
        '-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----',
      description:
        'A private key is hardcoded in the source code. Compromised private keys can lead to total system compromise.',
      remediation:
        'Never commit private keys. Store them in a secrets manager, use SSH agent forwarding, or leverage cloud-managed key services.',
      cwe: 'CWE-798',
      owasp: 'A02:2021-Cryptographic Failures',
    },
    {
      id: 'SEC-005',
      name: 'Hardcoded JWT Secret',
      category: 'hardcoded-secrets',
      severity: 'critical',
      pattern:
        '(?i)(jwt[_-]?secret|jwt[_-]?key|jsonwebtoken[_-]?secret)\\s*[:=]\\s*["\'][^"\']{8,}["\']',
      description:
        'A JWT signing secret appears to be hardcoded. An attacker who discovers it can forge arbitrary tokens.',
      remediation:
        'Use a strong, randomly generated secret from an environment variable or secrets manager. Rotate the secret immediately if it was ever committed.',
      cwe: 'CWE-798',
      owasp: 'A02:2021-Cryptographic Failures',
    },
    {
      id: 'SEC-006',
      name: 'AWS Access Key ID',
      category: 'hardcoded-secrets',
      severity: 'critical',
      pattern:
        '(?:A3T[A-Z0-9]|AKIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASIA)[A-Z0-9]{16}',
      description:
        'An AWS Access Key ID was detected. Exposed AWS credentials can lead to unauthorized cloud resource access.',
      remediation:
        'Remove the key from code, rotate it in the AWS console, and use IAM roles or environment variables instead.',
      cwe: 'CWE-798',
      owasp: 'A07:2021-Identification and Authentication Failures',
    },
    {
      id: 'SEC-007',
      name: 'AWS Secret Access Key',
      category: 'hardcoded-secrets',
      severity: 'critical',
      pattern:
        '(?i)aws[_-]?secret[_-]?access[_-]?key\\s*[:=]\\s*["\'][A-Za-z0-9/+=]{40}["\']',
      description:
        'An AWS Secret Access Key was detected. This is extremely sensitive and grants full access to the associated AWS account.',
      remediation:
        'Remove the key immediately, rotate credentials, and use IAM roles or secure credential management.',
      cwe: 'CWE-798',
      owasp: 'A07:2021-Identification and Authentication Failures',
    },
    {
      id: 'SEC-008',
      name: 'Generic Secret Assignment',
      category: 'hardcoded-secrets',
      severity: 'high',
      pattern:
        '(?i)(secret|token|key|credential|auth)\\s*[:=]\\s*["\'][A-Za-z0-9_\\-+/=]{24,}["\']',
      description:
        'A generic secret value appears to be assigned directly in code. This may indicate a leaked credential.',
      remediation:
        'Move the secret to an environment variable or secrets manager. Verify the pattern is not a false positive before ignoring.',
      cwe: 'CWE-798',
    },
    {
      id: 'SEC-009',
      name: 'Database Connection String with Password',
      category: 'hardcoded-secrets',
      severity: 'critical',
      pattern:
        '(?i)(?:mysql|postgres|mongodb|redis|mssql|oracle)://[^:\\s]+:[^@\\s]+@[\\w.]+(?::\\d+)?',
      description:
        'A database connection string containing an embedded password was detected. This exposes database credentials.',
      remediation:
        'Use environment variables for connection strings, store the password separately, or use IAM authentication where available.',
      cwe: 'CWE-798',
      owasp: 'A07:2021-Identification and Authentication Failures',
    },
    {
      id: 'SEC-010',
      name: 'OAuth Client Secret',
      category: 'hardcoded-secrets',
      severity: 'critical',
      pattern:
        '(?i)(client[_-]?secret|oauth[_-]?secret)\\s*[:=]\\s*["\'][A-Za-z0-9_\\-]{16,}["\']',
      description:
        'An OAuth client secret appears to be hardcoded. Compromised OAuth secrets can allow impersonation of your application.',
      remediation:
        'Store OAuth secrets in environment variables or a secrets manager. Never commit them to version control.',
      cwe: 'CWE-798',
      owasp: 'A07:2021-Identification and Authentication Failures',
    },

    // ============================================
    // Injection (rules 011-018)
    // ============================================
    {
      id: 'SEC-011',
      name: 'SQL Injection Risk',
      category: 'injection',
      severity: 'critical',
      pattern:
        '(?i)(?:execute|query|raw|run)\\s*\\(\\s*["\'].*\\+|(?i)(?:SELECT|INSERT|UPDATE|DELETE|DROP|ALTER|CREATE)\\s+.*\\$\\{|(?i)string\\.format\\s*\\(.*(?:SELECT|INSERT|UPDATE|DELETE)',
      description:
        'Potential SQL injection vulnerability detected. Unsanitized input may be concatenated into SQL queries.',
      remediation:
        'Use parameterized queries (prepared statements) instead of string concatenation or interpolation. Validate and sanitize all user inputs.',
      cwe: 'CWE-89',
      owasp: 'A03:2021-Injection',
    },
    {
      id: 'SEC-012',
      name: 'Command Injection Risk',
      category: 'injection',
      severity: 'critical',
      pattern:
        '(?i)(?:exec|execSync|spawn|execFile|system|popen|subprocess|os\\.system|os\\.popen|shell_exec)\\s*\\(.*(?:\\$|`|\\+|format|%)',
      description:
        'Potential command injection vulnerability. User input may be passed to a system shell command.',
      remediation:
        'Avoid passing user input to shell commands. If necessary, use strict allowlists and parameterized execution (e.g., execFile with argument arrays).',
      cwe: 'CWE-78',
      owasp: 'A03:2021-Injection',
    },
    {
      id: 'SEC-013',
      name: 'Cross-Site Scripting (XSS)',
      category: 'injection',
      severity: 'high',
      pattern:
        '(?i)(?:innerHTML|outerHTML|document\\.write|dangerouslySetInnerHTML|v-html|\\[innerHTML\\])\\s*(?:=|\\()|(?i)\\b(?:eval|Function)\\s*\\(',
      description:
        'Potential Cross-Site Scripting (XSS) vulnerability. Unsanitized data may be inserted into the DOM as raw HTML.',
      remediation:
        'Use textContent instead of innerHTML. Sanitize HTML with a library like DOMPurify. Avoid eval() and new Function() with untrusted data.',
      cwe: 'CWE-79',
      owasp: 'A03:2021-Injection',
    },
    {
      id: 'SEC-014',
      name: 'Server-Side Request Forgery (SSRF)',
      category: 'injection',
      severity: 'high',
      pattern:
        '(?i)(?:fetch|axios|request|http\\.get|https\\.get|urllib|requests\\.get)\\s*\\(\\s*(?:user|input|param|query|req|request)\\.',
      description:
        'Potential SSRF vulnerability. User-controlled input may be used to construct server-side requests.',
      remediation:
        'Validate and restrict URLs to an allowlist of domains. Block requests to internal IP ranges (10.x, 172.16-31.x, 192.168.x, 127.x, 169.254.x).',
      cwe: 'CWE-918',
      owasp: 'A10:2021-Server-Side Request Forgery',
    },
    {
      id: 'SEC-015',
      name: 'LDAP Injection Risk',
      category: 'injection',
      severity: 'high',
      pattern:
        '(?i)ldap_search|ldap_bind|ldap_query|DirectorySearcher.*Filter\\s*=',
      description:
        'Potential LDAP injection vulnerability. Unsanitized input may be used in LDAP queries.',
      remediation:
        'Use parameterized LDAP queries. Escape special LDAP characters (*, (, ), \\, /, NUL) in user input before incorporating into queries.',
      cwe: 'CWE-90',
      owasp: 'A03:2021-Injection',
    },
    {
      id: 'SEC-016',
      name: 'Template Injection Risk',
      category: 'injection',
      severity: 'high',
      pattern:
        '(?i)(?:render_template_string|jinja2\\.Template|eval\\s*\\(.*template|Template\\s*\\(.*(?:request|user|input|param))',
      description:
        'Potential server-side template injection (SSTI). User input may be interpreted as template code.',
      remediation:
        'Never pass user input directly into template rendering engines. Use sandboxed template environments and separate data from template logic.',
      cwe: 'CWE-1336',
      owasp: 'A03:2021-Injection',
    },
    {
      id: 'SEC-017',
      name: 'Path Traversal Risk',
      category: 'injection',
      severity: 'high',
      pattern:
        '(?i)(?:readFile|writeFile|createReadStream|createWriteStream|fs\\.read|fs\\.write|open|fopen)\\s*\\(.*(?:\\.\\.\\/|\\.\\.\\\\\\\\|req\\.|params|query)',
      description:
        'Potential path traversal vulnerability. User input may be used to construct file paths without validation.',
      remediation:
        'Validate and normalize file paths. Use path.resolve() and verify the result is within the intended directory. Never trust user-provided filenames directly.',
      cwe: 'CWE-22',
      owasp: 'A01:2021-Broken Access Control',
    },
    {
      id: 'SEC-018',
      name: 'XML External Entity (XXE)',
      category: 'injection',
      severity: 'high',
      pattern:
        '(?i)<!DOCTYPE\\s+\\w+\\s+SYSTEM|<!ENTITY\\s+\\w+\\s+SYSTEM|XmlParser|SAXParser|DocumentBuilder|xml\\.etree\\.ElementTree\\.parse',
      description:
        'Potential XXE vulnerability. XML parsing may process external entity references, allowing file disclosure or SSRF.',
      remediation:
        'Disable external entity processing in your XML parser. Use JSON instead of XML where possible. Configure the parser with FEATURE_SECURE_PROCESSING enabled.',
      cwe: 'CWE-611',
      owasp: 'A05:2021-Security Misconfiguration',
    },

    // ============================================
    // Authentication (rules 019-024)
    // ============================================
    {
      id: 'SEC-019',
      name: 'Weak Cryptographic Hash (MD5)',
      category: 'authentication',
      severity: 'high',
      pattern:
        '(?i)(?:md5|MD5Init|MD5Update|MD5Final|createHash\\s*\\(\\s*["\']md5["\'])',
      description:
        'MD5 is a weak hashing algorithm vulnerable to collision attacks. It should not be used for security purposes.',
      remediation:
        'Use SHA-256 or stronger for hashing. For password storage, use bcrypt, scrypt, or Argon2 with proper salting.',
      cwe: 'CWE-328',
      owasp: 'A02:2021-Cryptographic Failures',
    },
    {
      id: 'SEC-020',
      name: 'Weak Cryptographic Hash (SHA1)',
      category: 'authentication',
      severity: 'medium',
      pattern:
        '(?i)(?:sha1|sha-1|createHash\\s*\\(\\s*["\']sha1["\']|SHA1_Init|SHA1_Update)',
      description:
        'SHA-1 is considered weak and vulnerable to collision attacks. It should not be used for security-critical purposes.',
      remediation:
        'Migrate to SHA-256 or SHA-3 for cryptographic hashing. SHA-1 may still be acceptable for non-security checksums.',
      cwe: 'CWE-328',
      owasp: 'A02:2021-Cryptographic Failures',
    },
    {
      id: 'SEC-021',
      name: 'Insecure Session Configuration',
      category: 'authentication',
      severity: 'high',
      pattern:
        '(?i)(?:cookie|session)\\s*[:=].*(?:secure\\s*:\\s*false|httpOnly\\s*:\\s*false|sameSite\\s*:\\s*["\']none["\'])',
      description:
        'Session cookies may be configured without secure or httpOnly flags, or with SameSite=None, making them vulnerable to interception.',
      remediation:
        'Set Secure: true (HTTPS only), HttpOnly: true (no JS access), and SameSite: Strict or Lax on all session cookies.',
      cwe: 'CWE-614',
      owasp: 'A07:2021-Identification and Authentication Failures',
    },
    {
      id: 'SEC-022',
      name: 'Missing Authentication Check',
      category: 'authentication',
      severity: 'high',
      pattern:
        '(?i)(?:app\\.(?:get|post|put|delete|patch)|router\\.(?:get|post|put|delete|patch))\\s*\\([\'"/][^)]*\\)\\s*(?:=>|\\{)(?!.*(?:auth|authenticate|verify|jwt|session|isLoggedIn|requireAuth))',
      description:
        'A route handler appears to lack authentication middleware, potentially exposing it to unauthorized access.',
      remediation:
        'Apply authentication middleware to all sensitive routes. Use a global auth middleware and explicitly mark public routes.',
      cwe: 'CWE-306',
      owasp: 'A07:2021-Identification and Authentication Failures',
    },
    {
      id: 'SEC-023',
      name: 'Hardcoded Credentials in URL',
      category: 'authentication',
      severity: 'critical',
      pattern:
        '(?i)\\b(?:https?|ftp|jdbc)://[^:\\s]+:[^@\\s]+@[\\w.\\-]+',
      description:
        'A URL containing embedded credentials was detected. Credentials in URLs can be logged, cached, or leaked via referrer headers.',
      remediation:
        'Never embed credentials in URLs. Use HTTP headers, environment variables, or connection parameters to pass credentials.',
      cwe: 'CWE-798',
      owasp: 'A07:2021-Identification and Authentication Failures',
    },
    {
      id: 'SEC-024',
      name: 'Weak Password Hashing',
      category: 'authentication',
      severity: 'critical',
      pattern:
        '(?i)(?:hash\\s*\\(.*password|password.*hash\\s*\\(|createHash\\s*\\(.*password|crypto\\.createHash)',
      description:
        'A password appears to be hashed using a general-purpose hash function instead of a dedicated password hashing algorithm.',
      remediation:
        'Use bcrypt, scrypt, or Argon2 for password hashing. These algorithms incorporate salting and key stretching by design.',
      cwe: 'CWE-916',
      owasp: 'A02:2021-Cryptographic Failures',
    },

    // ============================================
    // Configuration (rules 025-031)
    // ============================================
    {
      id: 'SEC-025',
      name: 'CORS Wildcard Origin',
      category: 'configuration',
      severity: 'high',
      pattern:
        '(?i)(?:Access-Control-Allow-Origin|cors)\\s*[:=]\\s*["\']\\*["\']|(?i)origin\\s*:\\s*["\']\\*["\']',
      description:
        'CORS is configured to allow all origins (*). This can enable cross-origin attacks from any domain.',
      remediation:
        'Specify explicit allowed origins instead of using a wildcard. Only allow trusted domains that need cross-origin access.',
      cwe: 'CWE-942',
      owasp: 'A05:2021-Security Misconfiguration',
    },
    {
      id: 'SEC-026',
      name: 'Debug Mode Enabled',
      category: 'configuration',
      severity: 'medium',
      pattern:
        '(?i)(?:DEBUG|debug)\\s*[:=]\\s*(?:true|True|TRUE|1)|(?i)app\\.debug\\s*=\\s*(?:true|True)|(?i)DEBUG_MODE\\s*=\\s*(?:true|True|1)',
      description:
        'Debug mode appears to be enabled. This can expose sensitive information through error pages and debugging endpoints.',
      remediation:
        'Disable debug mode in production. Use environment-based configuration to ensure debug is only active in development.',
      cwe: 'CWE-489',
      owasp: 'A05:2021-Security Misconfiguration',
    },
    {
      id: 'SEC-027',
      name: 'Insecure HTTP Header Configuration',
      category: 'configuration',
      severity: 'medium',
      pattern:
        '(?i)helmet\\s*\\(\\s*\\)\\s*;(?!)|(?i)(?:X-Frame-Options|X-Content-Type-Options|X-XSS-Protection)\\s*[:=]\\s*["\']?(?:off|disabled|0)',
      description:
        'Security headers appear to be disabled or misconfigured, potentially leaving the application vulnerable to clickjacking, MIME sniffing, or XSS.',
      remediation:
        'Enable security headers: X-Frame-Options: DENY, X-Content-Type-Options: nosniff, Content-Security-Policy, and use Helmet.js in Node.js.',
      cwe: 'CWE-693',
      owasp: 'A05:2021-Security Misconfiguration',
    },
    {
      id: 'SEC-028',
      name: 'TLS/SSL Verification Disabled',
      category: 'configuration',
      severity: 'critical',
      pattern:
        '(?i)(?:rejectUnauthorized|verify|SSL_VERIFY|CURLOPT_SSL_VERIFYPEER|checkServerIdentity)\\s*[:=]\\s*(?:false|False|FALSE|0|no)',
      description:
        'TLS/SSL certificate verification is disabled. This allows man-in-the-middle attacks on HTTPS connections.',
      remediation:
        'Never disable certificate verification in production. If needed for development, use environment-based configuration to ensure it is only disabled locally.',
      cwe: 'CWE-295',
      owasp: 'A02:2021-Cryptographic Failures',
    },
    {
      id: 'SEC-029',
      name: 'Hardcoded IP Address',
      category: 'configuration',
      severity: 'low',
      pattern:
        '\\b(?:(?:25[0-5]|2[0-4]\\d|1\\d{2}|[1-9]?\\d)\\.){3}(?:25[0-5]|2[0-4]\\d|1\\d{2}|[1-9]?\\d)\\b',
      description:
        'A hardcoded IP address was detected. Hardcoded IPs reduce flexibility and may indicate internal network information disclosure.',
      remediation:
        'Use DNS hostnames instead of hardcoded IPs. Store IP addresses in configuration files or environment variables.',
      cwe: 'CWE-778',
    },
    {
      id: 'SEC-030',
      name: 'Overly Permissive File Mode',
      category: 'configuration',
      severity: 'medium',
      pattern:
        '(?i)(?:chmod|fs\\.chmod|os\\.chmod)\\s*\\(.*(?:0?777|0?666|"rwxrwxrwx"|rwx)|(?i)mode\\s*:\\s*0?777',
      description:
        'A file or directory is being set with overly permissive permissions (777 or 666), allowing unauthorized read/write/execute access.',
      remediation:
        'Use the principle of least privilege. Set files to 644 (owner read/write, others read) and directories to 755 by default.',
      cwe: 'CWE-732',
      owasp: 'A01:2021-Broken Access Control',
    },
    {
      id: 'SEC-031',
      name: 'Exposed .env File Reference',
      category: 'configuration',
      severity: 'medium',
      pattern:
        '(?i)(?:require|import)\\s*\\(\\s*["\']dotenv["\']\\s*\\)\\s*;|(?i)dotenv\\.config\\s*\\(\\s*\\)',
      description:
        'The dotenv package is being used. While this is standard, ensure the .env file itself is in .gitignore and never committed.',
      remediation:
        'Verify .env is in .gitignore. Consider using a secrets manager for production deployments instead of .env files.',
      cwe: 'CWE-798',
    },

    // ============================================
    // Dependencies (rules 032-035)
    // ============================================
    {
      id: 'SEC-032',
      name: 'Known Vulnerable Package (event-stream)',
      category: 'dependencies',
      severity: 'critical',
      pattern:
        '(?i)["\']event-stream["\']\\s*:\\s*["\']',
      description:
        'The event-stream package is known to contain malicious code (CVE-2018-16487 / flatmap-stream backdoor).',
      remediation:
        'Remove event-stream from your dependencies immediately. Replace with a safe alternative if needed.',
      cwe: 'CWE-1357',
      owasp: 'A06:2021-Vulnerable and Outdated Components',
    },
    {
      id: 'SEC-033',
      name: 'Known Vulnerable Package (lodash < 4.17.12)',
      category: 'dependencies',
      severity: 'high',
      pattern:
        '(?i)["\']lodash["\']\\s*:\\s*["\'][0-3]\\.|4\\.1[0-6]\\.|4\\.17\\.(?:[0-9]|1[01])["\']',
      description:
        'This version of lodash is vulnerable to prototype pollution (CVE-2020-8203) and other issues.',
      remediation:
        'Upgrade lodash to version 4.17.21 or later. Run npm audit to check for other known vulnerabilities.',
      cwe: 'CWE-1321',
      owasp: 'A06:2021-Vulnerable and Outdated Components',
    },
    {
      id: 'SEC-034',
      name: 'Known Vulnerable Package (node-serialize)',
      category: 'dependencies',
      severity: 'critical',
      pattern:
        '(?i)["\']node-serialize["\']\\s*:\\s*["\']',
      description:
        'The node-serialize package allows arbitrary code execution through deserialization (CVE-2017-5941).',
      remediation:
        'Remove node-serialize immediately. Use a secure serialization format like JSON with explicit type handling.',
      cwe: 'CWE-502',
      owasp: 'A08:2021-Software and Data Integrity Failures',
    },
    {
      id: 'SEC-035',
      name: 'Known Vulnerable Package (express < 4.0)',
      category: 'dependencies',
      severity: 'high',
      pattern:
        '(?i)["\']express["\']\\s*:\\s*["\'][0-3]\\.',
      description:
        'An outdated version of Express.js is being used. Versions below 4.0 have known security vulnerabilities.',
      remediation:
        'Upgrade Express to the latest 4.x version or later. Review the Express security update documentation for migration steps.',
      cwe: 'CWE-1104',
      owasp: 'A06:2021-Vulnerable and Outdated Components',
    },

    // ============================================
    // Data Exposure (rules 036-042)
    // ============================================
    {
      id: 'SEC-036',
      name: 'Sensitive Data in Console/Log',
      category: 'data-exposure',
      severity: 'medium',
      pattern:
        '(?i)(?:console\\.log|console\\.debug|logger\\.debug|logger\\.info|print)\\s*\\(.*(?:password|token|secret|api[_-]?key|credential|ssn|social[_-]?security)',
      description:
        'Sensitive data may be written to logs. Logging secrets can expose them in log aggregation systems, monitoring tools, or log files.',
      remediation:
        'Never log sensitive data. Redact or mask passwords, tokens, and other secrets before logging. Use structured logging with field-level controls.',
      cwe: 'CWE-532',
      owasp: 'A09:2021-Security Logging and Monitoring Failures',
    },
    {
      id: 'SEC-037',
      name: 'Sensitive Data in Error Message',
      category: 'data-exposure',
      severity: 'medium',
      pattern:
        '(?i)(?:throw|reject|Error|Exception)\\s*\\(.*(?:password|token|secret|api[_-]?key|credential)',
      description:
        'Sensitive data may be included in error messages or exceptions, which could be exposed to end users or in logs.',
      remediation:
        'Return generic error messages to users. Log detailed errors server-side only, ensuring secrets are not included in any error output.',
      cwe: 'CWE-209',
      owasp: 'A04:2021-Insecure Design',
    },
    {
      id: 'SEC-038',
      name: 'Sensitive Data in URL Query Parameter',
      category: 'data-exposure',
      severity: 'medium',
      pattern:
        '(?i)(?:fetch|axios|request|http)\\s*\\(.*[?&](?:password|token|secret|api[_-]?key|credential)=',
      description:
        'Sensitive data may be passed in URL query parameters. URLs are logged in browser history, server logs, and referrer headers.',
      remediation:
        'Pass sensitive data in request headers or request bodies (POST) instead of URL parameters.',
      cwe: 'CWE-598',
      owasp: 'A02:2021-Cryptographic Failures',
    },
    {
      id: 'SEC-039',
      name: 'Stack Trace Exposure',
      category: 'data-exposure',
      severity: 'low',
      pattern:
        '(?i)(?:app\\.use|app\\.all|middleware).*err\\.(?:stack|message).*(?:res\\.send|res\\.json|res\\.write|response\\.write)',
      description:
        'Stack traces may be exposed to end users through error handlers. This reveals internal application structure.',
      remediation:
        'Return generic error responses in production. Only include stack traces in development mode. Use environment-based error handling.',
      cwe: 'CWE-209',
    },
    {
      id: 'SEC-040',
      name: 'Information Disclosure via Comment',
      category: 'data-exposure',
      severity: 'low',
      pattern:
        '(?i)(?:\\/\\/|#|<!--|\\*).*\\b(?:TODO:\\s*(?:hack|security|vuln|fixme)|FIXME:\\s*(?:security|auth)|HACK:|XXX:|BUG:)',
      description:
        'A source code comment indicates a known security issue or hack. These should be tracked and resolved.',
      remediation:
        'Create tickets for all security-related TODO/FIXME comments. Resolve them before deploying to production.',
    },
    {
      id: 'SEC-041',
      name: 'PII/Sensitive Data Pattern (SSN)',
      category: 'data-exposure',
      severity: 'high',
      pattern:
        '\\b\\d{3}-\\d{2}-\\d{4}\\b',
      description:
        'A pattern resembling a US Social Security Number (SSN) was detected. SSNs are highly sensitive PII.',
      remediation:
        'Do not store or process SSNs in code files. If necessary, encrypt at rest and in transit, and comply with applicable data protection regulations.',
      cwe: 'CWE-359',
      owasp: 'A01:2021-Broken Access Control',
    },
    {
      id: 'SEC-042',
      name: 'Credit Card Number Pattern',
      category: 'data-exposure',
      severity: 'high',
      pattern:
        '\\b(?:\\d{4}[\\s-]?){3}\\d{4}\\b',
      description:
        'A pattern resembling a credit card number was detected. Payment card data is subject to PCI-DSS compliance requirements.',
      remediation:
        'Never store raw credit card numbers. Use tokenization via a payment processor and ensure PCI-DSS compliance.',
      cwe: 'CWE-359',
      owasp: 'A01:2021-Broken Access Control',
    },

    // ============================================
    // Cryptographic (rules 043-050)
    // ============================================
    {
      id: 'SEC-043',
      name: 'Weak Encryption Algorithm (DES/3DES/RC4/Blowfish)',
      category: 'cryptographic',
      severity: 'high',
      pattern:
        '(?i)(?:createCipher|createCipheriv|Cipher)\\s*\\(\\s*["\'](?:des|des3|tripledes|rc4|blowfish|arc4)["\']',
      description:
        'A weak or broken encryption algorithm is being used. These algorithms are vulnerable to known attacks.',
      remediation:
        'Use AES-256-GCM or ChaCha20-Poly1305 for encryption. DES, 3DES, RC4, and Blowfish are all deprecated for security use.',
      cwe: 'CWE-327',
      owasp: 'A02:2021-Cryptographic Failures',
    },
    {
      id: 'SEC-044',
      name: 'Hardcoded Initialization Vector (IV)',
      category: 'cryptographic',
      severity: 'high',
      pattern:
        '(?i)(?:iv|initializationVector|nonce)\\s*[:=]\\s*(?:Buffer\\.from|Uint8Array|new byte)\\s*\\(\\s*["\'][A-Za-z0-9+/=]+["\']',
      description:
        'An initialization vector (IV) appears to be hardcoded. Reusing IVs with the same key undermines encryption security.',
      remediation:
        'Generate a unique, random IV for each encryption operation using crypto.randomBytes() or equivalent.',
      cwe: 'CWE-329',
      owasp: 'A02:2021-Cryptographic Failures',
    },
    {
      id: 'SEC-045',
      name: 'ECB Mode Usage',
      category: 'cryptographic',
      severity: 'high',
      pattern:
        '(?i)(?:createCipher|createCipheriv|Cipher)\\s*\\(\\s*["\']aes-?128-?ecb["\']|(?:createCipher|createCipheriv|Cipher)\\s*\\(\\s*["\']aes-?256-?ecb["\']',
      description:
        'ECB (Electronic Codebook) mode is being used. ECB mode encrypts identical plaintext blocks into identical ciphertext blocks, leaking patterns.',
      remediation:
        'Use authenticated encryption modes like AES-GCM or AES-CBC with a proper IV. Never use ECB mode for encrypting more than one block.',
      cwe: 'CWE-327',
      owasp: 'A02:2021-Cryptographic Failures',
    },
    {
      id: 'SEC-046',
      name: 'Small RSA Key Size',
      category: 'cryptographic',
      severity: 'high',
      pattern:
        '(?i)(?:generateKeyPair|RSA|rsa)\\s*.*(?:modulusLength|keySize|bits)\\s*[:=]\\s*(?:512|768|1024|2048)\\b',
      description:
        'An RSA key size of 2048 bits or less may be insufficient for long-term security. Keys below 2048 bits are considered weak.',
      remediation:
        'Use at minimum 3072-bit RSA keys (4096-bit recommended for new deployments). Consider using Ed25519 for digital signatures.',
      cwe: 'CWE-326',
      owasp: 'A02:2021-Cryptographic Failures',
    },
    {
      id: 'SEC-047',
      name: 'Insecure Random Number Generator',
      category: 'cryptographic',
      severity: 'high',
      pattern:
        '(?i)(?:Math\\.random|rand\\(\\)|srand\\(\\)|random\\.random)\\s*(?:\\(\\)|).*(?:token|password|secret|key|session|nonce|salt)',
      description:
        'A non-cryptographic random number generator is being used for a security-sensitive purpose. These generators are predictable.',
      remediation:
        'Use crypto.randomBytes(), crypto.getRandomValues(), or a cryptographic PRNG for all security-sensitive operations.',
      cwe: 'CWE-338',
      owasp: 'A02:2021-Cryptographic Failures',
    },
    {
      id: 'SEC-048',
      name: 'Missing Integrity Check (HMAC)',
      category: 'cryptographic',
      severity: 'medium',
      pattern:
        '(?i)(?:createCipher|createCipheriv|Cipher)\\s*\\(\\s*["\']aes-(?:128|256)-cbc["\']',
      description:
        'AES-CBC mode is used without apparent HMAC verification. Unauthenticated encryption is vulnerable to padding oracle attacks.',
      remediation:
        'Use authenticated encryption (AEAD) such as AES-256-GCM, or manually add an HMAC for integrity verification after encryption.',
      cwe: 'CWE-353',
      owasp: 'A02:2021-Cryptographic Failures',
    },
    {
      id: 'SEC-049',
      name: 'Deprecated Crypto API',
      category: 'cryptographic',
      severity: 'medium',
      pattern:
        '(?i)crypto\\.createCipher\\s*\\(\\s*(?!"\')|(?i)Cipher\\s*\\(\\s*(?!.*iv)',
      description:
        'A deprecated crypto API is being used. crypto.createCipher (without IV) is deprecated in Node.js and insecure.',
      remediation:
        'Use crypto.createCipheriv() with a proper algorithm, key, and IV. The createCipher API was deprecated due to security issues.',
      cwe: 'CWE-327',
      owasp: 'A02:2021-Cryptographic Failures',
    },
    {
      id: 'SEC-050',
      name: 'Hardcoded Encryption Key',
      category: 'cryptographic',
      severity: 'critical',
      pattern:
        '(?i)(?:encryption[_-]?key|encrypt[_-]?key|cipher[_-]?key|aes[_-]?key)\\s*[:=]\\s*["\'][A-Za-z0-9+/=]{16,}["\']',
      description:
        'An encryption key appears to be hardcoded. This compromises the entire encryption scheme if the code is exposed.',
      remediation:
        'Store encryption keys in a key management service (KMS) or secrets manager. Use key derivation functions (PBKDF2, HKDF) when deriving keys from passwords.',
      cwe: 'CWE-798',
      owasp: 'A02:2021-Cryptographic Failures',
    },
  ];
}

// -----------------------------------------------------------
// SecurityScanner class
// -----------------------------------------------------------

export class SecurityScanner {
  private rules: SecurityRule[];
  private vulnerabilities: SecurityVulnerability[];
  private ignoredRules: Set<string>;
  private ignoredFiles: Set<string>;
  private ignoreEntries: IgnoreEntry[];
  private config: SecurityScanConfig;
  private vulnCounter: number;
  private rootDir: string;

  constructor(rootDir?: string, config?: Partial<SecurityScanConfig>) {
    this.rootDir = rootDir || process.cwd();
    this.rules = getDefaultRules();
    this.vulnerabilities = [];
    this.ignoredRules = new Set<string>();
    this.ignoredFiles = new Set<string>();
    this.ignoreEntries = [];
    this.vulnCounter = 0;

    this.config = {
      enabled: true,
      autoScanOnChange: false,
      failOnSeverity: 'critical',
      excludePatterns: [...DEFAULT_EXCLUDE_PATTERNS],
      customRules: [],
      ...config,
    };

    // Add custom rules if provided
    if (this.config.customRules.length > 0) {
      this.rules.push(...this.config.customRules);
    }

    // Load ignore file if it exists
    this.loadIgnoreFile();
  }

  // ---------------------------------------------------------
  // Public API
  // ---------------------------------------------------------

  /**
   * Scan a single file for security issues.
   */
  scanFile(filePath: string): SecurityVulnerability[] {
    const absolutePath = resolve(filePath);

    if (!existsSync(absolutePath)) {
      return [];
    }

    const stat = statSync(absolutePath);
    if (stat.isDirectory()) {
      return [];
    }

    if (stat.size > MAX_FILE_SIZE) {
      return [];
    }

    // Check if file is ignored
    if (this.isFilePathIgnored(absolutePath)) {
      return [];
    }

    let content: string;
    try {
      content = readFileSync(absolutePath, 'utf-8');
    } catch {
      return [];
    }

    const findings = this.scanContent(content, absolutePath);
    this.vulnerabilities.push(...findings);
    return findings;
  }

  /**
   * Scan an entire directory for security issues.
   */
  scanDirectory(
    dirPath: string,
    options?: ScanOptions,
  ): SecurityScanResult {
    const startTime = Date.now();
    const absoluteDir = resolve(dirPath);
    const allFindings: SecurityVulnerability[] = [];
    let filesScanned = 0;

    const effectiveOptions: ScanOptions = {
      recursive: true,
      excludePatterns: [
        ...this.config.excludePatterns,
        ...(options?.excludePatterns || []),
      ],
      maxFileSize: options?.maxFileSize || MAX_FILE_SIZE,
      fileExtensions: options?.fileExtensions || DEFAULT_FILE_EXTENSIONS,
    };

    // Reset state for a fresh scan
    this.vulnerabilities = [];
    this.vulnCounter = 0;

    this.walkDirectory(
      absoluteDir,
      allFindings,
      effectiveOptions,
      (count) => {
        filesScanned = count;
      },
    );

    const duration = Date.now() - startTime;

    return {
      totalVulnerabilities: allFindings.length,
      critical: allFindings.filter((v) => v.severity === 'critical').length,
      high: allFindings.filter((v) => v.severity === 'high').length,
      medium: allFindings.filter((v) => v.severity === 'medium').length,
      low: allFindings.filter((v) => v.severity === 'low').length,
      info: allFindings.filter((v) => v.severity === 'info').length,
      files: filesScanned,
      duration,
      vulnerabilities: allFindings,
    };
  }

  /**
   * Scan a unified diff for security issues.
   */
  scanDiff(diff: string): SecurityVulnerability[] {
    const hunks = this.parseDiff(diff);
    const allFindings: SecurityVulnerability[] = [];

    for (const hunk of hunks) {
      if (hunk.changeType === 'remove') continue; // only scan added lines

      const findings = this.scanContent(hunk.content, hunk.file);
      // Adjust line numbers to the diff's line
      for (const finding of findings) {
        finding.line = hunk.line;
        finding.file = hunk.file;
      }
      allFindings.push(...findings);
    }

    this.vulnerabilities.push(...allFindings);
    return allFindings;
  }

  /**
   * Get all found vulnerabilities.
   */
  getVulnerabilities(): SecurityVulnerability[] {
    return [...this.vulnerabilities];
  }

  /**
   * Get vulnerability counts by severity.
   */
  getSeverityCounts(): Record<string, number> {
    return {
      critical: this.vulnerabilities.filter((v) => v.severity === 'critical')
        .length,
      high: this.vulnerabilities.filter((v) => v.severity === 'high').length,
      medium: this.vulnerabilities.filter((v) => v.severity === 'medium')
        .length,
      low: this.vulnerabilities.filter((v) => v.severity === 'low').length,
      info: this.vulnerabilities.filter((v) => v.severity === 'info').length,
      total: this.vulnerabilities.length,
    };
  }

  /**
   * Generate a report in the specified format.
   */
  generateReport(
    format: 'json' | 'markdown' | 'sarif' = 'json',
  ): string {
    switch (format) {
      case 'json':
        return this.generateJsonReport();
      case 'markdown':
        return this.generateMarkdownReport();
      case 'sarif':
        return this.generateSarifReport();
      default:
        return this.generateJsonReport();
    }
  }

  /**
   * Configure custom rules. Replaces existing custom rules.
   */
  setRules(rules: SecurityRule[]): void {
    // Remove previous custom rules
    this.rules = getDefaultRules();
    // Add the new custom rules
    this.rules.push(...rules);
    this.config.customRules = rules;
  }

  /**
   * Ignore a specific rule by its ID.
   */
  ignoreRule(ruleId: string): void {
    this.ignoredRules.add(ruleId);
  }

  /**
   * Ignore findings in a specific file.
   */
  ignoreFile(filePath: string): void {
    const absolutePath = resolve(filePath);
    this.ignoredFiles.add(absolutePath);
  }

  /**
   * Get remediation suggestions for a vulnerability.
   */
  getRemediation(vulnId: string): string | null {
    const vuln = this.vulnerabilities.find((v) => v.id === vulnId);
    if (!vuln) return null;

    const rule = this.rules.find((r) => r.id === vuln.ruleId);
    if (!rule) return vuln.remediation;

    return [
      `## ${rule.name}`,
      ``,
      `**Rule ID:** ${rule.id}`,
      `**Severity:** ${vuln.severity}`,
      `**Category:** ${rule.category}`,
      vuln.cwe ? `**CWE:** ${vuln.cwe}` : '',
      vuln.owasp ? `**OWASP:** ${vuln.owasp}` : '',
      ``,
      `### Description`,
      rule.description,
      ``,
      `### Remediation`,
      rule.remediation,
      ``,
      `### Location`,
      `- **File:** ${vuln.file}`,
      `- **Line:** ${vuln.line}`,
      `- **Column:** ${vuln.column}`,
      `- **Confidence:** ${vuln.confidence}`,
    ]
      .filter(Boolean)
      .join('\n');
  }

  /**
   * Compute a CVSS-like score for the current set of vulnerabilities.
   */
  getCVSSLikeScore(): number {
    if (this.vulnerabilities.length === 0) return 0;

    const counts = this.getSeverityCounts();
    let weightedSum = 0;
    let maxSeverity = 0;

    for (const [severity, weight] of Object.entries(SEVERITY_WEIGHTS)) {
      const count = counts[severity] || 0;
      weightedSum += weight * count;
      if (count > 0 && weight > maxSeverity) {
        maxSeverity = weight;
      }
    }

    // Base score: weighted average, capped at 10
    const avgScore = weightedSum / this.vulnerabilities.length;
    // Factor in the worst finding
    const combinedScore = avgScore * 0.4 + maxSeverity * 0.6;

    return Math.min(10, Math.round(combinedScore * 10) / 10);
  }

  /**
   * Clear all found vulnerabilities.
   */
  clear(): void {
    this.vulnerabilities = [];
    this.vulnCounter = 0;
  }

  /**
   * Get all active rules.
   */
  getRules(): SecurityRule[] {
    return [...this.rules];
  }

  /**
   * Get the current configuration.
   */
  getConfig(): SecurityScanConfig {
    return { ...this.config };
  }

  /**
   * Update configuration.
   */
  updateConfig(partial: Partial<SecurityScanConfig>): void {
    Object.assign(this.config, partial);
  }

  /**
   * Export findings to a file.
   */
  exportReport(
    outputPath: string,
    format: 'json' | 'markdown' | 'sarif' = 'json',
  ): void {
    const report = this.generateReport(format);
    const dir = dirname(outputPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(outputPath, report, 'utf-8');
  }

  // ---------------------------------------------------------
  // Private: scanning internals
  // ---------------------------------------------------------

  private scanContent(
    content: string,
    filePath: string,
  ): SecurityVulnerability[] {
    const lines = content.split('\n');
    const findings: SecurityVulnerability[] = [];

    for (const rule of this.rules) {
      // Skip ignored rules
      if (this.ignoredRules.has(rule.id)) continue;

      let regex: RegExp;
      try {
        regex = new RegExp(rule.pattern, 'gi');
      } catch {
        // Invalid regex pattern — skip this rule
        continue;
      }

      for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        const line = lines[lineIndex];
        regex.lastIndex = 0; // Reset for each line
        let match: RegExpExecArray | null;

        try {
          match = regex.exec(line);
        } catch {
          continue;
        }

        if (match) {
          const column = match.index + 1;
          const vulnId = this.generateVulnId();

          // Determine confidence based on context
          const confidence = this.assessConfidence(
            rule,
            line,
            filePath,
          );

          // Check if this specific finding is ignored
          if (
            this.isFindingIgnored(
              rule.id,
              filePath,
              lineIndex + 1,
            )
          ) {
            continue;
          }

          findings.push({
            id: vulnId,
            ruleId: rule.id,
            file: filePath,
            line: lineIndex + 1,
            column,
            severity: rule.severity,
            category: rule.category,
            title: rule.name,
            description: rule.description,
            remediation: rule.remediation,
            cwe: rule.cwe,
            owasp: rule.owasp,
            confidence,
          });
        }
      }
    }

    return findings;
  }

  private walkDirectory(
    dir: string,
    findings: SecurityVulnerability[],
    options: ScanOptions,
    onFileCount: (count: number) => void,
    currentCount: number = 0,
  ): number {
    let fileCount = currentCount;

    if (!existsSync(dir)) return fileCount;

    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true }) as Dirent[];
    } catch {
      return fileCount;
    }

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        if (!options.recursive) continue;
        if (this.isPathExcluded(fullPath, options.excludePatterns || []))
          continue;
        fileCount = this.walkDirectory(
          fullPath,
          findings,
          options,
          onFileCount,
          fileCount,
        );
        continue;
      }

      if (entry.isFile()) {
        // Check extension filter
        const ext = extname(entry.name).toLowerCase();
        if (
          options.fileExtensions &&
          options.fileExtensions.length > 0 &&
          !options.fileExtensions.includes(ext)
        ) {
          continue;
        }

        // Check exclude patterns
        if (this.isPathExcluded(fullPath, options.excludePatterns || []))
          continue;

        // Check ignored files
        if (this.isFilePathIgnored(fullPath)) continue;

        // Check file size
        try {
          const stat = statSync(fullPath);
          if (stat.size > (options.maxFileSize || MAX_FILE_SIZE)) continue;
        } catch {
          continue;
        }

        // Scan the file
        try {
          const content = readFileSync(fullPath, 'utf-8');
          const fileFindings = this.scanContent(content, fullPath);
          findings.push(...fileFindings);
        } catch {
          // Skip files that cannot be read as text
        }

        fileCount++;
        onFileCount(fileCount);
      }
    }

    return fileCount;
  }

  // ---------------------------------------------------------
  // Private: diff parsing
  // ---------------------------------------------------------

  private parseDiff(diff: string): DiffHunk[] {
    const hunks: DiffHunk[] = [];
    const lines = diff.split('\n');
    let currentFile = 'unknown';
    let currentLine = 0;

    for (const line of lines) {
      // Detect file path from diff headers
      const fileMatch = line.match(
        /^diff --git a\/(.+?) b\/(.+?)$|^--- (?:a\/)?(.+?)$|^\+\+\+ (?:b\/)?(.+?)$/,
      );
      if (fileMatch) {
        const newFile =
          fileMatch[4] || fileMatch[3] || fileMatch[2] || fileMatch[1];
        if (newFile && newFile !== '/dev/null') {
          currentFile = newFile;
        }
        continue;
      }

      // Detect hunk header: @@ -a,b +c,d @@
      const hunkMatch = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (hunkMatch) {
        currentLine = parseInt(hunkMatch[1], 10);
        continue;
      }

      // Added line
      if (line.startsWith('+') && !line.startsWith('++')) {
        hunks.push({
          file: currentFile,
          line: currentLine,
          content: line.substring(1),
          changeType: 'add',
        });
        currentLine++;
        continue;
      }

      // Removed line
      if (line.startsWith('-') && !line.startsWith('--')) {
        hunks.push({
          file: currentFile,
          line: currentLine,
          content: line.substring(1),
          changeType: 'remove',
        });
        continue;
      }

      // Context line
      if (line.startsWith(' ') || line.match(/^\d+/)) {
        currentLine++;
      }
    }

    return hunks;
  }

  // ---------------------------------------------------------
  // Private: ignore file handling
  // ---------------------------------------------------------

  private loadIgnoreFile(): void {
    const ignorePath = join(this.rootDir, IGNORE_FILE_NAME);
    if (!existsSync(ignorePath)) return;

    try {
      const content = readFileSync(ignorePath, 'utf-8');
      const lines = content.split('\n');

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;

        // Format: ruleId [file[:line]] [# reason]
        // Examples:
        //   SEC-029
        //   SEC-029 src/config.ts
        //   SEC-029 src/config.ts:42
        //   SEC-029 src/config.ts:42 # False positive for localhost
        const parts = trimmed.split('#');
        const mainPart = (parts[0] || '').trim();
        const reason = (parts[1] || '').trim();

        const tokens = mainPart.split(/\s+/);
        const ruleId = tokens[0];
        const fileRef = tokens[1] || undefined;

        const entry: IgnoreEntry = { ruleId, reason: reason || undefined };

        if (fileRef) {
          if (fileRef.includes(':')) {
            const [file, lineStr] = fileRef.split(':');
            entry.file = file;
            entry.line = parseInt(lineStr, 10) || undefined;
          } else {
            entry.file = fileRef;
          }
        }

        this.ignoreEntries.push(entry);

        // Also add to quick-lookup sets
        if (ruleId && !fileRef) {
          this.ignoredRules.add(ruleId);
        }
        if (entry.file && !ruleId?.includes('SEC-')) {
          this.ignoredFiles.add(resolve(entry.file));
        }
      }
    } catch {
      // Ignore file read errors
    }
  }

  private isFilePathIgnored(absolutePath: string): boolean {
    const ignoredList = Array.from(this.ignoredFiles);
    for (const ignored of ignoredList) {
      if (absolutePath === ignored || absolutePath.startsWith(ignored + sep)) {
        return true;
      }
    }
    // Check ignore entries with file patterns
    for (const entry of this.ignoreEntries) {
      if (entry.file && !entry.ruleId) {
        const ignoredPath = resolve(entry.file);
        if (
          absolutePath === ignoredPath ||
          absolutePath.startsWith(ignoredPath + sep)
        ) {
          return true;
        }
      }
    }
    return false;
  }

  private isFindingIgnored(
    ruleId: string,
    filePath: string,
    line: number,
  ): boolean {
    if (this.ignoredRules.has(ruleId)) return true;

    for (const entry of this.ignoreEntries) {
      if (entry.ruleId !== ruleId) continue;
      if (!entry.file) return true; // Rule globally ignored

      const normalizedEntryFile = resolve(entry.file);
      const normalizedFindingFile = resolve(filePath);

      if (normalizedFindingFile !== normalizedEntryFile) continue;
      if (!entry.line) return true; // Rule ignored for this file
      if (entry.line === line) return true; // Rule ignored on this specific line
    }

    return false;
  }

  // ---------------------------------------------------------
  // Private: path exclusion
  // ---------------------------------------------------------

  private isPathExcluded(
    filePath: string,
    patterns: string[],
  ): boolean {
    const relativePath = relative(this.rootDir, filePath);
    const normalizedPath = relativePath.replace(/\\/g, '/');

    for (const pattern of patterns) {
      const normalizedPattern = pattern.replace(/\\/g, '/');

      // Convert simple glob patterns to regex
      const regexPattern = normalizedPattern
        .replace(/\./g, '\\.')
        .replace(/\*\*/g, '§§') // Temporarily mark **
        .replace(/\*/g, '[^/]*')
        .replace(/§§/g, '.*')
        .replace(/\?/g, '[^/]');

      try {
        const regex = new RegExp(regexPattern, 'i');
        if (regex.test(normalizedPath) || regex.test(filePath.replace(/\\/g, '/'))) {
          return true;
        }
      } catch {
        // Skip invalid patterns
      }

      // Also check direct segment match
      const segments = normalizedPattern.split('/');
      for (const segment of segments) {
        if (
          segment &&
          !segment.includes('*') &&
          normalizedPath.includes(segment)
        ) {
          // Verify it's a real segment match, not a substring
          const pathParts = normalizedPath.split('/');
          if (pathParts.includes(segment)) {
            return true;
          }
        }
      }
    }

    return false;
  }

  // ---------------------------------------------------------
  // Private: confidence assessment
  // ---------------------------------------------------------

  private assessConfidence(
    rule: SecurityRule,
    line: string,
    filePath: string,
  ): 'high' | 'medium' | 'low' {
    const trimmedLine = line.trim();

    // Comments are low confidence
    if (
      trimmedLine.startsWith('//') ||
      trimmedLine.startsWith('#') ||
      trimmedLine.startsWith('/*') ||
      trimmedLine.startsWith('*') ||
      trimmedLine.startsWith('--') ||
      trimmedLine.startsWith('<!--')
    ) {
      return 'low';
    }

    // String literals in test files are lower confidence
    const ext = extname(filePath);
    const baseName = basename(filePath).toLowerCase();
    const isTestFile =
      baseName.includes('.test.') ||
      baseName.includes('.spec.') ||
      baseName.includes('_test.') ||
      baseName.includes('test_') ||
      baseName.includes('.e2e.') ||
      baseName.includes('mock') ||
      baseName.includes('fixture') ||
      baseName.includes('stub');

    if (isTestFile) {
      return 'low';
    }

    // Example/doc files are lower confidence
    const isDocFile =
      baseName.includes('readme') ||
      baseName.includes('example') ||
      baseName.includes('demo') ||
      ext === '.md';

    if (isDocFile) {
      return 'low';
    }

    // Configuration files often have false positives
    const isConfigFile =
      ext === '.json' ||
      ext === '.yaml' ||
      ext === '.yml' ||
      ext === '.toml' ||
      ext === '.ini' ||
      ext === '.cfg' ||
      ext === '.env';

    if (isConfigFile && rule.category === 'hardcoded-secrets') {
      return 'medium';
    }

    // Variable assignment patterns are high confidence for secrets
    if (
      rule.category === 'hardcoded-secrets' &&
      (trimmedLine.includes('=') || trimmedLine.includes(':'))
    ) {
      // Check if it's an actual assignment (not a comparison)
      const hasSingleEquals =
        trimmedLine.includes('=') && !trimmedLine.includes('==');
      const hasColon = trimmedLine.includes(':');
      if (hasSingleEquals || hasColon) {
        return 'high';
      }
    }

    // Injection patterns with user input references are high confidence
    if (
      rule.category === 'injection' &&
      (trimmedLine.includes('req.') ||
        trimmedLine.includes('request.') ||
        trimmedLine.includes('params.') ||
        trimmedLine.includes('query.') ||
        trimmedLine.includes('input') ||
        trimmedLine.includes('user'))
    ) {
      return 'high';
    }

    // Default to medium
    return 'medium';
  }

  // ---------------------------------------------------------
  // Private: ID generation
  // ---------------------------------------------------------

  private generateVulnId(): string {
    this.vulnCounter++;
    const timestamp = Date.now().toString(36);
    const counter = this.vulnCounter.toString(36);
    const random = Math.random().toString(36).substring(2, 6);
    return `VUL-${timestamp}-${counter}-${random}`;
  }

  // ---------------------------------------------------------
  // Private: report generation
  // ---------------------------------------------------------

  private generateJsonReport(): string {
    const result: SecurityScanResult = {
      totalVulnerabilities: this.vulnerabilities.length,
      critical: this.vulnerabilities.filter((v) => v.severity === 'critical')
        .length,
      high: this.vulnerabilities.filter((v) => v.severity === 'high').length,
      medium: this.vulnerabilities.filter((v) => v.severity === 'medium')
        .length,
      low: this.vulnerabilities.filter((v) => v.severity === 'low').length,
      info: this.vulnerabilities.filter((v) => v.severity === 'info').length,
      files: new Set(this.vulnerabilities.map((v) => v.file)).size,
      duration: 0,
      vulnerabilities: this.vulnerabilities,
    };

    return JSON.stringify(
      {
        scanner: 'NeuroCLI Security Scanner',
        version: '3.0.0',
        timestamp: new Date().toISOString(),
        cvssLikeScore: this.getCVSSLikeScore(),
        result,
      },
      null,
      2,
    );
  }

  private generateMarkdownReport(): string {
    const counts = this.getSeverityCounts();
    const score = this.getCVSSLikeScore();
    const lines: string[] = [];

    lines.push('# NeuroCLI Security Scan Report');
    lines.push('');
    lines.push(
      `**Generated:** ${new Date().toISOString()}`,
    );
    lines.push(`**Scanner:** NeuroCLI Security Scanner v3.0.0`);
    lines.push(`**CVSS-like Score:** ${score}/10`);
    lines.push('');

    // Summary table
    lines.push('## Summary');
    lines.push('');
    lines.push('| Severity | Count |');
    lines.push('|----------|-------|');
    lines.push(`| 🔴 Critical | ${counts.critical} |`);
    lines.push(`| 🟠 High | ${counts.high} |`);
    lines.push(`| 🟡 Medium | ${counts.medium} |`);
    lines.push(`| 🔵 Low | ${counts.low} |`);
    lines.push(`| ⚪ Info | ${counts.info} |`);
    lines.push(`| **Total** | **${counts.total}** |`);
    lines.push('');

    // Group by severity
    const severities: Array<
      SecurityVulnerability['severity']
    > = ['critical', 'high', 'medium', 'low', 'info'];
    const severityEmoji: Record<string, string> = {
      critical: '🔴',
      high: '🟠',
      medium: '🟡',
      low: '🔵',
      info: '⚪',
    };

    for (const severity of severities) {
      const vulns = this.vulnerabilities.filter(
        (v) => v.severity === severity,
      );
      if (vulns.length === 0) continue;

      lines.push(
        `## ${severityEmoji[severity]} ${severity.charAt(0).toUpperCase() + severity.slice(1)} Severity`,
      );
      lines.push('');

      // Group by category
      const byCategory = new Map<string, SecurityVulnerability[]>();
      for (const vuln of vulns) {
        const existing = byCategory.get(vuln.category) || [];
        existing.push(vuln);
        byCategory.set(vuln.category, existing);
      }

      for (const [category, categoryVulns] of Array.from(byCategory.entries())) {
        lines.push(
          `### ${category.charAt(0).toUpperCase() + category.slice(1).replace(/-/g, ' ')}`,
        );
        lines.push('');

        for (const vuln of categoryVulns) {
          lines.push(
            `#### \`${vuln.ruleId}\` - ${vuln.title}`,
          );
          lines.push('');
          lines.push(`- **File:** \`${vuln.file}\``);
          lines.push(`- **Line:** ${vuln.line}, Column ${vuln.column}`);
          lines.push(`- **Confidence:** ${vuln.confidence}`);
          if (vuln.cwe) lines.push(`- **CWE:** ${vuln.cwe}`);
          if (vuln.owasp) lines.push(`- **OWASP:** ${vuln.owasp}`);
          lines.push('');
          lines.push(vuln.description);
          lines.push('');
          lines.push('**Remediation:**');
          lines.push(vuln.remediation);
          lines.push('');
          lines.push('---');
          lines.push('');
        }
      }
    }

    if (this.vulnerabilities.length === 0) {
      lines.push('## ✅ No vulnerabilities found');
      lines.push('');
      lines.push(
        'Your codebase appears to be free of the security issues checked by the scanner.',
      );
    }

    return lines.join('\n');
  }

  private generateSarifReport(): string {
    const sarif = {
      $schema:
        'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/main/sarif-2.1/schema/sarif-schema-2.1.0.json',
      version: '2.1.0',
      runs: [
        {
          tool: {
            driver: {
              name: 'NeuroCLI Security Scanner',
              version: '3.0.0',
              informationUri: 'https://neurocli.dev/docs/security',
              rules: this.rules.map((rule) => ({
                id: rule.id,
                name: rule.name,
                shortDescription: {
                  text: rule.description,
                },
                fullDescription: {
                  text: rule.description,
                },
                helpUri: rule.cwe
                  ? `https://cwe.mitre.org/data/definitions/${rule.cwe.replace('CWE-', '')}.html`
                  : undefined,
                properties: {
                  category: rule.category,
                  severity: rule.severity,
                  'security-severity':
                    SEVERITY_WEIGHTS[rule.severity].toString(),
                  cwe: rule.cwe,
                  owasp: rule.owasp,
                },
                defaultConfiguration: {
                  level: this.severityToSarifLevel(rule.severity),
                },
              })),
            },
          },
          results: this.vulnerabilities.map((vuln) => ({
            ruleId: vuln.ruleId,
            level: this.severityToSarifLevel(vuln.severity),
            message: {
              text: vuln.description,
            },
            locations: [
              {
                physicalLocation: {
                  artifactLocation: {
                    uri: vuln.file.replace(/\\/g, '/'),
                  },
                  region: {
                    startLine: vuln.line,
                    startColumn: vuln.column,
                  },
                },
              },
            ],
            properties: {
              confidence: vuln.confidence,
              remediation: vuln.remediation,
              cwe: vuln.cwe,
              owasp: vuln.owasp,
            },
          })),
        },
      ],
    };

    return JSON.stringify(sarif, null, 2);
  }

  private severityToSarifLevel(
    severity: string,
  ): string {
    switch (severity) {
      case 'critical':
      case 'high':
        return 'error';
      case 'medium':
        return 'warning';
      case 'low':
        return 'note';
      case 'info':
        return 'none';
      default:
        return 'warning';
    }
  }
}

// -----------------------------------------------------------
// Convenience factory
// -----------------------------------------------------------

/**
 * Create a pre-configured SecurityScanner instance.
 */
export function createSecurityScanner(
  rootDir?: string,
  config?: Partial<SecurityScanConfig>,
): SecurityScanner {
  return new SecurityScanner(rootDir, config);
}

/**
 * Quick-scan a single file and return findings.
 */
export function quickScanFile(
  filePath: string,
): SecurityVulnerability[] {
  const scanner = new SecurityScanner();
  return scanner.scanFile(filePath);
}

/**
 * Quick-scan a directory and return a full result.
 */
export function quickScanDirectory(
  dirPath: string,
  options?: ScanOptions,
): SecurityScanResult {
  const scanner = new SecurityScanner(dirPath);
  return scanner.scanDirectory(dirPath, options);
}

/**
 * Quick-scan a diff and return findings.
 */
export function quickScanDiff(
  diff: string,
): SecurityVulnerability[] {
  const scanner = new SecurityScanner();
  return scanner.scanDiff(diff);
}

/**
 * Get the default set of security rules.
 */
export function getDefaultSecurityRules(): SecurityRule[] {
  return getDefaultRules();
}

import { readFileSync, readdirSync, existsSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
// ---------------------------------------------------------------------------
// Built-in skill definitions
// ---------------------------------------------------------------------------
const BUILTIN_SKILLS = [
    {
        name: 'react',
        description: 'React/Next.js development patterns, component architecture, hooks, and state management',
        triggers: [
            '\\breact\\b',
            '\\bnext\\.?js\\b',
            '\\bjsx\\b',
            '\\btsx\\b',
            '\\bcomponent\\b',
            '\\bhook\\b',
            '\\busestate\\b',
            '\\buseeffect\\b',
            'state management',
            'server component',
            'client component',
        ],
        systemPromptAddition: [
            'When working on React/Next.js code, follow these guidelines:',
            '- Prefer function components with hooks over class components.',
            '- Use TypeScript for all new component files (.tsx).',
            '- Colocate state as close to where it is used as possible.',
            '- Extract reusable logic into custom hooks.',
            '- Use React.memo, useMemo, and useCallback only when profiling shows a real need.',
            '- Follow the Next.js App Router conventions for routing, layouts, and server components.',
            '- Prefer server components by default; add "use client" only when browser APIs or hooks are required.',
            '- Use streaming and Suspense boundaries for data-loading pages.',
            '- Keep component files focused; extract sub-components when a file exceeds 200 lines.',
        ].join('\n'),
        tools: ['file-editor', 'terminal', 'browser'],
        priority: 80,
        autoActivate: true,
        source: 'builtin',
        tags: ['frontend', 'framework', 'react'],
    },
    {
        name: 'api-design',
        description: 'REST API design and implementation, endpoint modeling, and HTTP best practices',
        triggers: [
            '\\bapi\\b',
            '\\brest\\b',
            '\\bendpoint\\b',
            '\\broute\\b',
            'http method',
            '\\bcrud\\b',
            '\\bopenapi\\b',
            '\\bswagger\\b',
            '\\bgraphql\\b',
            'request response',
            '\\bmiddleware\\b',
        ],
        systemPromptAddition: [
            'When designing or implementing APIs, follow these guidelines:',
            '- Use plural noun resource names (e.g. /users, /orders).',
            '- Return appropriate HTTP status codes (201 for creation, 204 for deletion, etc.).',
            '- Include pagination for list endpoints (cursor-based preferred).',
            '- Version APIs via URL path prefix (/v1/) or header.',
            '- Validate request bodies with a schema layer before handler logic.',
            '- Document every endpoint with request/response examples.',
            '- Handle errors with a consistent JSON error envelope.',
            '- Prefer idempotent designs for PUT and DELETE operations.',
            '- Use middleware for cross-cutting concerns (auth, logging, rate-limiting).',
        ].join('\n'),
        tools: ['file-editor', 'terminal', 'http-client'],
        priority: 70,
        autoActivate: true,
        source: 'builtin',
        tags: ['backend', 'api', 'http'],
    },
    {
        name: 'database',
        description: 'Database schema design, query optimization, and data modeling',
        triggers: [
            '\\bdatabase\\b',
            '\\bschema\\b',
            '\\bsql\\b',
            '\\bprisma\\b',
            '\\bdrizzle\\b',
            '\\bmigration\\b',
            '\\btable\\b',
            '\\bquery\\b',
            '\\bindex\\b',
            '\\borm\\b',
            '\\bpostgres\\b',
            '\\bmongodb\\b',
            '\\bsqlite\\b',
        ],
        systemPromptAddition: [
            'When working with databases, follow these guidelines:',
            '- Normalize to 3NF by default; denormalize only with measured justification.',
            '- Always write migrations as reversible (up + down).',
            '- Add indexes for columns used in WHERE, JOIN, and ORDER BY clauses.',
            '- Use foreign key constraints with appropriate ON DELETE actions.',
            '- Prefer parameterized queries; never interpolate user input into SQL.',
            '- Model soft deletes with a deleted_at column rather than removing rows.',
            '- Use transactions for multi-step writes that must succeed or fail together.',
            '- Document the purpose of each table and non-obvious column in comments.',
            '- Keep migration files small and focused on one logical change.',
        ].join('\n'),
        tools: ['file-editor', 'terminal', 'database-client'],
        priority: 70,
        autoActivate: true,
        source: 'builtin',
        tags: ['backend', 'database', 'data'],
    },
    {
        name: 'testing',
        description: 'Test-driven development, test strategy, and quality assurance',
        triggers: [
            '\\btest\\b',
            '\\btesting\\b',
            '\\bunit test\\b',
            '\\bintegration test\\b',
            '\\be2e\\b',
            '\\bjest\\b',
            '\\bvitest\\b',
            '\\bplaywright\\b',
            '\\bpytest\\b',
            '\\bcoverage\\b',
            '\\bmock\\b',
            '\\bstub\\b',
            '\\btdd\\b',
        ],
        systemPromptAddition: [
            'When writing tests, follow these guidelines:',
            '- Write tests before implementation when practicing TDD; otherwise write them alongside.',
            '- Structure tests with Arrange-Act-Assert (Given-When-Then).',
            '- Test behavior, not implementation details.',
            '- Aim for meaningful coverage of business logic (>80%); do not chase 100% on trivial code.',
            '- Use descriptive test names that read as a specification.',
            '- Prefer integration tests for API routes; unit tests for pure functions.',
            '- Use test fixtures and factories instead of duplicating setup code.',
            '- Isolate external dependencies with mocks/stubs; avoid mocking internal modules.',
            '- Run the full suite before declaring work complete.',
        ].join('\n'),
        tools: ['file-editor', 'terminal', 'test-runner'],
        priority: 75,
        autoActivate: true,
        source: 'builtin',
        tags: ['testing', 'quality', 'tdd'],
    },
    {
        name: 'security',
        description: 'Security-first coding practices, vulnerability prevention, and hardening',
        triggers: [
            '\\bsecurity\\b',
            '\\bvulnerability\\b',
            '\\bauth\\b',
            '\\bauthentication\\b',
            '\\bauthorization\\b',
            '\\bcsrf\\b',
            '\\bxss\\b',
            '\\binjection\\b',
            '\\bencryption\\b',
            '\\bjwt\\b',
            '\\boauth\\b',
            '\\bsanitize\\b',
            '\\bcsp\\b',
        ],
        systemPromptAddition: [
            'When writing security-sensitive code, follow these guidelines:',
            '- Never trust user input; validate and sanitize at every trust boundary.',
            '- Use parameterized queries for all database operations.',
            '- Store passwords with bcrypt/argon2; never with plain hashes.',
            '- Apply the principle of least privilege to service accounts and API tokens.',
            '- Enable CSRF protection for all state-changing requests from browsers.',
            '- Set security headers: Content-Security-Policy, X-Content-Type-Options, Strict-Transport-Security.',
            '- Use environment variables for secrets; never commit them to source control.',
            '- Rotate secrets and API keys on a regular schedule.',
            '- Log security-relevant events but never log sensitive data (passwords, tokens).',
            '- Keep dependencies updated and audit for known vulnerabilities.',
        ].join('\n'),
        tools: ['file-editor', 'terminal'],
        priority: 90,
        autoActivate: true,
        source: 'builtin',
        tags: ['security', 'hardening', 'auth'],
    },
    {
        name: 'performance',
        description: 'Performance optimization, profiling, and efficient coding patterns',
        triggers: [
            '\\bperformance\\b',
            '\\boptimize\\b',
            '\\boptimization\\b',
            '\\bprofiling\\b',
            '\\bbottleneck\\b',
            '\\blatency\\b',
            '\\bthroughput\\b',
            '\\bcaching\\b',
            '\\blazy load\\b',
            '\\bcode splitting\\b',
            '\\bdebounce\\b',
            '\\bthrottle\\b',
        ],
        systemPromptAddition: [
            'When optimizing for performance, follow these guidelines:',
            '- Measure before and after every optimization; never optimize blindly.',
            '- Profile to identify actual bottlenecks rather than assumed ones.',
            '- Prefer algorithmic improvements over micro-optimizations.',
            '- Cache expensive computations and I/O; invalidate caches on data change.',
            '- Use lazy loading and code splitting for large front-end bundles.',
            '- Debounce or throttle high-frequency event handlers.',
            '- Batch database writes and network requests where possible.',
            '- Use connection pooling for database and HTTP clients.',
            '- Avoid premature optimization; write clear code first, then optimize hot paths.',
        ].join('\n'),
        tools: ['file-editor', 'terminal', 'profiler'],
        priority: 65,
        autoActivate: true,
        source: 'builtin',
        tags: ['performance', 'optimization', 'profiling'],
    },
    {
        name: 'debugging',
        description: 'Systematic debugging approach, root cause analysis, and troubleshooting',
        triggers: [
            '\\bdebug\\b',
            '\\bdebugging\\b',
            '\\berror\\b',
            '\\bbug\\b',
            '\\bcrash\\b',
            '\\bstack trace\\b',
            '\\btraceback\\b',
            '\\bfix\\b',
            '\\bissue\\b',
            '\\btroubleshoot\\b',
            '\\breproduce\\b',
            '\\broot cause\\b',
        ],
        systemPromptAddition: [
            'When debugging issues, follow these guidelines:',
            '- Reproduce the issue first; a reliable reproduction is half the fix.',
            '- Read the error message and stack trace carefully before making changes.',
            '- Form a hypothesis, test it with the smallest possible change, then iterate.',
            '- Use binary search (comment out half the code) to narrow down root cause.',
            '- Add logging around the failure point rather than changing logic speculatively.',
            '- Check recent changes (git log, git diff) for likely regressions.',
            '- Verify the fix with a test that reproduces the original issue.',
            '- Document the root cause and the fix in the PR description or a post-mortem.',
        ].join('\n'),
        tools: ['file-editor', 'terminal', 'debugger'],
        priority: 60,
        autoActivate: true,
        source: 'builtin',
        tags: ['debugging', 'troubleshooting', 'analysis'],
    },
    {
        name: 'devops',
        description: 'CI/CD pipelines, deployment strategies, and infrastructure automation',
        triggers: [
            '\\bci\\b\\/\\bcd\\b',
            '\\bcicd\\b',
            '\\bdeploy\\b',
            '\\bdeployment\\b',
            '\\bdocker\\b',
            '\\bkubernetes\\b',
            '\\bk8s\\b',
            '\\bpipeline\\b',
            '\\bgithub actions\\b',
            '\\bterraform\\b',
            '\\binfrastructure\\b',
            '\\bcontainer\\b',
            '\\bhelm\\b',
        ],
        systemPromptAddition: [
            'When working on CI/CD and deployment, follow these guidelines:',
            '- Treat infrastructure as code; version all config in the repository.',
            '- Keep pipelines fast: cache dependencies, parallelize independent steps.',
            '- Use separate stages for lint, test, build, deploy with clear gate conditions.',
            '- Deploy to staging before production; require manual approval for prod.',
            '- Use blue/green or canary deployments for zero-downtime releases.',
            '- Tag Docker images with both the git SHA and a semantic version.',
            '- Store secrets in a vault or secret manager, not in pipeline YAML.',
            '- Monitor deployment health; auto-rollback on error-rate spikes.',
            '- Document runbooks for common operational procedures.',
        ].join('\n'),
        tools: ['file-editor', 'terminal', 'docker', 'kubernetes'],
        priority: 65,
        autoActivate: true,
        source: 'builtin',
        tags: ['devops', 'ci-cd', 'infrastructure'],
    },
];
// ---------------------------------------------------------------------------
// SkillSystem
// ---------------------------------------------------------------------------
export class SkillSystem {
    skills;
    activeSkills;
    skillsDir;
    globalSkillsDir;
    projectRoot;
    constructor(projectRoot) {
        this.projectRoot = projectRoot;
        this.skillsDir = join(projectRoot, '.neuro', 'skills');
        this.globalSkillsDir = join(homedir(), '.neuro', 'skills');
        this.skills = new Map();
        this.activeSkills = new Map();
    }
    // -------------------------------------------------------------------------
    // Public API
    // -------------------------------------------------------------------------
    /** Discover and load all skills (builtin + global + project). */
    discover() {
        this.skills.clear();
        // Load in order: builtin -> global -> project (later loads override earlier)
        this.loadBuiltinSkills();
        this.loadFromDirectory(this.globalSkillsDir);
        this.loadFromDirectory(this.skillsDir);
        return this.getAllSkills();
    }
    /** Auto-activate skills whose trigger patterns match the given prompt. */
    autoActivate(prompt) {
        const activated = [];
        const lowerPrompt = prompt.toLowerCase();
        for (const skill of this.skills.values()) {
            // Skip skills already active
            if (this.activeSkills.has(skill.name)) {
                continue;
            }
            // Skip skills that are not auto-activatable
            if (!skill.autoActivate) {
                continue;
            }
            const matchReason = this.matchTriggers(lowerPrompt, skill.triggers);
            if (matchReason !== null) {
                const active = {
                    skill,
                    activatedAt: Date.now(),
                    activatedBy: 'auto',
                    matchReason,
                };
                this.activeSkills.set(skill.name, active);
                activated.push(active);
                this.logActivation(active);
            }
        }
        // Sort by priority descending so callers see highest-priority first
        activated.sort((a, b) => b.skill.priority - a.skill.priority);
        return activated;
    }
    /** Manually activate a skill by name. */
    activate(name) {
        const skill = this.skills.get(name);
        if (!skill) {
            return null;
        }
        const active = {
            skill,
            activatedAt: Date.now(),
            activatedBy: 'manual',
        };
        this.activeSkills.set(name, active);
        this.logActivation(active);
        return active;
    }
    /** Deactivate a skill by name. Returns true if it was active. */
    deactivate(name) {
        return this.activeSkills.delete(name);
    }
    /** Deactivate all active skills. */
    deactivateAll() {
        this.activeSkills.clear();
    }
    /** Return all currently active skills, sorted by priority descending. */
    getActiveSkills() {
        return Array.from(this.activeSkills.values()).sort((a, b) => b.skill.priority - a.skill.priority);
    }
    /** Return all discovered skill definitions. */
    getAllSkills() {
        return Array.from(this.skills.values()).sort((a, b) => b.priority - a.priority);
    }
    /** Build the concatenated system prompt addition from all active skills. */
    getSystemPromptAdditions() {
        const active = this.getActiveSkills();
        if (active.length === 0) {
            return '';
        }
        const sections = active.map((entry) => {
            const divider = '---';
            return [
                divider,
                `Skill: ${entry.skill.name} (priority ${entry.skill.priority})`,
                divider,
                entry.skill.systemPromptAddition,
            ].join('\n');
        });
        return sections.join('\n\n');
    }
    /** Print a human-readable list of available and active skills. */
    listSkills() {
        const all = this.getAllSkills();
        // eslint-disable-next-line no-console
        console.log('\n=== Available Skills ===\n');
        for (const skill of all) {
            const activeTag = this.activeSkills.has(skill.name)
                ? ' [ACTIVE]'
                : '';
            const autoTag = skill.autoActivate ? ' (auto)' : ' (manual)';
            // eslint-disable-next-line no-console
            console.log(`  ${skill.name}${activeTag}${autoTag} - ${skill.description}`);
            // eslint-disable-next-line no-console
            console.log(`    priority: ${skill.priority} | source: ${skill.source} | triggers: ${skill.triggers.length}`);
            if (skill.tags && skill.tags.length > 0) {
                // eslint-disable-next-line no-console
                console.log(`    tags: ${skill.tags.join(', ')}`);
            }
        }
        // eslint-disable-next-line no-console
        console.log('');
    }
    /** Check whether a skill is currently active. */
    isSkillActive(name) {
        return this.activeSkills.has(name);
    }
    // -------------------------------------------------------------------------
    // Private helpers
    // -------------------------------------------------------------------------
    /** Load skill markdown files from a directory. */
    loadFromDirectory(dir) {
        if (!existsSync(dir)) {
            return;
        }
        let entries;
        try {
            const stat = statSync(dir);
            if (!stat.isDirectory()) {
                return;
            }
            entries = readdirSync(dir);
        }
        catch {
            return;
        }
        for (const entry of entries) {
            const filePath = join(dir, entry);
            try {
                const fileStat = statSync(filePath);
                if (!fileStat.isFile()) {
                    continue;
                }
                if (!entry.endsWith('.md')) {
                    continue;
                }
                const content = readFileSync(filePath, 'utf-8');
                const skill = this.parseSkillFile(content, filePath);
                if (skill) {
                    // Later loads override earlier ones (project overrides global)
                    this.skills.set(skill.name, skill);
                }
            }
            catch {
                // Skip unreadable files
            }
        }
    }
    /** Register the builtin skill definitions. */
    loadBuiltinSkills() {
        for (const skill of BUILTIN_SKILLS) {
            this.skills.set(skill.name, { ...skill });
        }
    }
    /**
     * Parse a markdown skill file.
     *
     * Expected front-matter-like format:
     *
     *   ---
     *   name: my-skill
     *   description: A short description
     *   triggers: pattern1, pattern2, pattern3
     *   priority: 50
     *   autoActivate: true
     *   tags: tag1, tag2
     *   tools: tool1, tool2
     *   ---
     *
     *   The rest of the file becomes the systemPromptAddition.
     */
    parseSkillFile(content, filePath) {
        const trimmed = content.trim();
        // Extract front-matter between --- delimiters
        const fmRegex = /^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/;
        const match = trimmed.match(fmRegex);
        if (!match) {
            return null;
        }
        const frontMatter = match[1];
        const body = match[2].trim();
        // Parse front-matter lines
        const fm = {};
        for (const line of frontMatter.split('\n')) {
            const colonIndex = line.indexOf(':');
            if (colonIndex === -1) {
                continue;
            }
            const key = line.slice(0, colonIndex).trim().toLowerCase();
            const value = line.slice(colonIndex + 1).trim();
            fm[key] = value;
        }
        if (!fm.name) {
            return null;
        }
        const name = fm.name;
        const description = fm.description || `Custom skill: ${name}`;
        const triggers = fm.triggers
            ? fm.triggers
                .split(',')
                .map((t) => t.trim())
                .filter((t) => t.length > 0)
            : [];
        const priority = fm.priority ? parseInt(fm.priority, 10) : 50;
        const autoActivate = fm.autoactivate !== 'false';
        const tags = fm.tags
            ? fm.tags
                .split(',')
                .map((t) => t.trim())
                .filter((t) => t.length > 0)
            : undefined;
        const tools = fm.tools
            ? fm.tools
                .split(',')
                .map((t) => t.trim())
                .filter((t) => t.length > 0)
            : undefined;
        const systemPromptAddition = body || '';
        // Derive a default trigger from the skill name if none provided
        if (triggers.length === 0) {
            triggers.push(`\\b${name.replace(/[-_]/g, '[-_ ]?')}\\b`);
        }
        return {
            name,
            description,
            triggers,
            systemPromptAddition,
            tools,
            priority: Number.isNaN(priority) ? 50 : priority,
            autoActivate,
            source: filePath,
            tags,
        };
    }
    /**
     * Test whether any trigger pattern matches the prompt.
     * Returns the first matching pattern string, or null if none match.
     */
    matchTriggers(prompt, triggers) {
        for (const pattern of triggers) {
            try {
                const regex = new RegExp(pattern, 'i');
                if (regex.test(prompt)) {
                    return pattern;
                }
            }
            catch {
                // Invalid regex -- skip
            }
        }
        return null;
    }
    /** Log skill activation to the console. */
    logActivation(active) {
        const by = active.activatedBy === 'auto' ? 'auto' : 'manual';
        const reason = active.matchReason
            ? ` (matched: ${active.matchReason})`
            : '';
        // eslint-disable-next-line no-console
        console.log(`[skill-system] Activated skill "${active.skill.name}" via ${by}${reason}`);
    }
}
//# sourceMappingURL=skill-system.js.map
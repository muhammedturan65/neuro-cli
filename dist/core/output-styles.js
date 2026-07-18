// ============================================================
// NeuroCLI - Output Styles System
// Controls how the AI formats its responses
// ============================================================
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'fs';
import { join, basename } from 'path';
import { homedir } from 'os';
// -----------------------------------------------------------
// StyleManager
// -----------------------------------------------------------
const GLOBAL_STYLES_DIR = join(homedir(), '.neuro', 'styles');
const PROJECT_STYLES_SUBDIR = '.neuro/styles';
export class StyleManager {
    currentStyle;
    styles;
    stylesDir;
    projectStylesDir;
    constructor(workingDirectory) {
        this.styles = new Map();
        this.stylesDir = GLOBAL_STYLES_DIR;
        this.projectStylesDir = join(workingDirectory, PROJECT_STYLES_SUBDIR);
        // Load built-in styles first
        this.loadBuiltinStyles();
        // Discover custom styles (global + project-level)
        this.discoverCustomStyles();
        // Default to the "default" style
        this.currentStyle = this.styles.get('default');
    }
    // -------------------------------------------------------
    // Public API
    // -------------------------------------------------------
    /** Return the currently active style. */
    getStyle() {
        return this.currentStyle;
    }
    /** Switch to a named style. Returns true on success. */
    setStyle(name) {
        const style = this.styles.get(name);
        if (!style)
            return false;
        this.currentStyle = style;
        this.persistStylePreference(name);
        return true;
    }
    /** Return all available styles (built-in + custom). */
    listStyles() {
        return Array.from(this.styles.values());
    }
    /** Return the system-prompt addition string for the active style. */
    getSystemPromptAddition() {
        return this.currentStyle.systemPromptAddition;
    }
    /** Scan both global and project style directories for custom styles. */
    discoverCustomStyles() {
        // Global styles
        this.loadStylesFromDirectory(this.stylesDir);
        // Project-level styles (take precedence over global with same name)
        this.loadStylesFromDirectory(this.projectStylesDir);
        // Re-apply persisted preference if available
        const persisted = this.readPersistedStyle();
        if (persisted && this.styles.has(persisted)) {
            this.currentStyle = this.styles.get(persisted);
        }
    }
    /** Load a single style from a markdown file path. */
    loadStyleFromFile(filePath) {
        if (!existsSync(filePath))
            return null;
        try {
            const content = readFileSync(filePath, 'utf-8');
            const filename = basename(filePath, '.md');
            return this.parseStyleMarkdown(content, filename);
        }
        catch {
            return null;
        }
    }
    /** Pretty-print all styles to stdout (used by /style command). */
    printStyles() {
        const styles = this.listStyles();
        const currentName = this.currentStyle.name;
        console.log('\n  Output Styles\n  -------------');
        for (const style of styles) {
            const marker = style.name === currentName ? ' *' : '  ';
            const tag = style.name === currentName ? ' (active)' : '';
            console.log(`  ${marker} ${style.name}${tag}`);
            console.log(`      ${style.description}`);
        }
        console.log('\n  Usage: /style <name>   Switch active style');
        console.log('  Custom styles: ~/.neuro/styles/*.md or .neuro/styles/*.md\n');
    }
    // -------------------------------------------------------
    // Built-in styles
    // -------------------------------------------------------
    loadBuiltinStyles() {
        const builtins = [
            // 1. default ------------------------------------------------
            {
                name: 'default',
                description: 'Balanced approach with moderate detail and clear formatting',
                systemPromptAddition: [
                    'Respond in a balanced, clear manner.',
                    'Provide enough detail to be helpful without being excessive.',
                    'Use code blocks when relevant. Include brief explanations.',
                ].join(' '),
                formatRules: {
                    codeBlocks: 'detailed',
                    explanations: 'moderate',
                    examples: true,
                    stepByStep: false,
                    includeReasoning: false,
                    language: 'simple',
                },
            },
            // 2. concise ------------------------------------------------
            {
                name: 'concise',
                description: 'Brief responses, minimal code, direct answers',
                systemPromptAddition: [
                    'Be extremely concise. Give direct answers with minimal elaboration.',
                    'Prefer code over explanation. Use inline code instead of blocks when possible.',
                    'Skip greetings and filler. Never add commentary unless asked.',
                    'If a question can be answered in one line, do so.',
                ].join(' '),
                formatRules: {
                    codeBlocks: 'minimal',
                    explanations: 'brief',
                    examples: false,
                    stepByStep: false,
                    includeReasoning: false,
                    language: 'simple',
                },
            },
            // 3. explanatory --------------------------------------------
            {
                name: 'explanatory',
                description: 'Detailed explanations with context and examples',
                systemPromptAddition: [
                    'Provide thorough, detailed explanations with full context.',
                    'Include examples for every concept. Explain the "why" behind decisions.',
                    'Use annotated code blocks that explain each significant line.',
                    'When introducing a concept, define it before using it.',
                    'Anticipate follow-up questions and address them proactively.',
                ].join(' '),
                formatRules: {
                    codeBlocks: 'annotated',
                    explanations: 'thorough',
                    examples: true,
                    stepByStep: true,
                    includeReasoning: true,
                    language: 'simple',
                },
            },
            // 4. learning -----------------------------------------------
            {
                name: 'learning',
                description: 'Tutorial style with step-by-step explanations',
                systemPromptAddition: [
                    'Teach concepts step by step, as if the reader is learning for the first time.',
                    'Break every process into numbered steps. Explain each step before moving on.',
                    'Use analogies to relate new concepts to familiar ones.',
                    'Include "Try it yourself" suggestions after key concepts.',
                    'Highlight common mistakes and how to avoid them.',
                    'Summarize key takeaways at the end of each explanation.',
                ].join(' '),
                formatRules: {
                    codeBlocks: 'annotated',
                    explanations: 'thorough',
                    examples: true,
                    stepByStep: true,
                    includeReasoning: true,
                    language: 'simple',
                },
            },
            // 5. narrative ----------------------------------------------
            {
                name: 'narrative',
                description: 'Story-driven explanations that contextualize concepts',
                systemPromptAddition: [
                    'Present information as a narrative or story when possible.',
                    'Use real-world scenarios to frame technical concepts.',
                    'Build explanations from a problem statement through discovery to solution.',
                    'Make connections between ideas feel natural and logical.',
                    'Use descriptive language but stay technically accurate.',
                ].join(' '),
                formatRules: {
                    codeBlocks: 'detailed',
                    explanations: 'thorough',
                    examples: true,
                    stepByStep: false,
                    includeReasoning: true,
                    language: 'casual',
                },
            },
            // 6. technical ----------------------------------------------
            {
                name: 'technical',
                description: 'Precise technical language, API documentation style',
                systemPromptAddition: [
                    'Use precise, formal technical language throughout.',
                    'Reference specifications, RFCs, and official documentation when relevant.',
                    'Format code with type signatures, parameter descriptions, and return types.',
                    'Use correct terminology. Avoid colloquialisms.',
                    'Structure responses like API documentation: signature, description, parameters, returns, examples.',
                ].join(' '),
                formatRules: {
                    codeBlocks: 'detailed',
                    explanations: 'moderate',
                    examples: true,
                    stepByStep: false,
                    includeReasoning: false,
                    language: 'technical',
                },
            },
            // 7. review -------------------------------------------------
            {
                name: 'review',
                description: 'Focused on code review with severity levels',
                systemPromptAddition: [
                    'Review code with a critical eye, identifying issues by severity level.',
                    'Categorize findings as: CRITICAL (must fix), WARNING (should fix), INFO (consider fixing).',
                    'For each finding, explain the issue, its impact, and a suggested fix.',
                    'Check for: correctness, security, performance, readability, maintainability.',
                    'Highlight positive patterns and good practices when found.',
                    'Provide a summary with counts at the end.',
                ].join(' '),
                formatRules: {
                    codeBlocks: 'annotated',
                    explanations: 'moderate',
                    examples: false,
                    stepByStep: false,
                    includeReasoning: true,
                    language: 'technical',
                },
            },
            // 8. debug --------------------------------------------------
            {
                name: 'debug',
                description: 'Systematic investigation style for troubleshooting',
                systemPromptAddition: [
                    'Approach problems systematically using a structured debugging methodology.',
                    'Start by reproducing or confirming the issue. State observations before hypotheses.',
                    'List possible causes ranked by likelihood. Test each hypothesis explicitly.',
                    'Show the reasoning chain: observation -> hypothesis -> test -> conclusion.',
                    'When a fix is found, explain the root cause and how to prevent recurrence.',
                    'Use binary search / elimination approach for complex issues.',
                ].join(' '),
                formatRules: {
                    codeBlocks: 'detailed',
                    explanations: 'thorough',
                    examples: false,
                    stepByStep: true,
                    includeReasoning: true,
                    language: 'technical',
                },
            },
        ];
        for (const style of builtins) {
            this.styles.set(style.name, style);
        }
    }
    // -------------------------------------------------------
    // Custom style parsing
    // -------------------------------------------------------
    /**
     * Parse a markdown file with YAML frontmatter into an OutputStyle.
     *
     * Expected format:
     * ---
     * description: Short description of the style
     * codeBlocks: minimal | detailed | annotated
     * explanations: brief | moderate | thorough
     * examples: true | false
     * stepByStep: true | false
     * includeReasoning: true | false
     * language: technical | simple | academic | casual
     * ---
     *
     * The body of the markdown becomes the systemPromptAddition.
     */
    parseStyleMarkdown(content, filename) {
        const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/;
        const match = content.match(frontmatterRegex);
        if (!match)
            return null;
        const frontmatter = match[1];
        const body = match[2].trim();
        if (!body)
            return null;
        // Parse simple YAML key-value pairs
        const values = {};
        for (const line of frontmatter.split('\n')) {
            const kvMatch = line.match(/^\s*(\w+)\s*:\s*(.+)\s*$/);
            if (kvMatch) {
                values[kvMatch[1]] = kvMatch[2].trim();
            }
        }
        // Validate formatRules enums
        const validCodeBlocks = ['minimal', 'detailed', 'annotated'];
        const validExplanations = ['brief', 'moderate', 'thorough'];
        const validLanguage = ['technical', 'simple', 'academic', 'casual'];
        const codeBlocks = validCodeBlocks.includes(values.codeBlocks)
            ? values.codeBlocks
            : 'detailed';
        const explanations = validExplanations.includes(values.explanations)
            ? values.explanations
            : 'moderate';
        const language = validLanguage.includes(values.language)
            ? values.language
            : 'simple';
        const parseBool = (raw, fallback) => {
            if (raw === undefined)
                return fallback;
            return raw.toLowerCase() === 'true';
        };
        return {
            name: filename.toLowerCase().replace(/\s+/g, '-'),
            description: values.description || `Custom style: ${filename}`,
            systemPromptAddition: body,
            formatRules: {
                codeBlocks,
                explanations,
                examples: parseBool(values.examples, true),
                stepByStep: parseBool(values.stepByStep, false),
                includeReasoning: parseBool(values.includeReasoning, false),
                language,
            },
        };
    }
    // -------------------------------------------------------
    // Directory scanning helpers
    // -------------------------------------------------------
    loadStylesFromDirectory(dir) {
        if (!existsSync(dir))
            return;
        try {
            const entries = readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                if (!entry.isFile() || !entry.name.endsWith('.md'))
                    continue;
                const filePath = join(dir, entry.name);
                const style = this.loadStyleFromFile(filePath);
                if (style) {
                    this.styles.set(style.name, style);
                }
            }
        }
        catch {
            // Silently ignore unreadable directories
        }
    }
    // -------------------------------------------------------
    // Persistence helpers
    // -------------------------------------------------------
    getPersistencePath() {
        return join(this.stylesDir, '.active-style');
    }
    persistStylePreference(name) {
        try {
            if (!existsSync(this.stylesDir)) {
                mkdirSync(this.stylesDir, { recursive: true });
            }
            writeFileSync(this.getPersistencePath(), name, 'utf-8');
        }
        catch {
            // Persistence is best-effort; do not crash
        }
    }
    readPersistedStyle() {
        const filePath = this.getPersistencePath();
        if (!existsSync(filePath))
            return null;
        try {
            const content = readFileSync(filePath, 'utf-8').trim();
            return content || null;
        }
        catch {
            return null;
        }
    }
}
//# sourceMappingURL=output-styles.js.map
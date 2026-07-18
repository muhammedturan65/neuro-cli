export interface SkillDefinition {
    name: string;
    description: string;
    triggers: string[];
    systemPromptAddition: string;
    tools?: string[];
    priority: number;
    autoActivate: boolean;
    source: string;
    tags?: string[];
}
export interface ActiveSkill {
    skill: SkillDefinition;
    activatedAt: number;
    activatedBy: 'auto' | 'manual';
    matchReason?: string;
}
export declare class SkillSystem {
    private skills;
    private activeSkills;
    private skillsDir;
    private globalSkillsDir;
    private projectRoot;
    constructor(projectRoot: string);
    /** Discover and load all skills (builtin + global + project). */
    discover(): SkillDefinition[];
    /** Auto-activate skills whose trigger patterns match the given prompt. */
    autoActivate(prompt: string): ActiveSkill[];
    /** Manually activate a skill by name. */
    activate(name: string): ActiveSkill | null;
    /** Deactivate a skill by name. Returns true if it was active. */
    deactivate(name: string): boolean;
    /** Deactivate all active skills. */
    deactivateAll(): void;
    /** Return all currently active skills, sorted by priority descending. */
    getActiveSkills(): ActiveSkill[];
    /** Return all discovered skill definitions. */
    getAllSkills(): SkillDefinition[];
    /** Build the concatenated system prompt addition from all active skills. */
    getSystemPromptAdditions(): string;
    /** Print a human-readable list of available and active skills. */
    listSkills(): void;
    /** Check whether a skill is currently active. */
    isSkillActive(name: string): boolean;
    /** Load skill markdown files from a directory. */
    private loadFromDirectory;
    /** Register the builtin skill definitions. */
    private loadBuiltinSkills;
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
    private parseSkillFile;
    /**
     * Test whether any trigger pattern matches the prompt.
     * Returns the first matching pattern string, or null if none match.
     */
    private matchTriggers;
    /** Log skill activation to the console. */
    private logActivation;
}
//# sourceMappingURL=skill-system.d.ts.map
export interface CreatePROptions {
    title: string;
    body: string;
    head: string;
    base?: string;
    draft?: boolean;
    labels?: string[];
    reviewers?: string[];
    assignees?: string[];
}
export interface ListPROptions {
    state?: 'open' | 'closed' | 'merged' | 'all';
    limit?: number;
    label?: string;
    author?: string;
    assignee?: string;
    base?: string;
    head?: string;
    sort?: 'created' | 'updated' | 'popularity' | 'long-running';
    direction?: 'asc' | 'desc';
}
export interface PRDetail {
    number: number;
    title: string;
    body: string;
    state: string;
    html_url: string;
    head: {
        ref: string;
        sha: string;
    };
    base: {
        ref: string;
        sha: string;
    };
    user: {
        login: string;
    };
    created_at: string;
    updated_at: string;
    mergeable?: boolean | null;
    additions: number;
    deletions: number;
    changed_files: number;
    commits: number;
    labels: Array<{
        name: string;
        color: string;
    }>;
    assignees: Array<{
        login: string;
    }>;
    requested_reviewers: Array<{
        login: string;
    }>;
}
export interface PRReview {
    number: number;
    title: string;
    body: string;
    state: string;
    url: string;
    diff: string;
    commits: number;
    additions: number;
    deletions: number;
    changed_files: number;
    files: Array<{
        filename: string;
        status: string;
        additions: number;
        deletions: number;
        changes: number;
        patch?: string;
    }>;
    reviews: Array<{
        user: string;
        state: string;
        body: string;
    }>;
    comments: Array<{
        user: string;
        body: string;
        path: string;
        line: number;
    }>;
}
export type MergeMethod = 'merge' | 'squash' | 'rebase';
export interface MergePRResult {
    merged: boolean;
    sha: string;
    message: string;
    method: MergeMethod;
}
export interface CreateIssueOptions {
    title: string;
    body: string;
    labels?: string[];
    assignees?: string[];
    milestone?: number;
}
export interface ListIssuesOptions {
    state?: 'open' | 'closed' | 'all';
    limit?: number;
    label?: string;
    author?: string;
    assignee?: string;
    milestone?: string;
    sort?: 'created' | 'updated' | 'comments';
    direction?: 'asc' | 'desc';
}
export interface IssueDetail {
    number: number;
    title: string;
    body: string;
    state: string;
    html_url: string;
    user: {
        login: string;
    };
    created_at: string;
    updated_at: string;
    labels: Array<{
        name: string;
        color: string;
    }>;
    assignees: Array<{
        login: string;
    }>;
    comments: number;
    milestone?: {
        title: string;
        number: number;
    };
}
export interface BranchInfo {
    name: string;
    isHead: boolean;
    isRemote: boolean;
    ref: string;
}
export interface CreateReleaseOptions {
    tagName: string;
    name?: string;
    body?: string;
    target?: string;
    draft?: boolean;
    prerelease?: boolean;
    notes?: string;
    discussionCategory?: string;
}
export interface ReleaseInfo {
    id: number;
    tagName: string;
    name: string;
    body: string;
    draft: boolean;
    prerelease: boolean;
    html_url: string;
    created_at: string;
    published_at: string;
    author: {
        login: string;
    };
    assets: Array<{
        name: string;
        url: string;
        size: number;
        download_count: number;
    }>;
}
export interface RepoInfo {
    name: string;
    full_name: string;
    description: string;
    html_url: string;
    default_branch: string;
    visibility: string;
    language: string;
    stars: number;
    forks: number;
    open_issues: number;
    watchers: number;
    created_at: string;
    updated_at: string;
    pushed_at: string;
    license?: {
        key: string;
        name: string;
    };
    topics: string[];
}
export interface CodeSearchResult {
    name: string;
    path: string;
    html_url: string;
    repository: {
        full_name: string;
    };
    text_matches: Array<{
        fragment: string;
        matches: Array<{
            indices: number[];
            text: string;
        }>;
    }>;
}
export interface WorkflowRun {
    id: number;
    name: string;
    head_branch: string;
    head_sha: string;
    status: string;
    conclusion: string | null;
    html_url: string;
    created_at: string;
    updated_at: string;
    run_number: number;
    event: string;
    workflow_id: number;
}
export interface WorkflowRunStatus {
    id: number;
    name: string;
    status: string;
    conclusion: string | null;
    html_url: string;
    jobs: Array<{
        id: number;
        name: string;
        status: string;
        conclusion: string | null;
        started_at: string;
        completed_at: string | null;
        steps: Array<{
            name: string;
            status: string;
            conclusion: string | null;
            number: number;
        }>;
    }>;
}
export declare class GitHubIntegration {
    private cwd;
    private ghAvailable;
    private repoFlag;
    constructor(cwd?: string);
    private ensureGh;
    private gh;
    private git;
    /**
     * Create a pull request
     */
    createPR(options: CreatePROptions): {
        success: boolean;
        pr?: PRDetail;
        error?: string;
    };
    /**
     * List pull requests
     */
    listPRs(options?: ListPROptions): {
        success: boolean;
        prs?: PRDetail[];
        error?: string;
    };
    /**
     * Get PR details and diff
     */
    reviewPR(prNumber: number): {
        success: boolean;
        review?: PRReview;
        error?: string;
    };
    /**
     * Merge a PR
     */
    mergePR(prNumber: number, method?: MergeMethod): {
        success: boolean;
        result?: MergePRResult;
        error?: string;
    };
    /**
     * Create an issue
     */
    createIssue(options: CreateIssueOptions): {
        success: boolean;
        issue?: IssueDetail;
        error?: string;
    };
    /**
     * List issues
     */
    listIssues(options?: ListIssuesOptions): {
        success: boolean;
        issues?: IssueDetail[];
        error?: string;
    };
    /**
     * Close an issue
     */
    closeIssue(issueNumber: number): {
        success: boolean;
        error?: string;
    };
    /**
     * Comment on an issue
     */
    commentIssue(issueNumber: number, body: string): {
        success: boolean;
        error?: string;
    };
    /**
     * Create a branch (falls back to git if gh is unavailable)
     */
    createBranch(name: string, base?: string): {
        success: boolean;
        error?: string;
    };
    /**
     * List branches
     */
    listBranches(): {
        success: boolean;
        branches?: BranchInfo[];
        error?: string;
    };
    /**
     * Create a release
     */
    createRelease(options: CreateReleaseOptions): {
        success: boolean;
        release?: ReleaseInfo;
        error?: string;
    };
    /**
     * List releases
     */
    listReleases(): {
        success: boolean;
        releases?: ReleaseInfo[];
        error?: string;
    };
    /**
     * Get repository information
     */
    getRepoInfo(): {
        success: boolean;
        repo?: RepoInfo;
        error?: string;
    };
    /**
     * Search code in repository
     */
    searchCode(query: string): {
        success: boolean;
        results?: CodeSearchResult[];
        error?: string;
    };
    /**
     * List GitHub Actions workflow runs
     */
    getWorkflowRuns(): {
        success: boolean;
        runs?: WorkflowRun[];
        error?: string;
    };
    /**
     * Trigger a workflow
     */
    triggerWorkflow(workflowId: string, ref?: string): {
        success: boolean;
        error?: string;
    };
    /**
     * Get workflow run status
     */
    getWorkflowRunStatus(runId: number): {
        success: boolean;
        status?: WorkflowRunStatus;
        error?: string;
    };
    private mapPRDetail;
    private mapIssueDetail;
    private mapReleaseInfo;
    private extractRepoSlug;
    private getRepoInfoFromGit;
}
//# sourceMappingURL=github.d.ts.map
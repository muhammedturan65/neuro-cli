// ============================================================
// NeuroCLI - GitHub Integration
// PR/Issue/Repo management via `gh` CLI and git fallbacks
// ============================================================
import { execSync } from 'child_process';
function execGh(args, options) {
    const timeout = options?.timeout ?? 60000;
    const cwd = options?.cwd ?? process.cwd();
    try {
        const stdout = execSync(`gh ${args}`, {
            encoding: 'utf-8',
            cwd,
            timeout,
            maxBuffer: 50 * 1024 * 1024,
            env: { ...process.env, GH_PROMPT_DISABLED: '1', NO_COLOR: '1' },
        });
        return { stdout: stdout.trim(), stderr: '', exitCode: 0 };
    }
    catch (error) {
        return {
            stdout: error.stdout?.toString().trim() ?? '',
            stderr: error.stderr?.toString().trim() ?? '',
            exitCode: error.status ?? 1,
        };
    }
}
function execGit(args, options) {
    const timeout = options?.timeout ?? 30000;
    const cwd = options?.cwd ?? process.cwd();
    try {
        const stdout = execSync(`git ${args}`, {
            encoding: 'utf-8',
            cwd,
            timeout,
            maxBuffer: 10 * 1024 * 1024,
            env: { ...process.env, NO_COLOR: '1' },
        });
        return { stdout: stdout.trim(), stderr: '', exitCode: 0 };
    }
    catch (error) {
        return {
            stdout: error.stdout?.toString().trim() ?? '',
            stderr: error.stderr?.toString().trim() ?? '',
            exitCode: error.status ?? 1,
        };
    }
}
function parseJSON(text) {
    try {
        return JSON.parse(text);
    }
    catch {
        return null;
    }
}
function checkGhAvailable() {
    const result = execGh('--version');
    return result.exitCode === 0;
}
function getRepoFlag() {
    // Attempt to auto-detect the repo from the current directory
    const result = execGit('remote get-url origin');
    if (result.exitCode === 0 && result.stdout) {
        // Parse owner/repo from various remote URL formats
        const url = result.stdout;
        // ssh://git@github.com/owner/repo.git or git@github.com:owner/repo.git
        const match = url.match(/github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?$/);
        if (match) {
            return `--repo ${match[1]}`;
        }
    }
    return '';
}
// ---- GitHubIntegration Class ----
export class GitHubIntegration {
    cwd;
    ghAvailable = null;
    repoFlag;
    constructor(cwd) {
        this.cwd = cwd ?? process.cwd();
        this.ghAvailable = null;
        this.repoFlag = '';
    }
    ensureGh() {
        if (this.ghAvailable === null) {
            this.ghAvailable = checkGhAvailable();
            if (this.ghAvailable) {
                this.repoFlag = getRepoFlag();
            }
        }
        return this.ghAvailable;
    }
    gh(args, timeout) {
        const repoPart = this.repoFlag ? `${this.repoFlag} ` : '';
        return execGh(`${repoPart}${args}`, { cwd: this.cwd, timeout });
    }
    git(args, timeout) {
        return execGit(args, { cwd: this.cwd, timeout });
    }
    // ---- Pull Requests ----
    /**
     * Create a pull request
     */
    createPR(options) {
        if (!this.ensureGh()) {
            return { success: false, error: 'GitHub CLI (`gh`) is not installed or not authenticated' };
        }
        const flags = [
            `--title "${options.title.replace(/"/g, '\\"')}"`,
            `--body "${options.body.replace(/"/g, '\\"')}"`,
            `--head "${options.head}"`,
        ];
        if (options.base)
            flags.push(`--base "${options.base}"`);
        if (options.draft)
            flags.push('--draft');
        if (options.labels?.length)
            flags.push(`--label ${options.labels.map(l => `"${l}"`).join(',')}`);
        if (options.reviewers?.length)
            flags.push(`--reviewer ${options.reviewers.map(r => `"${r}"`).join(',')}`);
        if (options.assignees?.length)
            flags.push(`--assignee ${options.assignees.map(a => `"${a}"`).join(',')}`);
        const result = this.gh(`pr create ${flags.join(' ')} --json number,title,body,state,htmlUrl,headRef,headSha,baseRef,baseSha,author,createdAt,updatedAt,additions,deletions,changedFiles,commits,labels,assignees,reviewRequests,mergeable`);
        if (result.exitCode !== 0) {
            return { success: false, error: result.stderr || result.stdout || 'Failed to create PR' };
        }
        const pr = parseJSON(result.stdout);
        if (!pr) {
            return { success: false, error: 'Failed to parse PR creation response' };
        }
        return {
            success: true,
            pr: this.mapPRDetail(pr),
        };
    }
    /**
     * List pull requests
     */
    listPRs(options) {
        if (!this.ensureGh()) {
            return { success: false, error: 'GitHub CLI (`gh`) is not installed or not authenticated' };
        }
        const opts = options ?? {};
        const flags = ['--json number,title,body,state,htmlUrl,headRef,headSha,baseRef,baseSha,author,createdAt,updatedAt,additions,deletions,changedFiles,commits,labels,assignees,reviewRequests,mergeable'];
        if (opts.state && opts.state !== 'all')
            flags.push(`--state ${opts.state}`);
        if (opts.limit)
            flags.push(`--limit ${opts.limit}`);
        if (opts.label)
            flags.push(`--label "${opts.label}"`);
        if (opts.author)
            flags.push(`--author "${opts.author}"`);
        if (opts.assignee)
            flags.push(`--assignee "${opts.assignee}"`);
        if (opts.base)
            flags.push(`--base "${opts.base}"`);
        if (opts.head)
            flags.push(`--head "${opts.head}"`);
        if (opts.sort)
            flags.push(`--sort ${opts.sort}`);
        if (opts.direction)
            flags.push(`--${opts.direction}`);
        const result = this.gh(`pr list ${flags.join(' ')}`);
        if (result.exitCode !== 0) {
            return { success: false, error: result.stderr || 'Failed to list PRs' };
        }
        const prs = parseJSON(result.stdout);
        if (!prs) {
            return { success: false, error: 'Failed to parse PR list response' };
        }
        return {
            success: true,
            prs: prs.map(p => this.mapPRDetail(p)),
        };
    }
    /**
     * Get PR details and diff
     */
    reviewPR(prNumber) {
        if (!this.ensureGh()) {
            return { success: false, error: 'GitHub CLI (`gh`) is not installed or not authenticated' };
        }
        // Get PR details
        const detailResult = this.gh(`pr view ${prNumber} --json number,title,body,state,url,headRef,headSha,baseRef,baseSha,author,createdAt,updatedAt,additions,deletions,changedFiles,commits,labels,assignees,reviewRequests,mergeable,reviews,comments`);
        if (detailResult.exitCode !== 0) {
            return { success: false, error: detailResult.stderr || 'Failed to get PR details' };
        }
        const detail = parseJSON(detailResult.stdout);
        if (!detail) {
            return { success: false, error: 'Failed to parse PR details' };
        }
        // Get PR diff
        const diffResult = this.gh(`pr diff ${prNumber}`, 30000);
        const diff = diffResult.exitCode === 0 ? diffResult.stdout : '';
        // Get changed files
        const filesResult = this.gh(`pr diff ${prNumber} --name-only`);
        const fileNames = filesResult.exitCode === 0
            ? filesResult.stdout.split('\n').filter(Boolean)
            : [];
        // Get detailed file changes
        const filesJsonResult = this.gh(`pr view ${prNumber} --json files`);
        let files = [];
        if (filesJsonResult.exitCode === 0) {
            const filesData = parseJSON(filesJsonResult.stdout);
            if (filesData?.files) {
                files = filesData.files.map((f) => ({
                    filename: f.path ?? f.filename ?? '',
                    status: f.status ?? 'modified',
                    additions: f.additions ?? 0,
                    deletions: f.deletions ?? 0,
                    changes: (f.additions ?? 0) + (f.deletions ?? 0),
                    patch: f.patch,
                }));
            }
        }
        const reviews = (detail.reviews ?? []).map((r) => ({
            user: r.author?.login ?? r.user?.login ?? 'unknown',
            state: r.state ?? '',
            body: r.body ?? '',
        }));
        const comments = (detail.comments ?? []).map((c) => ({
            user: c.author?.login ?? c.user?.login ?? 'unknown',
            body: c.body ?? '',
            path: c.path ?? '',
            line: c.line ?? 0,
        }));
        return {
            success: true,
            review: {
                number: detail.number ?? prNumber,
                title: detail.title ?? '',
                body: detail.body ?? '',
                state: detail.state ?? '',
                url: detail.url ?? detail.htmlUrl ?? '',
                diff,
                commits: detail.commits ?? 0,
                additions: detail.additions ?? 0,
                deletions: detail.deletions ?? 0,
                changed_files: detail.changedFiles ?? fileNames.length,
                files,
                reviews,
                comments,
            },
        };
    }
    /**
     * Merge a PR
     */
    mergePR(prNumber, method) {
        if (!this.ensureGh()) {
            return { success: false, error: 'GitHub CLI (`gh`) is not installed or not authenticated' };
        }
        const mergeMethod = method ?? 'merge';
        const result = this.gh(`pr merge ${prNumber} --${mergeMethod} --json sha,merged`);
        if (result.exitCode !== 0) {
            return { success: false, error: result.stderr || 'Failed to merge PR' };
        }
        const data = parseJSON(result.stdout);
        return {
            success: true,
            result: {
                merged: data?.merged ?? true,
                sha: data?.sha ?? '',
                message: `PR #${prNumber} merged using ${mergeMethod}`,
                method: mergeMethod,
            },
        };
    }
    // ---- Issues ----
    /**
     * Create an issue
     */
    createIssue(options) {
        if (!this.ensureGh()) {
            return { success: false, error: 'GitHub CLI (`gh`) is not installed or not authenticated' };
        }
        const flags = [
            `--title "${options.title.replace(/"/g, '\\"')}"`,
            `--body "${options.body.replace(/"/g, '\\"')}"`,
        ];
        if (options.labels?.length)
            flags.push(`--label ${options.labels.map(l => `"${l}"`).join(',')}`);
        if (options.assignees?.length)
            flags.push(`--assignee ${options.assignees.map(a => `"${a}"`).join(',')}`);
        if (options.milestone)
            flags.push(`--milestone "${options.milestone}"`);
        const result = this.gh(`issue create ${flags.join(' ')} --json number,title,body,state,htmlUrl,author,createdAt,updatedAt,labels,assignees,comments,milestone`);
        if (result.exitCode !== 0) {
            return { success: false, error: result.stderr || result.stdout || 'Failed to create issue' };
        }
        const issue = parseJSON(result.stdout);
        if (!issue) {
            return { success: false, error: 'Failed to parse issue creation response' };
        }
        return {
            success: true,
            issue: this.mapIssueDetail(issue),
        };
    }
    /**
     * List issues
     */
    listIssues(options) {
        if (!this.ensureGh()) {
            return { success: false, error: 'GitHub CLI (`gh`) is not installed or not authenticated' };
        }
        const opts = options ?? {};
        const flags = ['--json number,title,body,state,htmlUrl,author,createdAt,updatedAt,labels,assignees,comments,milestone'];
        if (opts.state && opts.state !== 'all')
            flags.push(`--state ${opts.state}`);
        if (opts.limit)
            flags.push(`--limit ${opts.limit}`);
        if (opts.label)
            flags.push(`--label "${opts.label}"`);
        if (opts.author)
            flags.push(`--author "${opts.author}"`);
        if (opts.assignee)
            flags.push(`--assignee "${opts.assignee}"`);
        if (opts.milestone)
            flags.push(`--milestone "${opts.milestone}"`);
        if (opts.sort)
            flags.push(`--sort ${opts.sort}`);
        if (opts.direction)
            flags.push(`--${opts.direction}`);
        const result = this.gh(`issue list ${flags.join(' ')}`);
        if (result.exitCode !== 0) {
            return { success: false, error: result.stderr || 'Failed to list issues' };
        }
        const issues = parseJSON(result.stdout);
        if (!issues) {
            return { success: false, error: 'Failed to parse issues list response' };
        }
        return {
            success: true,
            issues: issues.map(i => this.mapIssueDetail(i)),
        };
    }
    /**
     * Close an issue
     */
    closeIssue(issueNumber) {
        if (!this.ensureGh()) {
            return { success: false, error: 'GitHub CLI (`gh`) is not installed or not authenticated' };
        }
        const result = this.gh(`issue close ${issueNumber}`);
        if (result.exitCode !== 0) {
            return { success: false, error: result.stderr || 'Failed to close issue' };
        }
        return { success: true };
    }
    /**
     * Comment on an issue
     */
    commentIssue(issueNumber, body) {
        if (!this.ensureGh()) {
            return { success: false, error: 'GitHub CLI (`gh`) is not installed or not authenticated' };
        }
        const result = this.gh(`issue comment ${issueNumber} --body "${body.replace(/"/g, '\\"')}"`);
        if (result.exitCode !== 0) {
            return { success: false, error: result.stderr || 'Failed to comment on issue' };
        }
        return { success: true };
    }
    // ---- Branches ----
    /**
     * Create a branch (falls back to git if gh is unavailable)
     */
    createBranch(name, base) {
        // Use git directly for branch creation - more reliable
        if (base) {
            const checkoutResult = this.git(`checkout ${base}`);
            if (checkoutResult.exitCode !== 0) {
                return { success: false, error: checkoutResult.stderr || `Failed to checkout base branch: ${base}` };
            }
        }
        const result = this.git(`checkout -b ${name}`);
        if (result.exitCode !== 0) {
            return { success: false, error: result.stderr || 'Failed to create branch' };
        }
        // Push to remote if gh is available
        if (this.ensureGh()) {
            const pushResult = this.git(`push -u origin ${name}`);
            if (pushResult.exitCode !== 0) {
                // Branch created locally but failed to push - still success
                return { success: true, error: `Branch created locally but push failed: ${pushResult.stderr}` };
            }
        }
        return { success: true };
    }
    /**
     * List branches
     */
    listBranches() {
        const result = this.git('branch -a --no-color');
        if (result.exitCode !== 0) {
            return { success: false, error: result.stderr || 'Failed to list branches' };
        }
        const branches = result.stdout
            .split('\n')
            .filter(Boolean)
            .map(line => {
            const trimmed = line.trim();
            const isHead = trimmed.startsWith('* ');
            const name = trimmed.replace(/^\* /, '').replace(/^remotes\/origin\//, '');
            const isRemote = trimmed.includes('remotes/');
            return {
                name,
                isHead,
                isRemote,
                ref: isRemote ? `refs/remotes/origin/${name}` : `refs/heads/${name}`,
            };
        });
        return { success: true, branches };
    }
    // ---- Releases ----
    /**
     * Create a release
     */
    createRelease(options) {
        if (!this.ensureGh()) {
            return { success: false, error: 'GitHub CLI (`gh`) is not installed or not authenticated' };
        }
        const flags = [
            options.tagName,
            `--title "${(options.name ?? options.tagName).replace(/"/g, '\\"')}"`,
        ];
        if (options.body) {
            flags.push(`--notes "${options.body.replace(/"/g, '\\"')}"`);
        }
        else if (options.notes) {
            flags.push(`--notes "${options.notes.replace(/"/g, '\\"')}"`);
        }
        if (options.target)
            flags.push(`--target "${options.target}"`);
        if (options.draft)
            flags.push('--draft');
        if (options.prerelease)
            flags.push('--prerelease');
        if (options.discussionCategory)
            flags.push(`--discussion-category "${options.discussionCategory}"`);
        const result = this.gh(`release create ${flags.join(' ')} --json tagName,name,body,draft,prerelease,htmlUrl,createdAt,publishedAt,author,assets`);
        if (result.exitCode !== 0) {
            return { success: false, error: result.stderr || result.stdout || 'Failed to create release' };
        }
        const release = parseJSON(result.stdout);
        if (!release) {
            return { success: false, error: 'Failed to parse release response' };
        }
        return {
            success: true,
            release: this.mapReleaseInfo(release),
        };
    }
    /**
     * List releases
     */
    listReleases() {
        if (!this.ensureGh()) {
            return { success: false, error: 'GitHub CLI (`gh`) is not installed or not authenticated' };
        }
        const result = this.gh('release list --json tagName,name,body,draft,prerelease,htmlUrl,createdAt,publishedAt,author,assets --limit 50');
        if (result.exitCode !== 0) {
            return { success: false, error: result.stderr || 'Failed to list releases' };
        }
        const releases = parseJSON(result.stdout);
        if (!releases) {
            return { success: false, error: 'Failed to parse releases response' };
        }
        return {
            success: true,
            releases: releases.map(r => this.mapReleaseInfo(r)),
        };
    }
    // ---- Repository ----
    /**
     * Get repository information
     */
    getRepoInfo() {
        if (!this.ensureGh()) {
            // Fallback: try to get basic info from git
            return this.getRepoInfoFromGit();
        }
        const result = this.gh('repo view --json name,description,htmlUrl,defaultBranchRef,visibility,primaryLanguage,stargazerCount,forkCount,issues,pullRequests,watchers,createdAt,updatedAt,pushedAt,licenseInfo,repositoryTopics');
        if (result.exitCode !== 0) {
            return this.getRepoInfoFromGit();
        }
        const repo = parseJSON(result.stdout);
        if (!repo) {
            return this.getRepoInfoFromGit();
        }
        const remoteResult = this.git('remote get-url origin');
        const full_name = this.extractRepoSlug(remoteResult.exitCode === 0 ? remoteResult.stdout : '') ?? repo.name;
        return {
            success: true,
            repo: {
                name: repo.name ?? '',
                full_name,
                description: repo.description ?? '',
                html_url: repo.htmlUrl ?? '',
                default_branch: repo.defaultBranchRef?.name ?? 'main',
                visibility: repo.visibility ?? 'unknown',
                language: repo.primaryLanguage?.name ?? '',
                stars: repo.stargazerCount ?? 0,
                forks: repo.forkCount ?? 0,
                open_issues: (repo.issues?.totalCount ?? repo.issues ?? 0) + (repo.pullRequests?.totalCount ?? 0),
                watchers: repo.watchers?.totalCount ?? repo.watchers ?? 0,
                created_at: repo.createdAt ?? '',
                updated_at: repo.updatedAt ?? '',
                pushed_at: repo.pushedAt ?? '',
                license: repo.licenseInfo ? { key: repo.licenseInfo.key, name: repo.licenseInfo.name } : undefined,
                topics: (repo.repositoryTopics ?? []).map((t) => t.name ?? t.topic ?? t),
            },
        };
    }
    /**
     * Search code in repository
     */
    searchCode(query) {
        if (!this.ensureGh()) {
            return { success: false, error: 'GitHub CLI (`gh`) is not installed or not authenticated' };
        }
        // Get the repo slug for scoped search
        const remoteResult = this.git('remote get-url origin');
        const repoSlug = this.extractRepoSlug(remoteResult.exitCode === 0 ? remoteResult.stdout : '');
        const scopedQuery = repoSlug ? `repo:${repoSlug} ${query}` : query;
        const result = this.gh(`search code "${scopedQuery}" --json path,textMatches,repository`);
        if (result.exitCode !== 0) {
            return { success: false, error: result.stderr || 'Failed to search code' };
        }
        const results = parseJSON(result.stdout);
        if (!results) {
            return { success: false, error: 'Failed to parse search results' };
        }
        return {
            success: true,
            results: results.map(r => ({
                name: r.path?.split('/').pop() ?? '',
                path: r.path ?? '',
                html_url: r.html_url ?? '',
                repository: { full_name: r.repository?.full_name ?? r.repository?.nameWithOwner ?? '' },
                text_matches: (r.text_matches ?? r.textMatches ?? []).map((m) => ({
                    fragment: m.fragment ?? '',
                    matches: (m.matches ?? []).map((match) => ({
                        indices: match.indices ?? [],
                        text: match.text ?? '',
                    })),
                })),
            })),
        };
    }
    // ---- GitHub Actions ----
    /**
     * List GitHub Actions workflow runs
     */
    getWorkflowRuns() {
        if (!this.ensureGh()) {
            return { success: false, error: 'GitHub CLI (`gh`) is not installed or not authenticated' };
        }
        const result = this.gh('run list --json databaseId,name,headBranch,headSha,status,conclusion,htmlUrl,createdAt,updatedAt,event,workflowId --limit 20');
        if (result.exitCode !== 0) {
            return { success: false, error: result.stderr || 'Failed to list workflow runs' };
        }
        const runs = parseJSON(result.stdout);
        if (!runs) {
            return { success: false, error: 'Failed to parse workflow runs response' };
        }
        return {
            success: true,
            runs: runs.map(r => ({
                id: r.databaseId ?? r.id ?? 0,
                name: r.name ?? '',
                head_branch: r.headBranch ?? '',
                head_sha: r.headSha ?? '',
                status: r.status ?? '',
                conclusion: r.conclusion ?? null,
                html_url: r.htmlUrl ?? '',
                created_at: r.createdAt ?? '',
                updated_at: r.updatedAt ?? '',
                run_number: r.runNumber ?? 0,
                event: r.event ?? '',
                workflow_id: r.workflowId ?? 0,
            })),
        };
    }
    /**
     * Trigger a workflow
     */
    triggerWorkflow(workflowId, ref) {
        if (!this.ensureGh()) {
            return { success: false, error: 'GitHub CLI (`gh`) is not installed or not authenticated' };
        }
        const refFlag = ref ? `--ref "${ref}"` : '';
        const result = this.gh(`workflow run ${workflowId} ${refFlag}`.trim());
        if (result.exitCode !== 0) {
            return { success: false, error: result.stderr || 'Failed to trigger workflow' };
        }
        return { success: true };
    }
    /**
     * Get workflow run status
     */
    getWorkflowRunStatus(runId) {
        if (!this.ensureGh()) {
            return { success: false, error: 'GitHub CLI (`gh`) is not installed or not authenticated' };
        }
        const runResult = this.gh(`run view ${runId} --json databaseId,name,status,conclusion,htmlUrl,jobs`);
        if (runResult.exitCode !== 0) {
            return { success: false, error: runResult.stderr || 'Failed to get workflow run status' };
        }
        const run = parseJSON(runResult.stdout);
        if (!run) {
            return { success: false, error: 'Failed to parse workflow run status' };
        }
        const jobs = (run.jobs ?? []).map((j) => ({
            id: j.databaseId ?? j.id ?? 0,
            name: j.name ?? '',
            status: j.status ?? '',
            conclusion: j.conclusion ?? null,
            started_at: j.startedAt ?? '',
            completed_at: j.completedAt ?? null,
            steps: (j.steps ?? []).map((s) => ({
                name: s.name ?? '',
                status: s.status ?? '',
                conclusion: s.conclusion ?? null,
                number: s.number ?? 0,
            })),
        }));
        return {
            success: true,
            status: {
                id: run.databaseId ?? runId,
                name: run.name ?? '',
                status: run.status ?? '',
                conclusion: run.conclusion ?? null,
                html_url: run.htmlUrl ?? '',
                jobs,
            },
        };
    }
    // ---- Private Helpers ----
    mapPRDetail(p) {
        return {
            number: p.number ?? 0,
            title: p.title ?? '',
            body: p.body ?? '',
            state: p.state ?? '',
            html_url: p.htmlUrl ?? p.url ?? '',
            head: {
                ref: p.headRefName ?? p.headRef ?? '',
                sha: p.headRefOid ?? p.headSha ?? '',
            },
            base: {
                ref: p.baseRefName ?? p.baseRef ?? '',
                sha: p.baseRefOid ?? p.baseSha ?? '',
            },
            user: { login: p.author?.login ?? p.user?.login ?? '' },
            created_at: p.createdAt ?? '',
            updated_at: p.updatedAt ?? '',
            mergeable: p.mergeable ?? null,
            additions: p.additions ?? 0,
            deletions: p.deletions ?? 0,
            changed_files: p.changedFiles ?? 0,
            commits: p.commits ?? 0,
            labels: (p.labels ?? []).map((l) => ({
                name: l.name ?? '',
                color: l.color ?? '',
            })),
            assignees: (p.assignees ?? []).map((a) => ({
                login: a.login ?? '',
            })),
            requested_reviewers: (p.reviewRequests ?? p.requestedReviewers ?? []).map((r) => ({
                login: r.login ?? r.slug ?? '',
            })),
        };
    }
    mapIssueDetail(i) {
        return {
            number: i.number ?? 0,
            title: i.title ?? '',
            body: i.body ?? '',
            state: i.state ?? '',
            html_url: i.htmlUrl ?? i.url ?? '',
            user: { login: i.author?.login ?? i.user?.login ?? '' },
            created_at: i.createdAt ?? '',
            updated_at: i.updatedAt ?? '',
            labels: (i.labels ?? []).map((l) => ({
                name: l.name ?? '',
                color: l.color ?? '',
            })),
            assignees: (i.assignees ?? []).map((a) => ({
                login: a.login ?? '',
            })),
            comments: i.comments ?? i.commentCount ?? 0,
            milestone: i.milestone ? {
                title: i.milestone.title ?? '',
                number: i.milestone.number ?? 0,
            } : undefined,
        };
    }
    mapReleaseInfo(r) {
        return {
            id: r.id ?? r.databaseId ?? 0,
            tagName: r.tagName ?? '',
            name: r.name ?? '',
            body: r.body ?? '',
            draft: r.draft ?? false,
            prerelease: r.prerelease ?? false,
            html_url: r.htmlUrl ?? r.url ?? '',
            created_at: r.createdAt ?? '',
            published_at: r.publishedAt ?? '',
            author: { login: r.author?.login ?? '' },
            assets: (r.assets ?? []).map((a) => ({
                name: a.name ?? '',
                url: a.url ?? a.downloadUrl ?? '',
                size: a.size ?? 0,
                download_count: a.downloadCount ?? 0,
            })),
        };
    }
    extractRepoSlug(remoteUrl) {
        if (!remoteUrl)
            return null;
        const match = remoteUrl.match(/github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?$/);
        return match ? match[1] : null;
    }
    getRepoInfoFromGit() {
        const remoteResult = this.git('remote get-url origin');
        if (remoteResult.exitCode !== 0) {
            return { success: false, error: 'Not a git repository or no remote configured' };
        }
        const slug = this.extractRepoSlug(remoteResult.stdout);
        const [owner, name] = slug ? slug.split('/') : ['unknown', 'unknown'];
        const branchResult = this.git('rev-parse --abbrev-ref HEAD');
        const defaultBranch = branchResult.exitCode === 0 ? branchResult.stdout : 'main';
        const logResult = this.git('log -1 --format=%ci');
        const pushedAt = logResult.exitCode === 0 ? logResult.stdout : '';
        return {
            success: true,
            repo: {
                name,
                full_name: slug ?? name,
                description: '',
                html_url: slug ? `https://github.com/${slug}` : '',
                default_branch: defaultBranch,
                visibility: 'unknown',
                language: '',
                stars: 0,
                forks: 0,
                open_issues: 0,
                watchers: 0,
                created_at: '',
                updated_at: '',
                pushed_at: pushedAt,
                topics: [],
            },
        };
    }
}
//# sourceMappingURL=github.js.map
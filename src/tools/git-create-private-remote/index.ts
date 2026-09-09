import * as vscode from 'vscode';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import { resolveWorkspaceRepoRoot } from '../../shared/git';

const execFileAsync = promisify(execFile);

interface CommandError extends Error {
    stderr?: string;
    stdout?: string;
}

interface RepositoryNames {
    browserUrl: string;
    sshUrl: string;
}

function showError(message: string): void {
    vscode.window.showErrorMessage(`Git Create Private Remote: ${message}`);
}

function showInfo(message: string): void {
    vscode.window.showInformationMessage(`Git Create Private Remote: ${message}`);
}

function githubEnvironment(): { [key: string]: string | undefined } {
    return { ...process.env, GH_HOST: 'github.com' };
}

async function execCommand(
    command: string,
    args: string[],
    cwd?: string,
    env?: { [key: string]: string | undefined },
): Promise<string> {
    const { stdout, stderr } = await execFileAsync(command, args, {
        cwd,
        env,
        maxBuffer: 1024 * 1024,
    });
    if (stderr.trim()) {
        console.warn(`[exec] ${command} stderr: ${stderr}`);
    }
    return stdout.trim();
}

function getCommandErrorMessage(error: unknown): string {
    const commandError = error as CommandError;
    return commandError.stderr?.trim() || commandError.message || String(error);
}

async function isGhAvailable(): Promise<boolean> {
    try {
        await execCommand('gh', ['--version']);
        return true;
    } catch {
        return false;
    }
}

async function getAuthenticatedUser(): Promise<string> {
    await execCommand(
        'gh',
        ['auth', 'status', '--hostname', 'github.com'],
        undefined,
        githubEnvironment(),
    );
    const login = await execCommand(
        'gh',
        ['api', 'user', '--hostname', 'github.com', '--jq', '.login'],
        undefined,
        githubEnvironment(),
    );
    if (!login) {
        throw new Error('Could not determine the authenticated GitHub user.');
    }
    return login;
}

async function repositoryExists(repository: string): Promise<boolean> {
    try {
        await execCommand(
            'gh',
            ['repo', 'view', repository, '--json', 'nameWithOwner'],
            undefined,
            githubEnvironment(),
        );
        return true;
    } catch {
        return false;
    }
}

async function createRepository(repository: string): Promise<void> {
    await execCommand(
        'gh',
        ['repo', 'create', repository, '--private'],
        undefined,
        githubEnvironment(),
    );
}

async function getRemoteNames(cwd: string): Promise<string[]> {
    const output = await execCommand('git', ['remote'], cwd);
    return output ? output.split(/\r?\n/).filter(Boolean) : [];
}

function validateOwner(value: string): string | undefined {
    if (!value.trim()) {
        return 'GitHub owner is required';
    }
    if (value !== value.trim()) {
        return 'GitHub owner must not start or end with whitespace';
    }
    if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(value)) {
        return 'Enter a GitHub username or organization name';
    }
    return undefined;
}

function validateRepositoryName(value: string): string | undefined {
    if (!value.trim()) {
        return 'Repository name is required';
    }
    if (value !== value.trim()) {
        return 'Repository name must not start or end with whitespace';
    }
    if (value.length > 100) {
        return 'Repository name must be 100 characters or fewer';
    }
    if (!/^[A-Za-z0-9._-]+$/.test(value)) {
        return 'Use only letters, numbers, dots, hyphens, and underscores';
    }
    return undefined;
}

function validateRemoteName(value: string, existingNames: string[]): string | undefined {
    if (!value.trim()) {
        return 'Remote name is required';
    }
    if (value !== value.trim()) {
        return 'Remote name must not start or end with whitespace';
    }
    if (value.startsWith('-')) {
        return 'Remote name must not start with a hyphen';
    }
    if (existingNames.includes(value)) {
        return `Remote "${value}" already exists. Choose another name`;
    }
    return undefined;
}

async function getGitProtocol(): Promise<'ssh' | 'https'> {
    try {
        const protocol = await execCommand(
            'gh',
            ['config', 'get', 'git_protocol', '--host', 'github.com'],
            undefined,
            githubEnvironment(),
        );
        return protocol.toLowerCase() === 'ssh' ? 'ssh' : 'https';
    } catch {
        return 'https';
    }
}

function getRepositoryNames(owner: string, repositoryName: string): RepositoryNames {
    const fullName = `${owner}/${repositoryName}`;
    return {
        browserUrl: `https://github.com/${fullName}`,
        sshUrl: `git@github.com:${fullName}.git`,
    };
}

async function addRemoteWithRetry(cwd: string, remoteUrls: RepositoryNames): Promise<string | undefined> {
    let existingNames = await getRemoteNames(cwd);

    while (true) {
        const remoteName = await vscode.window.showInputBox({
            title: 'Add Git Remote',
            prompt: 'Enter a unique remote name',
            placeHolder: 'e.g. upstream or github-private',
            validateInput: (value) => validateRemoteName(value, existingNames),
        });

        if (remoteName === undefined) {
            return undefined;
        }

        try {
            const protocol = await getGitProtocol();
            const remoteUrl = protocol === 'ssh' ? remoteUrls.sshUrl : `${remoteUrls.browserUrl}.git`;
            await execCommand('git', ['remote', 'add', remoteName, remoteUrl], cwd);
            return remoteName;
        } catch (error) {
            const action = await vscode.window.showErrorMessage(
                `Failed to add remote "${remoteName}": ${getCommandErrorMessage(error)}`,
                { modal: true },
                'Retry',
                'Finish',
            );
            if (action !== 'Retry') {
                return undefined;
            }

            try {
                existingNames = await getRemoteNames(cwd);
            } catch {
                // Keep the last known names and let the next git command report its error.
            }
        }
    }
}

export function registerGitCreatePrivateRemote(context: vscode.ExtensionContext): void {
    const command = vscode.commands.registerCommand('dev-tools.gitCreatePrivateRemote', async () => {
        const repoRoot = await resolveWorkspaceRepoRoot();
        if (!repoRoot) {
            showError('No git repository found.');
            return;
        }

        if (!(await isGhAvailable())) {
            showError('GitHub CLI (gh) is not installed. Please install it first.');
            return;
        }

        let authenticatedUser: string;
        try {
            authenticatedUser = await getAuthenticatedUser();
        } catch (error) {
            showError(`Not authenticated with GitHub.com. Please run "gh auth login" first. ${getCommandErrorMessage(error)}`);
            return;
        }

        const owner = await vscode.window.showInputBox({
            title: 'GitHub Owner',
            prompt: 'Enter the GitHub username or organization that will own the repository',
            value: authenticatedUser,
            validateInput: validateOwner,
        });
        if (owner === undefined) {
            return;
        }

        const repositoryName = await vscode.window.showInputBox({
            title: 'GitHub Repository Name',
            prompt: 'Enter the name for the new private repository',
            value: path.basename(repoRoot),
            validateInput: validateRepositoryName,
        });
        if (repositoryName === undefined) {
            return;
        }

        const repository = `${owner}/${repositoryName}`;
        const remoteUrls = getRepositoryNames(owner, repositoryName);

        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: 'Git Create Private Remote',
                cancellable: false,
            },
            async (progress) => {
                try {
                    progress.report({ message: `Checking whether ${repository} already exists...` });
                    if (await repositoryExists(repository)) {
                        showError(`GitHub repository "${repository}" already exists. No remote was added.`);
                        return;
                    }

                    progress.report({ message: 'Creating private GitHub repository...' });
                    await createRepository(repository);
                } catch (error) {
                    showError(`Failed to create GitHub repository: ${getCommandErrorMessage(error)}`);
                    return;
                }

                let urlCopied = true;
                try {
                    await vscode.env.clipboard.writeText(remoteUrls.browserUrl);
                } catch (error) {
                    urlCopied = false;
                    showError(`Repository was created at ${remoteUrls.browserUrl}, but its URL could not be copied: ${getCommandErrorMessage(error)}`);
                }

                const clipboardStatus = urlCopied
                    ? 'The URL was copied to the clipboard.'
                    : 'The URL could not be copied to the clipboard.';
                const action = await vscode.window.showInformationMessage(
                    `Private GitHub repository created at ${remoteUrls.browserUrl}. ${clipboardStatus} Add it as a Git remote?`,
                    { modal: true },
                    'Add Remote',
                    'Skip',
                );

                let remoteName: string | undefined;
                if (action === 'Add Remote') {
                    try {
                        remoteName = await addRemoteWithRetry(repoRoot, remoteUrls);
                    } catch (error) {
                        showError(`Repository was created at ${remoteUrls.browserUrl}, but local remotes could not be read: ${getCommandErrorMessage(error)}`);
                        return;
                    }
                }

                if (remoteName) {
                    showInfo(`Created ${remoteUrls.browserUrl} and added Git remote "${remoteName}". ${clipboardStatus}`);
                } else {
                    showInfo(`Created ${remoteUrls.browserUrl}. No Git remote was added. ${clipboardStatus}`);
                }
            },
        );
    });

    context.subscriptions.push(command);
}

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockExec = vi.hoisted(() => vi.fn());

vi.mock('child_process', () => ({
    exec: mockExec,
}));

vi.mock('vscode', () => ({
    window: {
        showErrorMessage: vi.fn(),
        showInformationMessage: vi.fn(),
        showOpenDialog: vi.fn(),
        activeTextEditor: undefined,
        withProgress: vi.fn(),
        showInputBox: vi.fn(),
    },
    workspace: { workspaceFolders: undefined },
    commands: { registerCommand: vi.fn() },
    env: { clipboard: { writeText: vi.fn() } },
    Uri: { file: (p: string) => ({ fsPath: p }) },
    ProgressLocation: { Notification: 1 },
}));

import { tagExistsOnRemote } from './index';

describe('tagExistsOnRemote', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns true when git ls-remote returns output', async () => {
        mockExec.mockImplementation((cmd, opts, cb) => {
            cb(null, { stdout: 'v1.0.0', stderr: '' });
        });
        await expect(tagExistsOnRemote('v1.0.0', '/repo')).resolves.toBe(true);
    });

    it('returns false when git ls-remote returns empty string', async () => {
        mockExec.mockImplementation((cmd, opts, cb) => {
            cb(null, { stdout: '', stderr: '' });
        });
        await expect(tagExistsOnRemote('v2.0.0', '/repo')).resolves.toBe(false);
    });

    it('returns false when exec throws', async () => {
        mockExec.mockImplementation((cmd, opts, cb) => {
            cb(new Error('fatal: could not read Username'));
        });
        await expect(tagExistsOnRemote('v3.0.0', '/repo')).resolves.toBe(false);
    });
});

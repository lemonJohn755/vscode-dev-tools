import * as vscode from 'vscode';

export interface TransformRunnerOptions {
    prefix: string;
    language: string;
    transform: (content: string) => string;
    successMessage: string;
    errorMessage: string;
    openLabel: string;
    filters: { [key: string]: string[] };
    useSelection?: boolean;
}

function showError(prefix: string, message: string): void {
    vscode.window.showErrorMessage(`${prefix}: ${message}`);
}

function showInfo(prefix: string, message: string): void {
    vscode.window.showInformationMessage(`${prefix}: ${message}`);
}

async function pickContent(
    prefix: string,
    openLabel: string,
    filters: { [key: string]: string[] },
    useSelection: boolean,
    selectedContent?: string,
): Promise<string | undefined> {
    const choice = await vscode.window.showQuickPick(
        [
            { label: '$(file) Use Current Editor File', description: 'Use the currently open file', value: 'current' },
            { label: '$(folder) Select File from Explorer', description: 'Browse and select a file', value: 'select' },
        ],
        { placeHolder: 'Choose input source', ignoreFocusOut: true },
    );

    if (!choice) {
        return undefined;
    }

    if (choice.value === 'current') {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            showError(prefix, 'No active editor open.');
            return undefined;
        }
        if (useSelection && selectedContent !== undefined) {
            return selectedContent;
        }
        return editor.document.getText();
    }

    const uri = await vscode.window.showOpenDialog({
        canSelectMany: false,
        openLabel,
        filters,
    });

    if (!uri || uri.length === 0) {
        return undefined;
    }

    try {
        const doc = await vscode.workspace.openTextDocument(uri[0]);
        return doc.getText();
    } catch (err) {
        showError(prefix, `Failed to read file: ${err}`);
        return undefined;
    }
}

async function openResult(content: string, language: string): Promise<void> {
    const doc = await vscode.workspace.openTextDocument({ content, language });
    await vscode.window.showTextDocument(doc, { preview: true });
}

export async function runTransformCommand(opts: TransformRunnerOptions): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    const selectedContent = opts.useSelection && editor && !editor.selection.isEmpty
        ? editor.document.getText(editor.selection)
        : undefined;
    const content = await pickContent(opts.prefix, opts.openLabel, opts.filters, opts.useSelection ?? false, selectedContent);
    if (content === undefined) {
        return;
    }
    try {
        const result = opts.transform(content);
        await openResult(result, opts.language);
        showInfo(opts.prefix, opts.successMessage);
    } catch {
        showError(opts.prefix, opts.errorMessage);
    }
}

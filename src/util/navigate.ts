import { App, MarkdownView, Notice } from 'obsidian';
import type { QmdResult } from '../client/types';

export async function navigateToResult(app: App, result: QmdResult): Promise<void> {
  // result.path is relative to the collection root (e.g. "notes/file.md").
  // Try direct vault lookup first, then fall back to basename match.
  const file =
    app.vault.getFileByPath(result.path) ??
    app.vault.getMarkdownFiles().find(
      (f) => f.path.endsWith('/' + result.path) || f.basename === result.path.replace(/\.md$/, ''),
    ) ??
    null;

  if (!file) {
    new Notice(`QMD: File not found: ${result.path}`);
    return;
  }

  const leaf = app.workspace.getLeaf(false);
  await leaf.openFile(file);

  if (result.line == null) return;

  const view = leaf.view;
  if (view instanceof MarkdownView) {
    const editor = view.editor;
    const pos = { line: result.line, ch: 0 };
    editor.setCursor(pos);
    editor.scrollIntoView({ from: pos, to: pos }, true);
  }
}

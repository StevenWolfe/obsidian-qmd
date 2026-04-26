// eslint-disable-next-line @typescript-eslint/no-var-requires
const { execFile } = require('child_process') as typeof import('child_process');

import { Notice, Plugin } from 'obsidian';
import { DEFAULT_SETTINGS, QmdSearchSettings, QmdSettingTab } from './settings';
import { setLogLevel } from './util/log';
import { buildEnv, initShellContext } from './util/env';
import type { QmdClient } from './client/base';
import { CliQmdClient } from './client/cli';
import { McpQmdClient } from './client/mcp';
import { SearchModal } from './ui/SearchModal';
import { StatusModal } from './ui/StatusModal';

export default class QmdSearchPlugin extends Plugin {
  settings!: QmdSearchSettings;
  client!: QmdClient;
  modelLoaded = false;
  // Resolved at runtime; may differ from settings.qmdBinaryPath when that is
  // still the default 'qmd' and the binary lives somewhere outside Electron's PATH.
  resolvedBinaryPath = 'qmd';

  async onload(): Promise<void> {
    await this.loadSettings();
    this.resolvedBinaryPath = await initShellContext(this.settings.qmdBinaryPath);
    this.client = this.buildClient();

    this.addCommand({
      id: 'qmd-search',
      name: 'QMD: Search',
      callback: () => new SearchModal(this.app, this.client, this.settings, this).open(),
    });

    this.addCommand({
      id: 'qmd-status',
      name: 'QMD: Index status',
      callback: () => new StatusModal(this.app, this.client).open(),
    });

    this.addCommand({
      id: 'qmd-reindex',
      name: 'QMD: Re-index collections',
      callback: () => this.reindex(),
    });

    this.addSettingTab(new QmdSettingTab(this.app, this));
  }

  async onunload(): Promise<void> {
    await this.client.dispose();
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    setLogLevel(this.settings.logLevel);
  }

  async saveSettings(rebuildClient = true): Promise<void> {
    await this.saveData(this.settings);
    setLogLevel(this.settings.logLevel);
    if (rebuildClient) {
      this.client.dispose().catch(console.error);
      this.resolvedBinaryPath = await initShellContext(this.settings.qmdBinaryPath);
      this.client = this.buildClient();
      this.modelLoaded = false;
    }
  }

  private buildClient(): QmdClient {
    if (this.settings.transportMode === 'mcp-http') {
      const c = new McpQmdClient(this.resolvedBinaryPath, this.settings.mcpPort);
      c.init().catch((err: Error) => {
        new Notice(`QMD: Failed to start MCP daemon — ${err.message}`);
      });
      return c;
    }
    return new CliQmdClient(this.resolvedBinaryPath);
  }

  private reindex(): void {
    const notice = new Notice('QMD: re-indexing collections…', 0);
    execFile(this.resolvedBinaryPath, ['update'], { timeout: 600_000, env: buildEnv() }, (err) => {
      notice.hide();
      if (err) new Notice(`QMD: re-index error — ${err.message}`);
      else new Notice('QMD: re-index complete ✓');
    });
  }
}

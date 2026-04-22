// eslint-disable-next-line @typescript-eslint/no-var-requires
const { execFile } = require('child_process') as typeof import('child_process');

import { Notice, Plugin } from 'obsidian';
import { DEFAULT_SETTINGS, QmdSearchSettings, QmdSettingTab } from './settings';
import { setLogLevel } from './util/log';
import type { QmdClient } from './client/base';
import { CliQmdClient } from './client/cli';
import { McpQmdClient } from './client/mcp';
import { SearchModal } from './ui/SearchModal';
import { StatusModal } from './ui/StatusModal';

export default class QmdSearchPlugin extends Plugin {
  settings!: QmdSearchSettings;
  client!: QmdClient;
  modelLoaded = false;

  async onload(): Promise<void> {
    await this.loadSettings();
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

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    setLogLevel(this.settings.logLevel);
    // Rebuild client when transport-relevant settings change
    this.client.dispose().catch(console.error);
    this.client = this.buildClient();
    this.modelLoaded = false;
  }

  private buildClient(): QmdClient {
    if (this.settings.transportMode === 'mcp-http') {
      const c = new McpQmdClient(this.settings.qmdBinaryPath, this.settings.mcpPort);
      c.init().catch((err: Error) => {
        new Notice(`QMD: Failed to start MCP daemon — ${err.message}`);
      });
      return c;
    }
    return new CliQmdClient(this.settings.qmdBinaryPath);
  }

  private reindex(): void {
    const notice = new Notice('QMD: re-indexing collections…', 0);
    execFile(this.settings.qmdBinaryPath, ['update'], { timeout: 600_000, env: process.env as NodeJS.ProcessEnv }, (err) => {
      notice.hide();
      if (err) new Notice(`QMD: re-index error — ${err.message}`);
      else new Notice('QMD: re-index complete ✓');
    });
  }
}

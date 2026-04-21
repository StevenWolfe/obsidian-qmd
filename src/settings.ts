// eslint-disable-next-line @typescript-eslint/no-var-requires
const { spawn } = require('child_process') as typeof import('child_process');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const os = require('os') as typeof import('os');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const path = require('path') as typeof import('path');

import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import type QmdSearchPlugin from './main';

export interface QmdSearchSettings {
  qmdBinaryPath: string;
  transportMode: 'cli' | 'mcp-http';
  mcpPort: number;
  defaultCollection: string;
  defaultSearchMode: 'keyword' | 'semantic' | 'hybrid';
}

export const DEFAULT_SETTINGS: QmdSearchSettings = {
  qmdBinaryPath: 'qmd',
  transportMode: 'cli',
  mcpPort: 8181,
  defaultCollection: '',
  defaultSearchMode: 'hybrid',
};

function runVersion(binary: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(binary, ['--version'], { env: process.env });
    const out: Buffer[] = [];
    proc.stdout.on('data', (c: Buffer) => out.push(c));
    proc.on('close', (code: number) => {
      if (code === 0) resolve(Buffer.concat(out).toString('utf8').trim());
      else reject(new Error(`exit code ${code}`));
    });
    proc.on('error', reject);
  });
}

export class QmdSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: QmdSearchPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    // Binary path
    let versionEl: HTMLElement;
    new Setting(containerEl)
      .setName('qmd binary path')
      .setDesc('Path to the qmd executable. Leave as "qmd" to use PATH.')
      .addText((text) => {
        text
          .setPlaceholder('qmd')
          .setValue(this.plugin.settings.qmdBinaryPath)
          .onChange(async (value) => {
            this.plugin.settings.qmdBinaryPath = value;
            await this.plugin.saveSettings();
          });
        text.inputEl.addEventListener('blur', async () => {
          try {
            const version = await runVersion(this.plugin.settings.qmdBinaryPath);
            versionEl.setText(`✓ ${version}`);
            versionEl.removeClass('qmd-version-error');
            versionEl.addClass('qmd-version-ok');
          } catch {
            versionEl.setText('✗ qmd not found or failed');
            versionEl.removeClass('qmd-version-ok');
            versionEl.addClass('qmd-version-error');
          }
        });
      });
    versionEl = containerEl.createEl('p', { cls: 'qmd-version-hint' });

    // Transport mode
    new Setting(containerEl)
      .setName('Transport mode')
      .setDesc('CLI spawns qmd per-query; MCP-HTTP connects to a persistent daemon.')
      .addDropdown((dd) => {
        dd.addOption('cli', 'CLI (default)')
          .addOption('mcp-http', 'MCP HTTP daemon')
          .setValue(this.plugin.settings.transportMode)
          .onChange(async (value: 'cli' | 'mcp-http') => {
            this.plugin.settings.transportMode = value;
            await this.plugin.saveSettings();
            this.display(); // re-render to show/hide port field
          });
      });

    // MCP port — only shown for mcp-http mode
    if (this.plugin.settings.transportMode === 'mcp-http') {
      new Setting(containerEl)
        .setName('MCP daemon port')
        .setDesc('Port the qmd MCP HTTP daemon listens on.')
        .addText((text) =>
          text
            .setPlaceholder('8181')
            .setValue(String(this.plugin.settings.mcpPort))
            .onChange(async (value) => {
              const port = parseInt(value, 10);
              if (!isNaN(port)) {
                this.plugin.settings.mcpPort = port;
                await this.plugin.saveSettings();
              }
            }),
        );
    }

    // Default collection
    new Setting(containerEl)
      .setName('Default collection')
      .setDesc('Pre-selected collection in the search modal. Leave blank for all.')
      .addText((text) =>
        text
          .setPlaceholder('')
          .setValue(this.plugin.settings.defaultCollection)
          .onChange(async (value) => {
            this.plugin.settings.defaultCollection = value;
            await this.plugin.saveSettings();
          }),
      );

    // Default search mode
    new Setting(containerEl)
      .setName('Default search mode')
      .addDropdown((dd) => {
        dd.addOption('keyword', 'Keyword')
          .addOption('semantic', 'Semantic')
          .addOption('hybrid', 'Hybrid (default)')
          .setValue(this.plugin.settings.defaultSearchMode)
          .onChange(async (value: 'keyword' | 'semantic' | 'hybrid') => {
            this.plugin.settings.defaultSearchMode = value;
            await this.plugin.saveSettings();
          });
      });

    // Register vault as collection
    new Setting(containerEl)
      .setName('Register vault as collection')
      .setDesc('Index this vault with qmd so it appears in search.')
      .addButton((btn) => {
        btn.setButtonText('Register…').onClick(async () => {
          const vaultPath = (this.app.vault.adapter as { basePath?: string }).basePath ?? '';
          const vaultName = this.app.vault.getName();
          const name = prompt('Collection name:', vaultName);
          if (!name) return;

          new Notice(`QMD: registering collection "${name}"…`);
          try {
            await new Promise<void>((resolve, reject) => {
              const proc = spawn(
                this.plugin.settings.qmdBinaryPath,
                ['collection', 'add', vaultPath, '--name', name],
                { env: process.env },
              );
              proc.on('close', (code: number) =>
                code === 0 ? resolve() : reject(new Error(`exit ${code}`)),
              );
              proc.on('error', reject);
            });

            new Notice(`QMD: generating embeddings for "${name}"…`);
            await new Promise<void>((resolve, reject) => {
              const proc = spawn(this.plugin.settings.qmdBinaryPath, ['embed'], {
                env: process.env,
              });
              proc.on('close', (code: number) =>
                code === 0 ? resolve() : reject(new Error(`exit ${code}`)),
              );
              proc.on('error', reject);
            });

            new Notice(`QMD: vault registered as "${name}" ✓`);
          } catch (err) {
            new Notice(`QMD: registration failed — ${(err as Error).message}`);
          }
        });
      });

    // Open index config
    new Setting(containerEl)
      .setName('Open index config')
      .setDesc('Open ~/.config/qmd/index.yml in the system default app.')
      .addButton((btn) => {
        btn.setButtonText('Open config').onClick(() => {
          const configPath = path.join(os.homedir(), '.config', 'qmd', 'index.yml');
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const { shell } = require('electron') as typeof import('electron');
          shell.openPath(configPath);
        });
      });
  }
}

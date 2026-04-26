// eslint-disable-next-line @typescript-eslint/no-var-requires
const { execFile } = require('child_process') as typeof import('child_process');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const fs = require('fs') as typeof import('fs');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const os = require('os') as typeof import('os');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const path = require('path') as typeof import('path');

import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import type QmdSearchPlugin from './main';
import { type LogLevel, setLogLevel, log } from './util/log';
import { buildEnv, resolveQmdBinary } from './util/env';

export interface QmdSearchSettings {
  qmdBinaryPath: string;
  transportMode: 'cli' | 'mcp-http';
  mcpPort: number;
  defaultCollection: string;
  defaultSearchMode: 'keyword' | 'semantic' | 'hybrid';
  logLevel: LogLevel;
}

export const DEFAULT_SETTINGS: QmdSearchSettings = {
  qmdBinaryPath: 'qmd',
  transportMode: 'cli',
  mcpPort: 8181,
  defaultCollection: '',
  defaultSearchMode: 'hybrid',
  logLevel: 'error',
};

function runVersion(binary: string): Promise<string> {
  // For path-like strings, verify existence before spawning — spawning a
  // non-existent file in Electron's renderer corrupts IPC channel cleanup.
  if (!binary.trim()) return Promise.reject(new Error('empty path'));
  if ((binary.includes('/') || binary.includes('\\')) && !fs.existsSync(binary)) {
    return Promise.reject(new Error('file not found'));
  }
  return new Promise((resolve, reject) => {
    execFile(binary, ['--version'], { timeout: 5000, env: buildEnv() }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout.trim());
    });
  });
}

export class QmdSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: QmdSearchPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('p', {
      text: `plugin v${this.plugin.manifest.version}`,
      cls: 'qmd-plugin-version',
    });

    // Binary path
    const versionEl = containerEl.createEl('p', { cls: 'qmd-version-hint' });
    // Show the currently resolved path when the setting is still the default
    if (this.plugin.resolvedBinaryPath !== 'qmd' && this.plugin.settings.qmdBinaryPath === 'qmd') {
      versionEl.setText(`resolved → ${this.plugin.resolvedBinaryPath}`);
      versionEl.addClass('qmd-version-ok');
    }
    let binaryInputEl: HTMLInputElement;
    new Setting(containerEl)
      .setName('qmd binary path')
      .setDesc('Path to the qmd executable. Leave as "qmd" to auto-detect.')
      .addText((text) => {
        binaryInputEl = text.inputEl;
        text
          .setPlaceholder('qmd')
          .setValue(this.plugin.settings.qmdBinaryPath)
          .onChange((value) => {
            this.plugin.settings.qmdBinaryPath = value;
          });
        text.inputEl.addEventListener('blur', async () => {
          await this.plugin.saveSettings();
          try {
            const version = await runVersion(this.plugin.resolvedBinaryPath);
            if (!versionEl.isConnected) return;
            versionEl.setText(`✓ ${version}`);
            versionEl.removeClass('qmd-version-error');
            versionEl.addClass('qmd-version-ok');
          } catch {
            if (!versionEl.isConnected) return;
            versionEl.setText('✗ qmd not found or failed');
            versionEl.removeClass('qmd-version-ok');
            versionEl.addClass('qmd-version-error');
          }
        });
      })
      .addButton((btn) => {
        btn.setButtonText('Auto-detect').onClick(async () => {
          btn.setDisabled(true);
          btn.setButtonText('Detecting…');
          try {
            const resolved = await resolveQmdBinary('qmd');
            if (!versionEl.isConnected) return;
            if (resolved !== 'qmd') {
              binaryInputEl.value = resolved;
              this.plugin.settings.qmdBinaryPath = resolved;
              await this.plugin.saveSettings();
              try {
                const version = await runVersion(resolved);
                versionEl.setText(`✓ ${version}`);
                versionEl.removeClass('qmd-version-error');
                versionEl.addClass('qmd-version-ok');
              } catch {
                versionEl.setText(`Found at ${resolved} but --version failed`);
                versionEl.addClass('qmd-version-ok');
              }
            } else {
              versionEl.setText('✗ Could not find qmd — set path manually');
              versionEl.removeClass('qmd-version-ok');
              versionEl.addClass('qmd-version-error');
            }
          } finally {
            if (btn.buttonEl.isConnected) {
              btn.setDisabled(false);
              btn.setButtonText('Auto-detect');
            }
          }
        });
      });

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
      .addText((text) => {
        text
          .setPlaceholder('')
          .setValue(this.plugin.settings.defaultCollection)
          .onChange((value) => {
            this.plugin.settings.defaultCollection = value;
          });
        text.inputEl.addEventListener('blur', async () => {
          await this.plugin.saveSettings(false);
        });
      });

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
            await this.plugin.saveSettings(false);
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
              execFile(
                this.plugin.settings.qmdBinaryPath,
                ['collection', 'add', vaultPath, '--name', name],
                { timeout: 30_000, env: buildEnv() },
                (err) => (err ? reject(err) : resolve()),
              );
            });

            new Notice(`QMD: generating embeddings for "${name}"…`);
            await new Promise<void>((resolve, reject) => {
              execFile(
                this.plugin.settings.qmdBinaryPath,
                ['embed'],
                { timeout: 600_000, env: buildEnv() },
                (err) => (err ? reject(err) : resolve()),
              );
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
        btn.setButtonText('Open config').onClick(async () => {
          const configPath = path.join(os.homedir(), '.config', 'qmd', 'index.yml');
          const configDir = path.dirname(configPath);
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const { shell } = require('electron') as typeof import('electron');
          const target = fs.existsSync(configPath) ? configPath
            : fs.existsSync(configDir) ? configDir
            : null;
          if (!target) {
            new Notice('QMD: ~/.config/qmd/ not found — install qmd first.');
            return;
          }
          const err = await shell.openPath(target);
          if (err) new Notice(`QMD: failed to open config — ${err}`);
        });
      });

    // Log level
    new Setting(containerEl)
      .setName('Log level')
      .setDesc('Controls what qmd plugin output appears in the console / --enable-logging file.')
      .addDropdown((dd) =>
        dd
          .addOption('off',   'Off')
          .addOption('error', 'Errors only (default)')
          .addOption('warn',  'Warnings + errors')
          .addOption('debug', 'Debug (verbose)')
          .setValue(this.plugin.settings.logLevel)
          .onChange(async (value: LogLevel) => {
            this.plugin.settings.logLevel = value;
            setLogLevel(value);
            await this.plugin.saveSettings(false);
          }),
      );

    // Status summary
    containerEl.createEl('h3', { text: 'Status', cls: 'qmd-section-heading' });
    const statusEl = containerEl.createDiv({ cls: 'qmd-status-inline' });
    statusEl.createEl('p', { text: 'Checking…', cls: 'qmd-muted' });

    this.plugin.client.status().then((s) => {
      if (!statusEl.isConnected) return;
      statusEl.empty();
      const health = statusEl.createDiv({ cls: 'qmd-status-health' });
      health.createEl('span', {
        text: s.healthy ? '✓ Healthy' : '✗ Unhealthy',
        cls: s.healthy ? 'qmd-status-ok' : 'qmd-status-err',
      });
      if (s.message) health.createEl('span', { text: ` — ${s.message}`, cls: 'qmd-status-message' });

      if (s.collections.length === 0) {
        statusEl.createEl('p', { text: 'No collections registered.', cls: 'qmd-muted' });
        return;
      }
      const table = statusEl.createEl('table', { cls: 'qmd-status-table' });
      const head = table.createEl('thead').createEl('tr');
      head.createEl('th', { text: 'Collection' });
      head.createEl('th', { text: 'Docs' });
      head.createEl('th', { text: 'Last indexed' });
      const tbody = table.createEl('tbody');
      for (const col of s.collections) {
        const row = tbody.createEl('tr');
        row.createEl('td', { text: col.name });
        row.createEl('td', { text: String(col.docCount) });
        row.createEl('td', { text: col.lastIndexed ?? '—' });
      }
    }).catch((err: Error) => {
      log.error('status failed:', err.message);
      if (!statusEl.isConnected) return;
      statusEl.empty();
      statusEl.createEl('p', { text: `Status error: ${err.message}`, cls: 'qmd-error' });
    });
  }
}

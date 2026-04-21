import { App, Modal } from 'obsidian';
import type { QmdClient } from '../client/base';
import type { QmdStatus } from '../client/types';

export class StatusModal extends Modal {
  constructor(app: App, private readonly client: QmdClient) {
    super(app);
  }

  async onOpen(): Promise<void> {
    const { contentEl } = this;
    contentEl.addClass('qmd-status-modal');
    contentEl.createEl('h2', { text: 'QMD Index Status' });

    const body = contentEl.createDiv({ cls: 'qmd-status-body' });
    body.createEl('p', { text: 'Loading…', cls: 'qmd-status-loading' });

    let status: QmdStatus;
    try {
      status = await this.client.status();
    } catch (err) {
      body.empty();
      body.createEl('p', {
        text: `Error fetching status: ${(err as Error).message}`,
        cls: 'qmd-error',
      });
      return;
    }

    body.empty();

    // Health indicator
    const healthRow = body.createDiv({ cls: 'qmd-status-health' });
    healthRow.createEl('span', {
      text: status.healthy ? '✓ Healthy' : '✗ Unhealthy',
      cls: status.healthy ? 'qmd-status-ok' : 'qmd-status-err',
    });
    if (status.message) {
      healthRow.createEl('span', { text: status.message, cls: 'qmd-status-message' });
    }

    // Collections table
    if (status.collections.length > 0) {
      const table = body.createEl('table', { cls: 'qmd-status-table' });
      const head = table.createEl('thead').createEl('tr');
      head.createEl('th', { text: 'Collection' });
      head.createEl('th', { text: 'Documents' });
      head.createEl('th', { text: 'Last indexed' });

      const tbody = table.createEl('tbody');
      for (const col of status.collections) {
        const row = tbody.createEl('tr');
        row.createEl('td', { text: col.name });
        row.createEl('td', { text: String(col.docCount) });
        row.createEl('td', { text: col.lastIndexed ?? '—' });
      }
    } else {
      body.createEl('p', { text: 'No collections found.', cls: 'qmd-muted' });
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

import { App, Modal, Notice, Plugin } from 'obsidian';
import type { QmdClient } from '../client/base';
import type { QmdSearchSettings } from '../settings';
import type { SearchMode } from '../client/types';
import { loadCollectionNames } from '../util/config';
import { navigateToResult } from '../util/navigate';
import { buildResultItem } from './ResultItem';

interface ModelLoadedHost {
  modelLoaded: boolean;
}

export class SearchModal extends Modal {
  private queryInput!: HTMLInputElement;
  private collectionSelect!: HTMLSelectElement;
  private intentInput!: HTMLInputElement;
  private intentRow!: HTMLElement;
  private resultsContainer!: HTMLElement;
  private activeMode: SearchMode;

  constructor(
    app: App,
    private readonly client: QmdClient,
    private readonly settings: QmdSearchSettings,
    private readonly plugin: ModelLoadedHost,
  ) {
    super(app);
    this.activeMode = settings.defaultSearchMode;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass('qmd-search-modal');

    // Query input
    this.queryInput = contentEl.createEl('input', {
      type: 'text',
      cls: 'qmd-query-input',
      attr: { placeholder: 'Search your notes…', 'aria-label': 'Search query' },
    });

    // Collection dropdown
    const collectionRow = contentEl.createDiv({ cls: 'qmd-control-row' });
    collectionRow.createEl('label', { text: 'Collection', cls: 'qmd-label' });
    this.collectionSelect = collectionRow.createEl('select', { cls: 'qmd-collection-select' });
    this.collectionSelect.createEl('option', { value: '', text: 'All collections' });
    for (const name of loadCollectionNames()) {
      this.collectionSelect.createEl('option', { value: name, text: name });
    }
    if (this.settings.defaultCollection) {
      this.collectionSelect.value = this.settings.defaultCollection;
    }

    // Mode segmented control
    const modeRow = contentEl.createDiv({ cls: 'qmd-mode-row' });
    for (const [label, value] of [
      ['Keyword', 'keyword'],
      ['Semantic', 'semantic'],
      ['Hybrid', 'hybrid'],
    ] as [string, SearchMode][]) {
      const btn = modeRow.createEl('button', { text: label, cls: 'qmd-mode-btn' });
      if (value === this.activeMode) btn.addClass('qmd-mode-btn--active');
      btn.addEventListener('click', () => {
        this.activeMode = value;
        modeRow.querySelectorAll('.qmd-mode-btn').forEach((b) => b.classList.remove('qmd-mode-btn--active'));
        btn.addClass('qmd-mode-btn--active');
      });
    }

    // Intent collapsible
    const intentWrapper = contentEl.createDiv({ cls: 'qmd-intent-wrapper' });
    const intentToggle = intentWrapper.createEl('button', {
      cls: 'qmd-intent-toggle',
      attr: { 'aria-expanded': 'false' },
    });
    intentToggle.innerHTML = '&#x25B8; Intent';
    this.intentRow = intentWrapper.createDiv({ cls: 'qmd-intent-row qmd-intent-row--hidden' });
    this.intentInput = this.intentRow.createEl('input', {
      type: 'text',
      cls: 'qmd-intent-input',
      attr: { placeholder: 'e.g. web performance (steers ranking, not a search term)' },
    });
    intentToggle.addEventListener('click', () => {
      const hidden = this.intentRow.hasClass('qmd-intent-row--hidden');
      this.intentRow.toggleClass('qmd-intent-row--hidden', !hidden);
      intentToggle.setAttribute('aria-expanded', String(hidden));
      intentToggle.innerHTML = (hidden ? '&#x25BE; Intent' : '&#x25B8; Intent');
    });

    // Results area
    this.resultsContainer = contentEl.createDiv({ cls: 'qmd-results' });

    // Submit on Enter
    this.queryInput.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter') this.runSearch();
    });

    this.queryInput.focus();
  }

  private async runSearch(): Promise<void> {
    const query = this.queryInput.value.trim();
    if (!query) return;

    const isCliHybrid =
      this.settings.transportMode === 'cli' &&
      this.activeMode === 'hybrid' &&
      !this.plugin.modelLoaded;

    const noticeText = isCliHybrid
      ? 'QMD: loading models and searching…'
      : 'QMD: searching…';
    const notice = new Notice(noticeText, 0);

    this.resultsContainer.empty();

    try {
      const results = await this.client.search({
        query,
        mode: this.activeMode,
        collection: this.collectionSelect.value || undefined,
        intent: this.intentInput.value.trim() || undefined,
      });

      this.plugin.modelLoaded = true;

      if (results.length === 0) {
        this.resultsContainer.createEl('p', { text: 'No results.', cls: 'qmd-no-results' });
        return;
      }

      for (const result of results) {
        const item = buildResultItem(result, async () => {
          await navigateToResult(this.app, result);
          this.close();
        });
        this.resultsContainer.appendChild(item);
      }
    } catch (err) {
      this.resultsContainer.createEl('p', {
        text: `Error: ${(err as Error).message}`,
        cls: 'qmd-error',
      });
    } finally {
      notice.hide();
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

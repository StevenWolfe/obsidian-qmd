import { App, Modal, Notice, TFile, prepareFuzzySearch } from 'obsidian';
import type { QmdClient } from '../client/base';
import type { QmdSearchSettings } from '../settings';
import type { QmdResult, SearchMode } from '../client/types';
import { loadCollectionNames } from '../util/config';
import { navigateToResult } from '../util/navigate';
import { buildResultItem } from './ResultItem';
import { log } from '../util/log';

interface ModelLoadedHost {
  modelLoaded: boolean;
}

export class SearchModal extends Modal {
  private queryInput!: HTMLInputElement;
  private collectionSelect!: HTMLSelectElement;
  private intentInput!: HTMLInputElement;
  private intentRow!: HTMLElement;
  private resultsArea!: HTMLElement;
  private qmdContainer!: HTMLElement;
  private vaultContainer!: HTMLElement;
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
    this.modalEl.addClass('qmd-search-modal');

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

    // Results area — two sections (hidden until first search)
    this.resultsArea = contentEl.createDiv({ cls: 'qmd-results qmd-results--hidden' });

    const qmdSection = this.resultsArea.createDiv({ cls: 'qmd-results-section' });
    qmdSection.createEl('h4', { text: 'qmd', cls: 'qmd-results-section-heading' });
    this.qmdContainer = qmdSection.createDiv({ cls: 'qmd-results-section-body' });

    const vaultSection = this.resultsArea.createDiv({ cls: 'qmd-results-section' });
    vaultSection.createEl('h4', { text: 'vault search', cls: 'qmd-results-section-heading' });
    this.vaultContainer = vaultSection.createDiv({ cls: 'qmd-results-section-body' });

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

    const notice = new Notice(isCliHybrid ? 'QMD: loading models and searching…' : 'QMD: searching…', 0);

    // Show results area and set loading state
    this.resultsArea.removeClass('qmd-results--hidden');
    this.qmdContainer.empty();
    this.vaultContainer.empty();
    this.qmdContainer.createEl('p', { text: 'Searching…', cls: 'qmd-muted' });
    this.vaultContainer.createEl('p', { text: 'Searching…', cls: 'qmd-muted' });

    // Fire qmd search async while vault search runs synchronously
    const qmdPromise = this.client.search({
      query,
      mode: this.activeMode,
      collection: this.collectionSelect.value || undefined,
      intent: this.intentInput.value.trim() || undefined,
      noRerank: this.settings.noRerank || undefined,
      candidateLimit: this.settings.candidateLimit || undefined,
      minScore: this.settings.minScore || undefined,
    });
    const vaultFiles = this.searchVault(query);

    // Populate vault results immediately (sync, no waiting)
    this.renderVaultResults(vaultFiles);

    // Wait for qmd results
    let qmdResults: QmdResult[] | null = null;
    let qmdError: Error | null = null;
    try {
      qmdResults = await qmdPromise;
      this.plugin.modelLoaded = true;
    } catch (err) {
      qmdError = err as Error;
      log.error('search failed:', qmdError.message);
    } finally {
      notice.hide();
    }

    this.qmdContainer.empty();
    if (qmdError) {
      this.qmdContainer.createEl('p', { text: `Error: ${qmdError.message}`, cls: 'qmd-error' });
    } else if (!qmdResults || qmdResults.length === 0) {
      this.qmdContainer.createEl('p', { text: 'No results.', cls: 'qmd-no-results' });
    } else {
      for (const result of qmdResults) {
        this.qmdContainer.appendChild(buildResultItem(result, async () => {
          await navigateToResult(this.app, result);
          this.close();
        }));
      }
    }
  }

  private searchVault(query: string): TFile[] {
    const fuzzy = prepareFuzzySearch(query);
    return this.app.vault.getMarkdownFiles()
      .map((file) => ({ file, result: fuzzy(file.basename) }))
      .filter((x) => x.result !== null)
      .sort((a, b) => b.result!.score - a.result!.score)
      .slice(0, 7)
      .map((x) => x.file);
  }

  private renderVaultResults(files: TFile[]): void {
    this.vaultContainer.empty();
    if (files.length === 0) {
      this.vaultContainer.createEl('p', { text: 'No matches.', cls: 'qmd-no-results' });
      return;
    }
    for (const file of files) {
      this.vaultContainer.appendChild(this.buildVaultResultItem(file));
    }
  }

  private buildVaultResultItem(file: TFile): HTMLElement {
    const item = document.createElement('div');
    item.className = 'qmd-result-item';
    item.setAttribute('role', 'button');
    item.tabIndex = 0;

    const header = item.createDiv({ cls: 'qmd-result-header' });
    header.createEl('span', { cls: 'qmd-result-title', text: file.basename });
    header.createEl('span', { cls: 'qmd-result-badge qmd-result-badge--vault', text: 'vault' });
    item.createEl('span', { cls: 'qmd-result-path', text: file.path });

    const onClick = async () => {
      await this.app.workspace.getLeaf(false).openFile(file);
      this.close();
    };
    item.addEventListener('click', onClick);
    item.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') void onClick();
    });

    return item;
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

'use strict';
(function() {
const __nativeRequire = typeof require === 'function' ? require : null;
const __modules = {
"main.js": function(require, module, exports) {
const {
  ItemView,
  Notice,
  Plugin,
  PluginSettingTab,
  requestUrl,
  Setting,
  TFile,
  TFolder
} = require("obsidian");

const {
  DEFAULT_SETTINGS,
  buildTaskFromFile,
  detectSourceType,
  isProcessableSource,
  migrateSettings,
  normalizeVaultPath,
  rollbackPath,
  sourceHash,
  statusCounts,
  tasksPath
} = require("src/core/task.js");
const { extractTextFromBuffer } = require("src/core/extractors.js");
const { createFolderIndexMarkdown, folderIndexPath } = require("src/core/moc.js");
const { parseTagLibrary, suggestMapIndex, validateCard } = require("src/core/tags.js");
const { detectEcosystemPlugins } = require("src/core/ecosystem.js");
const { cardOutputPath, resolveFixedRoute } = require("src/core/routing.js");
const { migrateTaskLedgerV3 } = require("src/core/migration.js");
const { createTaskRecord } = require("src/core/pipeline.js");
const { requestMiniMaxJson } = require("src/core/ai-pipeline.js");
const { runKnowledgeWorkflow } = require("src/core/workflow.js");
const { buildCardRecord, cardFileName, renderKnowledgeCard, renderStructuredSummary } = require("src/core/markdown-renderer.js");
const { groupReviewItems, applyBatchAction } = require("src/core/review-service.js");

function loadSecretsFile() {
  try {
    const fs = require('fs');
    const path = require('path');
    const os = require('os');
    const secretsPath = path.join(os.homedir(), '.eks-secrets.json');
    if (fs.existsSync(secretsPath)) {
      return JSON.parse(fs.readFileSync(secretsPath, 'utf-8'));
    }
  } catch (e) {
    console.warn('工程知识切片: 密钥文件加载失败', e);
  }
  return {};
}

class RateLimiter {
  constructor(intervalMs, maxConcurrent) {
    this.intervalMs = intervalMs || 1000;
    this.maxConcurrent = maxConcurrent || 2;
    this.activeRequests = 0;
    this.lastRequestTime = 0;
  }
  async acquire() {
    while (this.activeRequests >= this.maxConcurrent) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;
    if (elapsed < this.intervalMs) {
      await new Promise(resolve => setTimeout(resolve, this.intervalMs - elapsed));
    }
    this.activeRequests++;
    this.lastRequestTime = Date.now();
  }
  release() {
    this.activeRequests--;
  }
  async run(fn) {
    await this.acquire();
    try { return await fn(); } finally { this.release(); }
  }
}

const VIEW_TYPE_SLICER = 'engineering-knowledge-slicer-dashboard';
const PROCESSING_STATUSES = new Set(['parsing', 'classifying', 'summarizing', 'atomizing', 'validating', 'writing']);

module.exports = class EngineeringKnowledgeSlicerPlugin extends Plugin {
  async onload() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, migrateSettings(await this.loadData()));
    const _secrets = loadSecretsFile();
    if (this.settings.useEnvKeys !== false) {
      if (_secrets.minimaxApiKey) this.settings.minimaxApiKey = _secrets.minimaxApiKey;
      if (_secrets.pdfMineruApiKey) this.settings.pdfMineruApiKey = _secrets.pdfMineruApiKey;
      if (_secrets.pdfPaddleOcrApiKey) this.settings.pdfPaddleOcrApiKey = _secrets.pdfPaddleOcrApiKey;
    }
    // 密钥注入后再写盘，确保 data.json 不会因为顺序问题而清掉 secrets
    await this.saveData(this.settings);
    this.rateLimiter = new RateLimiter(this.settings.rateLimitMs || 1000, this.settings.rateLimitMaxConcurrent || 2);
    this.autoProcessing = false;
    this.pauseRequested = false;
    this.cancelRequestedTaskId = '';
    this.sessionStats = { scanned: 0, processed: 0, written: 0, review: 0, failed: 0, skipped: 0, current: '', lastMessage: '等待开始处理' };
    this.registerView(VIEW_TYPE_SLICER, (leaf) => new SlicerDashboardView(leaf, this));

    this.addRibbonIcon('layers', '工程知识切片', () => this.activateView());
    this.addCommand({ id: 'open-slicer-dashboard', name: '打开工程知识切片控制台', callback: () => this.activateView() });
    this.addCommand({ id: 'scan-source-files', name: '扫描源文件', callback: () => this.scanSourceFiles(true) });
    this.addCommand({ id: 'process-next-source-file', name: '处理下一个队列文件', callback: () => this.processNextQueuedTask() });
    this.addCommand({ id: 'auto-process-source-files', name: '自动处理可信卡片', callback: () => this.autoProcessQueue(true) });
    this.addCommand({ id: 'retry-failed-source-files', name: '重试失败任务并自动处理', callback: () => this.retryFailedAndAutoProcess(true) });
    this.addCommand({ id: 'rollback-last-batch', name: '回滚最近一批卡片', callback: () => this.rollbackLastBatch() });
    this.addCommand({ id: 'open-ai-settings', name: '打开工程知识切片 AI 设置', callback: () => this.activateView() });

    this.registerEvent(this.app.workspace.on('file-menu', (menu, file) => {
      if (!(file instanceof TFile)) return;
      menu.addItem((item) => item
        .setTitle('用工程知识切片处理')
        .setIcon('layers')
        .onClick(() => this.processSingleFile(file)));
      menu.addItem((item) => item
        .setTitle('查看切片处理历史')
        .setIcon('history')
        .onClick(() => this.showHistoryForFile(file)));
    }));

    this.addSettingTab(new SlicerSettingTab(this.app, this));
  }

  onunload() {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_SLICER);
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  async testServiceConnection(service) {
    const config = serviceConnectionConfig(service, this.settings);
    if (!config.apiKey) {
      new Notice(`${config.label} 密钥未配置。`);
      return false;
    }
    if (typeof fetch !== 'function') {
      new Notice('当前 Obsidian 环境不支持网络请求。');
      return false;
    }
    try {
      const response = await obsidianRequest(config.url, config.request);
      if (response.status === 401 || response.status === 403) throw new Error('鉴权失败，请检查密钥。');
      if (service === 'minimax' && !response.ok) throw new Error(`HTTP ${response.status}`);
      new Notice(`${config.label} 连接可用。`);
      return true;
    } catch (error) {
      new Notice(`${config.label} 连接失败：${sanitizeSecret(error.message)}`);
      return false;
    }
  }

  async activateView() {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_SLICER);
    const leaf = leaves[0] || this.app.workspace.getRightLeaf(false);
    await leaf.setViewState({ type: VIEW_TYPE_SLICER, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  async refreshViews() {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_SLICER)) {
      if (leaf.view && leaf.view.render) {
        try {
          await leaf.view.render();
        } catch (error) {
          console.error('工程知识切片界面刷新失败', error);
          new Notice(`工程知识切片界面刷新失败：${error.message}`);
        }
      }
    }
  }

  openSettings() {
    const setting = this.app.setting;
    if (!setting) {
      new Notice('当前 Obsidian 没有暴露设置面板接口。请从设置 > 第三方插件 > 工程知识切片进入。');
      return;
    }
    if (typeof setting.open === 'function') setting.open();
    if (typeof setting.openTabById === 'function') setting.openTabById(this.manifest.id);
  }

  async ensureFolders() {
    for (const path of [
      this.settings.bidIntakePath,
      this.settings.businessIntakePath,
      this.settings.bidOutputPath,
      this.settings.businessOutputPath,
      this.settings.artifactsPath,
      this.settings.draftPath,
      this.settings.logPath
    ]) {
      await ensureFolder(this.app, path);
    }
  }

  async scanSourceFiles(showNotice = false) {
    await this.ensureFolders();
    const tasks = await this.loadTasks();
    const files = this.app.vault.getFiles().filter((file) => this.isInIntake(file.path) && !this.isInternalSlicerFile(file.path));
    let added = 0;
    for (const file of files) {
      const buffer = Buffer.from(await this.app.vault.readBinary(file));
      const hash = sourceHash(buffer);
      const existing = tasks.find((task) => task.source_hash === hash && task.library === libraryForPath(file.path, this.settings));
      if (existing) {
        if (existing.source_path !== file.path && !existing.source_aliases.includes(file.path)) existing.source_aliases.push(file.path);
        continue;
      }
      const task = createTaskRecord({
        sourcePath: file.path,
        sourceHash: hash,
        sourceType: detectSourceType(file.path),
        library: libraryForPath(file.path, this.settings),
        versions: runtimeVersions(this.settings)
      });
      if (!isProcessableSource(file.path)) task.status = detectSourceType(file.path) === 'unknown' ? 'skipped' : 'unsupported';
      tasks.push(task);
      added += 1;
    }
    this.sessionStats.scanned += files.length;
    await this.saveTasks(tasks);
    if (showNotice) new Notice(`工程知识切片已扫描 ${files.length} 个文件，新增 ${added} 个任务。开始自动处理。`);
    await this.refreshViews();
    await this.autoProcessQueue(false);
    return { scanned: files.length, added };
  }

  isInIntake(path) {
    const normalized = normalizeUnicodeForm(normalizeVaultPath(path));
    return [this.settings.bidIntakePath, this.settings.businessIntakePath]
      .some((root) => normalized.startsWith(`${normalizeVaultPath(normalizeUnicodeForm(root))}/`));
  }

  isInternalSlicerFile(path) {
    const normalized = normalizeUnicodeForm(normalizeVaultPath(path));
    return normalized.startsWith(`${normalizeVaultPath(normalizeUnicodeForm(this.settings.artifactsPath))}/`)
      || normalized.startsWith(`${this.settings.draftPath}/`)
      || normalized.startsWith(`${this.settings.logPath}/`);
  }

  async processSingleFile(file) {
    await this.ensureFolders();
    const buffer = Buffer.from(await this.app.vault.readBinary(file));
    const tasks = await this.loadTasks();
    const hash = sourceHash(buffer);
    const library = libraryForPath(file.path, this.settings);
    const existing = tasks.find((item) => item.source_hash === hash && item.library === library);
    if (existing) {
      if (!['queued', 'failed'].includes(existing.status)) {
        new Notice(`该文件已有处理记录：${existing.status}。如需重做，请在审核台使用“重新生成”或先清空插件缓存。`);
        await this.activateView();
        return;
      }
      existing.status = 'queued';
      existing.updated_at = new Date().toISOString();
      existing.errors = [];
    } else {
      const task = createTaskRecord({ sourcePath: file.path, sourceHash: hash, sourceType: detectSourceType(file.path), library, versions: runtimeVersions(this.settings) });
      tasks.push(task);
    }
    await this.saveTasks(tasks);
    await this.processTask(existing || tasks.at(-1));
  }

  async processNextQueuedTask() {
    const tasks = await this.loadTasks();
    const task = tasks.find((item) => item.status === 'queued');
    if (!task) {
      new Notice('没有待处理的工程知识切片任务。');
      return;
    }
    await this.processTask(task);
  }

  async autoProcessQueue(showNotice = false) {
    if (this.autoProcessing) {
      if (showNotice) new Notice('自动处理正在运行，请查看处理概览中的实时进度。');
      return { processed: 0, alreadyRunning: true };
    }
    this.autoProcessing = true;
    this.pauseRequested = false;
    let processed = 0;
    try {
      const resumable = await this.loadTasks();
      let resumed = false;
      for (const task of resumable) {
        if (task.status !== 'paused') continue;
        task.status = 'queued';
        task.updated_at = new Date().toISOString();
        resumed = true;
      }
      if (resumed) await this.saveTasks(resumable);
      this.sessionStats.lastMessage = '正在自动处理队列';
      while (!this.pauseRequested) {
        const tasks = await this.recoverStaleProcessingTasks(await this.loadTasks());
        const task = tasks.find((item) => item.status === 'queued');
        if (!task) break;
        await this.processTask(task);
        processed += 1;
        if (this.settings.rateLimitMs && !this.pauseRequested) {
          await new Promise(resolve => setTimeout(resolve, this.settings.rateLimitMs));
        }
        if (processed >= 500) {
          this.sessionStats.lastMessage = `已达到本轮 500 个任务上限，剩余任务将在下次运行时继续处理。`;
          if (showNotice) new Notice(`已处理 500 个任务，达到本轮上限。仍有未处理任务，请再次运行「自动处理」继续。`);
          break;
        }
      }
      this.sessionStats.lastMessage = `自动处理完成，本轮处理 ${processed} 个任务`;
      if (showNotice) new Notice(`自动处理完成，本轮处理 ${processed} 个任务。可信卡片已入库，疑问项进入审核台。`);
      return { processed, alreadyRunning: false };
    } finally {
      this.autoProcessing = false;
      this.sessionStats.current = '';
      await this.refreshViews();
    }
  }

  async retryFailedAndAutoProcess(showNotice = false) {
    const tasks = await this.loadTasks();
    let reset = 0;
    for (const task of tasks) {
      if (task.status !== 'failed') continue;
      task.status = 'queued';
      task.updated_at = new Date().toISOString();
      task.errors = [];
      task.review_atom_ids = [];
      reset += 1;
    }
    await this.saveTasks(tasks);
    this.sessionStats.lastMessage = `已重新入队 ${reset} 个失败任务`;
    if (showNotice) new Notice(`已重新入队 ${reset} 个失败任务，开始自动处理。`);
    await this.refreshViews();
    await this.autoProcessQueue(false);
  }

  async processSelectedTasks(taskIds) {
    for (const taskId of taskIds) {
      const tasks = await this.loadTasks();
      const task = tasks.find((item) => item.task_id === taskId);
      if (task) await this.processTask(task);
    }
  }

  pauseProcessing() {
    this.pauseRequested = true;
    this.sessionStats.lastMessage = '将在当前 API 阶段完成后暂停';
    new Notice('已请求暂停：当前 API 请求完成后保存进度并暂停。');
    this.refreshViews();
  }

  cancelCurrentTask(taskId) {
    this.cancelRequestedTaskId = taskId;
    this.sessionStats.lastMessage = '将在当前 API 阶段完成后取消当前任务';
    new Notice('已请求取消：当前 API 请求完成后停止该任务。');
    this.refreshViews();
  }

  async rollbackLastBatch() {
    const tasks = await this.loadTasks();
    const written = tasks.filter((t) => t.status === 'written' && t.writtenFiles && t.writtenFiles.length);
    if (!written.length) {
      new Notice('没有可回滚的已入库卡片批次。');
      return;
    }
    const lastBatch = written[written.length - 1];
    let deleted = 0;
    for (const filePath of lastBatch.writtenFiles) {
      const file = this.app.vault.getAbstractFileByPath(filePath);
      if (file instanceof TFile) {
        await this.app.vault.trash(file);
        deleted++;
      }
    }
    lastBatch.status = 'rolled_back';
    lastBatch.updated_at = new Date().toISOString();
    await this.saveTasks(upsertTask(tasks, lastBatch));
    this.sessionStats.lastMessage = `已回滚 ${deleted} 张卡片`;
    new Notice(`已回滚最近一批 ${deleted} 张知识卡片。`);
    await this.refreshViews();
  }

  assertTaskCanContinue(task) {
    if (this.cancelRequestedTaskId === task.task_id) {
      const error = new Error('任务已由使用者取消');
      error.code = 'TASK_CANCELLED';
      throw error;
    }
    if (this.pauseRequested) {
      const error = new Error('任务已由使用者暂停');
      error.code = 'TASK_PAUSED';
      throw error;
    }
  }

  async processTask(task) {
    const tasks = await this.loadTasks();
    const current = tasks.find((item) => item.task_id === task.task_id) || task;
    const startedAt = Date.now();
    try {
      // v1.1.2: 旧任务 / 第三方写入可能留下 source_path 为空的情况，统一兜底成空字符串
      // 防止后续 readBinary / Notice 拼接时出现 'undefined'/'null' 字面。
      current.source_path = normalizeVaultPath(current.source_path || '');
      current.source_path = normalizeUnicodeForm(current.source_path);
      this.sessionStats.current = current.source_path;
      current.errors = [];
      current.review_atom_ids = [];
      current.written_card_ids = [];
      await this.setTaskProgress(current, '准备处理源文件', { stage: 'start', startedAt: new Date(startedAt).toISOString() });
      if (!current.source_path) throw new Error('源文件路径为空，请在扫描源文件后重试。');
      if (!isProcessableSource(current.source_path)) {
        current.status = 'unsupported';
        current.updated_at = new Date().toISOString();
        await this.saveTasks(upsertTask(tasks, current));
        this.sessionStats.skipped += 1;
        this.sessionStats.lastMessage = `已跳过暂不支持的文件：${current.source_path}`;
        return;
      }

      let parsePackage = await this.loadArtifact(current, 'parsed');
      if (!parsePackage) {
        current.status = 'parsing';
        await this.setTaskProgress(current, '正在调用文档解析 API', { stage: 'parsing', elapsedMs: Date.now() - startedAt });
        const file = this.app.vault.getAbstractFileByPath(current.source_path);
        if (!(file instanceof TFile)) throw new Error(`未找到源文件：${current.source_path}`);
        const buffer = Buffer.from(await this.app.vault.readBinary(file));
        const extracted = await extractTextFromBuffer(current.source_path, buffer, {
          pdfExtractor: await this.getPdfExtractorConfig(current)
        });
        if (extracted.status !== 'ok' || !extracted.parsePackage) throw new Error(extracted.message || '文档解析 API 未返回可用 Markdown');
        parsePackage = extracted.parsePackage;
        current.status = 'parsed';
        await this.persistArtifact(current, 'parsed', parsePackage);
      }

      this.assertTaskCanContinue(current);

      const contracts = await this.loadRuntimeContracts();
      const tagLibraryText = await this.loadTagLibraryText();
      const tagLibrary = parseTagLibrary(tagLibraryText);
      const existingCards = await this.loadExistingCards(current.source_hash);
      const workflow = await runKnowledgeWorkflow({
        parsePackage,
        folderMap: contracts.folderMap,
        schemas: contracts.schemas,
        prompts: contracts.prompts,
        classification: await this.loadArtifact(current, 'classification'),
        summary: await this.loadArtifact(current, 'summary'),
        atomResult: await this.loadArtifact(current, 'atoms'),
        loadTypePrompt: (route) => this.loadComponentText(route.prompt),
        sourceHash: current.source_hash,
        maxChunkChars: this.settings.aiChunkSize,
        versions: runtimeVersions(this.settings),
        existingCards,
        existingFingerprints: existingCards.map((card) => card.atom_fingerprint).filter(Boolean),
        validateLabels: (atom) => validateAtomLabels(tagLibrary, atom),
        requestJson: (prompt, context) => requestMiniMaxJson({ settings: this.settings, prompt, context, fetchImpl: obsidianRequest }),
        onProgress: async (progress) => {
          this.assertTaskCanContinue(current);
          current.status = workflowStatus(progress.stage);
          await this.setTaskProgress(current, progress.message, Object.assign({}, progress, { elapsedMs: Date.now() - startedAt }));
        },
        onArtifact: (name, value) => this.persistArtifact(current, name, value)
      });

      const summaryLink = current.artifacts.summary_markdown
        ? `[[${current.artifacts.summary_markdown.replace(/\.md$/i, '')}]]`
        : `[[${workflow.summary.document_title}]]`;
      for (const card of workflow.accepted) card.parent_summary = summaryLink;
      for (const item of workflow.review) {
        item.atom.source.parent_summary = summaryLink;
        item.proposed_card.parent_summary = summaryLink;
      }

      current.status = 'writing';
      await this.setTaskProgress(current, `正在写入 ${workflow.accepted.length} 张可信知识卡片`, {
        stage: 'writing', cardCount: workflow.accepted.length, reviewCount: workflow.review.length, elapsedMs: Date.now() - startedAt
      });
      for (const card of workflow.accepted) {
        await this.writeAcceptedCard(current, card, workflow.route);
        current.written_card_ids.push(card.card_id);
      }
      if (workflow.review.length) {
        await this.persistArtifact(current, 'review', { version: '1.1', task_id: current.task_id, items: workflow.review });
        current.review_atom_ids = workflow.review.map((item) => item.atom_id);
      }
      if (!workflow.accepted.length && !workflow.review.length) throw new Error('MiniMax 未生成任何可用知识原子');

      current.status = workflow.review.length ? 'needs_review' : 'written';
      current.updated_at = new Date().toISOString();
      current.progress = {
        stage: 'complete',
        message: `处理完成：自动入库 ${workflow.accepted.length} 张，异常 ${workflow.review.length} 项`,
        elapsedMs: Date.now() - startedAt,
        at: current.updated_at
      };
      await this.writeTaskLog(current);
      await this.saveTasks(upsertTask(await this.loadTasks(), current));
      this.sessionStats.processed += 1;
      this.sessionStats.review += workflow.review.length;
      this.sessionStats.written += workflow.accepted.length;
      this.sessionStats.lastMessage = current.progress.message;
      new Notice(current.progress.message);
    } catch (error) {
      if (error.code === 'TASK_PAUSED' || error.code === 'TASK_CANCELLED') {
        current.status = error.code === 'TASK_PAUSED' ? 'paused' : 'cancelled';
        current.updated_at = new Date().toISOString();
        current.progress = { stage: current.status, message: error.message, at: current.updated_at, elapsedMs: Date.now() - startedAt };
        await this.saveTasks(upsertTask(await this.loadTasks(), current));
        this.cancelRequestedTaskId = '';
        return;
      }
      current.status = 'failed';
      current.updated_at = new Date().toISOString();
      current.errors = [...(current.errors || []), { stage: current.progress?.stage || 'process', message: sanitizeSecret(error.message), at: current.updated_at }];
      await this.writeTaskLog(current);
      await this.saveTasks(upsertTask(await this.loadTasks(), current));
      this.sessionStats.failed += 1;
      this.sessionStats.lastMessage = `处理失败：${current.source_path}`;
      new Notice(`工程知识切片处理失败：${sanitizeSecret(error.message)}`);
    } finally {
      await this.refreshViews();
    }
  }

  async processTaskLegacy(task) {
    const tasks = await this.loadTasks();
    const current = tasks.find((item) => item.taskId === task.taskId) || task;
    try {
      this.sessionStats.current = current.sourcePath;
      current.errors = [];
      current.draftFiles = [];
      current.writtenFiles = [];
      await this.setTaskProgress(current, '准备处理源文件', { stage: 'start' });
      if (!isProcessableSource(current.sourcePath)) {
        current.status = detectSourceType(current.sourcePath) === 'pdf' ? 'needs_ocr' : 'unsupported_media';
        current.updatedAt = new Date().toISOString();
        await this.saveTasks(upsertTask(tasks, current));
        this.sessionStats.skipped += 1;
        this.sessionStats.lastMessage = `已跳过暂不支持文件：${current.sourcePath}`;
        await this.refreshViews();
        return;
      }

      current.status = 'extracting';
      await this.setTaskProgress(current, '正在抽取文本', { stage: 'extracting' });

      const file = this.app.vault.getAbstractFileByPath(current.sourcePath);
      if (!(file instanceof TFile)) throw new Error(`Source file not found: ${current.sourcePath}`);
      const buffer = Buffer.from(await this.app.vault.readBinary(file));
      const extracted = await extractTextFromBuffer(current.sourcePath, buffer, {
        pdfExtractor: await this.getPdfExtractorConfig(current)
      });
      if (extracted.status !== 'ok') {
        current.status = extracted.status;
        current.errors = [{ stage: 'extract', message: extracted.message || extracted.status, at: new Date().toISOString() }];
        await this.writeTaskLog(current);
        await this.saveTasks(upsertTask(await this.loadTasks(), current));
        if (extracted.status === 'failed') this.sessionStats.failed += 1;
        else this.sessionStats.review += 1;
        this.sessionStats.lastMessage = `抽取失败或需要人工处理：${current.sourcePath}`;
        await this.refreshViews();
        return;
      }

      current.status = 'slicing';
      await this.setTaskProgress(current, '正在准备 AI 切片提示词', { stage: 'slicing' });
      const tagLibraryText = await this.loadTagLibraryText();
      const library = parseTagLibrary(tagLibraryText);
      let cards = null;
      try {
        cards = await draftCardsWithProvider({
          settings: this.settings,
          task: current,
          extracted,
          library,
          tagLibraryText,
          onProgress: (progress) => this.setTaskProgress(current, progress.message, progress)
        });
      } catch (providerError) {
        current.errors = [...(current.errors || []), {
          stage: 'ai-provider',
          message: sanitizeSecret(providerError.message),
          settings: sanitizeSettingsForLog(this.settings),
          at: new Date().toISOString()
        }];
      }
      if (!cards || !cards.length) {
        current.status = 'failed';
        current.errors = [...(current.errors || []), {
          stage: 'ai-slicing',
          message: 'AI 未生成任何知识卡片。请检查 AI Key、模型、提示词或源文件可读性；插件不会再使用本地规则生成单张粗略卡片。',
          at: new Date().toISOString()
        }];
        current.updatedAt = new Date().toISOString();
        await this.writeTaskLog(current);
        await this.saveTasks(upsertTask(await this.loadTasks(), current));
        this.sessionStats.failed += 1;
        this.sessionStats.lastMessage = `AI 未生成卡片：${current.sourcePath}`;
        new Notice('AI 未生成知识卡片，已停止本文件处理。');
        await this.refreshViews();
        return;
      }
      const draftFiles = [];
      const writtenFiles = [];
      await this.setTaskProgress(current, `正在写入 ${cards.length} 张知识卡片`, { stage: 'writing', cardCount: cards.length });
      for (const card of cards) {
        if (!card.Map_Index || card.Map_Index === '[[MOC_待分类]]') {
          card.Map_Index = suggestMapIndex(library, card.Category, card.TagL1, card.TagL2);
        }
        const validation = validateCard(library, card);
        if (!validation.valid) {
          card.Status = '#status/needs_fix';
          card.Validation_Errors = validation.errors;
        }
        const markdown = renderCardMarkdown(card);
        const question = this.isQuestionableCard(card, validation);
        if (question) {
          const draftPath = `${this.settings.draftPath}/${safeCardFileName(card.Title, current.sourceHash)}`;
          await writeUnique(this.app, draftPath, markdown);
          draftFiles.push(draftPath);
        } else {
          const approved = approveMarkdownStatus(markdown, approvedStatus(library));
          const outputPath = await writeUnique(this.app, cardOutputPath(this.settings, card, safeCardFileName(card.Title, current.sourceHash)), approved);
          writtenFiles.push(outputPath);
          await this.ensureMocForDraft(approved);
        }
      }

      current.status = draftFiles.length ? 'needs_review' : 'written';
      current.draftFiles = draftFiles;
      current.writtenFiles = writtenFiles;
      current.updatedAt = new Date().toISOString();
      delete current.progress;
      await this.writeTaskLog(current);
      await this.saveTasks(upsertTask(await this.loadTasks(), current));
      this.sessionStats.processed += 1;
      this.sessionStats.review += draftFiles.length;
      this.sessionStats.written += writtenFiles.length;
      this.sessionStats.lastMessage = `已入库 ${writtenFiles.length} 张，待审核 ${draftFiles.length} 张：${current.sourcePath}`;
      new Notice(`可信卡片已入库 ${writtenFiles.length} 张；疑问项 ${draftFiles.length} 张进入审核台。`);
    } catch (error) {
      current.status = 'failed';
      current.updatedAt = new Date().toISOString();
      current.errors = [{ stage: 'process', message: sanitizeSecret(error.message), at: new Date().toISOString() }];
      await this.writeTaskLog(current);
      await this.saveTasks(upsertTask(await this.loadTasks(), current));
      this.sessionStats.failed += 1;
      this.sessionStats.lastMessage = `处理失败：${current.sourcePath}`;
      new Notice(`工程知识切片处理失败：${error.message}`);
    } finally {
      await this.refreshViews();
    }
  }

  async loadComponentText(relativePath) {
    const path = normalizeVaultPath(`${this.settings.componentPackPath}/${relativePath}`);
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) throw new Error(`组件包文件不存在：${path}`);
    return this.app.vault.read(file);
  }

  async loadComponentJson(relativePath) {
    const text = await this.loadComponentText(relativePath);
    try { return JSON.parse(text); } catch (error) { throw new Error(`${relativePath} 不是有效 JSON：${error.message}`); }
  }

  async loadRuntimeContracts() {
    return {
      folderMap: await this.loadComponentJson('folder-map.json'),
      schemas: {
        classification: await this.loadComponentJson('schemas/classification.schema.json'),
        summary: await this.loadComponentJson('schemas/structured-summary.schema.json'),
        atoms: await this.loadComponentJson('schemas/knowledge-atoms.schema.json')
      },
      prompts: {
        classifier: await this.loadComponentText('提示词/00-类型判定.md'),
        summaryBase: await this.loadComponentText('提示词/01-结构化总结-基础.md'),
        atoms: await this.loadComponentText('提示词/99-知识原子生成.md'),
        typeMapping: await this.loadComponentText('模板/Type Mapping.md'),
        tagLibrary: await this.loadComponentText('Tag_Library.md')
      }
    };
  }

  async loadArtifact(task, name) {
    const path = task.artifacts && task.artifacts[name];
    if (!path) return null;
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return null;
    try { return JSON.parse(await this.app.vault.read(file)); } catch { return null; }
  }

  async persistArtifact(task, name, value) {
    const path = normalizeVaultPath(`${this.settings.artifactsPath}/${task.run_id}/${name}.json`);
    await writeFile(this.app, path, JSON.stringify(value, null, 2));
    task.artifacts = Object.assign({}, task.artifacts || {}, { [name]: path });
    if (name === 'summary') {
      const markdownPath = normalizeVaultPath(`${this.settings.artifactsPath}/${task.run_id}/summary.md`);
      await writeFile(this.app, markdownPath, renderStructuredSummary(value, `[[${task.source_path}]]`));
      task.artifacts.summary_markdown = markdownPath;
    }
    task.updated_at = new Date().toISOString();
    await this.saveTasks(upsertTask(await this.loadTasks(), task));
    return path;
  }

  async loadExistingFingerprints(excludeSourceHash = '') {
    const roots = [this.settings.bidOutputPath, this.settings.businessOutputPath].map(normalizeVaultPath);
    const fingerprints = [];
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (!roots.some((root) => file.path.startsWith(`${root}/`))) continue;
      const markdown = await this.app.vault.cachedRead(file);
      if (excludeSourceHash && readFrontmatterValue(markdown, 'source_hash') === excludeSourceHash) continue;
      const value = readFrontmatterValue(markdown, 'atom_fingerprint');
      if (value) fingerprints.push(value);
    }
    return fingerprints;
  }

  async loadExistingCards(excludeSourceHash = '') {
    const roots = [this.settings.bidOutputPath, this.settings.businessOutputPath].map(normalizeVaultPath);
    const cards = [];
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (!roots.some((root) => file.path.startsWith(`${root}/`)) || file.basename === '_索引') continue;
      const markdown = await this.app.vault.cachedRead(file);
      const source = readFrontmatterValue(markdown, 'source_hash');
      if (excludeSourceHash && source === excludeSourceHash) continue;
      const cardId = readFrontmatterValue(markdown, 'card_id');
      if (!cardId) continue;
      cards.push({
        card_id: cardId,
        atom_fingerprint: readFrontmatterValue(markdown, 'atom_fingerprint'),
        title: readFrontmatterValue(markdown, 'title') || getMarkdownTitle(markdown),
        Category: readFrontmatterValue(markdown, 'Category'),
        TagL1: readFrontmatterValue(markdown, 'TagL1'),
        TagL2: readFrontmatterValue(markdown, 'TagL2'),
        path: file.path,
        text: markdown.slice(0, 3000)
      });
    }
    return cards;
  }

  async writeAcceptedCard(task, card, route) {
    const path = normalizeVaultPath(`${route.output_folder}/${cardFileName(card)}`);
    const existing = this.app.vault.getAbstractFileByPath(path);
    const previous = existing instanceof TFile ? await this.app.vault.read(existing) : null;
    await writeFile(this.app, path, renderKnowledgeCard(card));
    await this.appendRollback({
      task_id: task.task_id,
      card_id: card.card_id,
      written_path: path,
      previous_content: previous,
      written_at: new Date().toISOString()
    });
    await this.ensureFolderIndex(route);
    return path;
  }

  async ensureFolderIndex(route) {
    const path = folderIndexPath(route);
    if (this.app.vault.getAbstractFileByPath(path)) return path;
    return writeFile(this.app, path, createFolderIndexMarkdown(route));
  }

  async applyReviewGroup(taskId, groupId, action, correction = {}) {
    const tasks = await this.loadTasks();
    const task = tasks.find((item) => item.task_id === taskId);
    if (!task) throw new Error('未找到审核任务');
    const artifact = await this.loadArtifact(task, 'review');
    if (!artifact) throw new Error('未找到审核产物');
    const group = groupReviewItems(artifact.items).find((item) => item.group_id === groupId);
    if (!group) throw new Error('未找到审核分组');

    if (action === 'regenerate_group') {
      delete task.artifacts.atoms;
      delete task.artifacts.review;
      task.review_atom_ids = [];
      task.status = 'queued';
      task.updated_at = new Date().toISOString();
      await this.saveTasks(upsertTask(tasks, task));
      await this.processTask(task);
      return;
    }

    const selectedIds = new Set(group.items.map((item) => item.atom_id));
    const changed = applyBatchAction(group.items, action, correction);
    const tagLibrary = await this.loadTagLibrary();
    const folderMap = (await this.loadRuntimeContracts()).folderMap;
    const unresolved = [];
    for (const item of changed) {
      if (item.status === 'discarded') continue;
      if (item.status === 'corrected' && !validateAtomLabels(tagLibrary, item.atom)) {
        item.status = 'pending';
        item.reasons = ['批量修正后仍未通过标签字典校验'];
        unresolved.push(item);
        continue;
      }
      const route = resolveFixedRoute(folderMap, item.atom);
      const card = Object.assign({}, item.proposed_card, {
        Category: item.atom.Category,
        TagL1: item.atom.TagL1,
        TagL2: item.atom.TagL2,
        Info_Type: item.atom.Info_Type,
        Event_Type: item.atom.Event_Type,
        output_folder: route.output_folder,
        status: 'confirmed'
      });
      await this.writeAcceptedCard(task, card, route);
      if (!task.written_card_ids.includes(card.card_id)) task.written_card_ids.push(card.card_id);
    }

    const untouched = artifact.items.filter((item) => !selectedIds.has(item.atom_id));
    artifact.items = [...untouched, ...unresolved];
    await this.persistArtifact(task, 'review', artifact);
    task.review_atom_ids = artifact.items.map((item) => item.atom_id);
    task.status = artifact.items.length ? 'needs_review' : 'written';
    task.updated_at = new Date().toISOString();
    await this.saveTasks(upsertTask(await this.loadTasks(), task));
    new Notice(`批量审核完成：处理 ${group.items.length} 项，剩余 ${artifact.items.length} 项`);
    await this.refreshViews();
  }

  async approveDraft(taskId, draftPath) {
    const file = this.app.vault.getAbstractFileByPath(draftPath);
    if (!(file instanceof TFile)) throw new Error(`未找到草稿：${draftPath}`);
    const draft = await this.app.vault.read(file);
    const library = await this.loadTagLibrary();
    const finalStatus = approvedStatus(library);
    const finalCard = cardFromMarkdown(draft);
    finalCard.Status = finalStatus;
    const validation = validateCard(library, finalCard);
    if (!validation.valid) {
      new Notice(`草稿标签或字段未通过校验，不能入库：${validation.errors.join('；')}`);
      await this.app.workspace.openLinkText(draftPath, '', false);
      return;
    }
    const approved = approveMarkdownStatus(draft, finalStatus);
    const title = getMarkdownTitle(draft) || file.basename;
    const routeCard = {
      Category: readFrontmatterValue(approved, 'Category'),
      TagL1: readFrontmatterValue(approved, 'TagL1'),
      TagL2: readFrontmatterValue(approved, 'TagL2')
    };
    const outputPath = await writeUnique(this.app, cardOutputPath(this.settings, routeCard, safeCardFileName(title, Date.now().toString(16))), approved);

    const tasks = await this.loadTasks();
    const task = tasks.find((item) => item.task_id === taskId);
    if (task) {
      task.draftFiles = (task.draftFiles || []).filter((item) => item !== draftPath);
      task.status = task.draftFiles.length ? 'needs_review' : 'written';
      task.updatedAt = new Date().toISOString();
      task.writtenFiles = [...(task.writtenFiles || []), outputPath];
    }
    await this.saveTasks(tasks);
    await this.appendRollback({ taskId, draftPath, writtenPath: outputPath, approvedAt: new Date().toISOString() });
    await this.ensureMocForDraft(approved);
    new Notice(`已批准入库：${outputPath}`);
    await this.refreshViews();
  }

  isQuestionableCard(card, validation) {
    if (!validation.valid) return true;
    if (card.Status === '#status/needs_fix' || card.Status === '#status/uncategorized') return true;
    if (!card.Map_Index || card.Map_Index === '[[MOC_待分类]]') return true;
    const threshold = Number(this.settings.autoApproveConfidenceThreshold || DEFAULT_SETTINGS.autoApproveConfidenceThreshold || 0.82);
    if (typeof card.Confidence !== 'number' || card.Confidence < threshold) return true;
    if (!card.Source_Excerpt || card.Source_Excerpt.length < 20) return true;
    return false;
  }

  async ensureMocForDraft(markdown) {
    const mapIndex = readFrontmatterValue(markdown, 'Map_Index');
    const category = readFrontmatterValue(markdown, 'Category');
    const tagL1 = readFrontmatterValue(markdown, 'TagL1');
    const tagL2 = readFrontmatterValue(markdown, 'TagL2');
    if (!mapIndex || !category || !tagL1 || !tagL2) return;
    const path = mapIndexToPath(mapIndex, this.settings.outputPath);
    if (this.app.vault.getAbstractFileByPath(path)) return;
    const title = path.split('/').pop().replace(/\.md$/, '');
    await writeUnique(this.app, path, createMocMarkdown({ title, category, tagL1, tagL2, outputPath: this.settings.outputPath }));
  }

  async retryTask(taskId) {
    const tasks = await this.loadTasks();
    const task = tasks.find((item) => item.task_id === taskId);
    if (!task) return;
    task.status = 'queued';
    task.errors = [];
    task.updated_at = new Date().toISOString();
    await this.saveTasks(tasks);
    await this.processTask(task);
  }

  async skipTask(taskId) {
    const tasks = await this.loadTasks();
    const task = tasks.find((item) => item.task_id === taskId);
    if (!task) return;
    task.status = 'skipped';
    task.updated_at = new Date().toISOString();
    await this.saveTasks(tasks);
    await this.refreshViews();
  }

  async loadTagLibrary() {
    return parseTagLibrary(await this.loadTagLibraryText());
  }

  async loadTagLibraryText() {
    const primaryCandidates = [
      `${this.settings.componentPackPath}/Tag_Library.md`,
      `${this.settings.componentPackPath}/模板/Type Mapping.md`
    ];
    const sections = [];
    for (const candidate of primaryCandidates) {
      const file = this.app.vault.getAbstractFileByPath(candidate);
      if (file instanceof TFile) sections.push(await this.app.vault.read(file));
    }
    if (sections.length) return sections.join('\n\n');
    const fallback = this.app.vault.getAbstractFileByPath('docs/tag-library-full-lifecycle-draft.md');
    return fallback instanceof TFile ? this.app.vault.read(fallback) : '';
  }

  async loadTasks() {
    const path = tasksPath(this.settings);
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return [];
    try {
      const parsed = JSON.parse(await this.app.vault.read(file));
      return migrateTaskLedgerV3(Array.isArray(parsed) ? parsed : [], runtimeVersions(this.settings));
    } catch {
      return [];
    }
  }

  async saveTasks(tasks) {
    await this.ensureFolders();
    await writeFile(this.app, tasksPath(this.settings), JSON.stringify(tasks, null, 2));
  }

  async setTaskProgress(task, message, details = {}) {
    const now = new Date().toISOString();
    task.updated_at = now;
    task.progress = Object.assign({}, details, {
      message,
      at: now
    });
    this.sessionStats.current = task.source_path;
    this.sessionStats.lastMessage = message;
    await this.saveTasks(upsertTask(await this.loadTasks(), task));
    await this.refreshViews();
  }

  async recoverStaleProcessingTasks(tasks) {
    const minutes = Number(this.settings.staleProcessingMinutes || DEFAULT_SETTINGS.staleProcessingMinutes || 20);
    const staleMs = Math.max(5, minutes) * 60 * 1000;
    const now = Date.now();
    let changed = false;
    for (const task of tasks) {
      if (!PROCESSING_STATUSES.has(task.status)) continue;
      const updatedAt = Date.parse(task.updated_at || task.progress?.at || '');
      if (!updatedAt || now - updatedAt < staleMs) continue;
      task.status = 'failed';
      task.updated_at = new Date().toISOString();
      task.errors = [...(task.errors || []), {
        stage: 'stale-processing',
        message: `任务在 ${minutes} 分钟内没有进度更新，已判定为中断。请使用“重试失败并处理”。`,
        at: task.updated_at
      }];
      task.progress = {
        stage: 'stale-processing',
        message: '任务长时间没有进度更新，已转为失败，可重试',
        at: task.updated_at
      };
      changed = true;
    }
    if (changed) await this.saveTasks(tasks);
    return tasks;
  }

  async clearPluginCache() {
    await this.ensureFolders();
    await deleteFolderContents(this.app, this.settings.artifactsPath);
    this.sessionStats = { scanned: 0, processed: 0, written: 0, review: 0, failed: 0, skipped: 0, current: '', lastMessage: '缓存已清空，等待重新扫描' };
    await this.ensureFolders();
    await this.refreshViews();
    new Notice('工程知识切片缓存已清空。源文件和已入库 wiki 卡片未删除。');
  }

  async writeTaskLog(task) {
    await this.ensureFolders();
    await writeFile(this.app, `${this.settings.logPath}/${task.task_id}.json`, JSON.stringify(task, null, 2));
  }

  async getPdfExtractorConfig(task = null) {
    return {
      enabled: true,
      order: 'mineru-api,paddleocr-api',
      allowExternalUpload: this.settings.pdfAllowExternalUpload === true,
      timeoutMs: Number(this.settings.pdfExternalTimeoutMs || 300000),
      pollIntervalMs: Number(this.settings.pdfApiPollIntervalMs || 5000),
      mineruApiKey: this.settings.pdfMineruApiKey || '',
      mineruApiEndpoint: this.settings.pdfMineruApiEndpoint || 'https://mineru.net/api/v4',
      mineruApiModel: this.settings.pdfMineruApiModel || 'vlm',
      mineruApiLanguage: this.settings.pdfMineruApiLanguage || 'ch_server',
      paddleOcrApiKey: this.settings.pdfPaddleOcrApiKey || '',
      paddleOcrApiEndpoint: this.settings.pdfPaddleOcrApiEndpoint || 'https://paddleocr.aistudio-app.com/api/v2/ocr/jobs',
      paddleOcrApiModel: this.settings.pdfPaddleOcrApiModel || 'PaddleOCR-VL-1.6',
      requestImpl: obsidianRequest,
      fileName: task?.source_path?.split('/').pop() || 'source.pdf',
      onProgress: task ? (progress) => this.setTaskProgress(task, progress.message, progress) : undefined
    };
  }

  async getPluginFilePath(relativePath) {
    const pluginRelativePath = normalizeVaultPath(`${this.manifest.dir || `.obsidian/plugins/${this.manifest.id}`}/${relativePath}`);
    const adapter = this.app.vault.adapter;
    if (adapter && typeof adapter.getFullPath === 'function') {
      return adapter.getFullPath(pluginRelativePath);
    }
    return pluginRelativePath;
  }

  async appendRollback(entry) {
    const path = rollbackPath(this.settings);
    let rows = [];
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) {
      try { rows = JSON.parse(await this.app.vault.read(file)); } catch { rows = []; }
    }
    rows.push(entry);
    await writeFile(this.app, path, JSON.stringify(rows, null, 2));
  }

  async showHistoryForFile(file) {
    const tasks = await this.loadTasks();
    const related = tasks.filter((task) => task.source_path === file.path || (task.source_aliases || []).includes(file.path));
    new Notice(related.length ? related.map((task) => `${task.task_id}: ${task.status}`).join('\n') : '该文件没有切片处理历史。');
    await this.activateView();
  }
};

class SlicerDashboardView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.selectedTaskIds = new Set();
  }

  getViewType() { return VIEW_TYPE_SLICER; }
  getDisplayText() { return '工程知识切片'; }
  getIcon() { return 'layers'; }

  async onOpen() {
    await this.render();
  }

  async render() {
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass('eks-view');
    try {
      await this.renderContent(container);
    } catch (error) {
      console.error('工程知识切片界面渲染失败', error);
      container.createEl('h2', { text: '工程知识切片' });
      container.createDiv({ cls: 'eks-empty', text: `界面渲染失败：${error.message}` });
      const fallback = container.createDiv('eks-actions');
      button(fallback, '重新渲染', () => this.render());
      button(fallback, '打开 Obsidian 设置', () => this.plugin.openSettings());
    }
  }

  async renderContent(container) {
    const tasks = await this.plugin.loadTasks();
    const counts = statusCounts(tasks);

    const overview = container.createDiv('eks-panel eks-overview');
    const header = overview.createDiv('eks-header');
    header.createEl('h3', { text: '总览' });
    const actions = header.createDiv('eks-actions');
    button(actions, '扫描并自动处理', () => this.plugin.scanSourceFiles(true));
    button(actions, '继续自动处理', () => this.plugin.autoProcessQueue(true));
    button(actions, '重试失败任务', () => this.plugin.retryFailedAndAutoProcess(true));
    button(actions, '打开设置', () => this.plugin.openSettings());

    const stats = overview.createDiv('eks-stats');
    stat(stats, '待处理', counts.pending);
    stat(stats, '处理中', counts.processing);
    stat(stats, '异常待审核', counts.needsReview);
    stat(stats, '失败', counts.failed);
    stat(stats, '已入库卡片', counts.written);
    stat(stats, '已跳过', counts.skipped);

    const queue = container.createDiv('eks-panel eks-queue');
    queue.createEl('h3', { text: '处理概览' });
    this.renderQueue(queue, tasks);

    const review = container.createDiv('eks-panel eks-review');
    review.createEl('h3', { text: '审核工作台（仅异常）' });
    const reviewScroll = review.createDiv('eks-review-scroll');
    await this.renderReview(reviewScroll, tasks);

    const paths = container.createDiv('eks-paths');
    paths.createSpan({ text: `源文件入口：${this.plugin.settings.bidIntakePath}；${this.plugin.settings.businessIntakePath}` });
    paths.createSpan({ text: `入库输出：${this.plugin.settings.bidOutputPath}；${this.plugin.settings.businessOutputPath}` });
    paths.createSpan({ text: '目录由 folder-map.json 固定映射；Category / TagL1 / TagL2 仅用于 MOC 索引。' });
  }

  async renderContentLegacy(container) {
    const tasks = await this.plugin.loadTasks();
    const counts = statusCounts(tasks);

    const overview = container.createDiv('eks-panel eks-overview');
    const header = overview.createDiv('eks-header');
    header.createEl('h3', { text: '总览' });
    const actions = header.createDiv('eks-actions');
    button(actions, '扫描并自动处理', () => this.plugin.scanSourceFiles(true));
    button(actions, '自动处理可信卡片', () => this.plugin.autoProcessQueue(true));
    button(actions, '重试失败并处理', () => this.plugin.retryFailedAndAutoProcess(true));
    button(actions, '打开设置', () => this.plugin.openSettings());

    const stats = overview.createDiv('eks-stats');
    stat(stats, '待处理', counts.pending);
    stat(stats, '处理中', counts.processing);
    stat(stats, '待审核', counts.needsReview);
    stat(stats, '失败', counts.failed);
    stat(stats, '已入库', counts.written);
    stat(stats, '已跳过', counts.skipped);

    const queue = container.createDiv('eks-panel eks-queue');
    queue.createEl('h3', { text: '处理概览' });
    this.renderQueue(queue, tasks);

    const review = container.createDiv('eks-panel eks-review');
    review.createEl('h3', { text: '审核工作台' });
    const reviewScroll = review.createDiv('eks-review-scroll');
    await this.renderReview(reviewScroll, tasks);

    const paths = container.createDiv('eks-paths');
    paths.createSpan({ text: `源文件入口：${this.plugin.settings.intakePath}` });
    paths.createSpan({ text: `入库输出：${this.plugin.settings.outputPath}` });
    paths.createSpan({ text: '可信卡片自动写入 wiki；疑问项进入审核台。' });
    paths.createSpan({ text: '默认分类目录：wiki/category/tagL1/tagL2' });
  }

  renderQueue(parent, tasks) {
    const historical = tasks.filter((task) => ['written', 'skipped', 'unsupported'].includes(task.status)).length;
    const pending = tasks.filter((task) => task.status === 'queued').length;
    const reviewCount = tasks.reduce((sum, task) => sum + (task.review_atom_ids || []).length, 0);
    const activeTask = tasks.find((task) => PROCESSING_STATUSES.has(task.status));
    const stats = this.plugin.sessionStats || {};
    const progressData = activeTask?.progress || {};
    const grid = parent.createDiv('eks-compact-stats');
    const progress = grid.createDiv('eks-progress-message');
    progress.createDiv({ cls: 'eks-progress-title', text: `当前进度 · ${stageLabel(activeTask?.status || progressData.stage)}` });
    progress.createDiv({ cls: 'eks-progress-text', text: progressData.message || stats.lastMessage || '等待开始处理' });
    if (progressData.totalPages || progressData.extractedPages) {
      progress.createDiv({ cls: 'eks-task-meta', text: `解析页数：${progressData.extractedPages || 0}/${progressData.totalPages || '?'}` });
    }
    if (progressData.chunkTotal || progressData.chunkIndex) {
      progress.createDiv({ cls: 'eks-task-meta', text: `MiniMax 分块：${progressData.chunkIndex || 0}/${progressData.chunkTotal || '?'}；第 ${progressData.attempt || 1} 次请求` });
    }
    if (progressData.elapsedMs !== undefined) progress.createDiv({ cls: 'eks-task-meta', text: `已用时：${formatDuration(progressData.elapsedMs)}` });
    if (progressData.at) progress.createDiv({ cls: 'eks-task-meta', text: `最后更新：${formatLocalTime(progressData.at)}` });
    stat(grid, '过往已处理', historical);
    stat(grid, '本次处理文件', stats.processed || 0);
    stat(grid, '本次已入库卡片', stats.written || 0);
    stat(grid, '异常项', reviewCount);
    stat(grid, '待自动处理', pending);
    const currentFile = activeTask?.source_path || stats.current;
    if (currentFile) parent.createDiv({ cls: 'eks-task-meta', text: `当前文件：${currentFile}` });
    const actions = parent.createDiv('eks-actions');
    button(actions, '继续自动处理', () => this.plugin.autoProcessQueue(true));
    if (activeTask) {
      button(actions, '完成当前阶段后暂停', () => this.plugin.pauseProcessing());
      button(actions, '取消当前任务', () => this.plugin.cancelCurrentTask(activeTask.task_id));
    }

    const exceptions = tasks.filter((task) => ['failed', 'skipped', 'unsupported'].includes(task.status));
    if (exceptions.length) {
      const reasons = new Map();
      for (const task of exceptions) {
        const reason = task.errors?.at(-1)?.message || stageLabel(task.status);
        reasons.set(reason, (reasons.get(reason) || 0) + 1);
      }
      parent.createDiv({ cls: 'eks-task-meta', text: `失败/跳过原因：${[...reasons].map(([reason, count]) => `${reason}（${count}）`).join('；')}` });
    }
  }

  renderQueueLegacy(parent, tasks) {
    const historical = tasks.filter((task) => ['written', 'archived', 'skipped'].includes(task.status)).length;
    const pending = tasks.filter((task) => task.status === 'queued').length;
    const review = tasks.filter((task) => task.status === 'needs_review').length;
    const activeTask = tasks.find((task) => PROCESSING_STATUSES.has(task.status));
    const stats = this.plugin.sessionStats || {};
    const activeMessage = activeTask?.progress?.message || stats.lastMessage || '等待开始处理';
    const grid = parent.createDiv('eks-compact-stats');
    const progress = grid.createDiv('eks-progress-message');
    progress.createDiv({ cls: 'eks-progress-title', text: '当前进度' });
    progress.createDiv({ cls: 'eks-progress-text', text: activeMessage });
    if (activeTask?.progress?.chunkTotal) {
      progress.createDiv({
        cls: 'eks-task-meta',
        text: `AI 分段：${activeTask.progress.chunkIndex}/${activeTask.progress.chunkTotal}；累计卡片：${activeTask.progress.cardCount || 0}`
      });
    }
    if (activeTask?.progress?.at) {
      progress.createDiv({ cls: 'eks-task-meta', text: `最后更新：${formatLocalTime(activeTask.progress.at)}` });
    }
    stat(grid, '过往已处理', historical);
    stat(grid, '本次处理', stats.processed || 0);
    stat(grid, '本次已处理', stats.written || 0);
    stat(grid, '疑问项', review);
    stat(grid, '待自动处理', pending);
    const currentFile = activeTask?.sourcePath || stats.current;
    if (currentFile) parent.createDiv({ cls: 'eks-task-meta', text: `当前文件：${currentFile}` });
    const actions = parent.createDiv('eks-actions');
    button(actions, '继续自动处理', () => this.plugin.autoProcessQueue(true));
  }

  async renderReview(parent, tasks) {
    const reviewTasks = tasks.filter((task) => task.status === 'needs_review' && task.artifacts?.review);
    if (!reviewTasks.length) {
      parent.createDiv({ cls: 'eks-empty', text: '暂无异常项。可信结果会自动入库，不需要逐条审核。' });
      return;
    }
    for (const task of reviewTasks) {
      const artifact = await this.plugin.loadArtifact(task, 'review');
      if (!artifact) continue;
      for (const group of groupReviewItems(artifact.items)) {
        const block = parent.createDiv('eks-review-group');
        const header = block.createDiv('eks-review-group-header');
        header.createEl('h4', { text: `${group.label}（${group.items.length} 项）` });
        const scores = group.items.map((item) => Number(item.confidence?.score || 0));
        const average = scores.length ? scores.reduce((sum, value) => sum + value, 0) / scores.length : 0;
        block.createDiv({ cls: 'eks-task-meta', text: `${task.source_path} · 平均可信度 ${average.toFixed(2)}` });
        block.createDiv({ cls: 'eks-review-reason', text: `原因：${group.reasons.join('；') || '可信度未达到自动入库阈值'}` });
        const samples = group.items.slice(0, 3).map((item) => item.atom?.title).filter(Boolean);
        if (samples.length) block.createDiv({ cls: 'eks-task-meta', text: `示例：${samples.join('；')}${group.items.length > 3 ? '…' : ''}` });
        const actions = block.createDiv('eks-actions');
        button(actions, '整组批准入库', () => this.plugin.applyReviewGroup(task.task_id, group.group_id, 'approve_group'));
        button(actions, '批量修正标签', async () => {
          const initial = '{"Category":"","TagL1":"","TagL2":""}';
          const raw = window.prompt('输入要批量修正的标签 JSON；不修改的字段请删除', initial);
          if (!raw) return;
          try {
            await this.plugin.applyReviewGroup(task.task_id, group.group_id, 'apply_correction', JSON.parse(raw));
          } catch (error) {
            new Notice(`批量修正失败：${error.message}`);
          }
        });
        button(actions, '仅重做知识原子', () => this.plugin.applyReviewGroup(task.task_id, group.group_id, 'regenerate_group'));
        button(actions, '整组丢弃', () => this.plugin.applyReviewGroup(task.task_id, group.group_id, 'discard_group'));
      }
    }
  }

  async renderReviewLegacy(parent, tasks) {
    const reviewTasks = tasks.filter((task) => task.status === 'needs_review' && task.draftFiles && task.draftFiles.length);
    if (!reviewTasks.length) {
      parent.createDiv({ cls: 'eks-empty', text: '暂无待审核草稿卡片。' });
      return;
    }
    for (const task of reviewTasks) {
      const block = parent.createDiv('eks-draft-block');
      block.createEl('h4', { text: task.sourcePath });
      for (const draftPath of task.draftFiles) {
        const file = this.app.vault.getAbstractFileByPath(draftPath);
        const draft = file instanceof TFile ? await this.app.vault.read(file) : '';
        const item = block.createDiv('eks-draft');
        item.createDiv({ cls: 'eks-task-meta', text: draftPath });
        this.renderDraftSummary(item, draft, task);
        const actions = item.createDiv('eks-actions');
        button(actions, '批准入库', () => this.plugin.approveDraft(task.taskId, draftPath));
        button(actions, '打开草稿', () => this.app.workspace.openLinkText(draftPath, '', false));
        button(actions, '重新生成', () => this.plugin.retryTask(task.taskId));
        button(actions, '退回/跳过', () => this.plugin.skipTask(task.taskId));
      }
    }
  }

  renderDraftSummary(parent, draft, task) {
    parent.createEl('h4', { text: `疑问项 ${task.taskId}` });
    const fields = ['Map_Index', 'Category', 'TagL1', 'TagL2', 'Status', 'Confidence'];
    const table = parent.createEl('table', { cls: 'eks-draft-table' });
    for (const field of fields) {
      const tr = table.createEl('tr');
      tr.createEl('th', { text: field });
      tr.createEl('td', { text: readFrontmatterValue(draft, field) || '-' });
    }
  }
}

class SlicerSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl('h2', { text: '工程知识切片设置' });
    pathSetting(containerEl, this.plugin, '招投标源文件路径', '固定读取招投标源文件。', 'bidIntakePath');
    pathSetting(containerEl, this.plugin, '业务库源文件路径', '固定读取业务库源文件。', 'businessIntakePath');
    pathSetting(containerEl, this.plugin, '招投标输出路径', '招投标知识卡片固定输出根目录。', 'bidOutputPath');
    pathSetting(containerEl, this.plugin, '业务库输出路径', '业务知识卡片固定输出根目录。', 'businessOutputPath');
    pathSetting(containerEl, this.plugin, '中间产物路径', '解析包、结构化总结、审核项和脱敏日志目录。', 'artifactsPath');
    pathSetting(containerEl, this.plugin, '组件包路径', '标签库、提示词、模板和映射规则所在目录。', 'componentPackPath');

    new Setting(containerEl)
      .setName('自动入库置信度门槛')
      .setDesc('低于该置信度的卡片进入审核台；字段非法、MOC 待分类或证据不足的卡片始终进入审核台。')
      .addText((text) => text
        .setPlaceholder('0.9')
        .setValue(String(this.plugin.settings.autoApproveConfidenceThreshold || 0.9))
        .onChange(async (value) => {
          const threshold = Number(value);
          if (Number.isFinite(threshold) && threshold >= 0 && threshold <= 1) {
            this.plugin.settings.autoApproveConfidenceThreshold = threshold;
            await this.plugin.saveSettings();
          }
        }));

    new Setting(containerEl)
      .setName('并发处理文档数')
      .setDesc('同时处理的源文件上限，建议 2-3，过高容易触发 API 限流。')
      .addText((text) => text
        .setPlaceholder('3')
        .setValue(String(this.plugin.settings.maxConcurrentDocuments || 3))
        .onChange(async (value) => {
          const n = Number(value);
          if (Number.isFinite(n) && n >= 1 && n <= 10) {
            this.plugin.settings.maxConcurrentDocuments = n;
            await this.plugin.saveSettings();
          }
        }));

    new Setting(containerEl)
      .setName('启用外部密钥文件')
      .setDesc('开启后从 ~/.eks-secrets.json 读取密钥，避免 OneDrive/iCloud 同步目录中的 data.json 泄露密钥。')
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.useEnvKeys !== false)
        .onChange(async (value) => {
          this.plugin.settings.useEnvKeys = value;
          await this.plugin.saveSettings();
        }));

    containerEl.createEl('h3', { text: 'MiniMax 结构化处理' });

    passwordSetting(containerEl, this.plugin, 'MiniMax API Key', '用于调用 MiniMax 国内版。仅保存在本地插件设置中，不写入 Markdown 或任务日志。', 'minimaxApiKey', 'MiniMax API Key');
    textSetting(containerEl, this.plugin, 'MiniMax 模型', '默认使用 MiniMax-M3，可按账户实际可用模型修改。', 'minimaxModel', 'MiniMax-M3');
    textSetting(containerEl, this.plugin, 'MiniMax M3 接口地址', '国内版默认使用 Anthropic 兼容接口，以支持更长的结构化输出。', 'minimaxEndpoint', 'https://api.minimaxi.com/anthropic/v1/messages');
    connectionTestSetting(containerEl, this.plugin, '测试 MiniMax 连接', 'minimax');

    new Setting(containerEl)
      .setName('知识卡片输出语言')
      .setDesc('源文件可为中文、英文或日文；调用 AI 时，标题、摘要和摘录统一生成中文。')
      .addDropdown((dropdown) => dropdown
        .addOption('zh-CN', '简体中文')
        .setValue(this.plugin.settings.targetLanguage || 'zh-CN')
        .onChange(async (value) => {
          this.plugin.settings.targetLanguage = value;
          await this.plugin.saveSettings();
        }));

    containerEl.createEl('h3', { text: '云端文档解析' });

    new Setting(containerEl)
      .setName('允许上传源文件到外部解析 API')
      .setDesc('开启后受支持的源文件会上传到 MinerU/PaddleOCR。请确认符合公司的保密与数据外发要求。')
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.pdfAllowExternalUpload === true)
        .onChange(async (value) => {
          this.plugin.settings.pdfAllowExternalUpload = value;
          await this.plugin.saveSettings();
        }));

    passwordSetting(containerEl, this.plugin, 'MinerU API Token', '精准解析 API Token，仅保存在本地插件设置中。', 'pdfMineruApiKey', 'MinerU Token');
    textSetting(containerEl, this.plugin, 'MinerU API 端点', '国内精准解析 API 基础地址。', 'pdfMineruApiEndpoint', 'https://mineru.net/api/v4');
    textSetting(containerEl, this.plugin, 'MinerU API 模型', '建议使用 vlm；复杂版面、表格和扫描件解析更完整。', 'pdfMineruApiModel', 'vlm');
    connectionTestSetting(containerEl, this.plugin, '测试 MinerU 连接', 'mineru');

    new Setting(containerEl)
      .setName('MinerU 文档语言')
      .setDesc('ch_server 同时覆盖中文、英文、繁体和日文；日文为主的资料可改为 japan。')
      .addDropdown((dropdown) => dropdown
        .addOption('ch_server', '中/英/日文混合')
        .addOption('ch', '中文/英文')
        .addOption('japan', '日文为主')
        .addOption('en', '英文为主')
        .setValue(this.plugin.settings.pdfMineruApiLanguage || 'ch_server')
        .onChange(async (value) => {
          this.plugin.settings.pdfMineruApiLanguage = value;
          await this.plugin.saveSettings();
        }));

    passwordSetting(containerEl, this.plugin, 'PaddleOCR API Token', 'AI Studio 文档解析 Token，仅保存在本地插件设置中。', 'pdfPaddleOcrApiKey', 'PaddleOCR Token');
    textSetting(containerEl, this.plugin, 'PaddleOCR API 端点', '国内 PaddleOCR 异步任务接口。', 'pdfPaddleOcrApiEndpoint', 'https://paddleocr.aistudio-app.com/api/v2/ocr/jobs');
    textSetting(containerEl, this.plugin, 'PaddleOCR API 模型', '用于扫描件和 MinerU 低质量结果补盲。', 'pdfPaddleOcrApiModel', 'PaddleOCR-VL-1.6');
    connectionTestSetting(containerEl, this.plugin, '测试 PaddleOCR 连接', 'paddleocr');

    new Setting(containerEl)
      .setName('云端解析轮询间隔')
      .setDesc('查询远程解析进度的间隔，默认 5 秒。')
      .addText((text) => text
        .setPlaceholder('5')
        .setValue(String(Math.round((this.plugin.settings.pdfApiPollIntervalMs || 5000) / 1000)))
        .onChange(async (value) => {
          const seconds = Number(value);
          if (Number.isFinite(seconds) && seconds >= 1 && seconds <= 60) {
            this.plugin.settings.pdfApiPollIntervalMs = seconds * 1000;
            await this.plugin.saveSettings();
          }
        }));

    new Setting(containerEl)
      .setName('外部 PDF 解析超时')
      .setDesc('MinerU/PaddleOCR 可能较慢，默认 600 秒；超时后会降级到下一解析器。')
      .addText((text) => text
        .setPlaceholder('600')
        .setValue(String(Math.round((this.plugin.settings.pdfExternalTimeoutMs || 600000) / 1000)))
        .onChange(async (value) => {
          const seconds = Number(value);
          if (Number.isFinite(seconds) && seconds > 0) {
            this.plugin.settings.pdfExternalTimeoutMs = Math.round(seconds * 1000);
            await this.plugin.saveSettings();
          }
        }));

    new Setting(containerEl)
      .setName('AI 请求超时')
      .setDesc('单次分段调用超过该时间仍无返回时，任务会失败并显示原因；长文档会分多段逐段调用。')
      .addText((text) => text
        .setPlaceholder('300')
        .setValue(String(Math.round((this.plugin.settings.aiRequestTimeoutMs || 300000) / 1000)))
        .onChange(async (value) => {
          const seconds = Number(value);
          if (Number.isFinite(seconds) && seconds >= 10) {
            this.plugin.settings.aiRequestTimeoutMs = Math.round(seconds * 1000);
            await this.plugin.saveSettings();
          }
        }));

    new Setting(containerEl)
      .setName('AI 单段字符数')
      .setDesc('每次交给 AI 的源文本长度。默认 8000；复杂表格较多时可适当调低。')
      .addText((text) => text
        .setPlaceholder('8000')
        .setValue(String(this.plugin.settings.aiChunkSize || 8000))
        .onChange(async (value) => {
          const chars = Number(value);
          if (Number.isFinite(chars) && chars >= 4000 && chars <= 30000) {
            this.plugin.settings.aiChunkSize = Math.round(chars);
            await this.plugin.saveSettings();
          }
        }));

    new Setting(containerEl)
      .setName('AI 最大分段数')
      .setDesc('限制单个文件的 AI 调用次数，默认 100。超过上限时任务会明确失败，不会静默遗漏后半部分。')
      .addText((text) => text
        .setPlaceholder('100')
        .setValue(String(this.plugin.settings.aiMaxChunks || 100))
        .onChange(async (value) => {
          const chunks = Number(value);
          if (Number.isFinite(chunks) && chunks >= 1 && chunks <= 200) {
            this.plugin.settings.aiMaxChunks = Math.round(chunks);
            await this.plugin.saveSettings();
          }
        }));

    new Setting(containerEl)
      .setName('卡住任务判定时间')
      .setDesc('处理中任务超过该时间没有任何进度更新，会自动转为失败，方便用“重试失败并处理”重新排队。')
      .addText((text) => text
        .setPlaceholder('20')
        .setValue(String(this.plugin.settings.staleProcessingMinutes || 20))
        .onChange(async (value) => {
          const minutes = Number(value);
          if (Number.isFinite(minutes) && minutes >= 5) {
            this.plugin.settings.staleProcessingMinutes = Math.round(minutes);
            await this.plugin.saveSettings();
          }
        }));

    containerEl.createEl('h3', { text: '生态插件检测' });
    for (const item of detectEcosystemPlugins(this.app)) {
      const setting = new Setting(containerEl)
        .setName(item.name)
        .setDesc(item.role);
      setting.addExtraButton((button) => button
        .setIcon(item.enabled ? 'check-circle' : (item.installed ? 'circle-dot' : 'circle'))
        .setTooltip(item.enabled ? '已启用' : (item.installed ? '已安装但未启用' : '可选增强')));
    }

    containerEl.createEl('h3', { text: '维护' });
    new Setting(containerEl)
      .setName('清空当前插件缓存')
      .setDesc('删除任务队列、处理日志和待审核草稿；不会删除源文件，也不会删除已经写入 wiki 的知识卡片。')
      .addButton((button) => button
        .setButtonText('清空缓存')
        .setWarning()
        .onClick(async () => {
          if (typeof window !== 'undefined' && !window.confirm('确认清空工程知识切片的任务队列、日志和草稿？源文件和已入库 wiki 卡片不会删除。')) return;
          await this.plugin.clearPluginCache();
          this.display();
        }));
  }
}

function pathSetting(containerEl, plugin, name, desc, key) {
  new Setting(containerEl)
    .setName(name)
    .setDesc(desc)
    .addText((text) => text
      .setValue(plugin.settings[key])
      .onChange(async (value) => {
        plugin.settings[key] = normalizeVaultPath(value);
        await plugin.saveSettings();
      }));
}

function textSetting(containerEl, plugin, name, desc, key, fallback = '') {
  new Setting(containerEl)
    .setName(name)
    .setDesc(desc)
    .addText((text) => text
      .setValue(plugin.settings[key] || fallback)
      .onChange(async (value) => {
        plugin.settings[key] = value.trim() || fallback;
        await plugin.saveSettings();
      }));
}

function passwordSetting(containerEl, plugin, name, desc, key, placeholder = '') {
  new Setting(containerEl)
    .setName(name)
    .setDesc(desc)
    .addText((text) => {
      text.inputEl.type = 'password';
      text
        .setPlaceholder(placeholder)
        .setValue(plugin.settings[key] || '')
        .onChange(async (value) => {
          plugin.settings[key] = value.trim();
          await plugin.saveSettings();
        });
    });
}

async function obsidianRequest(url, init = {}) {
  let body = init.body;
  if (Buffer.isBuffer(body) || ArrayBuffer.isView(body)) {
    const bytes = Buffer.from(body);
    body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  }
  const response = await requestUrl({
    url,
    method: init.method || 'GET',
    headers: init.headers || {},
    body,
    throw: false
  });
  const text = String(response.text || '');
  return {
    ok: response.status >= 200 && response.status < 300,
    status: response.status,
    async json() {
      if (response.json !== undefined && response.json !== null) return response.json;
      return JSON.parse(text);
    },
    async text() { return text; },
    async arrayBuffer() {
      if (response.arrayBuffer) return response.arrayBuffer;
      const bytes = Buffer.from(text, 'utf8');
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    }
  };
}

function connectionTestSetting(containerEl, plugin, name, service) {
  new Setting(containerEl)
    .setName(name)
    .setDesc('验证鉴权和服务端是否可访问；不会上传知识库文件。')
    .addButton((control) => control
      .setButtonText('测试连接')
      .onClick(async () => {
        control.setDisabled(true);
        try { await plugin.testServiceConnection(service); } finally { control.setDisabled(false); }
      }));
}

function serviceConnectionConfig(service, settings) {
  if (service === 'minimax') {
    const endpoint = settings.minimaxEndpoint || 'https://api.minimaxi.com/anthropic/v1/messages';
    if (/\/anthropic\/v1\/messages\/?$/i.test(endpoint)) {
      return {
        label: 'MiniMax',
        apiKey: settings.minimaxApiKey || '',
        url: endpoint,
        request: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': settings.minimaxApiKey || '', 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({
            model: settings.minimaxModel || 'MiniMax-M3',
            messages: [{ role: 'user', content: '仅回答 OK' }],
            max_tokens: 32
          })
        }
      };
    }
    return {
      label: 'MiniMax',
      apiKey: settings.minimaxApiKey || '',
      url: endpoint,
      request: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.minimaxApiKey || ''}` },
        body: JSON.stringify({
          model: settings.minimaxModel || 'MiniMax-M3',
          messages: [{ role: 'user', content: '仅回复 OK' }],
          temperature: 0,
          max_tokens: 4
        })
      }
    };
  }
  if (service === 'mineru') {
    const endpoint = String(settings.pdfMineruApiEndpoint || 'https://mineru.net/api/v4').replace(/\/$/, '');
    return {
      label: 'MinerU',
      apiKey: settings.pdfMineruApiKey || '',
      url: `${endpoint}/extract/task/connection-test`,
      request: { method: 'GET', headers: { Authorization: `Bearer ${settings.pdfMineruApiKey || ''}` } }
    };
  }
  const endpoint = String(settings.pdfPaddleOcrApiEndpoint || 'https://paddleocr.aistudio-app.com/api/v2/ocr/jobs').replace(/\/$/, '');
  return {
    label: 'PaddleOCR',
    apiKey: settings.pdfPaddleOcrApiKey || '',
    url: `${endpoint}/connection-test`,
    request: { method: 'GET', headers: { Authorization: `bearer ${settings.pdfPaddleOcrApiKey || ''}` } }
  };
}

function button(parent, text, onClick) {
  const el = parent.createEl('button', { text });
  el.onclick = onClick;
  return el;
}

function stat(parent, label, value) {
  const el = parent.createDiv('eks-stat');
  el.createDiv({ cls: 'eks-stat-value', text: String(value) });
  el.createDiv({ cls: 'eks-stat-label', text: label });
}

function formatLocalTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('zh-CN', { hour12: false });
}

function formatDuration(milliseconds) {
  const seconds = Math.max(0, Math.floor(Number(milliseconds || 0) / 1000));
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes} 分 ${seconds % 60} 秒`;
}

function stageLabel(stage) {
  const labels = {
    start: '准备', queued: '排队', parsing: '文档解析', parsed: '解析完成', classifying: '类型判定', classification: '类型判定',
    summarizing: '结构化总结', 'summary-map': '逐段总结', 'summary-reduce': '合并总结', atomizing: '知识原子化', atomization: '知识原子化',
    validating: '可信度与契约校验', writing: '写入知识库', complete: '完成', failed: '失败', paused: '已暂停', cancelled: '已取消',
    skipped: '已跳过', unsupported: '不支持'
  };
  return labels[stage] || String(stage || '等待');
}

async function ensureFolder(app, folderPath) {
  const parts = normalizeVaultPath(folderPath).split('/').filter(Boolean);
  let current = '';
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    if (!app.vault.getAbstractFileByPath(current)) {
      try { await app.vault.createFolder(current); } catch {}
    }
  }
}

async function writeFile(app, path, content) {
  await ensureFolder(app, path.split('/').slice(0, -1).join('/'));
  const existing = app.vault.getAbstractFileByPath(path);
  if (existing instanceof TFile) {
    await app.vault.modify(existing, content);
  } else {
    await app.vault.create(path, content);
  }
  return path;
}

async function writeUnique(app, targetPath, content) {
  const normalized = normalizeVaultPath(targetPath);
  const folder = normalized.split('/').slice(0, -1).join('/');
  const file = normalized.split('/').pop();
  const stem = file.replace(/\.md$/, '');
  let candidate = normalized;
  let index = 1;
  while (app.vault.getAbstractFileByPath(candidate)) {
    candidate = `${folder}/${stem}-${index}.md`;
    index += 1;
  }
  await writeFile(app, candidate, content);
  return candidate;
}

async function deleteFolderContents(app, folderPath) {
  const folder = app.vault.getAbstractFileByPath(normalizeVaultPath(folderPath));
  if (!(folder instanceof TFolder)) return;
  const children = [...folder.children];
  for (const child of children) {
    await app.vault.delete(child, true);
  }
}

function upsertTask(tasks, task) {
  const id = task.task_id || task.taskId;
  const index = tasks.findIndex((item) => (item.task_id || item.taskId) === id);
  if (index >= 0) tasks[index] = task;
  else tasks.push(task);
  return tasks;
}

function runtimeVersions(settings) {
  return {
    pipelineVersion: settings.pipelineVersion || '1.1.0',
    promptBundleVersion: settings.promptBundleVersion || '1.1',
    schemaVersion: settings.schemaVersion || '1.1'
  };
}

function libraryForPath(filePath, settings) {
  const path = normalizeVaultPath(filePath);
  if (path.startsWith(`${normalizeVaultPath(settings.businessIntakePath)}/`)) return 'business';
  return 'bid';
}

function workflowStatus(stage) {
  if (stage === 'classification') return 'classifying';
  if (stage === 'summary-map' || stage === 'summary-reduce') return 'summarizing';
  if (stage === 'atomization') return 'atomizing';
  return 'validating';
}

function validateAtomLabels(library, atom) {
  const required = [
    [library.categories, atom.Category],
    [library.tagL1, atom.TagL1],
    [library.tagL2, atom.TagL2]
  ];
  if (atom.card_kind === 'event') required.push([library.eventTypes, atom.Event_Type]);
  if (atom.card_kind === 'static') required.push([library.infoTypes, atom.Info_Type]);
  return required.every(([allowed, value]) => Boolean(value) && allowed && allowed.has(value));
}

// 统一遮蔽多种 API 密钥形态（OpenAI sk-、Bearer JWT、URL 里的 token= / api_key= / apikey=）
// v1.1.2 之前只匹配 sk-*，会把 MiniMax / PaddleOCR / MinerU 的密钥原样漏进 Notice。
function sanitizeSecret(message) {
  return String(message || '')
    .replace(/(bearer\s+)[A-Za-z0-9._\-+/=]{12,}/gi, '$1***')
    .replace(/\b(sk-|sk_|key-)[A-Za-z0-9._\-+/=]{8,}/g, '$1***')
    .replace(/([?&](?:token|access_token|api[_-]?key|apikey|password|secret)=)[^&\s"']+/gi, '$1***')
    .replace(/("|\b)([A-Za-z0-9_-]{32,})("|\b)(?=.*(?:key|token|secret))/g, '$1***$3');
}

function getMarkdownTitle(markdown) {
  const match = String(markdown || '').match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : '';
}

function readFrontmatterValue(markdown, key) {
  const match = String(markdown || '').match(new RegExp(`^${key}:\\s*\"?([^\"\\n]+)\"?`, 'm'));
  return match ? match[1].trim() : '';
}

function cardFromMarkdown(markdown) {
  const confidence = Number(readFrontmatterValue(markdown, 'Confidence'));
  return {
    Map_Index: readFrontmatterValue(markdown, 'Map_Index'),
    Card_Type: readFrontmatterValue(markdown, 'Card_Type'),
    Event_Type: readFrontmatterValue(markdown, 'Event_Type'),
    Info_Type: readFrontmatterValue(markdown, 'Info_Type'),
    Category: readFrontmatterValue(markdown, 'Category'),
    TagL1: readFrontmatterValue(markdown, 'TagL1'),
    TagL2: readFrontmatterValue(markdown, 'TagL2'),
    Status: readFrontmatterValue(markdown, 'Status'),
    Source_File: readFrontmatterValue(markdown, 'Source_File'),
    Source_Path: readFrontmatterValue(markdown, 'Source_Path'),
    Source_Hash: readFrontmatterValue(markdown, 'Source_Hash'),
    Confidence: Number.isFinite(confidence) ? confidence : undefined
  };
}

function approveMarkdownStatus(markdown, status = '#status/approved') {
  const text = String(markdown || '');
  if (/^Status:\s*.*$/m.test(text)) {
    return text.replace(/^Status:\s*.*$/m, `Status: ${JSON.stringify(status)}`);
  }
  return text.replace(/^---\n/, `---\nStatus: ${JSON.stringify(status)}\n`);
}

function approvedStatus(library) {
  if (library?.statuses?.has('#status/approved')) return '#status/approved';
  if (library?.statuses?.has('#status/confirmed')) return '#status/confirmed';
  return '#status/approved';
}

},
"src/core/task.js": function(require, module, exports) {
const crypto = require("crypto");
const path = require("path");

const DEFAULT_SETTINGS = {
  settingsVersion: 5,
  intakePath: '06-知识库/源文件',
  outputPath: '06-知识库/wiki',
  bidIntakePath: '06-知识库/源文件/招投标',
  businessIntakePath: '06-知识库/源文件/业务库',
  bidOutputPath: '06-知识库/wiki/招投标',
  businessOutputPath: '06-知识库/wiki/业务库',
  artifactsPath: '06-知识库/源文件/_slicer_artifacts',
  componentPackPath: '06-知识库/组件包',
  draftPath: '06-知识库/源文件/_slicer_artifacts/review',
  logPath: '06-知识库/源文件/_slicer_artifacts/logs',
  tasksFileName: 'tasks.json',
  rollbackFileName: 'rollback.json',
  aiProvider: 'minimax',
  autoApproveConfidenceThreshold: 0.9,
  minimaxApiKey: '',
  minimaxModel: 'MiniMax-M3',
  minimaxEndpoint: 'https://api.minimaxi.com/anthropic/v1/messages',
  pdfExtractionOrder: 'mineru-api,paddleocr-api',
  pdfAllowExternalUpload: false,
  pdfMineruApiKey: '',
  pdfMineruApiEndpoint: 'https://mineru.net/api/v4',
  pdfMineruApiModel: 'vlm',
  pdfMineruApiLanguage: 'ch_server',
  pdfPaddleOcrApiKey: '',
  pdfPaddleOcrApiEndpoint: 'https://paddleocr.aistudio-app.com/api/v2/ocr/jobs',
  pdfPaddleOcrApiModel: 'PaddleOCR-VL-1.6',
  pdfApiPollIntervalMs: 5000,
  pdfExternalTimeoutMs: 600000,
  aiChunkSize: 8000,
  aiMaxChunks: 100,
  aiRequestTimeoutMs: 300000,
  aiRequestMaxAttempts: 3,
  aiRetryBaseMs: 800,
  maxAutomaticRetries: 3,
  maxConcurrentDocuments: 3,
  rateLimitMs: 1000,
  rateLimitMaxConcurrent: 2,
  useEnvKeys: true,
  staleProcessingMinutes: 20,
  targetLanguage: 'zh-CN',
  maxExcerptLength: 500,
  pipelineVersion: '1.1.1',
  promptBundleVersion: '1.1',
  schemaVersion: '1.1'
};

function migrateSettings(stored = {}) {
  const source = stored && typeof stored === 'object' ? stored : {};
  const migrated = {};
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (Object.hasOwn(source, key)) migrated[key] = source[key];
  }
  migrated.settingsVersion = 5;
  migrated.aiProvider = 'minimax';
  migrated.bidIntakePath = DEFAULT_SETTINGS.bidIntakePath;
  migrated.businessIntakePath = DEFAULT_SETTINGS.businessIntakePath;
  migrated.bidOutputPath = DEFAULT_SETTINGS.bidOutputPath;
  migrated.businessOutputPath = DEFAULT_SETTINGS.businessOutputPath;
  migrated.intakePath = DEFAULT_SETTINGS.intakePath;
  migrated.outputPath = DEFAULT_SETTINGS.outputPath;
  migrated.artifactsPath = DEFAULT_SETTINGS.artifactsPath;
  migrated.draftPath = DEFAULT_SETTINGS.draftPath;
  migrated.logPath = DEFAULT_SETTINGS.logPath;
  migrated.pdfExtractionOrder = DEFAULT_SETTINGS.pdfExtractionOrder;
  // v1.1.1 升级门槛：用户在 v1.1.0 之前 < 0.9 时全部提升到 0.9；用户主动调低的（< 0.85）保持原意
  const storedThreshold = Number(source.autoApproveConfidenceThreshold);
  if (Number.isFinite(storedThreshold) && storedThreshold < 0.9) {
    migrated.autoApproveConfidenceThreshold = storedThreshold < 0.85
      ? storedThreshold
      : DEFAULT_SETTINGS.autoApproveConfidenceThreshold;
  } else if (!Number.isFinite(storedThreshold)) {
    migrated.autoApproveConfidenceThreshold = DEFAULT_SETTINGS.autoApproveConfidenceThreshold;
  } else {
    migrated.autoApproveConfidenceThreshold = storedThreshold;
  }
  if (!migrated.minimaxEndpoint
    || migrated.minimaxEndpoint === 'https://api.minimax.chat/v1/chat/completions'
    || migrated.minimaxEndpoint === 'https://api.minimaxi.com/v1/chat/completions') {
    migrated.minimaxEndpoint = DEFAULT_SETTINGS.minimaxEndpoint;
  }
  if (!migrated.aiMaxChunks || Number(migrated.aiMaxChunks) <= 8) migrated.aiMaxChunks = DEFAULT_SETTINGS.aiMaxChunks;
  if (!migrated.aiChunkSize || Number(migrated.aiChunkSize) === 12000) migrated.aiChunkSize = DEFAULT_SETTINGS.aiChunkSize;
  if (!Number(migrated.pdfExternalTimeoutMs) || Number(migrated.pdfExternalTimeoutMs) <= 300000) {
    migrated.pdfExternalTimeoutMs = DEFAULT_SETTINGS.pdfExternalTimeoutMs;
  }
  if (!Number(migrated.aiRequestTimeoutMs) || Number(migrated.aiRequestTimeoutMs) <= 180000) {
    migrated.aiRequestTimeoutMs = DEFAULT_SETTINGS.aiRequestTimeoutMs;
  }
  if (!Number(migrated.maxConcurrentDocuments) || Number(migrated.maxConcurrentDocuments) < 2) {
    migrated.maxConcurrentDocuments = DEFAULT_SETTINGS.maxConcurrentDocuments;
  }
  if (migrated.pdfAllowExternalUpload === undefined) migrated.pdfAllowExternalUpload = false;
  if (!Number(migrated.rateLimitMs)) migrated.rateLimitMs = DEFAULT_SETTINGS.rateLimitMs;
  if (!Number(migrated.rateLimitMaxConcurrent)) migrated.rateLimitMaxConcurrent = DEFAULT_SETTINGS.rateLimitMaxConcurrent;
  if (migrated.useEnvKeys === undefined) migrated.useEnvKeys = DEFAULT_SETTINGS.useEnvKeys;
  if (!Number(migrated.aiRequestMaxAttempts)) migrated.aiRequestMaxAttempts = DEFAULT_SETTINGS.aiRequestMaxAttempts;
  if (!Number(migrated.aiRetryBaseMs)) migrated.aiRetryBaseMs = DEFAULT_SETTINGS.aiRetryBaseMs;
  return migrated;
}

const SOURCE_TYPE_BY_EXT = {
  '.md': 'md',
  '.txt': 'txt',
  '.pdf': 'pdf',
  '.doc': 'docx',
  '.docx': 'docx',
  '.ppt': 'pptx',
  '.pptx': 'pptx',
  '.xls': 'xlsx',
  '.xlsx': 'xlsx',
  '.eml': 'email',
  '.msg': 'outlook-msg',
  '.html': 'html',
  '.htm': 'html',
  '.png': 'image',
  '.jpg': 'image',
  '.jpeg': 'image',
  '.webp': 'image',
  '.gif': 'image',
  '.tif': 'image',
  '.tiff': 'image',
  '.mp4': 'video',
  '.mov': 'video',
  '.avi': 'video',
  '.mkv': 'video',
  '.mp3': 'audio',
  '.wav': 'audio',
  '.m4a': 'audio'
};

const PROCESSABLE_TYPES = new Set(['md', 'txt', 'pdf', 'docx', 'pptx', 'xlsx', 'email', 'html', 'image']);

function normalizeVaultPath(filePath) {
  return String(filePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
}

// v1.1.2: 把 Buffer.from 的副作用收拢到一处。
// 当 input 是 null / undefined / 字符串数字时，行为统一：空缓冲区。
// 同时避免 ArrayBuffer/SharedArrayBuffer/Uint8Array 等非 Buffer 输入在
// multipart / uploadBody 等路径中产生 Buffer.from(... ) 期待 Buffer 的边界 bug。
function safeBufferFrom(input, encoding) {
  if (input == null) return Buffer.alloc(0);
  if (Buffer.isBuffer(input)) return encoding ? input.toString(encoding) : input;
  if (input instanceof ArrayBuffer) return Buffer.from(input);
  if (ArrayBuffer.isView(input)) return Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  if (typeof input === 'string') return encoding ? Buffer.from(input, encoding) : Buffer.from(input, 'utf8');
  try { return Buffer.from(String(input), 'utf8'); } catch { return Buffer.alloc(0); }
}

// v1.1.2: 把字符串里的 NUL / 控制字符 / 全角空格替换为安全形态，
// 防止 vault 同步过来的文件名含不可见控制字符导致卡片命名或链接构造失败。
function normalizeUnicodeForm(value) {
  let str = String(value || '');
  if (!str) return str;
  // 优先用 Node 内置 NFC；旧版本 / 浏览器 fallback 用 regex 替换 NFD 组合字符
  if (typeof str.normalize === 'function') {
    try { str = str.normalize('NFC'); } catch { /* 不可用则忽略 */ }
  }
  // 清除夹带的控制字符（保留换行回车之外的不可见字符）
  str = str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F﻿]/g, '');
  // 全角空格 / 不间断空格统一成普通空格
  str = str.replace(/[　 ]/g, ' ');
  return str;
}

function detectSourceType(filePath) {
  const ext = path.extname(String(filePath || '')).toLowerCase();
  return SOURCE_TYPE_BY_EXT[ext] || 'unknown';
}

function isProcessableSource(filePath) {
  return PROCESSABLE_TYPES.has(detectSourceType(filePath));
}

function sourceHash(buffer) {
  return crypto.createHash('sha256').update(buffer || Buffer.alloc(0)).digest('hex');
}

function buildTaskFromFile(sourcePath, buffer, now = new Date()) {
  const normalized = normalizeVaultPath(sourcePath);
  const hash = sourceHash(buffer);
  const time = now.toISOString();
  return {
    taskId: `slicer-${hash.slice(0, 12)}`,
    sourcePath: normalized,
    sourceHash: hash,
    sourceType: detectSourceType(normalized),
    status: isProcessableSource(normalized) ? 'queued' : futureMediaStatus(normalized),
    createdAt: time,
    updatedAt: time,
    draftFiles: [],
    errors: []
  };
}

function futureMediaStatus(filePath) {
  const sourceType = detectSourceType(filePath);
  if (sourceType === 'video' || sourceType === 'audio') return 'unsupported_media';
  if (sourceType === 'outlook-msg') return 'unsupported_media';
  return 'skipped';
}

function statusCounts(tasks) {
  const counts = {
    total: tasks.length,
    pending: 0,
    processing: 0,
    needsReview: 0,
    failed: 0,
    written: 0,
    skipped: 0
  };
  const processing = new Set(['parsing', 'classifying', 'summarizing', 'atomizing', 'validating', 'writing']);
  for (const task of tasks) {
    if (task.status === 'queued' || task.status === 'discovered') counts.pending += 1;
    if (processing.has(task.status)) counts.processing += 1;
    if (task.status === 'needs_review') counts.needsReview += 1;
    if (task.status === 'failed') counts.failed += 1;
    if (Array.isArray(task.written_card_ids) && task.written_card_ids.length) counts.written += task.written_card_ids.length;
    else if (Array.isArray(task.writtenFiles) && task.writtenFiles.length) counts.written += task.writtenFiles.length;
    else if (task.status === 'written' || task.status === 'archived') counts.written += 1;
    if (task.status === 'skipped' || task.status === 'unsupported' || task.status === 'unsupported_media' || task.status === 'needs_ocr') counts.skipped += 1;
  }
  return counts;
}

function tasksPath(settings = DEFAULT_SETTINGS) {
  return normalizeVaultPath(`${settings.logPath}/${settings.tasksFileName || 'tasks.json'}`);
}

function rollbackPath(settings = DEFAULT_SETTINGS) {
  return normalizeVaultPath(`${settings.logPath}/${settings.rollbackFileName || 'rollback.json'}`);
}

module.exports = {
  DEFAULT_SETTINGS,
  buildTaskFromFile,
  detectSourceType,
  futureMediaStatus,
  isProcessableSource,
  migrateSettings,
  normalizeVaultPath,
  rollbackPath,
  sourceHash,
  statusCounts,
  tasksPath
};

},
"src/core/tags.js": function(require, module, exports) {
function emptyLibrary() {
  return {
    all: new Set(),
    categories: new Set(),
    tagL1: new Set(),
    tagL2: new Set(),
    eventTypes: new Set(),
    infoTypes: new Set(),
    statuses: new Set(),
    mapByCategory: new Map(),
    mapByTriplet: new Map()
  };
}

function parseTagLibrary(markdown) {
  const library = emptyLibrary();
  const tagPattern = /`(#[a-zA-Z0-9/_-]+)`/g;
  const mapPattern = /`\[\[([^`\]]+)\]\]`|\[\[([^\]]+)\]\]/;
  for (const line of String(markdown || '').split(/\r?\n/)) {
    const tags = [...line.matchAll(tagPattern)].map((match) => match[1]);
    if (tags.length === 0) continue;
    const mapMatch = line.match(mapPattern);
    const mapIndex = mapMatch ? `[[${mapMatch[1] || mapMatch[2]}]]` : '';
    for (const tag of tags) {
      library.all.add(tag);
      if (tag.startsWith('#cat/') || tag.startsWith('#domain/')) {
        library.categories.add(tag);
        if (mapIndex) library.mapByCategory.set(tag, mapIndex);
      }
      if (tag.startsWith('#l1/')) library.tagL1.add(tag);
      if (tag.startsWith('#l2/')) library.tagL2.add(tag);
      if (tag.startsWith('#event/') || tag.startsWith('#type/')) library.eventTypes.add(tag);
      if (tag.startsWith('#info/')) library.infoTypes.add(tag);
      if (tag.startsWith('#status/')) library.statuses.add(tag);
    }
    if (tags.length >= 3 && mapIndex) {
      library.mapByTriplet.set(tripletKey(tags[0], tags[1], tags[2]), mapIndex);
    }
  }
  seedFallbacks(library);
  return library;
}

function seedFallbacks(library) {
  const defaults = {
    categories: ['#cat/general-knowledge', '#cat/design', '#cat/quality'],
    tagL1: ['#l1/document-control', '#l1/hvac', '#l1/ncr-defect'],
    tagL2: ['#l2/requirement', '#l2/value-engineering', '#l2/corrective-action'],
    eventTypes: ['#event/meeting', '#event/decision', '#event/issue', '#event/nonconformance'],
    infoTypes: ['#info/spec', '#info/requirement', '#info/method'],
    statuses: ['#status/pending_review', '#status/needs_fix', '#status/approved', '#status/uncategorized']
  };
  for (const [field, tags] of Object.entries(defaults)) {
    if (library[field].size) continue;
    for (const tag of tags) {
      library[field].add(tag);
      library.all.add(tag);
    }
  }
  if (!library.mapByCategory.has('#cat/general-knowledge')) {
    library.mapByCategory.set('#cat/general-knowledge', '[[MOC_通用知识库]]');
  }
  if (!library.mapByCategory.has('#cat/design')) {
    library.mapByCategory.set('#cat/design', '[[MOC_设计管理]]');
  }
  if (!library.mapByCategory.has('#cat/quality')) {
    library.mapByCategory.set('#cat/quality', '[[MOC_质量管理]]');
  }
  const domainMaps = {
    '#domain/arch': '[[MOC_建筑工程]]',
    '#domain/struct': '[[MOC_结构工程]]',
    '#domain/process': '[[MOC_工艺生产线]]',
    '#domain/hvac': '[[MOC_暖通空调]]',
    '#domain/elec': '[[MOC_电气工程]]',
    '#domain/plumb': '[[MOC_给排水]]',
    '#domain/cost': '[[MOC_成本与VECD优化]]',
    '#domain/safe': '[[MOC_安全与合规]]'
  };
  for (const [tag, moc] of Object.entries(domainMaps)) {
    if (library.categories.has(tag) && !library.mapByCategory.has(tag)) {
      library.mapByCategory.set(tag, moc);
    }
  }
}

function tripletKey(category, tagL1, tagL2) {
  return `${category}|${tagL1}|${tagL2}`;
}

function suggestMapIndex(library, category, tagL1, tagL2) {
  return library.mapByTriplet.get(tripletKey(category, tagL1, tagL2))
    || library.mapByCategory.get(category)
    || '[[MOC_待分类]]';
}

function validateCard(library, card) {
  const errors = [];
  requireInSet(errors, library.categories, card.Category, 'Category');
  requireInSet(errors, library.tagL1, card.TagL1, 'TagL1');
  requireInSet(errors, library.tagL2, card.TagL2, 'TagL2');
  requireInSet(errors, library.statuses, card.Status, 'Status');

  if (card.Card_Type === 'event') {
    requireInSet(errors, library.eventTypes, card.Event_Type, 'Event_Type');
  } else if (card.Card_Type === 'info') {
    requireInSet(errors, library.infoTypes, card.Info_Type, 'Info_Type');
  } else {
    errors.push(`Card_Type must be event or info: ${card.Card_Type || ''}`);
  }

  for (const field of ['Source_File', 'Source_Path', 'Source_Hash']) {
    if (!card[field]) errors.push(`${field} is required`);
  }
  if (typeof card.Confidence !== 'number') errors.push('Confidence must be a number');

  return { valid: errors.length === 0, errors };
}

function requireInSet(errors, set, value, label) {
  if (!value || !set.has(value)) errors.push(`${label} is not in Tag Library: ${value || ''}`);
}

module.exports = {
  parseTagLibrary,
  suggestMapIndex,
  validateCard
};

},
"src/core/extractors.js": function(require, module, exports) {
const { createParsePackage, documentPlan } = require("src/core/document-parser.js");
const { extractDocumentWithApis } = require("src/core/external-pdf.js");

async function extractTextFromBuffer(filePath, buffer, options = {}) {
  const plan = documentPlan(filePath);
  if (plan.mode === 'unsupported') {
    return {
      status: 'unsupported_media',
      text: '',
      sourceType: plan.sourceType,
      message: unsupportedMessage(plan.sourceType)
    };
  }
  if (plan.mode === 'text') {
    return withParsePackage(textResult(buffer, plan.sourceType), {
      sourcePath: filePath,
      buffer,
      sourceType: plan.sourceType,
      parser: 'text-normalizer'
    });
  }
  if (plan.mode === 'email') {
    const decoded = decodeTextBuffer(buffer);
    const email = parseEmail(decoded.text);
    return withParsePackage(Object.assign(readableTextResult(email.text, 'email', decoded), {
      title: email.subject,
      metadata: Object.assign({}, email, { sourceEncoding: decoded.encoding })
    }), {
      sourcePath: filePath,
      buffer,
      sourceType: 'email',
      parser: 'eml-parser'
    });
  }

  const fileName = String(filePath || '').split(/[\\/]/).pop() || 'source';
  const config = Object.assign({}, options.pdfExtractor || {}, options.documentExtractor || {}, {
    fileName,
    order: plan.engines.join(','),
    mineruApiModel: plan.mineruModel
  });
  const external = await extractDocumentWithApis(buffer, config);
  if (!external || external.status !== 'ok') {
    return {
      status: 'failed',
      text: '',
      sourceType: plan.sourceType,
      sourceEncoding: external?.engine || '',
      sourceLanguage: 'unknown',
      extractor: external?.engine || 'document-api',
      message: external?.message || '云端文档解析失败。'
    };
  }
  const text = String(external.text || '').trim();
  return withParsePackage({
    status: 'ok',
    text,
    sourceType: plan.sourceType,
    sourceEncoding: external.engine || 'document-api',
    sourceLanguage: detectDominantLanguage(text),
    extractor: external.engine || 'document-api',
    metadata: external.metadata || {}
  }, {
    sourcePath: filePath,
    buffer,
    sourceType: plan.sourceType,
    parser: external.engine,
    parserModel: config.mineruApiModel,
    remoteJobId: external.remoteJobId,
    pages: external.pages,
    images: external.images
  });
}

function withParsePackage(result, options) {
  if (!result || result.status !== 'ok') return result;
  result.parsePackage = createParsePackage(Object.assign({}, options, {
    markdown: result.text,
    language: result.sourceLanguage || 'unknown'
  }));
  return result;
}

function unsupportedMessage(sourceType) {
  if (sourceType === 'outlook-msg') return '暂不支持 Outlook MSG，请导出为 EML 后处理。';
  if (sourceType === 'video' || sourceType === 'audio') return '音视频处理属于后续版本能力。';
  return '不支持的文件类型。';
}

function textResult(buffer, sourceType) {
  const decoded = decodeTextBuffer(buffer);
  return readableTextResult(decoded.text, sourceType, decoded);
}

function readableTextResult(text, sourceType, decoded = {}) {
  const clean = String(text || '').trim();
  if (looksLikeGibberish(clean)) {
    return {
      status: 'failed',
      text: '',
      sourceType,
      sourceEncoding: decoded.encoding || '',
      sourceLanguage: detectDominantLanguage(clean),
      message: '文本内容疑似编码错误或二进制乱码，请转换为受支持的文本编码后重试。'
    };
  }
  return {
    status: clean ? 'ok' : 'failed',
    text: clean,
    sourceType,
    sourceEncoding: decoded.encoding || '',
    sourceLanguage: detectDominantLanguage(clean),
    message: clean ? '' : '未读取到可用文本。'
  };
}

function decodeTextBuffer(buffer) {
  const input = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || '');
  if (input.length === 0) return decodedCandidate('utf-8', '');
  // 文本缓冲区告警：含 NUL 字节的文件几乎可以肯定是二进制（PDF/ZIP/图片等），
  // 即便扩展名是 .md/.txt 也要拒收，避免二进制字节流被当文本送进 AI。
  const nulCount = countByte(input, 0x00);
  if (nulCount > 0 && (!looksLikeLegitimateText(input) || nulCount > 2)) {
    return decodedCandidate('binary-rejected', '');
  }
  if (input.length >= 3 && input[0] === 0xef && input[1] === 0xbb && input[2] === 0xbf) {
    return decodedCandidate('utf-8-bom', input.slice(3).toString('utf8'));
  }
  if (input.length >= 2 && input[0] === 0xff && input[1] === 0xfe) {
    return decodedCandidate('utf-16le-bom', input.slice(2).toString('utf16le'));
  }
  if (input.length >= 2 && input[0] === 0xfe && input[1] === 0xff) {
    return decodeWithTextDecoder(input.slice(2), 'utf-16be')
      || decodedCandidate('utf-16be-bom', swapUtf16Bytes(input.slice(2)).toString('utf16le'));
  }

  const candidates = [
    decodedCandidate('utf-8', input.toString('utf8')),
    decodedCandidate('utf-16le', input.toString('utf16le')),
    decodeWithTextDecoder(input, 'utf-16be'),
    decodeWithTextDecoder(input, 'shift_jis'),
    decodeWithTextDecoder(input, 'windows-31j'),
    decodeWithTextDecoder(input, 'gb18030'),
    decodeWithTextDecoder(input, 'big5'),
    decodedCandidate('latin1', input.toString('latin1'))
  ].filter(Boolean);
  for (const candidate of candidates) {
    candidate.score += encodingHeuristicBonus(input, candidate.encoding, candidate.text);
  }
  candidates.sort((a, b) => b.score - a.score);
  // 自适应兜底：当最优候选的 readability 分数仍低于阈值时，认为解码失败。
  // 返回 'utf-8' 空文本而不是乱码文本，让调用方走 failed 分支。
  const best = candidates[0];
  if (!best || best.score < DECODE_MIN_CONFIDENCE) {
    return decodedCandidate('low-confidence', best ? best.text : '');
  }
  return best;
}

// 文本缓冲区中含 NUL 字节时是否仍可能是合法文本？
// 唯一例外是使用了 PUA/控制字符的某些专业日志，但通用插件场景下 NUL ≈ 二进制。
function looksLikeLegitimateText(buffer) {
  if (Buffer.isBuffer(buffer) && buffer.length >= 3) {
    if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) return true;
    if (buffer[0] === 0xff && buffer[1] === 0xfe) return true;
    if (buffer[0] === 0xfe && buffer[1] === 0xff) return true;
  }
  return false;
}

function countByte(buffer, byte) {
  let n = 0;
  const len = Buffer.isBuffer(buffer) ? buffer.length : 0;
  for (let i = 0; i < len; i += 1) if (buffer[i] === byte) n += 1;
  return n;
}

const DECODE_MIN_CONFIDENCE = -0.15;

function encodingHeuristicBonus(buffer, encoding, text) {
  const enc = String(encoding || '').toLowerCase();
  const looksSjis = looksLikeShiftJisBytes(buffer);
  // Fix: UTF-8 CJK 3-byte sequences (E4-E9, 80-BF, 80-BF) overlap with
  // ShiftJIS lead-trail byte ranges, causing false-positive ShiftJIS detection.
  // If buffer is valid UTF-8 (zero replacement chars) with CJK content,
  // strongly prefer UTF-8 and reject ShiftJIS/GB18030/Big5 candidates.
  const utf8Text = buffer.toString('utf8');
  const utf8Valid = !utf8Text.includes('\uFFFD') && utf8Text.length > 0;
  if (utf8Valid && hasCjk(utf8Text)) {
    if (enc === 'utf-8' || enc === 'utf-8-bom') return 0.5;
    if (enc === 'shift_jis' || enc === 'windows-31j' || enc === 'gb18030' || enc === 'big5') return -0.5;
  }
  if ((enc === 'utf-16le' || enc === 'utf-16be') && !looksLikeUtf16Bytes(buffer)) return -2;
  if ((enc === 'shift_jis' || enc === 'windows-31j') && looksSjis && hasCjk(text)) return 0.35;
  if ((enc === 'gb18030' || enc === 'big5') && looksSjis) return -0.12;
  if (enc === 'latin1') return -0.2;
  return 0;
}

function looksLikeUtf16Bytes(buffer) {
  if (buffer.length < 4) return false;
  let evenZeros = 0;
  let oddZeros = 0;
  const pairs = Math.floor(buffer.length / 2);
  for (let i = 0; i + 1 < buffer.length; i += 2) {
    if (buffer[i] === 0) evenZeros += 1;
    if (buffer[i + 1] === 0) oddZeros += 1;
  }
  return evenZeros / pairs > 0.25 || oddZeros / pairs > 0.25;
}

function looksLikeShiftJisBytes(buffer) {
  let pairs = 0;
  let validPairs = 0;
  for (let i = 0; i + 1 < buffer.length; i += 1) {
    const lead = buffer[i];
    const trail = buffer[i + 1];
    if ((lead >= 0x81 && lead <= 0x9f) || (lead >= 0xe0 && lead <= 0xfc)) {
      pairs += 1;
      if ((trail >= 0x40 && trail <= 0x7e) || (trail >= 0x80 && trail <= 0xfc)) validPairs += 1;
      i += 1;
    }
  }
  return pairs > 0 && validPairs / pairs >= 0.75;
}

function hasCjk(text) {
  return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(String(text || ''));
}

function decodeWithTextDecoder(buffer, encoding) {
  try {
    if (typeof TextDecoder !== 'function') return null;
    return decodedCandidate(encoding, new TextDecoder(encoding, { fatal: false }).decode(buffer));
  } catch {
    return null;
  }
}

function decodedCandidate(encoding, text) {
  return { encoding, text, score: readabilityScore(text) };
}

function readabilityScore(text) {
  const value = String(text || '');
  if (!value) return -100;
  const chars = [...value];
  const replacement = chars.filter((ch) => ch === '\uFFFD').length;
  const controls = chars.filter((ch) => /[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(ch)).length;
  const readable = chars.filter(isExpectedReadableChar).length;
  const mojibake = chars.filter((ch) => /[\u00C0-\u00FF]/.test(ch) && !isExpectedReadableChar(ch)).length;
  const unexpected = chars.filter(isUnexpectedScriptOrPrivate).length;
  return (readable / chars.length) - (replacement * 0.25) - (controls * 0.2) - (mojibake * 0.06) - (unexpected * 0.08);
}

function detectDominantLanguage(text) {
  const value = String(text || '');
  const kana = (value.match(/[\p{Script=Hiragana}\p{Script=Katakana}]/gu) || []).length;
  const han = (value.match(/\p{Script=Han}/gu) || []).length;
  const latin = (value.match(/[A-Za-z]/g) || []).length;
  if (kana > 0) return 'ja';
  if (han > latin) return 'zh';
  if (latin > 0) return 'en';
  return 'unknown';
}

function swapUtf16Bytes(buffer) {
  const out = Buffer.from(buffer);
  for (let i = 0; i + 1 < out.length; i += 2) {
    const first = out[i];
    out[i] = out[i + 1];
    out[i + 1] = first;
  }
  return out;
}

function parseEmail(raw) {
  const normalizedRaw = String(raw || '').replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n');
  const [headerPart, ...bodyParts] = normalizedRaw.split(/\r?\n\r?\n/);
  const headers = {};
  for (const line of headerPart.split(/\r?\n/)) {
    const match = line.match(/^([^:]+):\s*(.*)$/);
    if (match) headers[match[1].toLowerCase()] = match[2].trim();
  }
  const body = bodyParts.join('\n\n');
  return {
    subject: headers.subject || '',
    from: headers.from || '',
    to: headers.to || '',
    date: headers.date || '',
    text: stripHtml(body).trim()
  };
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n');
}

function looksLikeGibberish(text) {
  const value = String(text || '');
  if (!value) return false;
  if (/\\u[0-9a-f]{4}/i.test(value)) return true;
  const chars = [...value];
  // Split suspicious into truly suspicious (control/replacement/surrogate) vs
  // Latin-Extended (À-ÿ) which may appear legitimately in names/loanwords.
  const controlChars = chars.filter((ch) => /[\x00-\x08\x0B\x0C\x0E-\x1F\uFFFD\uD800-\uDFFF]/.test(ch)).length;
  const latinExtended = chars.filter((ch) => /[À-ÿ]/.test(ch)).length;
  const suspicious = controlChars + latinExtended;
  const readable = chars.filter(isExpectedReadableChar).length;
  const unexpected = chars.filter(isUnexpectedScriptOrPrivate).length;
  const symbols = chars.filter((ch) => !isExpectedReadableChar(ch)).length;
  if (chars.length < 80 && controlChars === 0 && unexpected === 0 && readable / chars.length > 0.75) return false;
  // Lower the weight of Latin-Extended chars: they're suspicious only when
  // they dominate (ratio > 0.15), unlike true control/replacement chars which
  // are suspicious at any ratio > 0.03.
  const controlRatio = controlChars / chars.length;
  const latinExtendedRatio = latinExtended / chars.length;
  return chars.length > 30 && (
    controlRatio > 0.03
    || latinExtendedRatio > 0.15
    || unexpected / chars.length > 0.05
    || readable / chars.length < 0.62
    || symbols / chars.length > 0.22
  );
}

function isExpectedReadableChar(ch) {
  return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}A-Za-z0-9\s，。、“”：《》；：！？（）【】,.()[\]{}:;!?/+\-=_%#&'"|@<>·•、~￥$…—℃±×÷≤≥²³°′″㎡µΩ]/u.test(ch);
}

function isUnexpectedScriptOrPrivate(ch) {
  return /[\p{Script=Hangul}\p{Script=Arabic}\p{Script=Devanagari}\p{Script=Bengali}\p{Script=Tamil}\p{Script=Kannada}\p{Script=Telugu}\p{Script=Thai}\uE000-\uF8FF\uF0000-\uFFFFD\u100000-\u10FFFD]/u.test(ch);
}

module.exports = {
  decodeTextBuffer,
  detectDominantLanguage,
  extractTextFromBuffer,
  parseEmail,
  stripHtml
};

},
"src/core/moc.js": function(require, module, exports) {
function folderIndexPath(route) {
  return `${String(route.output_folder || '').replace(/\/$/, '')}/_索引.md`;
}

function createFolderIndexMarkdown(route) {
  const title = `${route.folder_type} 索引`;
  return `---\ntitle: ${JSON.stringify(title)}\nlibrary: ${JSON.stringify(route.library)}\nfolder_type: ${JSON.stringify(route.folder_type)}\nindex_type: fixed-folder\n---\n\n# ${title}\n\n## 知识卡片\n\n\`\`\`dataview\nTABLE card_kind AS 类型, Category, TagL1, TagL2, confidence AS 可信度, source_file AS 来源\nFROM ${JSON.stringify(route.output_folder)}\nWHERE library = ${JSON.stringify(route.library)}\n  AND folder_type = ${JSON.stringify(route.folder_type)}\n  AND file.name != "_索引"\nSORT updated DESC\n\`\`\`\n\n## 标签三元组索引\n\nCategory / TagL1 / TagL2 仅用于 MOC 查询与筛选，文件目录由 folder-map.json 固定映射。\n`;
}

module.exports = { createFolderIndexMarkdown, folderIndexPath };


},
"src/core/ecosystem.js": function(require, module, exports) {
const OPTIONAL_PLUGINS = [
  { id: 'dataview', name: 'Dataview', role: 'MOC 表格和动态查询' },
  { id: 'tag-wrangler', name: 'Tag Wrangler', role: '标签重命名、合并与治理' },
  { id: 'quickadd', name: 'QuickAdd', role: '快捷捕获命令和手动建卡' },
  { id: 'obsidian-tasks-plugin', name: 'Tasks', role: '待办查询和任务视图' },
  { id: 'obsidian-kanban', name: 'Kanban', role: '可选审核看板' },
  { id: 'metadata-menu', name: 'Metadata Menu', role: 'Frontmatter 字段编辑辅助' },
  { id: 'obsidian-linter', name: 'Linter', role: 'Markdown 和 frontmatter 格式整理' },
  { id: 'templater-obsidian', name: 'Templater', role: '模板渲染兼容' },
  { id: 'templates', name: 'Templates', role: '核心模板兼容' }
];

function detectEcosystemPlugins(app) {
  const installed = (app && app.plugins && app.plugins.plugins) || {};
  const enabled = (app && app.plugins && app.plugins.enabledPlugins) || new Set();
  return OPTIONAL_PLUGINS.map((plugin) => ({
    id: plugin.id,
    name: plugin.name,
    installed: Boolean(installed[plugin.id]),
    enabled: typeof enabled.has === 'function' ? enabled.has(plugin.id) : Boolean(enabled[plugin.id]),
    role: plugin.role
  }));
}

module.exports = {
  OPTIONAL_PLUGINS,
  detectEcosystemPlugins
};

},
"src/core/routing.js": function(require, module, exports) {
function resolveFixedRoute(folderMap, value) {
  const route = (folderMap && folderMap.routes || []).find((item) => (
    item.library === value.library && item.folder_type === value.folder_type
  ));
  if (!route) throw new Error(`固定目录映射中不存在：${value.library || 'unknown'} / ${value.folder_type || 'unknown'}`);
  return route;
}

function cardOutputFolder(folderMap, card) {
  return resolveFixedRoute(folderMap, card).output_folder.replace(/\/$/, '');
}

function cardOutputPath(folderMap, card, fileName) {
  return `${cardOutputFolder(folderMap, card)}/${sanitizeFileName(fileName)}`;
}

function sanitizeFileName(value) {
  const fileName = String(value || 'card.md').replace(/[\\/:*?"<>|#\[\]]+/g, '-').replace(/-+/g, '-');
  return fileName.toLowerCase().endsWith('.md') ? fileName : `${fileName}.md`;
}

module.exports = { cardOutputFolder, cardOutputPath, resolveFixedRoute, sanitizeFileName };


},
"src/core/external-pdf.js": function(require, module, exports) {
const { runMineruApi } = require("src/core/mineru-api.js");
const { runPaddleOcrApi } = require("src/core/paddleocr-api.js");

const DEFAULT_ORDER = ['mineru-api', 'paddleocr-api'];
const MAX_MINERU_FILE_BYTES = 200 * 1024 * 1024;

async function extractDocumentWithApis(buffer, config = {}) {
  if (Number(buffer?.length || 0) > MAX_MINERU_FILE_BYTES) {
    return {
      status: 'failed',
      engine: 'document-api',
      text: '',
      message: '源文件超过 MinerU 精准解析 API 的 200 MB 上限，请拆分后重试。'
    };
  }
  if (Number(config.pageCount || 0) > 200) {
    return {
      status: 'failed',
      engine: 'document-api',
      text: '',
      message: '文档超过 MinerU 精准解析 API 的 200 页上限，请拆分后重试。'
    };
  }

  if (typeof config.run === 'function') {
    const injected = await config.run(buffer, config);
    return normalizeResult(injected, 'document-api');
  }

  const errors = [];
  for (const engine of parseOrder(config.order || config.pdfExtractionOrder)) {
    await emitProgress(config, {
      stage: 'document-engine',
      engine,
      message: `正在尝试云端文档解析器：${engineLabel(engine)}`
    });
    const result = await runEngine(engine, buffer, config);
    if (result && result.status === 'ok' && isUsableMarkdown(result.text)) return result;
    if (result && result.status === 'ok') errors.push(`${engine}: 解析结果未通过可读性检查`);
    if (result && result.message) errors.push(`${engine}: ${result.message}`);
  }

  return {
    status: 'failed',
    engine: 'document-api',
    text: '',
    message: errors.length ? errors.join(' | ') : '云端文档解析未返回可读 Markdown。'
  };
}

async function extractPdfWithExternal(buffer, config = {}) {
  return extractDocumentWithApis(buffer, config);
}

function parseOrder(value) {
  const requested = String(value || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter((item) => DEFAULT_ORDER.includes(item));
  return requested.length ? [...new Set(requested)] : [...DEFAULT_ORDER];
}

async function runEngine(engine, buffer, config) {
  if (config.engineRunners && typeof config.engineRunners[engine] === 'function') {
    return config.engineRunners[engine]({ buffer, config });
  }
  if (!config.allowExternalUpload) return { status: 'unavailable', message: '未确认允许上传源文件到外部解析 API。' };
  if (engine === 'mineru-api') {
    return runMineruApi(buffer, {
      apiKey: config.mineruApiKey,
      endpoint: config.mineruApiEndpoint,
      model: config.mineruApiModel,
      language: config.mineruApiLanguage,
      fileName: config.fileName,
      timeoutMs: config.timeoutMs,
      pollIntervalMs: config.pollIntervalMs,
      requestImpl: config.requestImpl,
      fetchImpl: config.fetchImpl,
      sleep: config.sleep,
      onProgress: config.onProgress
    });
  }
  if (engine === 'paddleocr-api') {
    return runPaddleOcrApi(buffer, {
      apiKey: config.paddleOcrApiKey,
      endpoint: config.paddleOcrApiEndpoint,
      model: config.paddleOcrApiModel,
      fileName: config.fileName,
      timeoutMs: config.timeoutMs,
      pollIntervalMs: config.pollIntervalMs,
      requestImpl: config.requestImpl,
      fetchImpl: config.fetchImpl,
      sleep: config.sleep,
      onProgress: config.onProgress
    });
  }
  return { status: 'unavailable', message: `不支持的云端解析器：${engine}` };
}

function normalizeResult(result, fallbackEngine) {
  if (!result || result.status !== 'ok') {
    return {
      status: result?.status || 'failed',
      engine: result?.engine || fallbackEngine,
      text: '',
      message: result?.message || '云端文档解析失败。'
    };
  }
  if (!isUsableMarkdown(result.text)) {
    return {
      status: 'failed',
      engine: result.engine || fallbackEngine,
      text: '',
      message: result.message || '云端解析结果未通过可读性检查。'
    };
  }
  return result;
}

function isUsableMarkdown(text) {
  const value = String(text || '').trim();
  if (value.length < 20 || /\\u[0-9a-f]{4}/i.test(value)) return false;
  const chars = [...value];
  const corrupt = chars.filter((char) => char === '\uFFFD' || /[\x00-\x08\x0B\x0C\x0E-\x1F\uD800-\uDFFF]/.test(char)).length;
  const readable = chars.filter((char) => /[\p{L}\p{N}\s，。、“”‘’：；！？（）【】《》,.()[\]{}:;!?/+=_%#&'"|@<>·…—-]/u.test(char)).length;
  return corrupt / chars.length <= 0.02 && readable / chars.length >= 0.72;
}

function engineLabel(engine) {
  return engine === 'mineru-api' ? 'MinerU API' : 'PaddleOCR API';
}

async function emitProgress(config, payload) {
  if (typeof config.onProgress === 'function') await config.onProgress(payload);
}

module.exports = {
  DEFAULT_ORDER,
  MAX_MINERU_FILE_BYTES,
  extractDocumentWithApis,
  extractPdfWithExternal,
  isUsableMarkdown,
  parseOrder
};

},
"src/core/mineru-api.js": function(require, module, exports) {
const { extractZipEntryEndingWith } = require("src/core/zip.js");

async function runMineruApi(buffer, options = {}) {
  if (!options.apiKey) return unavailable('未配置 MinerU API Token。');
  if (typeof (options.requestImpl || options.fetchImpl || globalThis.fetch) !== 'function') return unavailable('当前环境不支持网络请求。');

  const fetcher = options.requestImpl || options.fetchImpl || globalThis.fetch;
  const endpoint = String(options.endpoint || 'https://mineru.net/api/v4').replace(/\/$/, '');
  const headers = {
    Authorization: `Bearer ${options.apiKey}`,
    'Content-Type': 'application/json'
  };
  const fileName = safeFileName(options.fileName || 'source.pdf');
  const pollIntervalMs = Math.max(500, Number(options.pollIntervalMs) || 5000);
  const maxPolls = Math.max(1, Math.ceil((Number(options.timeoutMs) || 300000) / pollIntervalMs));
  const sleep = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));

  try {
    await emit(options, { stage: 'mineru-api-request', message: 'MinerU：正在申请上传地址' });
    const createResponse = await fetcher(`${endpoint}/file-urls/batch`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        files: [{ name: fileName, is_ocr: true }],
        model_version: options.model || 'vlm',
        language: options.language || 'ch_server',
        enable_table: options.enableTable !== false,
        enable_formula: options.enableFormula !== false
      })
    });
    const createPayload = await readJson(createResponse, 'MinerU 申请上传地址');
    const batchId = createPayload?.data?.batch_id;
    const uploadUrl = createPayload?.data?.file_urls?.[0];
    if (!batchId || !uploadUrl) throw new Error(createPayload?.msg || 'MinerU 未返回上传地址或批次 ID。');

    await emit(options, { stage: 'mineru-api-upload', message: 'MinerU：正在上传源文件' });
    const uploadResponse = await fetcher(uploadUrl, { method: 'PUT', body: Buffer.from(buffer || []) });
    if (!uploadResponse.ok) throw new Error(`MinerU 文件上传失败（HTTP ${uploadResponse.status}）。`);

    for (let attempt = 0; attempt < maxPolls; attempt += 1) {
      if (attempt > 0) await sleep(pollIntervalMs);
      const resultResponse = await fetcher(`${endpoint}/extract-results/batch/${encodeURIComponent(batchId)}`, {
        method: 'GET',
        headers: { Authorization: headers.Authorization }
      });
      const resultPayload = await readJson(resultResponse, 'MinerU 查询任务');
      const result = resultPayload?.data?.extract_result?.[0];
      if (!result) throw new Error(resultPayload?.msg || 'MinerU 未返回任务状态。');
      const progress = result.extract_progress || {};
      await emit(options, {
        stage: 'mineru-api-poll',
        message: progress.total_pages
          ? `MinerU：已解析 ${progress.extracted_pages || 0}/${progress.total_pages} 页`
          : `MinerU：${stateLabel(result.state)}`,
        extractedPages: progress.extracted_pages || 0,
        totalPages: progress.total_pages || 0,
        remoteState: result.state
      });
      if (result.state === 'failed') throw new Error(result.err_msg || 'MinerU 解析失败。');
      if (result.state !== 'done') continue;
      if (!result.full_zip_url) throw new Error('MinerU 完成任务未返回结果下载地址。');

      await emit(options, { stage: 'mineru-api-download', message: 'MinerU：正在下载 Markdown 结果' });
      const zipResponse = await fetcher(result.full_zip_url, { method: 'GET' });
      if (!zipResponse.ok) throw new Error(`MinerU 结果下载失败（HTTP ${zipResponse.status}）。`);
      const zipBuffer = Buffer.from(await zipResponse.arrayBuffer());
      const markdown = extractZipEntryEndingWith(zipBuffer, 'full.md').trim();
      if (!markdown) throw new Error('MinerU 结果 ZIP 中未找到 full.md。');
      return { status: 'ok', engine: 'mineru-api-markdown', text: markdown, message: '' };
    }
    throw new Error(`MinerU 解析超时（${Math.round(maxPolls * pollIntervalMs / 1000)} 秒）。`);
  } catch (error) {
    return { status: 'failed', engine: 'mineru-api', text: '', message: safeError(error) };
  }
}

async function readJson(response, operation) {
  if (!response || !response.ok) throw new Error(`${operation}失败（HTTP ${response?.status || 0}）。`);
  const payload = await response.json();
  if (payload?.code !== undefined && payload.code !== 0) throw new Error(`${operation}失败：${payload.msg || payload.code}`);
  return payload;
}

function stateLabel(state) {
  return ({ 'waiting-file': '等待文件上传', pending: '排队中', running: '正在解析', converting: '正在转换格式' })[state] || String(state || '处理中');
}

function safeFileName(value) {
  return String(value || 'source.pdf').split(/[\\/]/).pop().replace(/[^\p{L}\p{N}._()（）\- ]/gu, '_') || 'source.pdf';
}

function safeError(error) {
  return String(error?.message || error || '未知错误').replace(/Bearer\s+\S+/gi, 'Bearer ***');
}

function unavailable(message) {
  return Promise.resolve({ status: 'unavailable', engine: 'mineru-api', text: '', message });
}

async function emit(options, payload) {
  if (typeof options.onProgress === 'function') await options.onProgress(payload);
}

module.exports = { runMineruApi };

},
"src/core/paddleocr-api.js": function(require, module, exports) {
async function runPaddleOcrApi(buffer, options = {}) {
  if (!options.apiKey) return unavailable('未配置 PaddleOCR API Token。');
  const fetcher = options.requestImpl || options.fetchImpl || globalThis.fetch;
  const FormDataCtor = options.FormDataCtor || globalThis.FormData;
  const BlobCtor = options.BlobCtor || globalThis.Blob;
  if (typeof fetcher !== 'function' || (!options.requestImpl && (typeof FormDataCtor !== 'function' || typeof BlobCtor !== 'function'))) {
    return unavailable('当前环境不支持 PaddleOCR 文件上传。');
  }

  const endpoint = String(options.endpoint || 'https://paddleocr.aistudio-app.com/api/v2/ocr/jobs').replace(/\/$/, '');
  const headers = { Authorization: `bearer ${options.apiKey}` };
  const pollIntervalMs = Math.max(500, Number(options.pollIntervalMs) || 5000);
  const maxPolls = Math.max(1, Math.ceil((Number(options.timeoutMs) || 300000) / pollIntervalMs));
  const sleep = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));

  try {
    const optionalPayload = JSON.stringify({
      useDocOrientationClassify: options.useDocOrientationClassify === true,
      useDocUnwarping: options.useDocUnwarping === true,
      useChartRecognition: options.useChartRecognition === true
    });
    const upload = options.requestImpl
      ? multipartUpload(buffer, options, optionalPayload)
      : browserFormUpload(buffer, options, optionalPayload, FormDataCtor, BlobCtor);

    await emit(options, { stage: 'paddleocr-api-submit', message: 'PaddleOCR：正在提交解析任务' });
    const createResponse = await fetcher(endpoint, {
      method: 'POST',
      headers: Object.assign({}, headers, upload.headers),
      body: upload.body
    });
    const createPayload = await readJson(createResponse, 'PaddleOCR 提交任务');
    const jobId = createPayload?.data?.jobId;
    if (!jobId) throw new Error('PaddleOCR 未返回任务 ID。');

    for (let attempt = 0; attempt < maxPolls; attempt += 1) {
      if (attempt > 0) await sleep(pollIntervalMs);
      const jobResponse = await fetcher(`${endpoint}/${encodeURIComponent(jobId)}`, { method: 'GET', headers });
      const jobPayload = await readJson(jobResponse, 'PaddleOCR 查询任务');
      const data = jobPayload?.data || {};
      const progress = data.extractProgress || {};
      await emit(options, {
        stage: 'paddleocr-api-poll',
        message: progress.totalPages
          ? `PaddleOCR：已解析 ${progress.extractedPages || 0}/${progress.totalPages} 页`
          : `PaddleOCR：${stateLabel(data.state)}`,
        extractedPages: progress.extractedPages || 0,
        totalPages: progress.totalPages || 0,
        remoteState: data.state
      });
      if (data.state === 'failed') throw new Error(data.errorMsg || 'PaddleOCR 解析失败。');
      if (data.state !== 'done') continue;
      const jsonUrl = data.resultUrl?.jsonUrl;
      if (!jsonUrl) throw new Error('PaddleOCR 完成任务未返回 JSONL 下载地址。');

      await emit(options, { stage: 'paddleocr-api-download', message: 'PaddleOCR：正在下载 Markdown 结果' });
      const resultResponse = await fetcher(jsonUrl, { method: 'GET' });
      if (!resultResponse.ok) throw new Error(`PaddleOCR 结果下载失败（HTTP ${resultResponse.status}）。`);
      const text = await resultResponse.text();
      const markdown = parsePaddleJsonl(text);
      if (!markdown) throw new Error('PaddleOCR 结果中没有可用的 Markdown。');
      return { status: 'ok', engine: 'paddleocr-api-markdown', text: markdown, message: '' };
    }
    throw new Error(`PaddleOCR 解析超时（${Math.round(maxPolls * pollIntervalMs / 1000)} 秒）。`);
  } catch (error) {
    return { status: 'failed', engine: 'paddleocr-api', text: '', message: safeError(error) };
  }
}

function browserFormUpload(buffer, options, optionalPayload, FormDataCtor, BlobCtor) {
  const form = new FormDataCtor();
  form.append('model', options.model || 'PaddleOCR-VL-1.6');
  form.append('optionalPayload', optionalPayload);
  form.append(
    'file',
    new BlobCtor([Buffer.from(buffer || [])], { type: 'application/pdf' }),
    safeFileName(options.fileName || 'source.pdf')
  );
  return { headers: {}, body: form };
}

function multipartUpload(buffer, options, optionalPayload) {
  const boundary = `----eks-${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
  const fileName = safeFileName(options.fileName || 'source.pdf').replace(/"/g, '_');
  const chunks = [];
  const field = (name, value) => {
    chunks.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
      'utf8'
    ));
  };
  field('model', options.model || 'PaddleOCR-VL-1.6');
  field('optionalPayload', optionalPayload);
  chunks.push(Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: application/pdf\r\n\r\n`,
    'utf8'
  ));
  chunks.push(Buffer.from(buffer || []));
  chunks.push(Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8'));
  return {
    headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
    body: Buffer.concat(chunks)
  };
}

function parsePaddleJsonl(value) {
  const pages = [];
  for (const line of String(value || '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const parsed = JSON.parse(line);
    for (const result of parsed?.result?.layoutParsingResults || []) {
      const markdown = String(result?.markdown?.text || '').trim();
      if (markdown) pages.push(markdown);
    }
  }
  return pages.join('\n\n').trim();
}

async function readJson(response, operation) {
  if (!response || !response.ok) throw new Error(`${operation}失败（HTTP ${response?.status || 0}）。`);
  return response.json();
}

function stateLabel(state) {
  return ({ pending: '排队中', running: '正在解析' })[state] || String(state || '处理中');
}

function safeFileName(value) {
  return String(value || 'source.pdf').split(/[\\/]/).pop().replace(/[^\p{L}\p{N}._()（）\- ]/gu, '_') || 'source.pdf';
}

function safeError(error) {
  return String(error?.message || error || '未知错误').replace(/bearer\s+\S+/gi, 'bearer ***');
}

function unavailable(message) {
  return Promise.resolve({ status: 'unavailable', engine: 'paddleocr-api', text: '', message });
}

async function emit(options, payload) {
  if (typeof options.onProgress === 'function') await options.onProgress(payload);
}

module.exports = { parsePaddleJsonl, runPaddleOcrApi };

},
"src/core/zip.js": function(require, module, exports) {
const zlib = require("zlib");

function extractZipEntryEndingWith(buffer, suffix) {
  const input = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  const endOffset = findEndOfCentralDirectory(input);
  if (endOffset < 0) return '';

  const entryCount = input.readUInt16LE(endOffset + 10);
  let cursor = input.readUInt32LE(endOffset + 16);
  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > input.length || input.readUInt32LE(cursor) !== 0x02014b50) break;
    const method = input.readUInt16LE(cursor + 10);
    const compressedSize = input.readUInt32LE(cursor + 20);
    const fileNameLength = input.readUInt16LE(cursor + 28);
    const extraLength = input.readUInt16LE(cursor + 30);
    const commentLength = input.readUInt16LE(cursor + 32);
    const localHeaderOffset = input.readUInt32LE(cursor + 42);
    const name = input.slice(cursor + 46, cursor + 46 + fileNameLength).toString('utf8').replace(/\\/g, '/');
    if (name.toLowerCase().endsWith(String(suffix || '').toLowerCase())) {
      const content = readLocalEntry(input, localHeaderOffset, compressedSize, method);
      return content.toString('utf8');
    }
    cursor += 46 + fileNameLength + extraLength + commentLength;
  }
  return '';
}

function readLocalEntry(buffer, offset, compressedSize, method) {
  if (offset + 30 > buffer.length || buffer.readUInt32LE(offset) !== 0x04034b50) return Buffer.alloc(0);
  const fileNameLength = buffer.readUInt16LE(offset + 26);
  const extraLength = buffer.readUInt16LE(offset + 28);
  const start = offset + 30 + fileNameLength + extraLength;
  const compressed = buffer.slice(start, start + compressedSize);
  if (method === 0) return compressed;
  if (method === 8) return zlib.inflateRawSync(compressed);
  throw new Error(`不支持的 ZIP 压缩方式：${method}`);
}

function findEndOfCentralDirectory(buffer) {
  const minimum = Math.max(0, buffer.length - 65557);
  for (let offset = buffer.length - 22; offset >= minimum; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  return -1;
}

module.exports = { extractZipEntryEndingWith };

},
"src/core/component-contracts.js": function(require, module, exports) {
function parseFolderMap(text) {
  let parsed;
  try {
    parsed = JSON.parse(String(text || ''));
  } catch (error) {
    throw new Error(`folder-map.json is not valid JSON: ${error.message}`);
  }
  return parsed;
}

function validateFolderMap(folderMap, promptExists = () => true) {
  const errors = [];
  if (!folderMap || typeof folderMap !== 'object') return ['folder map must be an object'];
  if (folderMap.version !== '1.1') errors.push('folder map version must be 1.1');
  if (!Array.isArray(folderMap.routes)) return [...errors, 'folder map routes must be an array'];

  const seen = new Set();
  let bidCount = 0;
  let businessCount = 0;
  for (const [index, route] of folderMap.routes.entries()) {
    const label = `route ${index + 1}`;
    if (!route || typeof route !== 'object') {
      errors.push(`${label} must be an object`);
      continue;
    }
    if (!['bid', 'business'].includes(route.library)) errors.push(`${label} library must be bid or business`);
    if (route.library === 'bid') bidCount += 1;
    if (route.library === 'business') businessCount += 1;
    if (!String(route.folder_type || '').trim()) errors.push(`${label} folder_type is required`);

    const key = `${route.library}:${route.folder_type}`;
    if (seen.has(key)) errors.push(`duplicate route: ${key}`);
    seen.add(key);

    const root = route.library === 'bid'
      ? '06-知识库/wiki/招投标/'
      : route.library === 'business'
        ? '06-知识库/wiki/业务库/'
        : '';
    const output = String(route.output_folder || '').replace(/\\/g, '/');
    if (!root || !output.startsWith(root) || /category|tagl1|tagl2/i.test(output)) {
      errors.push(`${label} output_folder must use its fixed wiki root`);
    }
    if (!String(route.prompt || '').startsWith('提示词/')) errors.push(`${label} prompt path is invalid`);
    else if (!promptExists(route.prompt)) errors.push(`${label} prompt does not exist: ${route.prompt}`);
  }

  if (bidCount !== 19) errors.push(`expected 19 bid routes, got ${bidCount}`);
  if (businessCount !== 9) errors.push(`expected 9 business routes, got ${businessCount}`);
  return errors;
}

function validateSchemaDocument(schema) {
  const errors = [];
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return ['schema must be an object'];
  if (schema.$schema !== 'https://json-schema.org/draft/2020-12/schema') errors.push('schema draft must be 2020-12');
  if (!String(schema.$id || '').startsWith('engineering-knowledge-slicer://schema/')) errors.push('schema $id is invalid');
  if (schema.type !== 'object') errors.push('root schema type must be object');
  if (!schema.properties || typeof schema.properties !== 'object') errors.push('schema properties are required');
  if (!Array.isArray(schema.required)) errors.push('schema required must be an array');
  if (typeof schema.additionalProperties !== 'boolean') errors.push('schema must decide additionalProperties explicitly');
  return errors;
}

module.exports = {
  parseFolderMap,
  validateFolderMap,
  validateSchemaDocument
};

},
"src/core/migration.js": function(require, module, exports) {
const crypto = require("crypto");

const LEGACY_ACTIVE = new Set(['extracting', 'parsing', 'classifying', 'summarizing', 'slicing', 'atomizing', 'validating', 'writing']);
const VALID_TERMINAL = new Set(['queued', 'written', 'needs_review', 'failed', 'skipped', 'cancelled', 'unsupported', 'paused']);

function migrateTaskLedgerV3(tasks, versions = {}) {
  const pipelineVersion = versions.pipelineVersion || '1.1.1';
  const promptBundleVersion = versions.promptBundleVersion || '1.1';
  return (Array.isArray(tasks) ? tasks : []).map((task) => {
    const canonical = task.schema_version === '1.1' && Boolean(task.task_id) && Boolean(task.run_id);
    // v1.1.2: 旧任务 source_path 可能在 macOS 上是 NFD 编码、Windows 上是 GBK，统一规范成 NFC，
    // 避免按路径查文件时因编码不一致出现"找不到源文件"。
    const sourcePath = normalizeUnicodeForm(String(task.source_path || task.sourcePath || '').replace(/\\/g, '/'));
    const sourceHash = String(task.source_hash || task.sourceHash || '');
    const taskId = task.task_id || task.taskId || `slicer-${sourceHash.slice(0, 12)}`;
    const library = task.library || (sourcePath.includes('/业务库/') ? 'business' : 'bid');
    const wasActive = !canonical && LEGACY_ACTIVE.has(task.status);
    const status = canonical
      ? task.status
      : wasActive
      ? 'failed'
      : task.status === 'archived'
        ? 'written'
        : VALID_TERMINAL.has(task.status)
          ? task.status
          : 'failed';
    const errors = [...(Array.isArray(task.errors) ? task.errors : [])];
    if (wasActive) {
      errors.push({
        stage: 'migration',
        message: '版本升级后旧处理中任务无法安全续接，请手动重试。',
        at: new Date().toISOString()
      });
    }
    const runId = task.run_id || stableId(`${library}:${sourceHash}:${pipelineVersion}:${promptBundleVersion}`);
    return {
      task_id: taskId,
      run_id: runId,
      source_path: sourcePath,
      source_aliases: Array.isArray(task.source_aliases) ? task.source_aliases : [],
      source_hash: sourceHash,
      source_type: task.source_type || task.sourceType || 'unknown',
      library,
      pipeline_version: pipelineVersion,
      prompt_bundle_version: promptBundleVersion,
      schema_version: '1.1',
      status,
      remote_jobs: Array.isArray(task.remote_jobs) ? task.remote_jobs : [],
      retry_counts: task.retry_counts || {},
      artifacts: task.artifacts || {},
      written_card_ids: task.written_card_ids || task.writtenFiles || [],
      review_atom_ids: task.review_atom_ids || task.draftFiles || [],
      errors,
      progress: task.progress || {},
      lease: null,
      created_at: task.created_at || task.createdAt || new Date().toISOString(),
      updated_at: task.updated_at || task.updatedAt || new Date().toISOString()
    };
  });
}

function readinessIssues(settings = {}, contractResult = { valid: true, errors: [] }) {
  const issues = [];
  if (!String(settings.minimaxApiKey || '').trim()) issues.push(issue('minimax-key-missing', 'MiniMax API Key 未配置。'));
  if (!String(settings.pdfMineruApiKey || '').trim()) issues.push(issue('mineru-key-missing', 'MinerU API Token 未配置。'));
  if (settings.pdfAllowExternalUpload !== true) issues.push(issue('external-upload-not-confirmed', '尚未确认允许上传源文件到外部解析 API。'));
  if (!contractResult || contractResult.valid !== true) {
    issues.push(issue('component-contract-invalid', `组件包契约无效：${(contractResult?.errors || []).join('；')}`));
  }
  if (!String(settings.pdfPaddleOcrApiKey || '').trim()) {
    issues.push(issue('paddleocr-key-missing', 'PaddleOCR Token 未配置，PDF/图片补盲不可用。', false));
  }
  return issues;
}

function issue(code, message, blocking = true) {
  return { code, message, blocking };
}

function stableId(value) {
  return `run-${crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 16)}`;
}

module.exports = {
  migrateTaskLedgerV3,
  readinessIssues
};

},
"src/core/document-parser.js": function(require, module, exports) {
const crypto = require("crypto");

const MAX_MINERU_FILE_BYTES = 200 * 1024 * 1024;

function documentPlan(filePath) {
  const lower = String(filePath || '').toLowerCase();
  if (/\.md$/.test(lower)) return plan('md', 'text');
  if (/\.txt$/.test(lower)) return plan('txt', 'text');
  if (/\.eml$/.test(lower)) return plan('email', 'email');
  if (/\.pdf$/.test(lower)) return plan('pdf', 'remote', ['mineru-api', 'paddleocr-api']);
  if (/\.(png|jpe?g|webp|gif|bmp|tiff?)$/.test(lower)) return plan('image', 'remote', ['mineru-api', 'paddleocr-api']);
  if (/\.(doc|docx)$/.test(lower)) return plan('docx', 'remote', ['mineru-api']);
  if (/\.(ppt|pptx)$/.test(lower)) return plan('pptx', 'remote', ['mineru-api']);
  if (/\.(xls|xlsx)$/.test(lower)) return plan('xlsx', 'remote', ['mineru-api']);
  if (/\.(html|htm)$/.test(lower)) return Object.assign(plan('html', 'remote', ['mineru-api']), { mineruModel: 'MinerU-HTML' });
  if (/\.msg$/.test(lower)) return plan('outlook-msg', 'unsupported');
  if (/\.(mp4|mov|avi|mkv)$/.test(lower)) return plan('video', 'unsupported');
  if (/\.(mp3|wav|m4a)$/.test(lower)) return plan('audio', 'unsupported');
  return plan('unknown', 'unsupported');
}

function plan(sourceType, mode, engines = []) {
  return { sourceType, mode, engines, mineruModel: 'vlm' };
}

function createParsePackage(options) {
  const markdown = String(options.markdown || '').trim();
  const quality = markdownQuality(markdown);
  return {
    source_path: String(options.sourcePath || '').replace(/\\/g, '/'),
    source_hash: crypto.createHash('sha256').update(options.buffer || Buffer.alloc(0)).digest('hex'),
    source_type: options.sourceType || 'unknown',
    parser: normalizeParser(options.parser),
    parser_model: options.parserModel || '',
    remote_job_id: options.remoteJobId || '',
    language: options.language || 'unknown',
    markdown,
    pages: Array.isArray(options.pages) && options.pages.length
      ? options.pages
      : markdown ? [{ page: 1, text: markdown }] : [],
    images: Array.isArray(options.images) ? options.images : [],
    quality,
    schema_version: '1.1'
  };
}

function normalizeParser(parser) {
  const value = String(parser || '');
  if (value.startsWith('mineru-api')) return 'mineru-api';
  if (value.startsWith('paddleocr-api')) return 'paddleocr-api';
  if (value === 'eml-parser') return value;
  return 'text-normalizer';
}

function markdownQuality(markdown) {
  const chars = [...String(markdown || '')];
  if (!chars.length) return { readable: false, score: 0, components: { length: 0, readable_ratio: 0, corrupt_ratio: 0, structure: 0 } };
  const corrupt = chars.filter((char) => char === '\uFFFD' || /[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(char)).length;
  const readable = chars.filter((char) => /[\p{L}\p{N}\s，。、“”‘’：；！？（）【】《》,.()[\]{}:;!?/+=_%#&'"|@<>·…—-]/u.test(char)).length;
  const lengthScore = Math.min(1, chars.length / 200);
  const readableRatio = readable / chars.length;
  const corruptRatio = corrupt / chars.length;
  const structure = /(^|\n)#{1,6}\s|\|.+\||(^|\n)[-*]\s/m.test(markdown) ? 1 : 0.6;
  const score = clamp((0.25 * lengthScore) + (0.5 * readableRatio) + (0.25 * structure) - corruptRatio);
  return {
    readable: chars.length >= 20 && corruptRatio <= 0.02 && readableRatio >= 0.72,
    score: Number(score.toFixed(4)),
    components: {
      length: Number(lengthScore.toFixed(4)),
      readable_ratio: Number(readableRatio.toFixed(4)),
      corrupt_ratio: Number(corruptRatio.toFixed(4)),
      structure
    }
  };
}

function clamp(value) {
  return Math.max(0, Math.min(1, value));
}

module.exports = {
  MAX_MINERU_FILE_BYTES,
  createParsePackage,
  markdownQuality,
  documentPlan
};

},
"src/core/identity.js": function(require, module, exports) {
const crypto = require("crypto");

function sourceIdentity({ library, sourceHash }) {
  return `source-${hash(`${library}:${sourceHash}`).slice(0, 20)}`;
}

function runIdentity({ sourceIdentity: sourceId, pipelineVersion, promptBundleVersion, schemaVersion }) {
  return `run-${hash(`${sourceId}:${pipelineVersion}:${promptBundleVersion}:${schemaVersion}`).slice(0, 20)}`;
}

function atomFingerprint(atom) {
  const identityFields = {
    card_kind: atom?.card_kind || '',
    title: atom?.title || '',
    content: atom?.content || {},
    source_locator: atom?.source?.source_locator || ''
  };
  return hash(stableStringify(normalizeValue(identityFields)));
}

function cardIdentity(sourceHash, fingerprint) {
  return `card-${String(sourceHash || '').slice(0, 12)}-${String(fingerprint || '').slice(0, 12)}`;
}

function normalizeValue(value) {
  if (typeof value === 'string') return value.trim().replace(/\s+/g, ' ').toLowerCase();
  if (Array.isArray(value)) return value.map(normalizeValue);
  if (value && typeof value === 'object') {
    const result = {};
    for (const key of Object.keys(value).sort()) result[key] = normalizeValue(value[key]);
    return result;
  }
  return value;
}

function stableStringify(value) {
  return JSON.stringify(value);
}

function hash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

module.exports = {
  atomFingerprint,
  cardIdentity,
  runIdentity,
  sourceIdentity
};

},
"src/core/pipeline.js": function(require, module, exports) {
const { runIdentity, sourceIdentity } = require("src/core/identity.js");

const TRANSITIONS = {
  discovered: new Set(['queued', 'skipped', 'unsupported']),
  queued: new Set(['parsing', 'paused', 'cancelled', 'failed']),
  parsing: new Set(['parsed', 'paused', 'cancelled', 'failed']),
  parsed: new Set(['classifying', 'paused', 'cancelled', 'failed']),
  classifying: new Set(['classified', 'paused', 'cancelled', 'failed']),
  classified: new Set(['summarizing', 'paused', 'cancelled', 'failed']),
  summarizing: new Set(['summarized', 'paused', 'cancelled', 'failed']),
  summarized: new Set(['atomizing', 'paused', 'cancelled', 'failed']),
  atomizing: new Set(['validating', 'paused', 'cancelled', 'failed']),
  validating: new Set(['writing', 'needs_review', 'paused', 'cancelled', 'failed']),
  writing: new Set(['written', 'needs_review', 'paused', 'cancelled', 'failed']),
  failed: new Set(['queued', 'cancelled']),
  paused: new Set(['queued', 'cancelled']),
  needs_review: new Set(['writing', 'written', 'cancelled'])
};

function createTaskRecord(options) {
  const versions = options.versions || {};
  const sourceId = sourceIdentity({ library: options.library, sourceHash: options.sourceHash });
  const runId = runIdentity({
    sourceIdentity: sourceId,
    pipelineVersion: versions.pipelineVersion || '1.1.0',
    promptBundleVersion: versions.promptBundleVersion || '1.1',
    schemaVersion: versions.schemaVersion || '1.1'
  });
  const now = typeof options.now === 'string' ? options.now : (options.now || new Date()).toISOString();
  return {
    task_id: sourceId,
    run_id: runId,
    source_path: String(options.sourcePath || '').replace(/\\/g, '/'),
    source_aliases: [],
    source_hash: options.sourceHash,
    source_type: options.sourceType,
    library: options.library,
    pipeline_version: versions.pipelineVersion || '1.1.0',
    prompt_bundle_version: versions.promptBundleVersion || '1.1',
    schema_version: versions.schemaVersion || '1.1',
    status: 'queued',
    remote_jobs: [],
    retry_counts: {},
    artifacts: {},
    written_card_ids: [],
    review_atom_ids: [],
    errors: [],
    progress: {},
    lease: null,
    created_at: now,
    updated_at: now
  };
}

function transitionTask(task, nextStatus, options = {}) {
  const allowed = TRANSITIONS[task.status];
  if (!allowed || !allowed.has(nextStatus)) {
    throw new Error(`illegal pipeline transition: ${task.status} -> ${nextStatus}`);
  }
  const next = copyTask(task);
  next.status = nextStatus;
  next.updated_at = options.at || new Date().toISOString();
  if (options.progress) next.progress = Object.assign({}, next.progress, options.progress);
  if (options.artifact?.key && options.artifact?.path) {
    next.artifacts[options.artifact.key] = options.artifact.path;
  }
  if (options.error) next.errors.push(options.error);
  return next;
}

function acquireLease(task, owner, now = new Date(), durationMs = 60_000) {
  const current = task.lease;
  if (current && current.owner !== owner && new Date(current.expires_at).getTime() > now.getTime()) {
    throw new Error(`task is leased by another worker: ${current.owner}`);
  }
  const next = copyTask(task);
  next.lease = {
    owner,
    acquired_at: now.toISOString(),
    expires_at: new Date(now.getTime() + durationMs).toISOString()
  };
  return next;
}

function releaseLease(task, owner) {
  if (task.lease && task.lease.owner !== owner) throw new Error(`cannot release lease owned by ${task.lease.owner}`);
  const next = copyTask(task);
  next.lease = null;
  return next;
}

function retryFailedTask(task, options = {}) {
  if (task.status !== 'failed') throw new Error('only failed tasks can be retried');
  const maxRetries = Number(options.maxRetries || 3);
  const stage = task.errors?.at(-1)?.stage || 'unknown';
  const current = Number(task.retry_counts?.[stage] || 0);
  if (current >= maxRetries) throw new Error(`retry limit reached for ${stage}`);
  const next = transitionTask(task, 'queued', { at: options.at });
  next.retry_counts[stage] = current + 1;
  next.progress = {};
  next.lease = null;
  return next;
}

async function runPipelineTask(initialTask, handlers, persist = async () => {}) {
  let task = copyTask(initialTask);
  let steps = 0;
  try {
    while (!['written', 'needs_review', 'failed', 'cancelled', 'unsupported', 'skipped'].includes(task.status)) {
      if (steps++ > 20) throw new Error('pipeline exceeded maximum transition count');
      if (task.status === 'queued') task = transitionTask(task, 'parsing');
      else if (task.status === 'parsing') task = transitionTask(task, 'parsed', { artifact: artifact('parsed', await requiredHandler(handlers, 'parse', task)) });
      else if (task.status === 'parsed') task = transitionTask(task, 'classifying');
      else if (task.status === 'classifying') task = transitionTask(task, 'classified', { artifact: artifact('classification', await requiredHandler(handlers, 'classify', task)) });
      else if (task.status === 'classified') task = transitionTask(task, 'summarizing');
      else if (task.status === 'summarizing') task = transitionTask(task, 'summarized', { artifact: artifact('summary', await requiredHandler(handlers, 'summarize', task)) });
      else if (task.status === 'summarized') task = transitionTask(task, 'atomizing');
      else if (task.status === 'atomizing') task = transitionTask(task, 'validating', { artifact: artifact('atoms', await requiredHandler(handlers, 'atomize', task)) });
      else if (task.status === 'validating') task = transitionTask(task, 'writing', { artifact: artifact('validated', await requiredHandler(handlers, 'validate', task)) });
      else if (task.status === 'writing') {
        const written = await requiredHandler(handlers, 'write', task);
        task = transitionTask(task, 'written');
        task.written_card_ids = Array.isArray(written) ? written : [];
      } else {
        throw new Error(`pipeline cannot resume from status: ${task.status}`);
      }
      await persist(copyTask(task));
    }
    return task;
  } catch (error) {
    if (TRANSITIONS[task.status]?.has('failed')) {
      task = transitionTask(task, 'failed', {
        error: { stage: task.status, message: error.message, at: new Date().toISOString() }
      });
      await persist(copyTask(task));
    }
    throw error;
  }
}

function artifact(key, path) {
  return { key, path: String(path || '') };
}

async function requiredHandler(handlers, name, task) {
  if (typeof handlers?.[name] !== 'function') throw new Error(`pipeline handler is missing: ${name}`);
  return handlers[name](copyTask(task));
}

function copyTask(task) {
  return Object.assign({}, task, {
    source_aliases: [...(task.source_aliases || [])],
    remote_jobs: [...(task.remote_jobs || [])],
    retry_counts: Object.assign({}, task.retry_counts || {}),
    artifacts: Object.assign({}, task.artifacts || {}),
    written_card_ids: [...(task.written_card_ids || [])],
    review_atom_ids: [...(task.review_atom_ids || [])],
    errors: [...(task.errors || [])],
    progress: Object.assign({}, task.progress || {}),
    lease: task.lease ? Object.assign({}, task.lease) : null
  });
}

module.exports = {
  TRANSITIONS,
  acquireLease,
  createTaskRecord,
  releaseLease,
  retryFailedTask,
  runPipelineTask,
  transitionTask
};

},
"src/core/schema-validator.js": function(require, module, exports) {
function validateSchema(schema, value) {
  const errors = [];
  visit(schema, value, '$', errors);
  return { valid: errors.length === 0, errors };
}

function visit(schema, value, path, errors) {
  if (!schema || typeof schema !== 'object') return;

  if (Object.hasOwn(schema, 'const') && value !== schema.const) {
    errors.push(`${path} must equal ${JSON.stringify(schema.const)}`);
    return;
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    errors.push(`${path} must be one of ${schema.enum.map((item) => JSON.stringify(item)).join(', ')}`);
    return;
  }

  const acceptedTypes = Array.isArray(schema.type) ? schema.type : (schema.type ? [schema.type] : []);
  if (acceptedTypes.length && !acceptedTypes.some((type) => matchesType(type, value))) {
    errors.push(`${path} must be ${acceptedTypes.join(' or ')}`);
    return;
  }

  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${path} is shorter than ${schema.minLength}`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push(`${path} is longer than ${schema.maxLength}`);
    if (schema.pattern && !(new RegExp(schema.pattern).test(value))) errors.push(`${path} does not match ${schema.pattern}`);
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path} is below ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path} is above ${schema.maximum}`);
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${path} has fewer than ${schema.minItems} items`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${path} has more than ${schema.maxItems} items`);
    if (schema.uniqueItems && new Set(value.map(stableValue)).size !== value.length) errors.push(`${path} contains duplicate items`);
    if (schema.items) value.forEach((item, index) => visit(schema.items, item, `${path}[${index}]`, errors));
  }

  if (isObject(value)) {
    for (const key of schema.required || []) {
      if (!Object.hasOwn(value, key)) errors.push(`${path}.${key} is required`);
    }
    const properties = schema.properties || {};
    for (const [key, item] of Object.entries(value)) {
      if (properties[key]) visit(properties[key], item, `${path}.${key}`, errors);
      else if (schema.additionalProperties === false) errors.push(`${path}.${key} is not allowed`);
      else if (isObject(schema.additionalProperties)) visit(schema.additionalProperties, item, `${path}.${key}`, errors);
    }
  }
}

function matchesType(type, value) {
  if (type === 'null') return value === null;
  if (type === 'array') return Array.isArray(value);
  if (type === 'object') return isObject(value);
  if (type === 'integer') return Number.isInteger(value);
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  return typeof value === type;
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function stableValue(value) {
  if (!isObject(value) && !Array.isArray(value)) return `${typeof value}:${String(value)}`;
  if (Array.isArray(value)) return `[${value.map(stableValue).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${key}:${stableValue(value[key])}`).join(',')}}`;
}

module.exports = { validateSchema };


},
"src/core/ai-pipeline.js": function(require, module, exports) {
const { validateSchema } = require("src/core/schema-validator.js");

function buildClassificationPrompt({ classifierPrompt, folderMap, parsePackage }) {
  const whitelist = (folderMap.routes || []).map((route) => ({
    library: route.library,
    folder_type: route.folder_type
  }));
  const fullEvidence = (parsePackage.sections || []).length
    ? parsePackage.sections.map((section) => `## ${section.heading || section.section_id}\n${section.markdown || ''}`).join('\n\n')
    : String(parsePackage.markdown || '');
  const evidence = classificationSample(fullEvidence);
  return [
    classifierPrompt,
    '以下目录是唯一合法白名单。library 与 folder_type 必须精确匹配其中一项，不得新建、翻译或改写目录名：',
    JSON.stringify(whitelist, null, 2),
    '文件元数据：',
    JSON.stringify({
      source_name: parsePackage.source_name,
      source_path: parsePackage.source_path,
      source_type: parsePackage.source_type,
      parser: parsePackage.parser,
      parse_quality: parsePackage.quality
    }, null, 2),
    '解析后的文档内容：',
    evidence,
    '只返回符合 classification.schema.json 的 JSON。'
  ].filter(Boolean).join('\n\n');
}

function classificationSample(markdown, maxChars = 24000) {
  const text = String(markdown || '');
  if (text.length <= maxChars) return text;
  const headingLines = (text.match(/^#{1,6}\s+.+$/gm) || []).join('\n').slice(0, 4000);
  const remaining = Math.max(6000, maxChars - headingLines.length - 120);
  const frontSize = Math.floor(remaining * 0.5);
  const middleSize = Math.floor(remaining * 0.2);
  const endSize = remaining - frontSize - middleSize;
  const middleStart = Math.max(frontSize, Math.floor(text.length / 2 - middleSize / 2));
  const lastHeading = Math.max(text.lastIndexOf('\n# '), text.lastIndexOf('\n## '), text.lastIndexOf('\n### '));
  const sectionTailSize = Math.floor(endSize * 0.6);
  const absoluteTailSize = endSize - sectionTailSize;
  const sectionTail = lastHeading >= 0 ? text.slice(lastHeading + 1, lastHeading + 1 + sectionTailSize) : text.slice(-sectionTailSize);
  return [
    text.slice(0, frontSize),
    '\n\n[文档标题目录汇总]\n', headingLines,
    '\n\n[文档中段代表内容]\n', text.slice(middleStart, middleStart + middleSize),
    '\n\n[最后章节开头]\n', sectionTail,
    '\n\n[文档实际尾部]\n', text.slice(-absoluteTailSize)
  ].join('');
}

async function classifyDocument(options) {
  const basePrompt = buildClassificationPrompt(options);
  const result = await requestWithContract({
    prompt: basePrompt,
    stage: 'classification',
    schema: options.classificationSchema,
    requestJson: options.requestJson,
    maxRepairAttempts: options.maxRepairAttempts,
    onProgress: options.onProgress,
    extraValidation(value) {
      return findRoute(options.folderMap, value) ? [] : ['分类结果不在固定目录白名单'];
    }
  });
  return Object.assign({}, result, findRoute(options.folderMap, result));
}

function findRoute(folderMap, classification) {
  return (folderMap.routes || []).find((route) => route.library === classification.library && route.folder_type === classification.folder_type) || null;
}

function splitMarkdownSections(markdown, options = {}) {
  const source = String(markdown || '');
  const maxChars = Math.max(100, Number(options.maxChars) || 12000);
  if (!source) return [{ chunk_id: 'chunk-001', markdown: '', headings: [] }];
  const tokens = source.match(/[^\n]*\n|[^\n]+$/g) || [source];
  const chunks = [];
  let current = '';

  function flush() {
    if (!current) return;
    chunks.push(current);
    current = '';
  }

  for (const token of tokens) {
    const heading = /^#{1,6}\s+/.test(token);
    if (heading && current && current.length >= maxChars * 0.6) flush();
    if (token.length > maxChars) {
      flush();
      for (let offset = 0; offset < token.length; offset += maxChars) chunks.push(token.slice(offset, offset + maxChars));
      continue;
    }
    if (current && current.length + token.length > maxChars) flush();
    current += token;
  }
  flush();

  return chunks.map((text, index) => ({
    chunk_id: `chunk-${String(index + 1).padStart(3, '0')}`,
    markdown: text,
    headings: [...text.matchAll(/^#{1,6}\s+(.+)$/gm)].map((match) => match[1].trim())
  }));
}

async function summarizeDocument(options) {
  const chunks = splitMarkdownSections(options.parsePackage.markdown, { maxChars: options.maxChunkChars });
  const partials = [];
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    const prompt = [
      options.basePrompt,
      '当前文档类型专用规则：',
      options.typePrompt,
      '分类结果：',
      JSON.stringify(options.classification, null, 2),
      `当前分块 ${chunk.chunk_id}（${index + 1}/${chunks.length}）：`,
      chunk.markdown,
      `coverage.chunk_ids 必须且只能包含 ["${chunk.chunk_id}"]，complete 必须为 true。`,
      '所有面向使用者的内容统一使用简体中文。只返回符合 structured-summary.schema.json 的 JSON。'
    ].filter(Boolean).join('\n\n');
    partials.push(await requestWithContract({
      prompt,
      stage: 'summary-map',
      schema: options.summarySchema,
      requestJson: options.requestJson,
      maxRepairAttempts: options.maxRepairAttempts,
      onProgress: options.onProgress,
      context: { chunk, chunkIndex: index + 1, chunkTotal: chunks.length },
      normalizeValue: (value) => normalizeSummaryMap(value, options, chunk),
      extraValidation: (value) => exactCoverage(value.coverage, 'chunk_ids', [chunk.chunk_id], '总结分块覆盖不完整')
    }));
  }

  if (partials.length === 1) return partials[0];
  if (partials.length > Math.max(2, Number(options.reduceBatchSize) || 8)) {
    return reduceSummaryHierarchy(options, partials, Math.max(2, Number(options.reduceBatchSize) || 8));
  }
  const chunkIds = chunks.map((chunk) => chunk.chunk_id);
  const reducePrompt = [
    options.basePrompt,
    '当前文档类型专用规则：',
    options.typePrompt,
    '请合并以下逐块总结，去重但不得删除任何有证据的独立事实、决策、要求、风险、参数、行动项或经验。',
    '保持每个 key_point 到 evidence_id 的可追溯关系。不得补充逐块总结中不存在的事实。',
    `coverage.chunk_ids 必须完整且只能为：${JSON.stringify(chunkIds)}；complete 必须为 true。`,
    JSON.stringify(partials, null, 2),
    '所有面向使用者的内容统一使用简体中文。只返回符合 structured-summary.schema.json 的 JSON。'
  ].filter(Boolean).join('\n\n');
  try {
    return await requestWithContract({
      prompt: reducePrompt,
      stage: 'summary-reduce',
      schema: options.summarySchema,
      requestJson: options.requestJson,
      maxRepairAttempts: options.maxRepairAttempts,
      onProgress: options.onProgress,
      context: { chunkIds, partialCount: partials.length },
      extraValidation: (value) => exactCoverage(value.coverage, 'chunk_ids', chunkIds, '总结分块覆盖不完整')
    });
  } catch (error) {
    if (error?.code !== 'AI_OUTPUT_TRUNCATED') throw error;
    return mergeStructuredSummaries(partials, chunkIds, options.summarySchema);
  }
}

function normalizeSummaryMap(value, options, chunk) {
  if (!value || typeof value !== 'object') return value;
  const result = Object.assign({}, value, {
    document_title: value.document_title || options.parsePackage.source_name || '结构化总结',
    library: options.classification.library,
    folder_type: options.classification.folder_type,
    document_type: options.classification.document_type,
    coverage: { chunk_ids: [chunk.chunk_id], complete: true }
  });
  if (Array.isArray(result.evidence)) {
    var fallbackLocator = (chunk.headings && chunk.headings.length) ? chunk.headings[0] : chunk.chunk_id;
    var fallbackQuote = String(chunk.markdown || '').slice(0, 200).replace(/\n/g, ' ').trim() || fallbackLocator;
    result.evidence = result.evidence.map(function(item, index) {
      if (!item || typeof item !== 'object') return item;
      return Object.assign({}, item, {
        evidence_id: item.evidence_id || ('evidence-' + (index + 1)),
        locator: item.locator || fallbackLocator,
        quote: item.quote || fallbackQuote
      });
    });
  }
  return result;
}

function mergeStructuredSummaries(partials, chunkIds, schema) {
  const first = partials[0] || {};
  const keyPoints = [];
  const evidence = [];
  const entities = [];
  const suggestedLinks = [];
  for (let index = 0; index < partials.length; index += 1) {
    const partial = partials[index];
    const prefix = (partial.coverage?.chunk_ids || [`part-${index + 1}`]).join('-');
    const evidenceMap = new Map();
    for (let evidenceIndex = 0; evidenceIndex < (partial.evidence || []).length; evidenceIndex += 1) {
      const item = partial.evidence[evidenceIndex];
      const oldId = item.evidence_id || `evidence-${evidenceIndex + 1}`;
      const newId = `${prefix}-${oldId}`;
      evidenceMap.set(oldId, newId);
      evidence.push(Object.assign({}, item, { evidence_id: newId }));
    }
    for (let pointIndex = 0; pointIndex < (partial.key_points || []).length; pointIndex += 1) {
      const point = partial.key_points[pointIndex];
      const oldId = point.point_id || `point-${pointIndex + 1}`;
      keyPoints.push(Object.assign({}, point, {
        point_id: `${prefix}-${oldId}`,
        evidence_ids: (point.evidence_ids || []).map((id) => evidenceMap.get(id) || `${prefix}-${id}`)
      }));
    }
    entities.push(...(partial.entities || []));
    suggestedLinks.push(...(partial.suggested_links || []));
  }
  const merged = applySchemaConstants(schema, {
    document_title: first.document_title || '结构化总结',
    library: first.library,
    folder_type: first.folder_type,
    document_type: first.document_type,
    executive_summary: [...new Set(partials.map((item) => item.executive_summary).filter(Boolean))].join('\n\n'),
    entities,
    key_points: keyPoints,
    evidence,
    suggested_links: suggestedLinks,
    coverage: { chunk_ids: chunkIds, complete: true },
    model_confidence: Math.min(...partials.map((item) => Number(item.model_confidence) || 0)),
    schema_version: '1.1'
  });
  if (Array.isArray(merged.evidence)) {
    var fbTitle = first.document_title || '文档内容';
    merged.evidence = merged.evidence.map(function(item, index) {
      if (!item || typeof item !== 'object') return item;
      return Object.assign({}, item, {
        evidence_id: item.evidence_id || ('evidence-' + (index + 1)),
        locator: item.locator || fbTitle,
        quote: item.quote || fbTitle
      });
    });
  }
  const validation = validateSchema(schema, merged);
  const errors = [...validation.errors, ...exactCoverage(merged.coverage, 'chunk_ids', chunkIds, '总结分块覆盖不完整')];
  if (errors.length) throw new Error(errors.join('；'));
  return merged;
}

async function reduceSummaryHierarchy(options, initial, batchSize) {
  let level = initial;
  let round = 1;
  while (level.length > 1) {
    const next = [];
    for (let offset = 0; offset < level.length; offset += batchSize) {
      const group = level.slice(offset, offset + batchSize);
      if (group.length === 1) {
        next.push(group[0]);
        continue;
      }
      const chunkIds = [...new Set(group.flatMap((item) => item.coverage.chunk_ids))];
      const prompt = [
        options.basePrompt,
        '当前文档类型专用规则：',
        options.typePrompt,
        `这是第 ${round} 轮分层归并。合并以下总结，去重但不得删除任何有证据的独立事实、决策、要求、风险、参数、行动项或经验。`,
        `coverage.chunk_ids 必须完整且只能为：${JSON.stringify(chunkIds)}；complete 必须为 true。`,
        JSON.stringify(group, null, 2),
        '只返回符合 structured-summary.schema.json 的 JSON。'
      ].filter(Boolean).join('\n\n');
      next.push(await requestWithContract({
        prompt,
        stage: 'summary-reduce',
        schema: options.summarySchema,
        requestJson: options.requestJson,
        maxRepairAttempts: options.maxRepairAttempts,
        onProgress: options.onProgress,
        context: { chunkIds, partialCount: group.length, reduceRound: round },
        extraValidation: (value) => exactCoverage(value.coverage, 'chunk_ids', chunkIds, '总结分块覆盖不完整')
      }));
    }
    level = next;
    round += 1;
  }
  return level[0];
}

async function atomizeSummary(options) {
  const pointIds = (options.summary.key_points || []).map((point) => point.point_id);
  const batchSize = Math.max(1, Math.min(3, Number(options.maxPointsPerRequest) || 1));
  const batches = [];
  for (let offset = 0; offset < pointIds.length; offset += batchSize) {
    batches.push(pointIds.slice(offset, offset + batchSize));
  }
  if (!batches.length) batches.push([]);

  const results = [];
  for (let index = 0; index < batches.length; index += 1) {
    const batchPointIds = batches[index];
    const pointSet = new Set(batchPointIds);
    const keyPoints = (options.summary.key_points || []).filter((point) => pointSet.has(point.point_id));
    const evidenceIds = new Set(keyPoints.flatMap((point) => point.evidence_ids || []));
    const batchSummary = Object.assign({}, options.summary, {
      executive_summary: keyPoints.map((point) => point.content).join('；'),
      key_points: keyPoints,
      evidence: (options.summary.evidence || []).filter((item) => evidenceIds.has(item.evidence_id))
    });
    results.push(await atomizeSummaryBatch(options, batchSummary, batchPointIds, index + 1, batches.length));
  }

  if (results.length === 1) return results[0];
  const merged = applySchemaConstants(options.atomSchema, {
    atoms: results.flatMap((result) => result.atoms || []),
    coverage: { point_ids: pointIds, complete: true },
    schema_version: '1.1'
  });
  const validation = validateSchema(options.atomSchema, merged);
  const errors = [...validation.errors, ...exactCoverage(merged.coverage, 'point_ids', pointIds, '知识点覆盖不完整')];
  if (errors.length) throw new Error(errors.join('；'));
  return merged;
}

async function atomizeSummaryBatch(options, summary, pointIds, batchIndex, batchTotal) {
  const prompt = [
    options.atomPrompt,
    'Type Mapping（静态/动态卡片判定只能参考此契约）：',
    options.typeMapping,
    '标签字典（Category / TagL1 / TagL2 只能从中精确选择，不得自造）：',
    options.tagLibrary,
    '结构化总结：',
    JSON.stringify(summary, null, 2),
    '已有知识卡片候选（related_candidates 只能引用这些 card_id；没有明确语义关系时返回空数组）：',
    JSON.stringify((options.linkCandidates || []).map((item) => ({ card_id: item.card_id, title: item.title, path: item.path })), null, 2),
    '允许的关联类型仅为 supports、contradicts、supersedes、depends_on、implements、related。',
    '每个独立且有复用价值的知识点生成一个原子；禁止只描述“召开会议、进行了讨论、应当优化”等空泛内容。',
    '每个原子的 source 必须包含源文件双链、原文定位、逐字证据和父总结双链。',
    `coverage.point_ids 必须完整且只能为：${JSON.stringify(pointIds)}；complete 必须为 true。`,
    `这是知识原子化第 ${batchIndex}/${batchTotal} 批；只处理本批知识点，不得重复其他批次。`,
    '标题和正文统一使用简体中文。只返回符合 knowledge-atoms.schema.json 的 JSON。'
  ].filter(Boolean).join('\n\n');
  return requestWithContract({
    prompt,
    stage: 'atomization',
    schema: options.atomSchema,
    requestJson: options.requestJson,
    maxRepairAttempts: options.maxRepairAttempts,
    onProgress: options.onProgress,
    context: { pointIds, batchIndex, batchTotal },
    normalizeValue: (value) => normalizeAtomBatch(value, summary, pointIds),
    extraValidation: (value) => exactCoverage(value.coverage, 'point_ids', pointIds, '知识点覆盖不完整')
  });
}

function normalizeAtomBatch(value, summary, pointIds) {
  if (!value || typeof value !== 'object') return value;
  const allowed = new Set(pointIds);
  const points = new Map((summary.key_points || []).map((point) => [point.point_id, point]));
  const evidence = new Map((summary.evidence || []).map((item) => [item.evidence_id, item]));
  const byPoint = new Map();
  for (const atom of value.atoms || []) {
    const rawPointIds = Array.isArray(atom?.content?.point_ids) ? atom.content.point_ids : [];
    const matched = rawPointIds.filter((pointId) => allowed.has(pointId));
    if (rawPointIds.length && !matched.length) continue;
    const pointId = matched[0] || (pointIds.length === 1 ? pointIds[0] : '');
    if (!pointId || byPoint.has(pointId)) continue;
    const point = points.get(pointId);
    const evidenceItem = evidence.get(point?.evidence_ids?.[0]) || {};
    byPoint.set(pointId, Object.assign({}, atom, {
      content: Object.assign({}, atom.content || {}, { point_ids: [pointId] }),
      source: Object.assign({}, atom.source || {}, {
        source_link: '[[source]]',
        source_locator: evidenceItem.locator || pointId,
        evidence_quote: evidenceItem.quote || point?.content || '',
        parent_summary: '[[summary]]'
      })
    }));
  }
  return Object.assign({}, value, { atoms: pointIds.map((pointId) => byPoint.get(pointId)).filter(Boolean) });
}

async function requestWithContract(options) {
  const maxRepairs = options.maxRepairAttempts === undefined ? 1 : Math.max(0, Number(options.maxRepairAttempts));
  let prompt = options.prompt;
  let lastErrors = [];
  for (let attempt = 0; attempt <= maxRepairs; attempt += 1) {
    await emitProgress(options.onProgress, Object.assign({}, options.context || {}, {
      stage: options.stage,
      attempt: attempt + 1,
      message: attempt ? '正在修正不符合契约的 AI 结果' : '正在调用 MiniMax M3'
    }));
    let rawValue;
    let value;
    try {
      rawValue = await options.requestJson(prompt, Object.assign({ stage: options.stage, attempt: attempt + 1, schema: options.schema }, options.context || {}));
      value = parseJsonPayload(rawValue);
    } catch (error) {
      if (error?.code !== 'AI_INVALID_JSON') throw error;
      lastErrors = [error.message];
      if (attempt < maxRepairs) {
        prompt = buildRepairPrompt(options.prompt, lastErrors, rawValue);
        continue;
      }
      break;
    }
    value = applySchemaConstants(options.schema, value);
    if (typeof options.normalizeValue === 'function') value = options.normalizeValue(value);
    if (value && typeof value === 'object' && Array.isArray(value.evidence)) {
      var fbLocator = value.document_title || '文档内容';
      value.evidence = value.evidence.map(function(item, index) {
        if (!item || typeof item !== 'object') return item;
        return Object.assign({}, item, {
          evidence_id: item.evidence_id || ('evidence-' + (index + 1)),
          locator: item.locator || fbLocator,
          quote: item.quote || fbLocator
        });
      });
    }
    const validation = validateSchema(options.schema, value);
    lastErrors = [...validation.errors, ...(options.extraValidation ? options.extraValidation(value) : [])];
    if (!lastErrors.length) return value;
    if (attempt < maxRepairs) {
      prompt = buildRepairPrompt(options.prompt, lastErrors, value);
    }
  }
  throw new Error(lastErrors.join('；') || `${options.stage} 结果不符合契约`);
}

function buildRepairPrompt(originalPrompt, errors, previousValue) {
  const previous = typeof previousValue === 'string'
    ? previousValue.slice(0, 12000)
    : JSON.stringify(previousValue, null, 2);
  return [
    originalPrompt,
    '上一次结果未通过校验，请只修正 JSON，不得改变原文事实。',
    `需要修正的问题：${errors.join('；')}`,
    '上一次结果：',
    previous || '未返回可解析内容，请重新输出完整 JSON。'
  ].join('\n\n');
}

function applySchemaConstants(schema, value) {
  if (!schema || typeof schema !== 'object') return value;
  if (Object.hasOwn(schema, 'const')) return schema.const;
  if (Array.isArray(value) && schema.items) {
    return value.map((item) => applySchemaConstants(schema.items, item));
  }
  if (value && typeof value === 'object' && !Array.isArray(value) && schema.properties) {
    const result = Object.assign({}, value);
    for (const [key, propertySchema] of Object.entries(schema.properties)) {
      if (Object.hasOwn(propertySchema || {}, 'const') || Object.hasOwn(result, key)) {
        result[key] = applySchemaConstants(propertySchema, result[key]);
      }
    }
    return result;
  }
  return value;
}

async function requestMiniMaxJson({ settings, prompt, fetchImpl, context }) {
  if (!settings || !settings.minimaxApiKey) throw new Error('MiniMax 国内版 API Key 未配置');
  const fetcher = fetchImpl || globalThis.fetch;
  const endpoint = settings.minimaxEndpoint || 'https://api.minimaxi.com/anthropic/v1/messages';
  const anthropicProtocol = /\/anthropic\/v1\/messages\/?$/i.test(endpoint);
  if (typeof fetcher !== 'function') throw new Error('当前环境不支持网络请求');
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timeoutMs = Math.max(10000, Number(settings.aiRequestTimeoutMs) || 180000);
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  let response;
  try {
    const body = {
      model: settings.minimaxModel || 'MiniMax-M3',
      messages: [
        { role: 'system', content: '你是工程知识处理引擎。严格返回 JSON，不要输出 Markdown 代码围栏。' },
        { role: 'user', content: prompt }
      ],
      max_completion_tokens: 2048,
      reasoning_split: true,
      temperature: context && context.stage === 'classification' ? 0.1 : 0.2
    };
    if (context?.schema) {
      body.tools = [{
        type: 'function',
        function: {
          name: 'return_structured_result',
          description: '返回严格符合参数 Schema 的工程知识处理结果。',
          parameters: context.schema
        }
      }];
      body.tool_choice = 'auto';
    }
    let headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.minimaxApiKey}` };
    if (anthropicProtocol) {
      body.max_tokens = 8192;
      delete body.max_completion_tokens;
      delete body.reasoning_split;
      body.system = '你是工程知识处理引擎。只通过指定工具返回结构化结果，不要输出额外说明。';
      body.messages = [{ role: 'user', content: prompt }];
      if (context?.schema) {
        body.tools = [{
          name: 'return_structured_result',
          description: '返回严格符合输入 Schema 的工程知识处理结果。',
          input_schema: context.schema
        }];
        body.tool_choice = { type: 'tool', name: 'return_structured_result' };
      }
      headers = { 'Content-Type': 'application/json', 'x-api-key': settings.minimaxApiKey, 'anthropic-version': '2023-06-01' };
    }
    response = await fetchWithTransientRetry(fetcher, endpoint, {
      method: 'POST',
      headers,
      signal: controller ? controller.signal : undefined,
      body: JSON.stringify(body)
    }, settings);
  } catch (error) {
    if (error && error.name === 'AbortError') throw new Error(`MiniMax 国内版请求超时（${Math.round(timeoutMs / 1000)} 秒）`);
    throw new Error(`MiniMax 国内版请求失败：${sanitizeError(error)}`);
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (!response.ok) {
    const detail = await safeResponseText(response);
    throw new Error(`MiniMax 国内版请求失败（HTTP ${response.status}）${detail ? `：${detail}` : ''}`);
  }
  const payload = await response.json();
  if (anthropicProtocol) {
    if (payload?.stop_reason === 'max_tokens') {
      throw outputTruncatedError('MiniMax 输出达到 8192 token 上限，结果已截断。');
    }
    const toolUse = (payload?.content || []).find((item) => item?.type === 'tool_use' && item?.name === 'return_structured_result');
    const text = (payload?.content || []).filter((item) => item?.type === 'text').map((item) => item.text || '').join('\n');
    const content = toolUse?.input || text;
    if (!content) throw new Error('MiniMax 国内版返回内容为空');
    return parseJsonPayload(content);
  }
  const choice = payload && payload.choices && payload.choices[0];
  if (choice?.finish_reason === 'length' || choice?.finish_reason === 'max_output') {
    throw outputTruncatedError('MiniMax 输出达到 2048 token 上限，结果已截断；请缩小单批知识点数量后重试。');
  }
  const toolCall = choice?.message?.tool_calls?.find((item) => item?.function?.name === 'return_structured_result');
  const content = toolCall?.function?.arguments || (choice && choice.message && choice.message.content);
  if (!content) throw new Error('MiniMax 国内版返回内容为空');
  return parseJsonPayload(content);
}

function exactCoverage(coverage, key, expected, message) {
  if (!coverage || coverage.complete !== true) return [message];
  const actual = Array.isArray(coverage[key]) ? coverage[key] : [];
  const left = [...new Set(actual)].sort();
  const right = [...new Set(expected)].sort();
  return left.length === right.length && left.every((item, index) => item === right[index]) ? [] : [message];
}

function outputTruncatedError(message) {
  const error = new Error(message);
  error.code = 'AI_OUTPUT_TRUNCATED';
  return error;
}

async function fetchWithTransientRetry(fetcher, endpoint, options, settings) {
  const configuredAttempts = Number(settings?.aiRequestMaxAttempts);
  const maxAttempts = Number.isFinite(configuredAttempts)
    ? Math.min(5, Math.max(1, Math.round(configuredAttempts)))
    : 3;
  const configuredBaseMs = Number(settings?.aiRetryBaseMs);
  const baseMs = Number.isFinite(configuredBaseMs) ? Math.max(0, configuredBaseMs) : 800;
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetcher(endpoint, options);
      if (response.ok || !isTransientHttpStatus(response.status) || attempt === maxAttempts) return response;
      await safeResponseText(response);
    } catch (error) {
      if (error?.name === 'AbortError' || attempt === maxAttempts) throw error;
      lastError = error;
    }
    await sleep(baseMs * (2 ** (attempt - 1)));
  }

  throw lastError || new Error('MiniMax request failed after retries');
}

function isTransientHttpStatus(status) {
  return [408, 425, 429, 500, 502, 503, 504].includes(Number(status));
}

function sleep(ms) {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

function parseJsonPayload(value) {
  if (value && typeof value === 'object') return unwrapTextJson(value);
  let text = String(value || '').trim().replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  try { return JSON.parse(text); } catch {}
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(text.slice(start, end + 1).replace(/,\s*([}\]])/g, '$1')); } catch {}
  }
  const error = new Error('AI 返回内容不是有效 JSON');
  error.code = 'AI_INVALID_JSON';
  throw error;
}

function unwrapTextJson(value) {
  if (Array.isArray(value)) return value.map(unwrapTextJson);
  if (!value || typeof value !== 'object') return value;
  const result = {};
  if (typeof value.$text === 'string') {
    try {
      const parsed = parseJsonPayload(value.$text);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) Object.assign(result, parsed);
    } catch {}
  }
  for (const [key, item] of Object.entries(value)) {
    if (key === '$text') continue;
    result[key] = unwrapTextJson(item);
  }
  return Object.keys(result).length ? result : value;
}

async function safeResponseText(response) {
  try { return String(await response.text()).replace(/\s+/g, ' ').slice(0, 300); } catch { return ''; }
}

function sanitizeError(error) {
  return String(error && error.message ? error.message : error || '未知错误').replace(/(bearer|token|api[_ -]?key)\s*[:=]?\s*\S+/gi, '$1 ***');
}

async function emitProgress(onProgress, payload) {
  if (typeof onProgress === 'function') await onProgress(payload);
}

module.exports = {
  atomizeSummary,
  buildClassificationPrompt,
  classifyDocument,
  classificationSample,
  findRoute,
  parseJsonPayload,
  requestMiniMaxJson,
  requestWithContract,
  splitMarkdownSections,
  summarizeDocument
};

},
"src/core/confidence.js": function(require, module, exports) {
const WEIGHTS = { P: 0.25, T: 0.15, E: 0.35, S: 0.15, A: 0.10 };

function calculateConfidence(input) {
  const hardRules = [];
  const parseMarkdown = normalizeText(input.parsePackage && input.parsePackage.markdown);
  const source = input.atom && input.atom.source ? input.atom.source : {};
  const evidenceQuote = normalizeText(source.evidence_quote);
  const atomText = normalizeText(`${input.atom && input.atom.title || ''} ${flattenContent(input.atom && input.atom.content)}`);

  const P = clamp(input.parsePackage && input.parsePackage.quality && input.parsePackage.quality.score);
  const alternative = Math.max(0, ...((input.classification && input.classification.alternatives) || []).map((item) => Number(item.model_confidence) || 0));
  const modelTypeScore = clamp(input.classification && input.classification.model_confidence);
  const margin = clamp(modelTypeScore - alternative);
  const T = clamp(0.65 * modelTypeScore + 0.2 * (input.routeValid ? 1 : 0) + 0.15 * margin);

  const hasSourceLink = Boolean(String(source.source_link || '').trim());
  const hasLocator = Boolean(String(source.source_locator || '').trim());
  const hasParent = Boolean(String(source.parent_summary || '').trim());
  const quoteFound = Boolean(evidenceQuote) && parseMarkdown.includes(evidenceQuote);
  const numbersGrounded = extractedFacts(atomText).every((item) => evidenceQuote.includes(item) || parseMarkdown.includes(item));
  const E = clamp((hasLocator ? 0.2 : 0) + (hasSourceLink ? 0.1 : 0) + (hasParent ? 0.1 : 0) + (quoteFound ? 0.4 : 0) + (numbersGrounded ? 0.2 : 0));

  const S = clamp((input.schemaValid ? 0.4 : 0) + (input.routeValid ? 0.3 : 0) + (input.labelsValid ? 0.3 : 0));
  const meaningful = atomText.length >= 12 && !isVague(atomText);
  const A = clamp((meaningful ? 0.6 : 0) + (!input.duplicate ? 0.4 : 0));
  const components = { P, T, E, S, A };
  let score = Object.entries(WEIGHTS).reduce((sum, [key, weight]) => sum + components[key] * weight, 0);

  if (P < 0.7) hardRules.push('解析质量低于 0.70，必须重新解析');
  if (!hasSourceLink) hardRules.push('缺少源文件链接');
  if (!hasLocator) hardRules.push('缺少原文定位');
  if (!evidenceQuote) hardRules.push('缺少逐字证据');
  if (!quoteFound) {
    hardRules.push('逐字证据无法在解析文本中定位');
    score = Math.min(score, 0.59);
  }
  if (!numbersGrounded) hardRules.push('知识卡片引入了证据中不存在的数字或日期');
  if (!input.schemaValid || !input.routeValid || !input.labelsValid) {
    hardRules.push('Schema、固定目录或标签字典校验未通过');
    score = Math.min(score, 0.69);
  }
  if (!meaningful) {
    hardRules.push('知识原子内容空泛或信息量不足');
    score = Math.min(score, 0.69);
  }
  if (input.duplicate) {
    hardRules.push('与已有知识卡片重复');
    score = Math.min(score, 0.69);
  }

  score = round(clamp(score));
  const rejected = P < 0.7 || !hasSourceLink || !hasLocator || !evidenceQuote || !numbersGrounded;
  let decision;
  if (rejected) decision = 'reject';
  else if (score >= 0.85 && hardRules.length === 0) decision = 'auto_ingest';
  else if (score >= 0.7) decision = 'review';
  else decision = 'regenerate';

  return {
    score,
    decision,
    components: Object.fromEntries(Object.entries(components).map(([key, value]) => [key, round(value)])),
    weights: WEIGHTS,
    hard_rules: hardRules
  };
}

function extractedFacts(text) {
  return [...new Set(String(text || '').match(/\d+(?:\.\d+)?(?:%|‰|mm|cm|m²|m2|m³|m3|MPa|kN|元|万元|亿元|年|月|日)?/g) || [])];
}

function flattenContent(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(flattenContent).join(' ');
  if (typeof value === 'object') {
    return Object.entries(value)
      .filter(([key]) => key !== 'id' && !/_ids?$/.test(key))
      .map(([, item]) => flattenContent(item))
      .join(' ');
  }
  return '';
}

function isVague(text) {
  return /^(召开|开展|推进|优化|加强|提升|讨论|研究).{0,20}(会议|工作|管理|效率|方案)?[。.]?$/.test(String(text || '').trim());
}

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function clamp(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(1, number));
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

module.exports = { WEIGHTS, calculateConfidence, extractedFacts };

},
"src/core/markdown-renderer.js": function(require, module, exports) {
const { atomFingerprint, cardIdentity } = require("src/core/identity.js");

function buildCardRecord(options) {
  const atom = options.atom;
  const fingerprint = atomFingerprint(atom);
  const cardId = cardIdentity(options.sourceHash, fingerprint);
  const now = typeof options.now === 'string' ? options.now : (options.now || new Date()).toISOString();
  const related = (atom.related_candidates || []).map((item) => typeof item === 'string' ? item : item.target).filter(Boolean);
  const relations = (atom.related_candidates || []).filter((item) => item && typeof item === 'object' && item.target).map((item) => ({
    target: item.target,
    relation: item.relation || 'related'
  }));
  const tags = [...new Set([atom.Category, atom.TagL1, atom.TagL2].filter(Boolean))];
  const sourceLink = String(atom.source && atom.source.source_link || '');
  const sourceFile = sourceLink.replace(/^\[\[/, '').replace(/\]\]$/, '').split('/').pop();
  const card = {
    title: atom.title,
    card_id: cardId,
    atom_fingerprint: fingerprint,
    card_kind: atom.card_kind,
    library: atom.library,
    folder_type: atom.folder_type,
    output_folder: options.route.output_folder,
    status: 'confirmed',
    source_file: sourceFile,
    source_link: sourceLink,
    source_hash: options.sourceHash,
    source_page: atom.source && atom.source.source_locator || '',
    source_locator: atom.source && atom.source.source_locator || '',
    evidence_quote: atom.source && atom.source.evidence_quote || '',
    parent_summary: atom.source && atom.source.parent_summary || '',
    related,
    relations,
    aliases: [],
    tags,
    confidence: options.confidence.score,
    confidence_components: options.confidence.components,
    schema_version: options.versions.schemaVersion,
    pipeline_version: options.versions.pipelineVersion,
    prompt_bundle_version: options.versions.promptBundleVersion,
    created: now,
    updated: now,
    content: atom.content || {}
  };
  for (const key of ['Info_Type', 'Event_Type', 'Category', 'TagL1', 'TagL2', 'project', 'client', 'stage']) {
    if (atom[key]) card[key] = atom[key];
  }
  if (options.supersedes) card.supersedes = options.supersedes;
  return card;
}

function renderKnowledgeCard(card) {
  const frontmatterOrder = [
    'title', 'card_id', 'atom_fingerprint', 'card_kind', 'Info_Type', 'Event_Type', 'library', 'folder_type',
    'output_folder', 'project', 'client', 'stage', 'status', 'Category', 'TagL1', 'TagL2', 'created', 'updated',
    'source_file', 'source_link', 'source_hash', 'source_page', 'parent_summary', 'supersedes', 'superseded_by',
    'related', 'aliases', 'tags', 'confidence', 'confidence_components', 'schema_version', 'pipeline_version', 'prompt_bundle_version'
  ];
  const lines = ['---'];
  for (const key of frontmatterOrder) {
    if (!hasValue(card[key]) && !['related', 'aliases', 'tags'].includes(key)) continue;
    lines.push(`${key}: ${yamlValue(card[key])}`);
  }
  lines.push('---', '', `# ${card.title}`, '');

  if (card.card_kind === 'event') renderEventBody(lines, card.content || {});
  else renderStaticBody(lines, card.content || {});

  lines.push('## 来源证据', '', `- 来源文件：${card.source_link}`, `- 证据位置：${card.source_locator || card.source_page}`, `- 原文摘录：${card.evidence_quote}`, '');
  lines.push('## 关联知识', '', `- 上游总结：${card.parent_summary}`);
  for (const relation of card.content.semantic_links || []) lines.push(`- ${relation.relation || 'related'} ${relation.target || relation.target_card_id || ''}`);
  const relationTargets = new Set();
  for (const relation of card.relations || []) {
    relationTargets.add(relation.target);
    lines.push(`- ${relation.relation || 'related'} ${relation.target}`);
  }
  for (const target of card.related || []) if (!relationTargets.has(target)) lines.push(`- related ${target}`);
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n')}\n`;
}

function renderStaticBody(lines, content) {
  lines.push('## 核心知识', '', content.core_knowledge || content.statement || content.summary || '');
  optionalSection(lines, '适用条件与边界', content.applicable_conditions);
  optionalSection(lines, '关键参数、条款或方法', content.details);
}

function renderEventBody(lines, content) {
  lines.push('## 背景与触发', '', content.background || content.context || '');
  optionalSection(lines, '争议点或讨论问题', content.discussion);
  optionalSection(lines, '已确认方案或结论', content.confirmed_solution || content.decision);
  optionalSection(lines, '未决事项', content.unresolved_items);
  optionalSection(lines, '后续行动', content.action_items);
}

function optionalSection(lines, title, value) {
  if (!hasValue(value)) return;
  lines.push('', `## ${title}`, '', formatBody(value));
}

function formatBody(value) {
  if (Array.isArray(value)) return value.map((item) => `- ${typeof item === 'string' ? item : JSON.stringify(item)}`).join('\n');
  if (value && typeof value === 'object') return Object.entries(value).map(([key, item]) => `- ${key}：${formatBody(item)}`).join('\n');
  return String(value || '');
}

function cardFileName(card) {
  return `${String(card.card_id || 'card-unassigned').replace(/[^a-zA-Z0-9-]/g, '-')}.md`;
}

function renderStructuredSummary(summary, sourceLink) {
  const lines = [
    '---',
    `title: ${yamlValue(summary.document_title)}`,
    'artifact_type: "structured-summary"',
    `library: ${yamlValue(summary.library)}`,
    `folder_type: ${yamlValue(summary.folder_type)}`,
    `document_type: ${yamlValue(summary.document_type)}`,
    `source_link: ${yamlValue(sourceLink)}`,
    `schema_version: ${yamlValue(summary.schema_version)}`,
    '---', '', `# ${summary.document_title}`, '', '## 摘要', '', summary.executive_summary || '', '', '## 结构化要点', ''
  ];
  for (const point of summary.key_points || []) lines.push(`- **${point.kind || '要点'}** ${point.content} ^${point.point_id}`);
  lines.push('', '## 来源证据', '');
  for (const evidence of summary.evidence || []) lines.push(`- ${evidence.locator}：${evidence.quote} ^${evidence.evidence_id}`);
  lines.push('', '## 源文件', '', `- ${sourceLink}`);
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n')}\n`;
}

function yamlValue(value) {
  if (Array.isArray(value)) return JSON.stringify(value);
  if (value && typeof value === 'object') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(String(value === undefined || value === null ? '' : value));
}

function hasValue(value) {
  if (value === undefined || value === null || value === '') return false;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

module.exports = { buildCardRecord, cardFileName, renderKnowledgeCard, renderStructuredSummary, yamlValue };

},
"src/core/link-service.js": function(require, module, exports) {
const RELATION_TYPES = Object.freeze(['supports', 'contradicts', 'supersedes', 'depends_on', 'implements', 'related']);

function findLinkCandidates(atom, cards, options = {}) {
  const limit = Math.min(20, Math.max(1, Number(options.limit) || 20));
  const atomTokens = tokenSet(`${atom.title || ''} ${flatten(atom.content)}`);
  return (cards || []).map((card) => {
    const cardTokens = tokenSet(`${card.title || ''} ${card.text || ''}`);
    let score = intersectionSize(atomTokens, cardTokens) * 2;
    if (atom.Category && atom.Category === card.Category) score += 6;
    if (atom.TagL1 && atom.TagL1 === card.TagL1) score += 3;
    if (atom.TagL2 && atom.TagL2 === card.TagL2) score += 2;
    return Object.assign({}, card, { candidate_score: score });
  }).sort((left, right) => right.candidate_score - left.candidate_score || String(left.card_id).localeCompare(String(right.card_id))).slice(0, limit);
}

function validateRelations(relations, candidates) {
  const candidateIds = new Set((candidates || []).map((item) => item.card_id));
  const valid = [];
  const issues = [];
  for (const relation of relations || []) {
    if (!candidateIds.has(relation.target_card_id)) {
      issues.push(`关联目标不在候选集：${relation.target_card_id}`);
      continue;
    }
    if (!RELATION_TYPES.includes(relation.relation)) {
      issues.push(`不支持的关联类型：${relation.relation}`);
      continue;
    }
    valid.push({ target_card_id: relation.target_card_id, relation: relation.relation });
  }
  return { valid, issues };
}

function tokenSet(text) {
  const normalized = String(text || '').toLowerCase();
  const tokens = normalized.match(/[a-z0-9][a-z0-9_-]+|[\u3400-\u9fff]{2,}/g) || [];
  const set = new Set();
  for (const token of tokens) {
    set.add(token);
    if (/^[\u3400-\u9fff]+$/.test(token)) {
      for (let index = 0; index < token.length - 1; index += 1) set.add(token.slice(index, index + 2));
    }
  }
  return set;
}

function intersectionSize(left, right) {
  let count = 0;
  for (const item of left) if (right.has(item)) count += 1;
  return count;
}

function flatten(value) {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'object') return String(value);
  return Object.values(value).map(flatten).join(' ');
}

module.exports = { RELATION_TYPES, findLinkCandidates, validateRelations };


},
"src/core/workflow.js": function(require, module, exports) {
const { atomizeSummary, classifyDocument, summarizeDocument } = require("src/core/ai-pipeline.js");
const { calculateConfidence } = require("src/core/confidence.js");
const { atomFingerprint } = require("src/core/identity.js");
const { buildCardRecord } = require("src/core/markdown-renderer.js");
const { resolveFixedRoute } = require("src/core/routing.js");
const { findLinkCandidates, validateRelations } = require("src/core/link-service.js");

async function runKnowledgeWorkflow(options) {
  const classification = options.classification || await classifyDocument({
    parsePackage: options.parsePackage,
    folderMap: options.folderMap,
    classifierPrompt: options.prompts.classifier,
    classificationSchema: options.schemas.classification,
    requestJson: options.requestJson,
    onProgress: options.onProgress
  });
  await emitArtifact(options.onArtifact, 'classification', classification);
  const route = resolveFixedRoute(options.folderMap, classification);
  const typePrompt = options.prompts.type || (typeof options.loadTypePrompt === 'function' ? await options.loadTypePrompt(route, classification) : '');
  const summary = options.summary || await summarizeDocument({
    parsePackage: options.parsePackage,
    classification,
    basePrompt: options.prompts.summaryBase,
    typePrompt,
    summarySchema: options.schemas.summary,
    maxChunkChars: options.maxChunkChars,
    maxRepairAttempts: 2,
    requestJson: options.requestJson,
    onProgress: options.onProgress
  });
  await emitArtifact(options.onArtifact, 'summary', summary);
  const linkCandidates = findLinkCandidates({ title: summary.document_title, content: summary }, options.existingCards || [], { limit: 20 });
  const atomResult = options.atomResult || await atomizeSummary({
    summary,
    atomPrompt: options.prompts.atoms,
    typeMapping: options.prompts.typeMapping,
    tagLibrary: options.prompts.tagLibrary,
    linkCandidates,
    atomSchema: options.schemas.atoms,
    requestJson: options.requestJson,
    onProgress: options.onProgress
  });
  await emitArtifact(options.onArtifact, 'atoms', atomResult);

  const existingFingerprints = new Set([
    ...(options.existingFingerprints || []),
    ...(options.existingCards || []).map((card) => card.atom_fingerprint).filter(Boolean)
  ]);
  const accepted = [];
  const review = [];
  for (const atom of atomResult.atoms || []) {
    atom.source = Object.assign({}, atom.source || {}, {
      source_link: `[[${options.parsePackage.source_path}]]`
    });
    reconcileAtomLinks(atom, linkCandidates);
    const fingerprint = atomFingerprint(atom);
    const labelsValid = typeof options.validateLabels === 'function' ? options.validateLabels(atom) : true;
    const routeValid = atom.library === classification.library && atom.folder_type === classification.folder_type;
    const duplicate = existingFingerprints.has(fingerprint);
    const confidence = calculateConfidence({
      parsePackage: options.parsePackage,
      classification,
      atom,
      schemaValid: true,
      routeValid,
      labelsValid,
      duplicate
    });
    const card = buildCardRecord({
      atom,
      route,
      sourceHash: options.sourceHash,
      confidence,
      versions: options.versions,
      now: options.now
    });
    if (confidence.decision === 'auto_ingest') {
      accepted.push(card);
      existingFingerprints.add(fingerprint);
    } else {
      const reasons = [...confidence.hard_rules, ...(atom.validation_issues || [])];
      if (!labelsValid && !reasons.some((reason) => /标签/.test(reason))) reasons.push('标签字典校验未通过');
      if (!routeValid && !reasons.some((reason) => /目录/.test(reason))) reasons.push('知识原子目录与文档分类不一致');
      if (duplicate && !reasons.some((reason) => /重复/.test(reason))) reasons.push('与已有知识卡片重复');
      if (!reasons.length) reasons.push(`可信度 ${confidence.score} 低于自动入库阈值`);
      review.push({
        atom_id: atom.atom_id,
        library: atom.library,
        folder_type: atom.folder_type,
        status: 'pending',
        reasons,
        confidence,
        atom,
        proposed_card: card
      });
    }
  }
  return { classification, route, summary, atomResult, accepted, review };
}

function reconcileAtomLinks(atom, candidates) {
  const validation = validateRelations(atom.related_candidates || [], candidates);
  const byId = new Map(candidates.map((candidate) => [candidate.card_id, candidate]));
  atom.related_candidates = validation.valid.map((relation) => {
    const target = byId.get(relation.target_card_id);
    const path = String(target.path || '').replace(/\.md$/i, '');
    return { target: `[[${path}]]`, relation: relation.relation };
  });
}

async function emitArtifact(handler, name, value) {
  if (typeof handler === 'function') await handler(name, value);
}

module.exports = { runKnowledgeWorkflow };

},
"src/core/review-service.js": function(require, module, exports) {
function groupReviewItems(items) {
  const groups = new Map();
  for (const item of items || []) {
    const issue = [...(item.reasons || [])].sort().join('；') || '其他异常';
    const key = `${item.library || 'unknown'}|${item.folder_type || 'unknown'}|${issue}`;
    if (!groups.has(key)) {
      groups.set(key, {
        group_id: `review-${hashCode(key)}`,
        library: item.library,
        folder_type: item.folder_type,
        reasons: item.reasons || [],
        label: `${item.folder_type || '未分类'} · ${issue}`,
        items: []
      });
    }
    groups.get(key).items.push(item);
  }
  return [...groups.values()].sort((left, right) => right.items.length - left.items.length || left.label.localeCompare(right.label, 'zh-CN'));
}

function applyBatchAction(items, action, correction = {}) {
  const statuses = {
    approve_group: 'approved_override',
    regenerate_group: 'regenerate',
    discard_group: 'discarded',
    apply_correction: 'corrected'
  };
  if (!statuses[action]) throw new Error(`不支持的批量审核操作：${action}`);
  return (items || []).map((item) => {
    const next = clone(item);
    next.status = statuses[action];
    if (action === 'apply_correction') next.atom = Object.assign({}, next.atom || {}, correction);
    return next;
  });
}

function pendingReviewItems(reviewArtifacts) {
  return (reviewArtifacts || []).flatMap((artifact) => artifact.items || []).filter((item) => item.status === 'pending' || item.status === 'corrected');
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function hashCode(value) {
  let hash = 0;
  for (const char of String(value)) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
  return Math.abs(hash).toString(36);
}

module.exports = { applyBatchAction, groupReviewItems, pendingReviewItems };


}
};
const __cache = {};
function __require(id) {
  if (__modules[id]) {
    if (!__cache[id]) {
      const module = { exports: {} };
      __cache[id] = module;
      __modules[id](__require, module, module.exports);
    }
    return __cache[id].exports;
  }
  if (__nativeRequire) return __nativeRequire(id);
  throw new Error('Cannot find module ' + id);
}
module.exports = __require('main.js');
})();

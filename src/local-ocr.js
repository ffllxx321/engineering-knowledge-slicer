'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const CONTRACT_VERSION = 'local_ocr_v1';
const DEFAULT_LIMITS = Object.freeze({
  maxPages: 500,
  maxPageBytes: 24 * 1024 * 1024,
  maxAggregateBytes: 256 * 1024 * 1024,
  maxPixelsPerPage: 40 * 1000 * 1000,
  maxAggregatePixels: 400 * 1000 * 1000,
  maxTextCharsPerPage: 250000,
  maxAggregateTextChars: 2 * 1000 * 1000
});

class LocalOcrError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'LocalOcrError';
    this.code = code;
    this.category = 'local_ocr';
    this.retryable = ['OCR_UNAVAILABLE', 'OCR_RENDER_FAILURE', 'OCR_TIMEOUT'].includes(code);
    this.page = Number(details.page) || undefined;
    this.metrics = details.metrics || undefined;
    if (details.cause) this.cause = details.cause;
  }
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function normalizeSettings(input = {}) {
  const limits = Object.assign({}, DEFAULT_LIMITS, input.limits || {});
  return {
    enabled: input.enabled === true,
    provider: ['auto', 'tesseract', 'executable'].includes(input.provider) ? input.provider : 'auto',
    executable: String(input.executable || '').trim(),
    languages: String(input.languages || 'chi_sim+eng').trim().replace(/[^A-Za-z0-9_+.-]/g, ''),
    concurrency: clampInt(input.concurrency, 1, 4, 2),
    timeoutMs: clampInt(input.timeoutMs, 1000, 600000, 120000),
    qualityThreshold: clampNumber(input.qualityThreshold, 0, 1, 0.72),
    dpi: clampInt(input.dpi, 72, 400, 200),
    limits: {
      maxPages: clampInt(limits.maxPages, 1, 5000, DEFAULT_LIMITS.maxPages),
      maxPageBytes: clampInt(limits.maxPageBytes, 1024, 256 * 1024 * 1024, DEFAULT_LIMITS.maxPageBytes),
      maxAggregateBytes: clampInt(limits.maxAggregateBytes, 1024, 1024 * 1024 * 1024, DEFAULT_LIMITS.maxAggregateBytes),
      maxPixelsPerPage: clampInt(limits.maxPixelsPerPage, 10000, 200 * 1000 * 1000, DEFAULT_LIMITS.maxPixelsPerPage),
      maxAggregatePixels: clampInt(limits.maxAggregatePixels, 10000, 1000 * 1000 * 1000, DEFAULT_LIMITS.maxAggregatePixels),
      maxTextCharsPerPage: clampInt(limits.maxTextCharsPerPage, 1, 2 * 1000 * 1000, DEFAULT_LIMITS.maxTextCharsPerPage),
      maxAggregateTextChars: clampInt(limits.maxAggregateTextChars, 1, 10 * 1000 * 1000, DEFAULT_LIMITS.maxAggregateTextChars)
    }
  };
}

function settingsFingerprint(settings) {
  const safe = normalizeSettings(settings);
  return sha256(stableJson({
    contract: CONTRACT_VERSION,
    provider: safe.provider,
    executable: safe.executable ? path.basename(safe.executable) : '',
    languages: safe.languages,
    qualityThreshold: safe.qualityThreshold,
    dpi: safe.dpi,
    limits: safe.limits
  }));
}

async function probeLocalOcr(settings = {}, dependencies = {}) {
  const config = normalizeSettings(settings);
  if (!config.enabled) return unavailable('disabled', config);
  const candidates = config.provider === 'auto' ? ['tesseract', 'executable'] : [config.provider];
  for (const provider of candidates) {
    if (provider === 'tesseract') {
      const executable = await resolveExecutable(dependencies.tesseractExecutable || 'tesseract', dependencies);
      if (executable) {
        const version = await probeVersion(executable, ['--version'], config.timeoutMs, dependencies);
        if (version.available) return available('tesseract', executable, version.version, config);
      }
    }
    if (provider === 'executable' && config.executable) {
      if (!path.isAbsolute(config.executable)) continue;
      const executable = await resolveExecutable(config.executable, dependencies);
      if (executable) {
        const version = await probeVersion(executable, ['--version'], config.timeoutMs, dependencies);
        if (version.available) return available('executable', executable, version.version, config);
      }
    }
  }
  return unavailable(config.executable ? 'probe_failed' : 'not_configured', config);
}

async function runLocalPdfOcr(input = {}, dependencies = {}) {
  const config = normalizeSettings(input.settings);
  const metrics = {
    pages_total: 0, pages_requested: 0, pages_completed: 0, pages_skipped_native: 0,
    pages_skipped_blank: 0, cache_hits: 0, cache_misses: 0, bytes_rendered: 0,
    pixels_rendered: 0, text_characters: 0, low_confidence_pages: 0, low_confidence_blocks: 0
  };
  checkAbort(input.signal, metrics);
  const probe = input.probe || await probeLocalOcr(config, dependencies);
  if (!probe.available) throw new LocalOcrError('OCR_UNAVAILABLE', '本地 OCR 未启用、未配置或不可用。', { metrics });
  const pages = [...(input.pages || [])].sort((a, b) => Number(a.page) - Number(b.page));
  metrics.pages_total = pages.length;
  if (pages.length > config.limits.maxPages) throw limitError('PDF 页数超过本地 OCR 限制。', metrics);
  const targets = [];
  for (const page of pages) {
    if (page.classification === 'native') metrics.pages_skipped_native += 1;
    else if (page.classification === 'blank') metrics.pages_skipped_blank += 1;
    else if (page.classification === 'scanned' || page.classification === 'mixed') targets.push(page);
  }
  metrics.pages_requested = targets.length;
  const providerVersion = String(probe.version || 'unknown').slice(0, 200);
  const fingerprint = settingsFingerprint(config);
  const sourceHash = String(input.sourceHash || '');
  const results = new Array(targets.length);
  let next = 0;
  let stopped = false;
  const tempRoot = await fs.promises.mkdtemp(path.join(dependencies.tempRoot || os.tmpdir(), 'eks-local-ocr-'));
  try {
    async function worker() {
      while (!stopped) {
        checkAbort(input.signal, metrics);
        const index = next++;
        if (index >= targets.length) return;
        const page = targets[index];
        const cacheKey = checkpointKey(sourceHash, page.page, probe.provider, providerVersion, fingerprint);
        let cached = null;
        if (typeof input.loadCheckpoint === 'function') {
          try { cached = await input.loadCheckpoint(cacheKey, page.page); } catch (_) { cached = null; }
        }
        if (validCheckpoint(cached, { cacheKey, sourceHash, page: page.page, providerVersion, fingerprint, limits: config.limits })) {
          metrics.cache_hits += 1;
          results[index] = cached.result;
          addResultMetrics(metrics, cached.result);
          continue;
        }
        metrics.cache_misses += 1;
        const pageResult = await processPage({
          pdfBuffer: input.pdfBuffer, page, probe, config, tempRoot, signal: input.signal, metrics
        }, dependencies);
        results[index] = pageResult;
        addResultMetrics(metrics, pageResult);
        if (typeof input.saveCheckpoint === 'function') {
          await input.saveCheckpoint(cacheKey, {
            contract: CONTRACT_VERSION, cacheKey, sourceHash, page: page.page,
            provider: probe.provider, providerVersion, settingsFingerprint: fingerprint,
            result: pageResult
          }, page.page);
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(config.concurrency, Math.max(1, targets.length)) }, worker));
  } catch (error) {
    stopped = true;
    if (error instanceof LocalOcrError) throw error;
    throw new LocalOcrError('OCR_MALFORMED_OUTPUT', '本地 OCR 返回无法处理的结果。', { cause: error, metrics });
  } finally {
    await fs.promises.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
  }
  checkAbort(input.signal, metrics);
  return {
    status: 'ok', contract: CONTRACT_VERSION, provider: probe.provider,
    providerVersion, settingsFingerprint: fingerprint, pages: results, metrics
  };
}

async function processPage(context, dependencies) {
  const { page, config, tempRoot, signal, metrics } = context;
  checkAbort(signal, metrics);
  const rendered = typeof dependencies.renderPage === 'function'
    ? await dependencies.renderPage(context)
    : await renderPdfPage(context, dependencies);
  checkAbort(signal, metrics);
  validateRendered(rendered, config.limits, metrics, page.page);
  metrics.bytes_rendered += rendered.bytes;
  metrics.pixels_rendered += rendered.width * rendered.height;
  if (metrics.bytes_rendered > config.limits.maxAggregateBytes || metrics.pixels_rendered > config.limits.maxAggregatePixels) {
    throw limitError('本地 OCR 累计渲染限制已超出。', metrics, page.page);
  }
  let raw;
  if (typeof dependencies.recognizePage === 'function') raw = await dependencies.recognizePage(Object.assign({}, context, { rendered }));
  else raw = await recognizePage(Object.assign({}, context, { rendered }), dependencies);
  checkAbort(signal, metrics);
  const normalized = normalizeOcrResult(raw, page, config);
  if (normalized.text.length > config.limits.maxTextCharsPerPage) throw limitError('单页 OCR 文本超过限制。', metrics, page.page);
  if (metrics.text_characters + normalized.text.length > config.limits.maxAggregateTextChars) throw limitError('OCR 累计文本超过限制。', metrics, page.page);
  return normalized;
}

async function renderPdfPage(context, dependencies) {
  const { pdfBuffer, page, config, tempRoot, signal, metrics } = context;
  if (!Buffer.isBuffer(pdfBuffer)) throw new LocalOcrError('OCR_RENDER_FAILURE', '缺少 PDF 二进制输入。', { page: page.page, metrics });
  const pdfPath = path.join(tempRoot, 'source.pdf');
  try { await fs.promises.access(pdfPath); } catch { await fs.promises.writeFile(pdfPath, pdfBuffer, { mode: 0o600 }); }
  const renderer = await resolveExecutable(dependencies.rendererExecutable || 'pdftoppm', dependencies);
  if (!renderer) throw new LocalOcrError('OCR_RENDER_FAILURE', '未找到本地 PDF 渲染器 pdftoppm。', { page: page.page, metrics });
  const prefix = path.join(tempRoot, `page-${page.page}`);
  await spawnCaptured(renderer, ['-f', String(page.page), '-l', String(page.page), '-singlefile', '-r', String(config.dpi), '-png', pdfPath, prefix], {
    signal, timeoutMs: config.timeoutMs, maxOutputBytes: 64 * 1024, dependencies
  }, 'OCR_RENDER_FAILURE', page.page, metrics);
  const imagePath = `${prefix}.png`;
  const stat = await fs.promises.stat(imagePath).catch(() => null);
  if (!stat || !stat.isFile()) throw new LocalOcrError('OCR_RENDER_FAILURE', 'PDF 渲染器未生成页面图像。', { page: page.page, metrics });
  const dimensions = readPngDimensions(await fs.promises.readFile(imagePath, { encoding: null, flag: 'r' }));
  return { path: imagePath, bytes: stat.size, width: dimensions.width, height: dimensions.height };
}

async function recognizePage(context, dependencies) {
  const { probe, rendered, page, config, signal, metrics } = context;
  if (probe.provider === 'tesseract') {
    const output = await spawnCaptured(probe.executable, [rendered.path, 'stdout', '-l', config.languages, 'tsv'], {
      signal, timeoutMs: config.timeoutMs, maxOutputBytes: config.limits.maxTextCharsPerPage * 8, dependencies
    }, 'OCR_TIMEOUT', page.page, metrics);
    return parseTesseractTsv(output.stdout, config.languages);
  }
  const output = await spawnCaptured(probe.executable, [
    '--input', rendered.path, '--page', String(page.page), '--languages', config.languages, '--format', 'json'
  ], {
    signal, timeoutMs: config.timeoutMs, maxOutputBytes: config.limits.maxTextCharsPerPage * 8, dependencies
  }, 'OCR_TIMEOUT', page.page, metrics);
  try { return JSON.parse(output.stdout); } catch (cause) {
    throw new LocalOcrError('OCR_MALFORMED_OUTPUT', '本地 OCR 可执行程序未返回有效 JSON。', { page: page.page, cause, metrics });
  }
}

function normalizeOcrResult(raw, page, config) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.blocks)) {
    throw new LocalOcrError('OCR_MALFORMED_OUTPUT', '本地 OCR 结果缺少 blocks 数组。', { page: page.page });
  }
  const blocks = raw.blocks.map((block, index) => {
    const text = String(block.text || '').trim();
    const confidence = clampNumber(block.confidence, 0, 1, 0);
    const bbox = validBbox(block.bbox) ? block.bbox.map(Number) : null;
    const visualType = normalizeVisualType(block.visual_type || block.kind);
    const eligible = !!text && confidence >= config.qualityThreshold && !visualType;
    return {
      text, confidence, bbox, language: String(block.language || raw.language || config.languages || 'unknown').slice(0, 64),
      locator: {
        scheme: 'pdf-quote', value: `page:${page.page}:ocr:${index + 1}`,
        page: Number(page.page), bbox, rotation: normalizeRotation(page.rotation),
        image_locator: page.image_locators?.[0] || null,
        quote_hash: sha256(text)
      },
      raw_fields: block.raw_fields && typeof block.raw_fields === 'object' ? block.raw_fields : {},
      inferred: block.inferred && typeof block.inferred === 'object' ? block.inferred : {},
      visual_type: visualType,
      card_eligible: eligible,
      exclusion_reason: visualType ? `unverified_${visualType}` : (!text ? 'empty_ocr' : (confidence < config.qualityThreshold ? 'low_confidence_ocr' : null))
    };
  });
  const text = blocks.filter((block) => block.text).map((block) => block.text).join('\n');
  const confidence = blocks.length ? blocks.reduce((sum, block) => sum + block.confidence, 0) / blocks.length : 0;
  return {
    page: Number(page.page), classification: page.classification, rotation: normalizeRotation(page.rotation),
    text, confidence: Number(confidence.toFixed(6)), language: String(raw.language || config.languages || 'unknown').slice(0, 64),
    blocks, image_locators: page.image_locators || [],
    status: text ? (confidence >= config.qualityThreshold ? 'ok' : 'low_confidence') : 'empty'
  };
}

function parseTesseractTsv(tsv, language) {
  const lines = String(tsv || '').split(/\r?\n/);
  if (!/^level\tpage_num\tblock_num/.test(lines[0] || '')) throw new LocalOcrError('OCR_MALFORMED_OUTPUT', 'Tesseract TSV 头无效。');
  const blocks = [];
  for (const line of lines.slice(1)) {
    const cols = line.split('\t');
    if (cols.length < 12 || cols[0] !== '5') continue;
    const text = cols.slice(11).join('\t').trim();
    if (!text) continue;
    const left = Number(cols[6]); const top = Number(cols[7]); const width = Number(cols[8]); const height = Number(cols[9]);
    const rawConfidence = Number(cols[10]);
    blocks.push({ text, confidence: rawConfidence < 0 ? 0 : rawConfidence / 100, bbox: [left, top, left + width, top + height], language });
  }
  return { language, blocks };
}

function validCheckpoint(value, expected) {
  if (!value || value.contract !== CONTRACT_VERSION || value.cacheKey !== expected.cacheKey ||
      value.sourceHash !== expected.sourceHash || Number(value.page) !== Number(expected.page) ||
      value.providerVersion !== expected.providerVersion || value.settingsFingerprint !== expected.fingerprint) return false;
  try {
    const result = value.result;
    if (!result || Number(result.page) !== Number(expected.page) || !Array.isArray(result.blocks) || typeof result.text !== 'string') return false;
    if (result.text.length > expected.limits.maxTextCharsPerPage) return false;
    return result.blocks.every((block) => typeof block.text === 'string' && Number.isFinite(block.confidence) && block.confidence >= 0 && block.confidence <= 1);
  } catch { return false; }
}

function checkpointKey(sourceHash, page, provider, providerVersion, fingerprint) {
  return `ocr-page-${sha256(`${sourceHash}\0${page}\0${provider}\0${providerVersion}\0${fingerprint}`).slice(0, 32)}`;
}

async function spawnCaptured(executable, args, options, failureCode, page, metrics) {
  if (!path.isAbsolute(executable)) throw new LocalOcrError('OCR_UNAVAILABLE', 'OCR 可执行文件必须解析为绝对路径。', { page, metrics });
  const spawnImpl = options.dependencies.spawn || spawn;
  return new Promise((resolve, reject) => {
    let settled = false; let stdout = ''; let stderr = ''; let outputBytes = 0; let timedOut = false;
    const child = spawnImpl(executable, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      if (error) reject(error); else resolve(result);
    };
    const stop = () => { try { child.kill('SIGKILL'); } catch (_) {} };
    const onAbort = () => {
      stop();
      finish(new LocalOcrError('OCR_CANCELLED', '本地 OCR 已取消。', { page, metrics }));
    };
    const timer = setTimeout(() => {
      timedOut = true; stop();
      finish(new LocalOcrError('OCR_TIMEOUT', '本地 OCR 执行超时。', { page, metrics }));
    }, options.timeoutMs);
    options.signal?.addEventListener('abort', onAbort, { once: true });
    for (const [stream, append] of [[child.stdout, (s) => { stdout += s; }], [child.stderr, (s) => { stderr += s; }]]) {
      stream?.on('data', (chunk) => {
        outputBytes += chunk.length;
        if (outputBytes > options.maxOutputBytes) {
          stop();
          finish(limitError('OCR 子进程输出超过限制。', metrics, page));
        } else append(chunk.toString('utf8'));
      });
    }
    child.on('error', (cause) => finish(new LocalOcrError(failureCode, '本地 OCR 子进程启动失败。', { page, cause, metrics })));
    child.on('close', (code) => {
      if (timedOut || settled) return;
      if (code !== 0) finish(new LocalOcrError(failureCode, `本地 OCR 子进程失败（退出码 ${Number(code)}）。`, { page, metrics }));
      else finish(null, { stdout, stderr: stderr.slice(0, 1024), code });
    });
  });
}

async function resolveExecutable(command, dependencies = {}) {
  if (typeof dependencies.resolveExecutable === 'function') return dependencies.resolveExecutable(command);
  const value = String(command || '');
  if (!value || /[\0\r\n]/.test(value)) return null;
  if (path.isAbsolute(value)) return validateExecutable(value);
  if (value.includes('/') || value.includes('\\')) return null;
  for (const directory of String(process.env.PATH || '').split(path.delimiter)) {
    if (!directory) continue;
    const candidate = path.resolve(directory, value);
    if (await validateExecutable(candidate)) return candidate;
  }
  return null;
}

async function validateExecutable(candidate) {
  try {
    const stat = await fs.promises.stat(candidate);
    if (!stat.isFile()) return null;
    await fs.promises.access(candidate, fs.constants.X_OK);
    return await fs.promises.realpath(candidate);
  } catch { return null; }
}

async function probeVersion(executable, args, timeoutMs, dependencies) {
  try {
    const result = await spawnCaptured(executable, args, {
      timeoutMs: Math.min(timeoutMs, 10000), maxOutputBytes: 64 * 1024, dependencies
    }, 'OCR_UNAVAILABLE');
    const version = `${result.stdout}\n${result.stderr}`.trim().split(/\r?\n/)[0] || path.basename(executable);
    return { available: true, version: version.slice(0, 200) };
  } catch { return { available: false, version: '' }; }
}

function readPngDimensions(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 24 || buffer.subarray(1, 4).toString() !== 'PNG') {
    throw new LocalOcrError('OCR_RENDER_FAILURE', '渲染图像不是有效 PNG。');
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function validateRendered(rendered, limits, metrics, page) {
  if (!rendered || !rendered.path || !Number.isFinite(rendered.bytes) || !Number.isFinite(rendered.width) || !Number.isFinite(rendered.height)) {
    throw new LocalOcrError('OCR_RENDER_FAILURE', '渲染结果字段不完整。', { page, metrics });
  }
  const pixels = rendered.width * rendered.height;
  if (rendered.bytes > limits.maxPageBytes || pixels > limits.maxPixelsPerPage) throw limitError('单页 OCR 渲染限制已超出。', metrics, page);
}

function addResultMetrics(metrics, result) {
  metrics.pages_completed += 1;
  metrics.text_characters += result.text.length;
  if (result.status === 'low_confidence') metrics.low_confidence_pages += 1;
  metrics.low_confidence_blocks += result.blocks.filter((block) => block.exclusion_reason === 'low_confidence_ocr').length;
}

function checkAbort(signal, metrics) {
  if (signal?.aborted) throw new LocalOcrError('OCR_CANCELLED', '本地 OCR 已取消。', { metrics });
}

function limitError(message, metrics, page) {
  return new LocalOcrError('OCR_LIMITS_EXCEEDED', message, { metrics, page });
}

function available(provider, executable, version, settings) {
  return { available: true, contract: CONTRACT_VERSION, provider, executable, version, settingsFingerprint: settingsFingerprint(settings) };
}

function unavailable(reason, settings) {
  return { available: false, contract: CONTRACT_VERSION, provider: settings.provider, reason, settingsFingerprint: settingsFingerprint(settings) };
}

function normalizeVisualType(value) {
  const text = String(value || '').toLowerCase();
  if (/stamp|seal|印章|盖章/.test(text)) return 'stamp';
  if (/signature|签名|签字/.test(text)) return 'signature';
  if (/approval|批准|审批/.test(text)) return 'approval_visual';
  return '';
}

function normalizeRotation(value) {
  const rotation = Number(value) || 0;
  return ((rotation % 360) + 360) % 360;
}

function validBbox(value) {
  return Array.isArray(value) && value.length === 4 && value.every((item) => Number.isFinite(Number(item)));
}

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : fallback;
}

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}

module.exports = {
  CONTRACT_VERSION, DEFAULT_LIMITS, LocalOcrError, checkpointKey, normalizeOcrResult,
  normalizeSettings, parseTesseractTsv, probeLocalOcr, runLocalPdfOcr,
  settingsFingerprint, validCheckpoint
};

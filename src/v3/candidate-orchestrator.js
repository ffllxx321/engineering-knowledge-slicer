// @ts-nocheck -- Obsidian runtime structures are verified by unit and official-host gates.
'use strict';

const { sha256, validateParseResult } = require('./contracts');
const { ARTIFACT_SCHEMA, CANDIDATE_SCHEMA, PROMPT_VERSION, factSignature, normalizeProposal, validateCandidate } = require('./candidate-contract');
const { MANIFEST_PATH: PHASE1_MANIFEST_PATH, V3Phase1Orchestrator } = require('./orchestrator');

const PHASE2_ROOT = 'Engineering Knowledge Slicer/v3-phase2';
const PHASE2_STATE_ROOT = `${PHASE2_ROOT}/state/v1`;
const PHASE2_OUTPUT_ROOT = `${PHASE2_ROOT}/experimental-output/v1`;
const PHASE2_MANIFEST_PATH = `${PHASE2_STATE_ROOT}/manifests/current-run.json`;
const CACHE_ROOT = `${PHASE2_STATE_ROOT}/model-cache`;
const RESUME_ROOT = `${PHASE2_STATE_ROOT}/runs`;
const CANDIDATE_ARTIFACT_SCHEMA = ARTIFACT_SCHEMA;

const SYSTEM_PROMPT = `你是施工总承包企业的知识候选整理器。只根据给定块及其ID，把可复用事实整理为中文候选。不得补充、推断或改写数字、单位、日期、版本、名称、标准条款、例外和义务。翻译不确定时使用安全直译并标记 uncertain_literal。每项只表达一个独立主题或义务。返回严格JSON：{"proposals":[{"title_zh":"","body_zh":"","knowledge_kind":"requirement|procedure|acceptance|risk|method|definition|reference|lesson","reusable_scope":"project|trade|organization|general","block_ids":[""],"evidence":{"块ID":"原文紧凑片段"},"translation_status":"original_zh|translated|uncertain_literal|mixed_normalized","confidence":{"evidence":0,"completeness":0,"translation":0},"warnings":[]}],"rejections":[{"block_ids":[""],"reason_zh":""}]}`;

function cacheKey(sourceHash, schema, promptVersion, model) { return sha256(JSON.stringify([sourceHash, schema, promptVersion, model])); }
function eligible(block) {
  const text = String(block.content || '').trim();
  if (!text) return '空白内容';
  if (/^(目录|目次|table of contents)\b/i.test(text) || /\.{3,}\s*\d+$/m.test(text)) return '目录内容不可作为知识';
  if (/^(第?\s*\d+\s*页|page\s+\d+|页眉|页脚)$/i.test(text)) return '页眉页脚或页码不可作为知识';
  if (/(unsubscribe|退订|tracking pixel|view in browser|查看网页版)/i.test(text)) return '营销退订或跟踪噪声不可作为知识';
  if (text.length < 8) return '内容过短，缺少可复用知识';
  return null;
}
function stableBatches(blocks, size = 8) {
  const result = []; for (let i = 0; i < blocks.length; i += size) result.push({ id: `batch-${String(i / size + 1).padStart(4, '0')}`, blocks: blocks.slice(i, i + size) }); return result;
}
function sanitizeReason(error) { return String(error?.message || error || '未知错误').replace(/(?:sk|key|ghp|eyJ)[-_A-Za-z0-9.]{12,}/g, '[已隐藏]').slice(0, 300); }
function providerRecord(status, model, started, inputSize, outputSize, reason) { return { adapter: 'v3-candidate-provider', status, duration_ms: Math.max(0, Date.now() - started), model,
  input_size: inputSize, output_size: outputSize, reason: sanitizeReason(reason) }; }

function consolidate(candidates) {
  const result = [];
  for (const candidate of candidates.sort((a, b) => a.id.localeCompare(b.id))) {
    const evidenceIds = new Set(candidate.evidence.map((e) => e.block_id));
    const compatible = result.find((prior) => prior.knowledge_kind === candidate.knowledge_kind && prior.reusable_scope === candidate.reusable_scope
      && factSignature(prior.facts) === factSignature(candidate.facts) && prior.evidence.some((e) => evidenceIds.has(e.block_id)));
    if (!compatible) { result.push(candidate); continue; }
    compatible.evidence = [...compatible.evidence, ...candidate.evidence].filter((item, index, all) => all.findIndex((x) => x.block_id === item.block_id && x.original === item.original) === index);
    compatible.warnings = [...new Set([...compatible.warnings, ...candidate.warnings])];
    compatible.body_zh = compatible.body_zh.length >= candidate.body_zh.length ? compatible.body_zh : candidate.body_zh;
    compatible.title_zh = compatible.title_zh.length >= candidate.title_zh.length ? compatible.title_zh : candidate.title_zh;
    compatible.id = require('./candidate-contract').stableCandidateId(compatible);
  }
  return result;
}

class V3Phase2CandidateOrchestrator {
  constructor(vault, options = {}) { this.vault = vault; this.provider = options.provider; this.model = String(options.model || 'configured-provider'); this.batchSize = options.batchSize || 8; }

  async processLatest(runId = `v3-p2-${Date.now().toString(36)}`) {
    const binding = await this.loadPhase1Binding(); const sourceHash = binding.parse.source.sha256;
    const key = cacheKey(sourceHash, CANDIDATE_SCHEMA, PROMPT_VERSION, this.model);
    const manifest = { schema: 'eks/v3/phase2-manifest/1', run_id: runId, state: 'running', source_phase1: binding.bound,
      candidate_schema: CANDIDATE_SCHEMA, prompt_version: PROMPT_VERSION, model: this.model, attempts: [], counts: null, final: null, error: null };
    await this.write(PHASE2_MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
    try {
      const deterministicRejected = []; const blocks = [];
      for (const block of binding.parse.blocks) { const reason = eligible(block); if (reason) deterministicRejected.push({ block_ids: [block.id], reason_zh: reason }); else blocks.push(block); }
      const blockMap = new Map(binding.parse.blocks.map((block) => [block.id, block]));
      const batches = stableBatches(blocks, this.batchSize); const proposed = []; const rejected = [...deterministicRejected];
      for (const batch of batches) {
        const resumePath = `${RESUME_ROOT}/${key}/${batch.id}.json`; let response = await this.readValidatedResponse(resumePath, batch, blockMap);
        if (response) manifest.attempts.push(providerRecord('skipped', this.model, Date.now(), 0, Buffer.byteLength(JSON.stringify(response)), '已验证的同批次续传产物'));
        else {
          const cachePath = `${CACHE_ROOT}/${key}/${batch.id}.json`; response = await this.readValidatedResponse(cachePath, batch, blockMap);
          if (response) manifest.attempts.push(providerRecord('skipped', this.model, Date.now(), 0, Buffer.byteLength(JSON.stringify(response)), '命中已验证缓存'));
          else {
            if (!this.provider || typeof this.provider.request !== 'function') throw new Error('未配置 Phase 2 候选 provider');
            const payload = { schema: CANDIDATE_SCHEMA, source: binding.parse.source, blocks: batch.blocks };
            const input = `${SYSTEM_PROMPT}\n\n${JSON.stringify(payload)}`; const started = Date.now();
            manifest.attempts.push(providerRecord('attempted', this.model, started, Buffer.byteLength(input), 0, '开始请求'));
            try {
              const raw = await this.provider.request(input, { model: this.model, batch_id: batch.id, prompt_version: PROMPT_VERSION });
              const output = typeof raw === 'string' ? raw : JSON.stringify(raw); response = JSON.parse(output);
              this.validateResponse(response, batch, blockMap);
              manifest.attempts.push(providerRecord('succeeded', this.model, started, Buffer.byteLength(input), Buffer.byteLength(output), '响应合同有效'));
              await this.write(cachePath, `${JSON.stringify(response, null, 2)}\n`); await this.write(resumePath, `${JSON.stringify(response, null, 2)}\n`);
            } catch (error) { manifest.attempts.push(providerRecord('failed', this.model, started, Buffer.byteLength(input), 0, error)); throw error; }
          }
        }
        for (const raw of response.proposals) { try { proposed.push(normalizeProposal(raw, binding.parse.source, blockMap)); } catch (error) { rejected.push({ block_ids: raw.block_ids || [], reason_zh: sanitizeReason(error) }); } }
        for (const item of response.rejections || []) rejected.push({ block_ids: item.block_ids || [], reason_zh: String(item.reason_zh || '模型未提供可复用知识').slice(0, 200) });
      }
      const accepted = consolidate(proposed); if (!accepted.length) throw new Error('没有通过质量门的候选知识');
      const covered = new Set([...accepted.flatMap((c) => c.evidence.map((e) => e.block_id)), ...rejected.flatMap((r) => r.block_ids)]);
      const uncovered = blocks.filter((block) => !covered.has(block.id)).map((block) => block.id);
      for (const id of uncovered) rejected.push({ block_ids: [id], reason_zh: '模型响应未覆盖该有效来源块' });
      const artifact = { schema: ARTIFACT_SCHEMA, source_phase1: binding.bound, candidate_schema: CANDIDATE_SCHEMA, prompt_version: PROMPT_VERSION,
        model: this.model, candidates: accepted, rejected, audit: { source_blocks: binding.parse.blocks.length, proposed: proposed.length, accepted: accepted.length,
          rejected: rejected.length, consolidated: proposed.length - accepted.length, uncovered_eligible_blocks: uncovered.length } };
      for (const candidate of artifact.candidates) validateCandidate(candidate, binding.parse.source, blockMap);
      const slug = sourceHash.slice(0, 16); const artifactPath = `${PHASE2_OUTPUT_ROOT}/${slug}.candidates.json`; const previewPath = `${PHASE2_OUTPUT_ROOT}/${slug}.preview.md`;
      const artifactText = `${JSON.stringify(artifact, null, 2)}\n`; const preview = renderPreview(artifact);
      await this.write(artifactPath, artifactText); await this.verify(artifactPath, sha256(artifactText));
      await this.write(previewPath, preview); await this.verify(previewPath, sha256(preview));
      manifest.counts = artifact.audit; manifest.final = { artifact: { path: artifactPath, sha256: sha256(artifactText) }, preview: { path: previewPath, sha256: sha256(preview) } }; manifest.state = 'committed';
      await this.write(PHASE2_MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
      if (!(await V3Phase2CandidateOrchestrator.completionFromManifest(this.vault))) throw new Error('Phase 2 完成权威校验失败');
      return { manifest, artifact };
    } catch (error) { manifest.state = 'failed'; manifest.error = { message: sanitizeReason(error) }; await this.write(PHASE2_MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`).catch(() => {}); throw Object.assign(error, { manifest }); }
  }

  async loadPhase1Binding() {
    if (!(await V3Phase1Orchestrator.completionFromManifest(this.vault))) throw new Error('Phase 1 清单未提交、不可重开或哈希无效');
    const manifestText = await this.vault.read(this.vault.getAbstractFileByPath(PHASE1_MANIFEST_PATH)); const manifest = JSON.parse(manifestText);
    const artifactText = await this.vault.read(this.vault.getAbstractFileByPath(manifest.parse_artifact.path)); const parse = validateParseResult(JSON.parse(artifactText));
    return { parse, bound: { manifest_path: PHASE1_MANIFEST_PATH, manifest_sha256: sha256(manifestText),
      parse_artifact_path: manifest.parse_artifact.path, parse_artifact_sha256: manifest.parse_artifact.sha256, preview_path: manifest.final.path, preview_sha256: manifest.final.sha256,
      source_sha256: parse.source.sha256 } };
  }
  validateResponse(response, batch, blockMap) {
    if (!response || !Array.isArray(response.proposals) || !Array.isArray(response.rejections)) throw new Error('provider JSON 合同无效');
    const allowed = new Set(batch.blocks.map((b) => b.id));
    for (const item of [...response.proposals, ...response.rejections]) if (!(item.block_ids || []).length || item.block_ids.some((id) => !allowed.has(id) || !blockMap.has(id))) throw new Error('provider 返回了虚构证据');
    return response;
  }
  async readValidatedResponse(path, batch, blockMap) { const file = this.vault.getAbstractFileByPath(path); if (!file) return null; try { const parsed = JSON.parse(await this.vault.read(file)); return this.validateResponse(parsed, batch, blockMap); } catch (_) { return null; } }
  async verify(path, hash) { const file = this.vault.getAbstractFileByPath(path); if (!file) throw new Error(`无法重开：${path}`); if (sha256(await this.vault.read(file)) !== hash) throw new Error(`哈希不匹配：${path}`); }
  async ensureParent(path) { let current = ''; for (const part of path.split('/').slice(0, -1)) { current = current ? `${current}/${part}` : part; if (!this.vault.getAbstractFileByPath(current)) try { await this.vault.createFolder(current); } catch (error) { if (!/already exists/i.test(sanitizeReason(error))) throw error; } } }
  async write(path, content) { await this.ensureParent(path); const existing = this.vault.getAbstractFileByPath(path); if (existing) return this.vault.modify(existing, content); return this.vault.create(path, content); }

  static async completionFromManifest(vault) {
    try {
      const file = vault.getAbstractFileByPath(PHASE2_MANIFEST_PATH); if (!file) return false; const manifest = JSON.parse(await vault.read(file));
      if (manifest.schema !== 'eks/v3/phase2-manifest/1' || manifest.state !== 'committed' || !manifest.final?.artifact || !manifest.final?.preview) return false;
      if (!(await V3Phase1Orchestrator.completionFromManifest(vault))) return false;
      const phase1Text = await vault.read(vault.getAbstractFileByPath(PHASE1_MANIFEST_PATH)); const phase1 = JSON.parse(phase1Text);
      if (manifest.source_phase1.manifest_sha256 !== sha256(phase1Text)) return false;
      if (manifest.source_phase1.parse_artifact_sha256 !== phase1.parse_artifact.sha256 || manifest.source_phase1.preview_sha256 !== phase1.final.sha256) return false;
      const artifactFile = vault.getAbstractFileByPath(manifest.final.artifact.path); const previewFile = vault.getAbstractFileByPath(manifest.final.preview.path); if (!artifactFile || !previewFile) return false;
      const artifactText = await vault.read(artifactFile); const artifact = JSON.parse(artifactText); if (artifact.schema !== ARTIFACT_SCHEMA || !artifact.candidates?.length) return false;
      return sha256(artifactText) === manifest.final.artifact.sha256 && sha256(await vault.read(previewFile)) === manifest.final.preview.sha256;
    } catch (_) { return false; }
  }
}

function renderPreview(artifact) {
  const rows = artifact.candidates.map((c) => `## ${c.title_zh}\n\n${c.body_zh}\n\n- 类型：${c.knowledge_kind}\n- 复用范围：${c.reusable_scope}\n- 证据：${c.evidence.map((e) => `${e.block_id}（${JSON.stringify(e.locator)}）`).join('；')}\n- 原文：${c.evidence.map((e) => e.original).join(' / ')}\n- 翻译状态：${c.translation_status}\n- 警告：${c.warnings.join('；') || '无'}\n`).join('\n');
  const rejects = artifact.rejected.map((r) => `- ${r.block_ids.join('、') || '未知块'}：${r.reason_zh}`).join('\n') || '- 无';
  return `---\neks_schema: eks/v3/candidate-preview/1\nsource_sha256: ${artifact.source_phase1.source_sha256}\n---\n\n# 实验性候选知识预览\n\n> 仅供 Phase 2 实验验证，不是最终知识库内容。\n\n${rows}\n## 拒绝记录\n\n${rejects}\n`;
}

module.exports = { CACHE_ROOT, CANDIDATE_ARTIFACT_SCHEMA, PHASE2_MANIFEST_PATH, PHASE2_OUTPUT_ROOT, PHASE2_ROOT, PHASE2_STATE_ROOT, RESUME_ROOT,
  SYSTEM_PROMPT, V3Phase2CandidateOrchestrator, cacheKey, consolidate, eligible, providerRecord, renderPreview, stableBatches };

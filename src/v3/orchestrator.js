// @ts-nocheck -- Obsidian runtime types are structurally verified by the real-host gate.
'use strict';

const { selectAndParse } = require('./adapters');
const { sha256, transition, validateParseResult } = require('./contracts');

const ROOT = 'Engineering Knowledge Slicer/v3-phase1/state';
const STAGING_ROOT = `${ROOT}/staging`;
const OUTPUT_ROOT = 'Engineering Knowledge Slicer/v3-phase1/verified-output';
const ARTIFACT_ROOT = 'Engineering Knowledge Slicer/v3-phase1/verified-artifacts';
const MANIFEST_PATH = `${ROOT}/manifests/current-run.json`;

class V3Phase1Orchestrator {
  constructor(vault, options = {}) {
    this.vault = vault;
    this.options = options;
  }

  async process(file, runId = `v3-${Date.now().toString(36)}`) {
    const manifest = { schema: 'eks/v3/run-manifest/1', run_id: runId, state: 'queued', source_path: file.path,
      transitions: [{ state: 'queued', at: new Date().toISOString() }], attempts: [], final: null, error: null };
    await this.persist(manifest);
    try {
      transition(manifest, 'reading'); await this.persist(manifest);
      const bytes = Buffer.from(await this.vault.readBinary(file));
      const extension = String(file.extension || file.path.split('.').pop() || '').toLowerCase();
      const source = { path: file.path, name: file.name || file.path.split('/').pop(), extension, bytes };
      transition(manifest, 'parsing'); await this.persist(manifest);
      const parsed = await selectAndParse(source, this.options);
      manifest.attempts = parsed.attempts;
      transition(manifest, 'validating'); validateParseResult(parsed.result); await this.persist(manifest);
      const markdown = renderMarkdown(parsed.result);
      const hash = sha256(markdown);
      const identity = parsed.result.source.sha256.slice(0, 16);
      const safeName = String(file.basename || file.name || 'source').replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|#^[\]]/g, '_').slice(0, 80);
      const stagingPath = `${STAGING_ROOT}/${runId}/${safeName}-${identity}.md`;
      const finalPath = `${OUTPUT_ROOT}/${safeName}-${identity}.md`;
      const artifactPath = `${ARTIFACT_ROOT}/${safeName}-${identity}.json`;
      const artifactText = `${JSON.stringify(parsed.result, null, 2)}\n`;
      const artifactHash = sha256(artifactText);
      transition(manifest, 'staging', { path: stagingPath }); await this.persist(manifest);
      await this.write(stagingPath, markdown);
      transition(manifest, 'verifying', { path: stagingPath, sha256: hash }); await this.persist(manifest);
      await this.verify(stagingPath, markdown, hash);
      const existing = this.vault.getAbstractFileByPath(finalPath);
      if (existing) {
        const existingText = await this.vault.read(existing);
        if (sha256(existingText) !== hash) throw new Error(`V3_IDEMPOTENCY_CONFLICT:${finalPath}`);
        const staged = this.vault.getAbstractFileByPath(stagingPath);
        if (staged) await this.vault.delete(staged, true);
      } else {
        const staged = this.vault.getAbstractFileByPath(stagingPath);
        if (!staged) throw new Error(`V3_STAGING_REOPEN_FAILED:${stagingPath}`);
        await this.ensureParent(finalPath);
        await this.vault.rename(staged, finalPath);
      }
      await this.verify(finalPath, markdown, hash);
      await this.write(artifactPath, artifactText);
      await this.verify(artifactPath, artifactText, artifactHash);
      manifest.final = { path: finalPath, sha256: hash, byte_size: Buffer.byteLength(markdown), reopenable: true };
      manifest.parse_artifact = { path: artifactPath, sha256: artifactHash, byte_size: Buffer.byteLength(artifactText), reopenable: true };
      transition(manifest, 'committed', { path: finalPath, sha256: hash });
      await this.persist(manifest);
      if (!(await V3Phase1Orchestrator.completionFromManifest(this.vault))) throw new Error('V3_COMPLETION_AUTHORITY_REJECTED');
      return { manifest, parseResult: parsed.result };
    } catch (error) {
      manifest.attempts = error?.attempts || manifest.attempts;
      manifest.error = { code: error?.code || 'V3_RUN_FAILED', message: String(error?.message || error) };
      if (manifest.state !== 'failed' && manifest.state !== 'committed') transition(manifest, 'failed');
      await this.persist(manifest).catch(() => {});
      throw Object.assign(error instanceof Error ? error : new Error(String(error)), { manifest });
    }
  }

  static async completionFromManifest(vault) {
    const file = vault.getAbstractFileByPath(MANIFEST_PATH);
    if (!file) return false;
    let manifest;
    try { manifest = JSON.parse(await vault.read(file)); } catch (_) { return false; }
    if (manifest?.schema !== 'eks/v3/run-manifest/1' || manifest.state !== 'committed' || !manifest.final?.path || !manifest.final?.sha256
      || !manifest.parse_artifact?.path || !manifest.parse_artifact?.sha256) return false;
    const finalFile = vault.getAbstractFileByPath(manifest.final.path);
    if (!finalFile) return false;
    const artifactFile = vault.getAbstractFileByPath(manifest.parse_artifact.path);
    if (!artifactFile) return false;
    try {
      const artifactText = await vault.read(artifactFile);
      validateParseResult(JSON.parse(artifactText));
      return sha256(await vault.read(finalFile)) === manifest.final.sha256 && sha256(artifactText) === manifest.parse_artifact.sha256;
    } catch (_) { return false; }
  }

  async verify(path, expected, hash) {
    const file = this.vault.getAbstractFileByPath(path);
    if (!file) throw new Error(`V3_REOPEN_FAILED:${path}`);
    const actual = await this.vault.read(file);
    if (actual !== expected || sha256(actual) !== hash) throw new Error(`V3_HASH_MISMATCH:${path}`);
  }

  async persist(manifest) { await this.write(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`); }
  async ensureParent(path) {
    const parts = path.split('/').slice(0, -1); let current = '';
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      if (!this.vault.getAbstractFileByPath(current)) {
        try { await this.vault.createFolder(current); }
        catch (error) { if (!/already exists/i.test(String(error?.message || error))) throw error; }
      }
    }
  }
  async write(path, content) {
    await this.ensureParent(path);
    const existing = this.vault.getAbstractFileByPath(path);
    if (existing) { await this.vault.modify(existing, content); return; }
    try { await this.vault.create(path, content); }
    catch (error) {
      if (!/already exists/i.test(String(error?.message || error))) throw error;
      let visible = null;
      for (let index = 0; index < 20 && !visible; index += 1) {
        await new Promise((resolve) => setTimeout(resolve, 25));
        visible = this.vault.getAbstractFileByPath(path);
      }
      if (!visible) throw error;
      await this.vault.modify(visible, content);
    }
  }
}

function renderMarkdown(result) {
  const provenance = result.parser_provenance.selected_parser;
  return `---\neks_schema: eks/v3/verified-markdown/1\nsource_path: ${JSON.stringify(result.source.path)}\nsource_sha256: ${result.source.sha256}\nparser: ${provenance}\nlanguages: [${result.languages.join(', ')}]\n---\n\n# ${result.source.name}\n\n${result.markdown}\n`;
}

module.exports = { ARTIFACT_ROOT, MANIFEST_PATH, OUTPUT_ROOT, ROOT, STAGING_ROOT, V3Phase1Orchestrator, renderMarkdown };

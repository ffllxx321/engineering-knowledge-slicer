"use strict";
const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const zlib = require("zlib");
const { execFileSync, spawn } = require("child_process");
const root = path.join(__dirname, "..");
const binary = process.env.OBSIDIAN_APPIMAGE || "/tmp/Obsidian-1.12.7.AppImage";
const shaBuffer = (b) => crypto.createHash("sha256").update(b).digest("hex");
const shaFile = (p) => shaBuffer(fs.readFileSync(p));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { analyzeMarkdownCard } = require('../src/content-integrity.js');

class AcceptanceLifecycleError extends Error {
  constructor(code, message, evidence = {}, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = 'AcceptanceLifecycleError';
    this.code = code;
    this.evidence = evidence;
  }
}

function deadlineMs(name, fallback) {
  const value = Number(process.env[name] || fallback);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function childEvidence(child, extra = {}) {
  return { pid: child?.pid || null, spawnfile: child?.spawnfile || null,
    exit_code: child?.exitCode ?? null, signal: child?.signalCode || null, ...extra };
}

async function terminateChild(child, graceMs = deadlineMs('EKS_ACCEPTANCE_KILL_GRACE_MS', 3000)) {
  if (!child || child.exitCode !== null || child.signalCode) return { terminated: true, forced: false };
  const exited = new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })));
  const signal = (name) => {
    try { if (child.pid) process.kill(-child.pid, name); else child.kill(name); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
  };
  signal('SIGTERM');
  let result = await Promise.race([exited, sleep(graceMs).then(() => null)]);
  if (result) return { terminated: true, forced: false, ...result };
  signal('SIGKILL');
  result = await Promise.race([exited, sleep(graceMs).then(() => null)]);
  return { terminated: Boolean(result), forced: true, ...(result || {}) };
}

async function closeServer(server, timeoutMs = deadlineMs('EKS_ACCEPTANCE_SERVER_CLOSE_MS', 3000)) {
  if (!server?.listening) return;
  await Promise.race([
    new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
    sleep(timeoutMs).then(() => { throw new AcceptanceLifecycleError('PROVIDER_CLOSE_TIMEOUT',
      `provider server did not close within ${timeoutMs}ms`, { timeout_ms: timeoutMs }); })
  ]);
}

function nativeChinesePdf(text = '施工验收要求：风管净距必须为 50 mm，设备型号 VAV-50。') {
  const characters = [...text];
  const hex = characters.map((_, index) => (index + 1).toString(16).padStart(2, '0')).join('').toUpperCase();
  const stream = `BT /F1 16 Tf 72 760 Td <${hex}> Tj ET`;
  const mappings = characters.map((character, index) => {
    const source = (index + 1).toString(16).padStart(2, '0').toUpperCase();
    const target = Buffer.from(character, 'utf16le').swap16().toString('hex').toUpperCase();
    return `<${source}> <${target}>`;
  }).join('\n');
  const cmap = `/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def /CMapName /EKS def /CMapType 2 def 1 begincodespacerange <00> <FF> endcodespacerange ${characters.length} beginbfchar\n${mappings}\nendbfchar endcmap CMapName currentdict /CMap defineresource pop end end`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding /ToUnicode 6 0 R >>',
    `<< /Length ${Buffer.byteLength(cmap)} >>\nstream\n${cmap}\nendstream`
  ];
  let pdf = '%PDF-1.7\n'; const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf); pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}
function crc32(data) {
  let c = 0xffffffff;
  for (const b of data) {
    c ^= b;
    for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
  }
  return (c ^ 0xffffffff) >>> 0;
}
function zip(entries) {
  const locals = [],
    centrals = [];
  let offset = 0;
  for (const [name, value] of Object.entries(entries)) {
    const data = Buffer.from(value),
      packed = zlib.deflateRawSync(data),
      n = Buffer.from(name),
      crc = crc32(data);
    const l = Buffer.alloc(30);
    l.writeUInt32LE(0x04034b50);
    l.writeUInt16LE(20, 4);
    l.writeUInt16LE(0x800, 6);
    l.writeUInt16LE(8, 8);
    l.writeUInt32LE(crc, 14);
    l.writeUInt32LE(packed.length, 18);
    l.writeUInt32LE(data.length, 22);
    l.writeUInt16LE(n.length, 26);
    locals.push(l, n, packed);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0x800, 8);
    c.writeUInt16LE(8, 10);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(packed.length, 20);
    c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(n.length, 28);
    c.writeUInt32LE(offset, 42);
    centrals.push(c, n);
    offset += l.length + n.length + packed.length;
  }
  const central = Buffer.concat(centrals),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, central, end]);
}
function fixtures() {
  const ct =
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>';
  return {
    "acceptance.md": Buffer.from(
      "# 验收规范\n\n风管壁厚必须为 1.2mm，风机型号必须为 MX-200。",
    ),
    "network-recovery.eml": Buffer.from(
      "From: qa@example.test\r\nTo: team@example.test\r\nSubject: Acceptance\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nSupplier must submit model MX-200 before 2026-08-01.",
    ),
    "contract.docx": zip({
      "[Content_Types].xml": ct,
      "word/document.xml":
        '<w:document xmlns:w="w"><w:body><w:p><w:r><w:t>合同要求：螺栓扭矩必须为 45 N·m，型号 BOLT-M16。</w:t></w:r></w:p></w:body></w:document>',
    }),
    "ventilation.xlsx": zip({
      "[Content_Types].xml": ct,
      "xl/workbook.xml":
        '<workbook xmlns:r="r"><sheets><sheet name="通风" r:id="r1"/></sheets></workbook>',
      "xl/_rels/workbook.xml.rels":
        '<Relationships><Relationship Id="r1" Target="worksheets/sheet1.xml"/></Relationships>',
      "xl/worksheets/sheet1.xml":
        '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>预埋套管直径</t></is></c><c r="B1" t="inlineStr"><is><t>DN200</t></is></c></row></sheetData></worksheet>',
    }),
    "briefing.pptx": zip({
      "[Content_Types].xml": ct,
      "ppt/presentation.xml":
        '<p:presentation xmlns:p="p" xmlns:r="r"><p:sldIdLst><p:sldId r:id="r1"/></p:sldIdLst></p:presentation>',
      "ppt/_rels/presentation.xml.rels":
        '<Relationships><Relationship Id="r1" Target="slides/slide1.xml"/></Relationships>',
      "ppt/slides/slide1.xml":
        '<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>质量要求：混凝土强度等级 C35。</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>',
    }),
    "native.pdf": nativeChinesePdf(),
  };
}
function inputs(argv) {
  const out = [];
  for (let i = 0; i < argv.length; i++)
    if (argv[i] === "--corpus" && argv[i + 1])
      out.push(...argv[++i].split(path.delimiter));
  const env = process.env.EKS_ACCEPTANCE_CORPUS;
  if (env) out.push(...env.split(path.delimiter));
  return out.filter(Boolean).map((item) => path.resolve(item));
}
async function localProvider() {
  const stats = {
    requests: 0,
    rate_limited: 0,
    transient: 0,
    non_chinese: 0,
    recovered: 0,
    contracts: 0,
  };
  let semantic = 0;
  const server = http.createServer(async (req, res) => {
    if (req.url === "/metrics") {
      res.setHeader("content-type", "application/json");
      return res.end(JSON.stringify(stats));
    }
    let raw = "";
    for await (const c of req) raw += c;
    stats.requests++;
    let body = {};
    try {
      body = JSON.parse(raw);
    } catch {}
    const prompt = String(body.messages?.[0]?.content || "");
    if (stats.requests === 1) {
      stats.rate_limited++;
      res.writeHead(429, { "retry-after": "0" });
      return res.end("{}");
    }
    if (stats.requests === 2) {
      stats.transient++;
      res.writeHead(503);
      return res.end("{}");
    }
    const at = prompt.lastIndexOf('{"regions":');
    let regions = [];
    if (at >= 0)
      try {
        regions = JSON.parse(prompt.slice(at).split("\n")[0]).regions || [];
      } catch {}
    semantic++;
    const first = semantic === 1;
    const translations = regions.map((x) => ({
      region_id: x.region_id,
      translated_text: first ? x.text : `工程验收要求：${x.text}`,
    }));
    if (first) stats.non_chinese++;
    else stats.recovered++;
    stats.contracts++;
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        id: "local",
        type: "message",
        stop_reason: "tool_use",
        content: [
          {
            type: "tool_use",
            name: "return_structured_result",
            input: { translations },
          },
        ],
      }),
    );
  });
  const startupMs = deadlineMs('EKS_ACCEPTANCE_PROVIDER_START_MS', 5000);
  await Promise.race([
    new Promise((resolve, reject) => {
      const onError = (error) => { server.off('listening', onListen); reject(new AcceptanceLifecycleError(
        'PROVIDER_LISTEN_ERROR', `provider server failed to listen: ${error.message}`, {}, error)); };
      const onListen = () => { server.off('error', onError); resolve(); };
      server.once('error', onError); server.once('listening', onListen);
      server.listen(0, '127.0.0.1');
    }),
    sleep(startupMs).then(() => { throw new AcceptanceLifecycleError('PROVIDER_START_TIMEOUT',
      `provider server did not listen within ${startupMs}ms`, { timeout_ms: startupMs }); })
  ]).catch(async (error) => { await closeServer(server).catch(() => {}); throw error; });
  return {
    server,
    endpoint: `http://127.0.0.1:${server.address().port}/anthropic/v1/messages`,
    stats,
  };
}
async function evaluate(port, maximumMs) {
  const timeoutMs = Math.max(1, Math.min(deadlineMs('EKS_ACCEPTANCE_CDP_TIMEOUT_MS', 15000), maximumMs || Infinity));
  const pages = await (await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(timeoutMs) })).json();
  const page = pages.find(
    (x) =>
      x.type === "page" &&
      x.webSocketDebuggerUrl &&
      !String(x.url).startsWith("devtools:"),
  );
  if (!page) return false;
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(page.webSocketDebuggerUrl),
      timer = setTimeout(() => { ws.close(); reject(new AcceptanceLifecycleError('CDP_TIMEOUT',
        `CDP evaluation exceeded ${timeoutMs}ms`, { port, timeout_ms: timeoutMs })); }, timeoutMs);
    ws.onopen = () =>
      ws.send(
        JSON.stringify({
          id: 1,
          method: "Runtime.evaluate",
          params: {
            awaitPromise: true,
            returnByValue: true,
            expression:
              '(async()=>{if(typeof app==="undefined"||!app.plugins)return false;localStorage.setItem("enable-plugin-"+app.appId,"true");let p=null;for(let i=0;i<100;i++){p=app.plugins.plugins["engineering-knowledge-slicer"];if(p&&p.settings&&typeof p.runAcceptanceRealProbe==="function")break;await new Promise(r=>setTimeout(r,50))}if(!p){p=await app.plugins.loadPlugin("engineering-knowledge-slicer")}if(!p||!p.settings||typeof p.runAcceptanceRealProbe!=="function")return false;await p.runAcceptanceRealProbe();return true})()',
          },
        }),
      );
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id === 1) {
        clearTimeout(timer);
        ws.close();
        if (m.result?.exceptionDetails) {
          const detail = m.result.exceptionDetails;
          const message = detail.exception?.description || detail.text || 'acceptance probe threw';
          reject(new AcceptanceLifecycleError('HOST_PROBE_ERROR', message, {
            port, line_number: detail.lineNumber ?? null, column_number: detail.columnNumber ?? null
          }));
          return;
        }
        resolve(m.result?.result?.value === true);
      }
    };
    ws.onerror = (error) => { clearTimeout(timer); reject(error); };
  });
}
async function launch(vault, config, resultPath, env, options = {}) {
  try {
    fs.unlinkSync(resultPath);
  } catch {}
  const port = 21000 + Math.floor(Math.random() * 1000);
  const command = options.command || 'xvfb-run';
  const args = options.args || [
      "-a",
      binary,
      "--no-sandbox",
      "--disable-gpu",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${config}`,
      `obsidian://open?path=${encodeURIComponent(vault)}`,
    ];
  const startedAt = Date.now();
  const child = spawn(command, args, {
      detached: true,
      stdio: "ignore",
      env: {
        ...process.env,
        ...env,
        HOME: path.dirname(config),
        XDG_CONFIG_HOME: config,
        EKS_ACCEPTANCE_REAL: "1",
      },
    });
  const timeoutMs = Number(options.timeoutMs || deadlineMs('EKS_ACCEPTANCE_TIMEOUT_MS', 240000));
  const deadline = Date.now() + timeoutMs;
  let spawnError;
  let exit;
  child.once('error', (error) => { spawnError = error; });
  child.once('exit', (code, signal) => { exit = { code, signal }; });
  let invoked = false;
  let lastCdpError;
  let cleanup;
  try {
    while (Date.now() < deadline && !fs.existsSync(resultPath)) {
      if (spawnError) throw new AcceptanceLifecycleError('HOST_SPAWN_ERROR',
        `acceptance host failed to spawn: ${spawnError.message}`, childEvidence(child), spawnError);
      if (exit) throw new AcceptanceLifecycleError('HOST_EARLY_EXIT',
        `acceptance host exited before producing a result`, childEvidence(child, { ...exit, elapsed_ms: Date.now() - startedAt }));
      if (!invoked && !options.skipEvaluate) {
        try { invoked = await evaluate(port, deadline - Date.now()); }
        catch (error) {
          lastCdpError = error;
          if (error?.code === 'HOST_PROBE_ERROR') throw error;
        }
      }
      await sleep(Math.min(250, Math.max(1, deadline - Date.now())));
    }
    if (!fs.existsSync(resultPath)) throw new AcceptanceLifecycleError('HOST_RESULT_TIMEOUT',
      `official Obsidian did not produce acceptance result within ${timeoutMs}ms`,
      childEvidence(child, { timeout_ms: timeoutMs, elapsed_ms: Date.now() - startedAt,
        cdp_invoked: invoked, last_cdp_error: lastCdpError ? String(lastCdpError.message || lastCdpError) : null }));
    try { return JSON.parse(fs.readFileSync(resultPath, 'utf8')); }
    catch (error) { throw new AcceptanceLifecycleError('HOST_RESULT_INVALID',
      `acceptance result is not valid JSON: ${error.message}`, childEvidence(child, { result_path: resultPath }), error); }
  } finally {
    cleanup = await terminateChild(child).catch((error) => ({ terminated: false, cleanup_error: String(error.message || error) }));
    if (!cleanup.terminated && !spawnError) throw new AcceptanceLifecycleError('HOST_CLEANUP_FAILED',
      'acceptance host remained alive after SIGTERM and SIGKILL', childEvidence(child, cleanup));
  }
}
function bucket(n) {
  return n < 1024 ? "lt_1KiB" : n < 1024 * 1024 ? "1KiB_1MiB" : "gte_1MiB";
}
function sourceTree() {
  return execFileSync("git", ["rev-parse", "HEAD^{tree}"], { cwd: root, encoding: "utf8" }).trim();
}
function obsidianVersion(hostVersion) {
  const value = hostVersion !== "unknown"
    ? String(hostVersion)
    : path.basename(binary).match(/Obsidian-([0-9]+(?:\.[0-9]+)*)/)?.[1] || "unknown";
  return value.match(/\d+(?:\.\d+)*/)?.[0] || "unknown";
}
function safeSources(tasks) {
  return tasks.map((task) => ({
    origin: task.source_origin === "external" ? "external" : "fixture",
    sha256: task.source_hash,
    type: task.source_type || "unknown",
    size_bucket: task.source_size_bucket,
    status: task.status,
    production_state: task.production_state,
    terminal_outcome: task.terminal_outcome,
    card_count: task.cards.length,
    cards: task.cards.map((card) => ({ sha256: card.content_hash, size_bytes: card.bytes,
      quality_ok: card.quality_ok === true, quality_reasons: card.quality_reasons || [] })),
    counts: task.counts,
    error_codes: task.error_codes,
  }));
}
function externalCorpusAcceptance(tasks, suppliedCount) {
  const external = safeSources(tasks).filter((source) => source.origin === "external");
  const successful = external.filter((source) =>
    source.status === "stored" && source.production_state === "stored" &&
    source.terminal_outcome === "completed_with_output" && source.card_count > 0 &&
    source.cards.every((card) => card.size_bytes > 0 && card.quality_ok === true) &&
    Number(source.counts?.verified || 0) > 0 && (source.error_codes || []).length === 0
  );
  const statusCounts = {};
  for (const source of external) statusCounts[source.status || "unknown"] = (statusCounts[source.status || "unknown"] || 0) + 1;
  const required = suppliedCount > 0;
  const checks = {
    external_corpus_accounted: !required || external.length === suppliedCount,
    external_all_stored: !required || external.every((source) => source.status === "stored" && source.production_state === "stored" && source.terminal_outcome === "completed_with_output"),
    external_cards_nonempty: !required || external.every((source) => source.card_count > 0 && source.cards.every((card) => card.size_bytes > 0)),
    external_cards_content_quality: !required || external.every((source) => source.cards.every((card) => card.quality_ok === true)),
    external_cards_verified: !required || external.every((source) => Number(source.counts?.verified || 0) > 0),
    external_error_free: !required || external.every((source) => (source.error_codes || []).length === 0),
  };
  return { required, passed: Object.values(checks).every(Boolean), checks,
    metrics: { supplied: suppliedCount, observed: external.length, successful: successful.length,
      unsuccessful: Math.max(suppliedCount - successful.length, 0), status_counts: statusCounts } };
}
async function main() {
  assert(
    fs.existsSync(binary),
    `Official Obsidian AppImage missing: ${binary}`,
  );
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "eks-acceptance-")),
    vault = path.join(tmp, "vault"),
    config = path.join(tmp, "config"),
    plugin = path.join(vault, ".obsidian/plugins/engineering-knowledge-slicer"),
    intake = path.join(vault, "06-知识库/源文件/业务库");
  fs.mkdirSync(plugin, { recursive: true });
  fs.mkdirSync(intake, { recursive: true });
  fs.mkdirSync(config, { recursive: true });
  for (const f of ["main.js", "manifest.json", "styles.css"])
    fs.copyFileSync(path.join(root, f), path.join(plugin, f));
  for (const [n, b] of Object.entries(fixtures()))
    fs.writeFileSync(path.join(intake, n), b);
  const corpus = [];
  for (const p of inputs(process.argv.slice(2))) {
    const st = fs.statSync(p);
    assert(st.isFile(), `corpus is not a file: ${p}`);
    const target = path.join(
      intake,
      `external-${shaFile(p).slice(0, 12)}${path.extname(p)}`,
    );
    fs.copyFileSync(p, target);
    corpus.push({
      type: path.extname(p).slice(1).toLowerCase() || "unknown",
      size_bucket: bucket(st.size),
      sha256: shaFile(p),
    });
  }
  fs.writeFileSync(
    path.join(vault, ".obsidian/community-plugins.json"),
    JSON.stringify(["engineering-knowledge-slicer"]),
  );
  fs.writeFileSync(
    path.join(config, "obsidian.json"),
    JSON.stringify({
      vaults: { acceptance: { path: vault, ts: Date.now(), open: true } },
    }),
  );
  const provider = await localProvider();
  const resultPath = path.join(vault, "EKS Acceptance/result.json");
  let first, second; const launches = [];
  try {
    first = await launch(vault, config, resultPath, {
      EKS_ACCEPTANCE_PROVIDER_MODE: "provider-local",
      EKS_ACCEPTANCE_MINIMAX_ENDPOINT: provider.endpoint,
    });
    launches.push(first);
    for (let i = 1; i < 5; i += 1) launches.push(await launch(vault, config, resultPath, {
      EKS_ACCEPTANCE_PROVIDER_MODE: "provider-local",
      EKS_ACCEPTANCE_MINIMAX_ENDPOINT: provider.endpoint,
    }));
    second = await launch(vault, config, resultPath, {
      EKS_ACCEPTANCE_PROVIDER_MODE: "provider-local",
      EKS_ACCEPTANCE_MINIMAX_ENDPOINT: provider.endpoint,
    });
  } finally {
    await closeServer(provider.server);
  }
  const stableCardSet = (result) => result.tasks.map((task) => ({
    source_hash: task.source_hash,
    cards: task.cards.map((card) => ({ path_hash: card.path_hash, content_hash: card.content_hash, bytes: card.bytes }))
      .sort((a, b) => a.path_hash.localeCompare(b.path_hash)),
  })).sort((a, b) => a.source_hash.localeCompare(b.source_hash));
  const same = JSON.stringify(stableCardSet(first)) === JSON.stringify(stableCardSet(second));
  const fixtureChecks = {
    host_real: first.real_host === true,
    production_terminal: first.terminal_count === first.task_count,
    false_success: first.false_success_count === 0,
    cards_nonempty:
      first.openable_count > 0 && first.openable_count === first.nonempty_count,
    chinese: first.openable_count === first.chinese_count,
    binary_free: first.openable_count === first.binary_free_count,
    stable_ids: first.openable_count === first.stable_id_count,
    placeholder_free: first.openable_count === first.placeholder_free_count,
    content_quality: first.openable_count === first.content_quality_count,
    fixture_gold: first.gold?.passed === true && first.gold?.hit_count >= first.gold?.minimum_hits
      && first.gold?.fixture_sources_hit >= first.gold?.minimum_fixture_sources_hit,
    idempotent: same,
    checkpoint_resume:
      second.operation_counters.apiRequests === 0 &&
      second.checkpoint_artifact_count === first.checkpoint_artifact_count,
    network_retry:
      provider.stats.rate_limited > 0 && provider.stats.transient > 0,
    non_chinese_recovery:
      provider.stats.non_chinese > 0 && provider.stats.recovered > 0,
    minimax_contract: provider.stats.contracts > 0,
  };
  const externalAcceptance = externalCorpusAcceptance(first.tasks, corpus.length);
  const checks = { ...fixtureChecks, ...externalAcceptance.checks };
  const failures = Object.entries(checks)
    .filter(([, v]) => !v)
    .map(([k]) => k);
  const report = {
    schema: "eks/acceptance-report/1",
    passed: launches.every(item => item.ok) && second.ok && !failures.length && externalAcceptance.passed,
    generated_at: new Date().toISOString(),
    source_tree: sourceTree(),
    bundle_sha256: shaFile(path.join(root, "main.js")),
    plugin_version: require(path.join(root, "manifest.json")).version,
    obsidian_appimage_sha256: shaFile(binary),
    obsidian_version: obsidianVersion(first.obsidian_version),
    provider: {
      local: "passed",
      real: process.env.EKS_ACCEPTANCE_MINIMAX_API_KEY
        ? "not_run_by_local_command"
        : "not_run",
      metrics: provider.stats,
    },
    corpus,
    sources: safeSources(first.tasks),
    checks,
    failures,
    stages: { first_ms: first.duration_ms, restart_ms: second.duration_ms },
    metrics: {
      harness_fixtures: { passed: first.ok && second.ok && Object.values(fixtureChecks).every(Boolean) },
      external_corpus: externalAcceptance.metrics,
      tasks: first.task_count,
      stored: first.stored_count,
      cards: first.openable_count,
      checkpoint_artifacts: first.checkpoint_artifact_count,
      gold: first.gold,
      startup: { clean_launches: launches.length, restart_reload: true,
        duplicate_view_failures: launches.concat(second).filter(item => /existing view type/i.test(JSON.stringify(item))).length },
    },
  };
  const dir = path.join(root, "test-artifacts");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "acceptance-real.json"),
    JSON.stringify(report, null, 2),
  );
  fs.writeFileSync(
    path.join(dir, "acceptance-real.md"),
    `# Real acceptance\n\n- Result: **${report.passed ? "PASS" : "FAIL"}**\n- Harness fixtures: **${report.metrics.harness_fixtures.passed ? "PASS" : "FAIL"}**\n- External corpus: **${externalAcceptance.required ? (externalAcceptance.passed ? "PASS" : "FAIL") : "NOT SUPPLIED"}** (${externalAcceptance.metrics.successful}/${externalAcceptance.metrics.supplied} successful)\n- Provider: host-real / corpus-real / provider-local\n- Tasks: ${report.metrics.tasks}; cards: ${report.metrics.cards}; gold hit rate: ${report.metrics.gold?.hit_rate ?? 0}\n- Failures: ${failures.join(", ") || "none"}\n`,
  );
  assert(report.passed, `acceptance failed: ${failures.join(", ")}`);
  console.log(
    `REAL ACCEPTANCE PASS tasks=${report.metrics.tasks} cards=${report.metrics.cards}`,
  );
}
function writeLifecycleFailureReport(error, targetRoot = root) {
  const dir = path.join(targetRoot, 'test-artifacts'); fs.mkdirSync(dir, { recursive: true });
  const report = { schema: 'eks/acceptance-report/1', passed: false, generated_at: new Date().toISOString(),
    source_tree: (() => { try { return sourceTree(); } catch { return 'unknown'; } })(), checks: {},
    failures: [error.code || 'ACCEPTANCE_UNEXPECTED_ERROR'], lifecycle_failure: {
      type: error.name || 'Error', code: error.code || 'ACCEPTANCE_UNEXPECTED_ERROR', message: error.message,
      evidence: error.evidence || {}, cause: error.cause ? String(error.cause.message || error.cause) : null },
    provider: { local: 'failed', real: 'not_run' }, sources: [], metrics: { harness_fixtures: { passed: false } } };
  fs.writeFileSync(path.join(dir, 'acceptance-real.json'), `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(path.join(dir, 'acceptance-real.md'), `# Real acceptance\n\n- Result: **FAIL**\n- Lifecycle failure: **${report.lifecycle_failure.code}**\n- Message: ${report.lifecycle_failure.message}\n`);
  return report;
}
if (require.main === module)
  main().catch((e) => {
    writeLifecycleFailureReport(e);
    console.error(`${e.name || 'Error'} [${e.code || 'ACCEPTANCE_UNEXPECTED_ERROR'}]: ${e.message}`);
    process.exitCode = 1;
  });
module.exports = { AcceptanceLifecycleError, binary, bucket, closeServer, externalCorpusAcceptance, fixtures,
  inputs, launch, nativeChinesePdf, obsidianVersion, root, safeSources, shaFile, sourceTree,
  terminateChild, writeLifecycleFailureReport };

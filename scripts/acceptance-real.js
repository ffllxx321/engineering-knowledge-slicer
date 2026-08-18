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
    "native.pdf": Buffer.from(
      "%PDF-1.4\n1 0 obj<</Type/Page>>endobj\nBT (Acceptance duct clearance shall be 50 mm model VAV-50.) Tj ET\n%%EOF",
    ),
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
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return {
    server,
    endpoint: `http://127.0.0.1:${server.address().port}/anthropic/v1/messages`,
    stats,
  };
}
async function evaluate(port) {
  const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const page = pages.find(
    (x) =>
      x.type === "page" &&
      x.webSocketDebuggerUrl &&
      !String(x.url).startsWith("devtools:"),
  );
  if (!page) return false;
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(page.webSocketDebuggerUrl),
      timer = setTimeout(() => reject(new Error("CDP timeout")), 15000);
    ws.onopen = () =>
      ws.send(
        JSON.stringify({
          id: 1,
          method: "Runtime.evaluate",
          params: {
            awaitPromise: true,
            returnByValue: true,
            expression:
              '(async()=>{if(typeof app==="undefined"||!app.plugins)return false;localStorage.setItem("enable-plugin-"+app.appId,"true");let p=app.plugins.plugins["engineering-knowledge-slicer"]||await app.plugins.loadPlugin("engineering-knowledge-slicer");if(!p||typeof p.runAcceptanceRealProbe!=="function")return false;await p.runAcceptanceRealProbe();return true})()',
          },
        }),
      );
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id === 1) {
        clearTimeout(timer);
        ws.close();
        resolve(m.result?.result?.value === true);
      }
    };
    ws.onerror = reject;
  });
}
async function launch(vault, config, resultPath, env) {
  try {
    fs.unlinkSync(resultPath);
  } catch {}
  const port = 21000 + Math.floor(Math.random() * 1000);
  const child = spawn(
    "xvfb-run",
    [
      "-a",
      binary,
      "--no-sandbox",
      "--disable-gpu",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${config}`,
      `obsidian://open?path=${encodeURIComponent(vault)}`,
    ],
    {
      detached: true,
      stdio: "ignore",
      env: {
        ...process.env,
        ...env,
        HOME: path.dirname(config),
        XDG_CONFIG_HOME: config,
        EKS_ACCEPTANCE_REAL: "1",
      },
    },
  );
  const deadline =
    Date.now() + Number(process.env.EKS_ACCEPTANCE_TIMEOUT_MS || 240000);
  let invoked = false;
  while (Date.now() < deadline && !fs.existsSync(resultPath)) {
    if (!invoked)
      try {
        invoked = await evaluate(port);
      } catch {}
    await sleep(500);
  }
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
  assert(
    fs.existsSync(resultPath),
    "official Obsidian did not produce acceptance result",
  );
  return JSON.parse(fs.readFileSync(resultPath, "utf8"));
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
    cards: task.cards.map((card) => ({ sha256: card.content_hash, size_bytes: card.bytes })),
    counts: task.counts,
    error_codes: task.error_codes,
  }));
}
function externalCorpusAcceptance(tasks, suppliedCount) {
  const external = safeSources(tasks).filter((source) => source.origin === "external");
  const successful = external.filter((source) =>
    source.status === "stored" && source.production_state === "stored" &&
    source.terminal_outcome === "completed_with_output" && source.card_count > 0 &&
    source.cards.every((card) => card.size_bytes > 0) &&
    Number(source.counts?.verified || 0) > 0 && (source.error_codes || []).length === 0
  );
  const statusCounts = {};
  for (const source of external) statusCounts[source.status || "unknown"] = (statusCounts[source.status || "unknown"] || 0) + 1;
  const required = suppliedCount > 0;
  const checks = {
    external_corpus_accounted: !required || external.length === suppliedCount,
    external_all_stored: !required || external.every((source) => source.status === "stored" && source.production_state === "stored" && source.terminal_outcome === "completed_with_output"),
    external_cards_nonempty: !required || external.every((source) => source.card_count > 0 && source.cards.every((card) => card.size_bytes > 0)),
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
  let first, second;
  try {
    first = await launch(vault, config, resultPath, {
      EKS_ACCEPTANCE_PROVIDER_MODE: "provider-local",
      EKS_ACCEPTANCE_MINIMAX_ENDPOINT: provider.endpoint,
    });
    second = await launch(vault, config, resultPath, {
      EKS_ACCEPTANCE_PROVIDER_MODE: "provider-local",
      EKS_ACCEPTANCE_MINIMAX_ENDPOINT: provider.endpoint,
    });
  } finally {
    provider.server.close();
  }
  const same =
    JSON.stringify(first.tasks.map((t) => t.cards)) ===
    JSON.stringify(second.tasks.map((t) => t.cards));
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
    passed: first.ok && second.ok && !failures.length && externalAcceptance.passed,
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
if (require.main === module)
  main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
module.exports = { binary, bucket, externalCorpusAcceptance, fixtures, inputs, launch, obsidianVersion, root, safeSources, shaFile, sourceTree };

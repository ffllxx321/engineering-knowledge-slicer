# Error diagnostic reports

When a task fails, open **Dashboard → Errors**, expand the failure, and select **Copy redacted diagnostic report**. Send the complete copied report to support. Do not send the source document, API keys, prompts, raw model responses, or the unbounded `diag.log`.

The copied Markdown starts with a short human-readable summary and contains one bounded JSON object under `## Machine-readable report`. The current identifiers are `reportVersion: "1.1"` and `schemaVersion: "eks-diagnostic-report/1.1"`.

The report includes plugin/runtime/platform versions, a non-secret settings allowlist, task/run IDs, source hashes and type, stage/status/timing, the stable final error and causal summary, last valid checkpoint, summary chunk and atom batch coverage, task-local cache/request/retry/rate-limit/backoff counts, a compact failure timeline, terminal persistence/UI state, validated artifact inventory, and concrete next actions. Component loading failures use the `component-contracts` stage and one of the three `COMPONENT_*` codes.

Privacy and bounds:

- Source text, prompt text, provider response bodies, API keys, authorization headers, cookies, secrets, and full source/artifact paths are excluded or replaced with hashes.
- Deep redaction is applied again at report construction, even if an upstream event was already sanitized.
- Repeated cache-hit events are represented as a compact chronological range with a count and bounded stable-ID list.
- JSON is capped at 64 KiB and copied Markdown at 72 KiB. Old timeline entries and excess inventory details are removed first.
- Report creation, persistence, and clipboard failures are caught and can never change the task result.

Failed runs also best-effort persist `diagnostic-report.json` beside the run artifacts. Existing task/error artifact formats and `diag.log` remain readable; the report is additive.

## User-facing template

````markdown
# Engineering Knowledge Slicer Diagnostic Report

> Send this complete report to support. Do not send the source document, API keys, prompts, or raw provider responses.

- Report/schema: <reportVersion> / <schemaVersion>
- Plugin: <pluginId> <pluginVersion>
- Task/run: <taskId> / <runId>
- Source: hash <sourceHash-or-pathHash>; type <sourceType>
- Stage/status: <stage> / <status>
- Error: <stableCode> (<category>, retryable=<true|false>)
- Checkpoint: <lastSuccessfulCheckpoint|none>
- Summary chunks: <completed>/<expected>; missing <count>
- Atom batches: <completed>/<expected>; missing <count>; failed <count>

## Machine-readable report

```json
{ "...": "complete bounded eks-diagnostic-report/1.1 object" }
```
````

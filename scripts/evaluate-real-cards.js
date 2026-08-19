'use strict';

const fs = require('fs');
const path = require('path');
const { loadMarkdownCorpus, HybridRetriever } = require('../src/retrieval-core');
const { evaluate, validateQuestions } = require('../src/retrieval-evaluation');

async function main() {
  const [cardsPath, questionsPath, outputPath] = process.argv.slice(2);
  if (!cardsPath || !questionsPath) throw new Error('用法：npm run eval:real-cards -- <卡片目录或文件> <版本化问题集.json> [报告.json]');
  const records = loadMarkdownCorpus(path.resolve(cardsPath));
  const questionSet = JSON.parse(fs.readFileSync(path.resolve(questionsPath), 'utf8'));
  validateQuestions(questionSet, new Set(records.map((record) => record.id)));
  const report = await evaluate(new HybridRetriever(records), questionSet, { repeats: 3 });
  const text = `${JSON.stringify(report, null, 2)}\n`;
  if (outputPath) fs.writeFileSync(path.resolve(outputPath), text, { mode: 0o600 }); else process.stdout.write(text);
  if (report.failures.length) process.exitCode = 1;
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });

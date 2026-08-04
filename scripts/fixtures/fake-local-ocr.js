#!/usr/bin/env node
'use strict';

const args = process.argv.slice(2);
const writeStdout = (value) => require('fs').writeSync(process.stdout.fd, value);
if (args.includes('--version')) {
  writeStdout('fake-local-ocr 1.0.0\n');
  process.exit(0);
}
const language = args[args.indexOf('--languages') + 1] || 'unknown';
if (language === 'timeout') {
  setTimeout(() => writeStdout('{}'), 10000);
} else if (language === 'malformed') {
  writeStdout('not-json');
} else {
  writeStdout(JSON.stringify({
    language,
    blocks: [
      { text: '扫描页施工验收要求。', confidence: 0.96, bbox: [10, 20, 300, 60], language },
      { text: '项目印章', confidence: 0.99, bbox: [320, 20, 420, 100], language, visual_type: 'stamp' },
      { text: '模糊低置信文本', confidence: 0.2, bbox: [10, 80, 180, 110], language }
    ]
  }));
}

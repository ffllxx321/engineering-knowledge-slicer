#!/usr/bin/env node
'use strict';

const args = process.argv.slice(2);
if (args.includes('--version')) {
  process.stdout.write('fake-local-ocr 1.0.0\n');
  process.exit(0);
}
const language = args[args.indexOf('--languages') + 1] || 'unknown';
if (language === 'timeout') {
  setTimeout(() => process.stdout.write('{}'), 10000);
} else if (language === 'malformed') {
  process.stdout.write('not-json');
} else {
  process.stdout.write(JSON.stringify({
    language,
    blocks: [
      { text: '扫描页施工验收要求。', confidence: 0.96, bbox: [10, 20, 300, 60], language },
      { text: '项目印章', confidence: 0.99, bbox: [320, 20, 420, 100], language, visual_type: 'stamp' },
      { text: '模糊低置信文本', confidence: 0.2, bbox: [10, 80, 180, 110], language }
    ]
  }));
}

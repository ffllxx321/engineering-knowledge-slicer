#!/usr/bin/env node
'use strict';
const assert = require('assert');
const { cleanTitleBoundary } = require('../src/semantic-text.js');

for (const title of ['≤0.5 mm', '≥5 MPa', '-20°C', 'C++', 'C#']) {
  assert.strictEqual(cleanTitleBoundary(title), title);
}
for (const [input, expected] of [
  ['# ≤0.5 mm', '≤0.5 mm'], ['> C++', 'C++'], ['- -20°C', '-20°C'],
  ['* ≥5 MPa', '≥5 MPa'], ['1. C#', 'C#'], ['（二） C++', 'C++'],
  ['- [x] **≥5 MPa**', '≥5 MPa'], ['+ [ ] ~~C#~~', 'C#'],
  ['【≤0.5 mm】', '≤0.5 mm'], ['`C++`', 'C++'], ['“ -20°C ”', '-20°C']
]) assert.strictEqual(cleanTitleBoundary(input), expected, input);

console.log('title boundary regression: PASS');

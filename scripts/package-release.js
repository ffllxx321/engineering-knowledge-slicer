'use strict';

const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const files = ['main.js', 'manifest.json', 'styles.css'];
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
const local = [], central = []; let offset = 0;
for (const name of files) {
  const data = fs.readFileSync(path.join(root, name));
  const encoded = Buffer.from(name);
  const crc = crc32(data);
  const header = Buffer.alloc(30 + encoded.length);
  header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x800, 6);
  header.writeUInt32LE(crc, 14); header.writeUInt32LE(data.length, 18); header.writeUInt32LE(data.length, 22);
  header.writeUInt16LE(encoded.length, 26); encoded.copy(header, 30);
  local.push(header, data);
  const cd = Buffer.alloc(46 + encoded.length);
  cd.writeUInt32LE(0x02014b50); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(0x800, 8);
  cd.writeUInt32LE(crc, 16); cd.writeUInt32LE(data.length, 20); cd.writeUInt32LE(data.length, 24);
  cd.writeUInt16LE(encoded.length, 28); cd.writeUInt32LE(offset, 42); encoded.copy(cd, 46);
  central.push(cd); offset += header.length + data.length;
}
const directory = Buffer.concat(central);
const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
const output = path.join(root, 'release', `engineering-knowledge-slicer-${manifest.version}.zip`);
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, Buffer.concat([...local, directory, end]));
console.log(`${path.relative(root, output)}: ${files.join(', ')}`);

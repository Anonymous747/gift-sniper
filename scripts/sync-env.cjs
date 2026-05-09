#!/usr/bin/env node
/**
 * Merges variables from .env.example into .env:
 * - If .env is missing, copies .env.example.
 * - Otherwise appends any KEY= definitions present in .env.example but absent from .env
 *   (preceding comment lines from the example are kept with each appended block).
 * Never overwrites existing values in .env.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const examplePath = path.join(root, '.env.example');
const envPath = path.join(root, '.env');

function read(p) {
  return fs.readFileSync(p, 'utf8');
}

/** @param {string} content */
function parseDefinedKeys(content) {
  const keys = new Set();
  for (const line of content.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (m) keys.add(m[1]);
  }
  return keys;
}

/** @param {string[]} lines */
function blocksFromExample(lines) {
  /** @type {{ key: string; lines: string[] }[]} */
  const blocks = [];
  /** @type {string[]} */
  let pending = [];
  for (const line of lines) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (m) {
      blocks.push({ key: m[1], lines: [...pending, line] });
      pending = [];
    } else {
      pending.push(line);
    }
  }
  return blocks;
}

function main() {
  if (!fs.existsSync(examplePath)) {
    console.error('Missing .env.example');
    process.exit(1);
  }

  const exampleContent = read(examplePath);
  const exampleLines = exampleContent.split(/\r?\n/);
  const blocks = blocksFromExample(exampleLines);

  if (!fs.existsSync(envPath)) {
    fs.writeFileSync(envPath, exampleContent.endsWith('\n') ? exampleContent : `${exampleContent}\n`, 'utf8');
    console.log('Created .env from .env.example');
    return;
  }

  const envContent = read(envPath);
  const defined = parseDefinedKeys(envContent);
  const missing = blocks.filter((b) => !defined.has(b.key));

  if (missing.length === 0) {
    console.log('.env already has every variable key from .env.example');
    return;
  }

  let out = envContent.replace(/\s*$/, '');
  for (const b of missing) {
    out += '\n';
    if (b.lines.length) {
      out += b.lines.join('\n');
    }
    out += '\n';
  }
  if (!out.endsWith('\n')) out += '\n';
  fs.writeFileSync(envPath, out, 'utf8');
  console.log(`Appended ${missing.length} key(s) from .env.example: ${missing.map((m) => m.key).join(', ')}`);
}

main();

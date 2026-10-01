#!/usr/bin/env node
/**
 * Fails if credential-like strings appear in files tracked or staged by git, or in build output.
 * Complements (does not replace) gitleaks in CI. Usage: node scripts/check-secrets.mjs [extra dirs…]
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const PATTERNS = [
  { name: 'Google API key', re: /AIza[0-9A-Za-z_-]{35}/ },
  { name: 'Google AI Studio auth key', re: /\bAQ\.[0-9A-Za-z_-]{40,}/ },
  { name: 'AWS access key id', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { name: 'AWS secret access key', re: /aws_secret_access_key\s*[=:]\s*[0-9A-Za-z/+]{40}/i },
  { name: 'Private key', re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
];

const SKIP = [
  /^LICENSE$/,
  /\.(png|jpe?g|webp|gif|ico|tif|bin|woff2?|zip|gz)$/i,
  /package-lock\.json$/,
];

function gitFiles() {
  const out = execFileSync('git', ['ls-files', '-co', '--exclude-standard'], { encoding: 'utf8' });
  return out.split('\n').filter(Boolean);
}

function walk(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) files.push(...walk(full));
    else files.push(full);
  }
  return files;
}

const extraDirs = process.argv.slice(2).filter((d) => existsSync(d));
const files = [...gitFiles(), ...extraDirs.flatMap(walk)];
const findings = [];
for (const file of files) {
  if (SKIP.some((re) => re.test(file)) || !existsSync(file)) continue;
  const text = readFileSync(file, 'utf8');
  for (const { name, re } of PATTERNS) {
    if (re.test(text)) findings.push(`${file}: ${name}`);
  }
}

if (findings.length > 0) {
  console.error('Potential secrets found (values not printed):');
  for (const f of findings) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`check-secrets: ${files.length} files scanned, no credential patterns found.`);

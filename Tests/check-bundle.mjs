import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';

const html=fs.readFileSync(new URL('../dist/Vibe-Recorder.html',import.meta.url),'utf8');
assert.ok(html.startsWith('<!doctype html>'));
assert.equal(/<script\b[^>]*\bsrc=/i.test(html),false,'bundle must not load external scripts');
assert.equal(/<link\b[^>]*\brel="stylesheet"/i.test(html),false,'bundle must contain its styles');
assert.equal(/<select\b/i.test(html),false,'default input does not need a page selector');
assert.equal(/\/Users\/|\/var\/folders\/|\.codex\//.test(html),false,'no private local paths');
const script=html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];
assert.ok(script,'inline application is present');
assert.equal(/^import\s/m.test(script),false,'no unresolved module imports');
assert.match(script,/data:text\/javascript;charset=utf-8,/,'embedded worklet uses inline data URL');
const checked=spawnSync(process.execPath,['--check','--input-type=module'],{input:script,encoding:'utf8'});
assert.equal(checked.status,0,checked.stderr);
console.log('PASS: self-contained HTML, inline script syntax, default-input UI, no private local paths.');

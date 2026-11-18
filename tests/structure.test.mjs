import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const root = new URL('../', import.meta.url);
const read = path => fs.readFileSync(new URL(path, root), 'utf8');
test('all static UI element identifiers referenced in main.js exist', () => {
  const html = read('index.html');
  const main = read('src/main.js');
  const ids = [...main.matchAll(/\$\('([\w-]+)'\)/g)].map(x => x[1]);
  for (const id of ids) assert.match(html, new RegExp(`id=["']${id}["']`), `missing ${id}`);
});
test('three actual Coaches DLC models are defined', () => {
  const code = read('src/scene.js');
  for (const item of ['Scania Touring', 'Volvo 9700 DD', 'MAN Lion']) assert.ok(code.includes(item));
});
test('application code directories contain no model or executable assets', () => {
  const banned = /\.(pmd|pmg|pma|scs|glb|exe)$/i;
  for (const folder of ['src','electron','docs']) {
    for (const filename of fs.readdirSync(new URL(folder + '/', root))) assert.ok(!banned.test(filename), filename);
  }
});

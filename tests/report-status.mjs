import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const file = process.argv[2] || new URL('../server/native/CheckClaudeProbe.swift', import.meta.url);
const source = fs.readFileSync(file, 'utf8');
const start = source.indexOf('          const txt =');
const end = source.indexOf('          async function pollReport', start);
assert.ok(start > 0 && end > start, 'real report renderer found');
class Element {
  children = []; className = ''; textContent = '';
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  remove() {}
}
function render(claude) {
  const nodes = new Map(['status', 'content', 'close'].map(key => [key, new Element()]));
  const context = vm.createContext({
    TOKEN: 'test', o: {}, status: nodes.get('status'), content: nodes.get('content'),
    document: {getElementById: key => nodes.get(key), createElement: () => new Element()},
    window: {addEventListener() {}, close() {}}, navigator: {},
    setInterval: () => 1, clearInterval() {}, setTimeout() {},
    fetch: () => Promise.resolve({}),
  });
  vm.runInContext(source.slice(start, end) + '\nglobalThis.renderReport = renderReport;', context);
  context.renderReport({claude, network: {}, browser: {}, quality: {}});
  return nodes.get('content');
}
const passed = {
  score: '98', grade: '优秀', risklevel: '安全', safeuse: '1',
  consistent: 'unknown', probe_state: 'probe_failed',
  verdict: '环境适合运行 Claude', route_notice: '提示：三路出口暂未识别，按通过处理，不影响评分。',
};
const content = render(passed);
const cards = content.children[0].children;
assert.equal(cards[0].className, 'metric good', '98 points must be green');
assert.equal(cards[1].className, 'metric good', 'overall risk remains green');
assert.equal(cards[3].className, 'metric good', 'unidentified route passes');
assert.equal(cards[3].children[0].textContent, '通过（未识别）');
assert.equal(content.children[1].className, 'verdict good');
assert.equal(content.children[2].className, 'desc', 'notice has no warning color');
const conflict = render({...passed, safeuse: '0', risklevel: '高风险', consistent: '0', probe_state: 'ok'});
assert.equal(conflict.children[0].children[3].className, 'metric bad', 'real mismatch stays red');
assert.equal(conflict.children[0].children[1].className, 'metric bad', 'confirmed risk stays red');
console.log('PASS real report renderer: green 98, informational unknown route, red confirmed conflict');

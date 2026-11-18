import test from 'node:test';
import assert from 'node:assert/strict';
import { interpret } from '../src/interpret.mjs';
import { assess, summarize } from '../src/receiving.mjs';
const raw = {"link": "LINK1", "resolver": "R1", "product": "G100", "purpose": "overview", "language": "zh", "resource": "https://supplier.invalid/G100", "general": true};
const scope = "G100";

test('领域记录保留明确的来源上下文', () => {
  const actual = interpret(raw);
  assert.equal(actual.resolver, raw.resolver);
  assert.equal(assess(actual, [actual], scope).status, 'accepted');
});
test('同一业务依据发生矛盾时不能覆盖接收', () => {
  const first = interpret(raw);
  const changed = interpret({"link": "LINK1", "resolver": "R1", "product": "G100", "purpose": "overview", "language": "zh", "resource": "https://other.invalid/resource", "general": true});
  assert.equal(assess(changed, [first], scope).status, 'conflict');
});
test('空目录与范围外内容不声明完成', () => {
  assert.equal(summarize([]).complete, false);
  const outcome = assess(interpret(raw), [], 'other-scope');
  assert.equal(summarize([outcome]).complete, false);
  assert.equal(summarize([outcome]).counts.outside, 1);
});
test('缺少领域核准或接纳依据时保留待处理', () => {
  assert.notEqual(assess(interpret({"link": "LINK1", "resolver": "R1", "product": "G100", "purpose": "overview", "language": "zh", "resource": "https://supplier.invalid/G100", "general": false}), [], scope).status, 'accepted');
});

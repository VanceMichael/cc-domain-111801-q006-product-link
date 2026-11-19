import test from 'node:test';
import assert from 'node:assert/strict';
import { interpret } from '../src/interpret.mjs';
import { interpretRelations, granularityOf } from '../src/relations.mjs';
import { assess, gapsFor, summarize, scopeKey, normalizeScope } from '../src/receiving.mjs';

const base = {
  link: 'LINK1', resolver: 'R1', product: 'G100',
  purpose: 'overview', language: 'zh',
  resource: 'https://supplier.invalid/G100', general: true,
};
const lotScope = { product: 'G100', qualifiers: { lot: 'L1' } };
const serialScope = { product: 'G100', qualifiers: { lot: 'L1', serial: 'S9' } };
const lotRecord = { ...base, qualifiers: { lot: 'L1' }, general: false, resource: 'https://supplier.invalid/G100/L1' };
const sharedRelations = {
  qualifiers: { lot: 'L1' },
  routes: [{ resolver: 'R2', preserves: ['product', 'lot'] }],
  generalizable: ['composition'],
};

test('记录保留实物限定与粒度，语言和用途随收件事实保留', () => {
  const record = interpret(lotRecord);
  assert.deepEqual(record.qualifiers, { lot: 'L1' });
  assert.equal(record.granularity, 'lot');
  const decision = assess(record, [], lotScope, interpretRelations({ routes: [] }));
  assert.equal(decision.status, 'accepted');
  assert.equal(decision.facts.purpose, 'overview');
  assert.equal(decision.facts.language, 'zh');
  assert.equal(decision.facts.granularity, 'lot');
  assert.deepEqual(decision.facts.appliesTo.qualifiers, { lot: 'L1' });
});

test('只认商品号的后续站不能把网页到达当成找到批次实物资料', () => {
  const productRecord = interpret(base);
  const relations = interpretRelations({
    routes: [{ resolver: 'R2', preserves: ['product'] }],
    generalizable: ['composition'],
  });
  const decision = assess(productRecord, [], lotScope, relations);
  assert.equal(decision.status, 'review');
  assert.match(decision.reason, /批次或序列/);
  assert.equal(decision.basis.stoppedAt, undefined);
  assert.deepEqual(decision.basis.route, ['R1', 'R2']);
});

test('来源明确声明商品级资料可供本批次复用时可以接受共用', () => {
  const productRecord = interpret({ ...base, purpose: 'composition' });
  const decision = assess(productRecord, [], lotScope, interpretRelations(sharedRelations));
  assert.equal(decision.status, 'accepted');
  assert.equal(decision.facts.sharing.kind, 'declared-generalizable');
  assert.deepEqual(decision.facts.sharing.purposes, ['composition']);
  assert.equal(decision.facts.appliesTo.granularity, 'lot');
});

test('没有声明支持的用途不能共用：宣传页不能顶替成分用途', () => {
  const productRecord = interpret({ ...base, purpose: 'overview' });
  const decision = assess(productRecord, [], lotScope, interpretRelations(sharedRelations));
  assert.equal(decision.status, 'review');
  assert.match(decision.reason, /复用/);
});

test('一个语言入口缺少某用途资料时留下缺口，而不是宣称实物没有该资料', () => {
  const decision = assess(interpret(lotRecord), [], lotScope, interpretRelations({ routes: [] }));
  const gaps = gapsFor([{ purpose: 'composition', language: 'zh' }], [decision], lotScope);
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].status, 'gap');
  assert.equal(gaps[0].need.purpose, 'composition');
  const summary = summarize([decision, ...gaps]);
  assert.equal(summary.complete, false);
  assert.equal(summary.counts.gap, 1);
});

test('循环跳转要显示停在哪个站及依据', () => {
  const relations = interpretRelations({
    routes: [
      { resolver: 'R2', preserves: ['product', 'lot'] },
      { resolver: 'R1', preserves: ['product'] },
    ],
  });
  const decision = assess(interpret(base), [], lotScope, relations);
  assert.equal(decision.status, 'loop');
  assert.equal(decision.basis.stoppedAt, 'R1');
  assert.deepEqual(decision.basis.route, ['R1', 'R2', 'R1']);
});

test('两个解析站对限定解释不一致时给出冲突与各自解释', () => {
  const relations = interpretRelations({
    qualifiers: { lot: 'L1' },
    routes: [
      { resolver: 'R2', preserves: ['product', 'lot'], qualifiers: { lot: 'L2' } },
    ],
  });
  const decision = assess(interpret(base), [], lotScope, relations);
  assert.equal(decision.status, 'conflict');
  assert.match(decision.reason, /解释不一致/);
  assert.equal(decision.interpretations.length, 2);
  assert.equal(decision.stoppedAt, 'R2');
});

test('重访发现入口解释变化时既有领取结果进入重新确认', () => {
  const first = interpret(lotRecord);
  const changed = interpret({ ...lotRecord, language: 'en' });
  const decision = assess(changed, [first], lotScope, interpretRelations({ routes: [] }));
  assert.equal(decision.status, 'reconfirm');
  assert.deepEqual(decision.changed, ['language']);
  assert.equal(decision.previous.language, 'zh');
});

test('关联路由或复用声明内容变化时同样要求重新确认', () => {
  const record = interpret({ ...base, purpose: 'composition' });
  const prior = [{ record, relationsDigest: 'digest-v1' }];
  const decision = assess(record, prior, lotScope, interpretRelations(sharedRelations), 'digest-v2');
  assert.equal(decision.status, 'reconfirm');
  assert.deepEqual(decision.changed, ['relations']);
  const unchanged = assess(record, prior, lotScope, interpretRelations(sharedRelations), 'digest-v1');
  assert.equal(unchanged.status, 'accepted');
});

test('同一资源可在声明支持下服务多个批次，但批次专用资料不按网址合并', () => {
  const productRecord = interpret({ ...base, purpose: 'composition' });
  const relations = interpretRelations(sharedRelations);
  const forL1 = assess(productRecord, [], { product: 'G100', qualifiers: { lot: 'L1' } }, relations);
  const forL2 = assess(productRecord, [], { product: 'G100', qualifiers: { lot: 'L2' } }, relations);
  assert.equal(forL1.status, 'accepted');
  assert.equal(forL2.status, 'accepted');
  const lotL1 = assess(interpret(lotRecord), [], lotScope, interpretRelations({ routes: [] }));
  const lotL2 = assess(interpret({ ...lotRecord, qualifiers: { lot: 'L2' } }), [],
    { product: 'G100', qualifiers: { lot: 'L2' } }, interpretRelations({ routes: [] }));
  assert.notEqual(lotL1.key, lotL2.key);
  assert.match(lotL1.key, /lot=L1/);
  assert.match(lotL2.key, /lot=L2/);
});

test('限定不匹配与更细粒度资料都不能悄悄并入当前范围', () => {
  const decision = assess(interpret({ ...lotRecord, qualifiers: { lot: 'OTHER' } }), [], lotScope, interpretRelations({}));
  assert.equal(decision.status, 'outside');
  const finer = assess(interpret({ ...lotRecord, qualifiers: { lot: 'L1', serial: 'S9' } }), [], lotScope, interpretRelations({}));
  assert.equal(finer.status, 'review');
});

test('范围键与粒度工具保持稳定', () => {
  assert.equal(scopeKey('G100'), 'G100');
  assert.equal(scopeKey(serialScope), 'G100/lot=L1/serial=S9');
  assert.equal(granularityOf({ lot: 'L1' }), 'lot');
  assert.equal(normalizeScope('G100').granularity, 'product');
});

test('序列范围下批次级资料可回答批次粒度需求，序列需求仍留缺口', () => {
  const lotDecision = assess(interpret(lotRecord), [], serialScope, interpretRelations({ routes: [] }));
  assert.equal(lotDecision.status, 'accepted');
  const lotNeed = gapsFor([{ purpose: 'overview', language: 'zh', granularity: 'lot' }], [lotDecision], serialScope);
  assert.equal(lotNeed.length, 0);
  const serialNeed = gapsFor([{ purpose: 'overview', language: 'zh', granularity: 'serial' }], [lotDecision], serialScope);
  assert.equal(serialNeed.length, 1);
});

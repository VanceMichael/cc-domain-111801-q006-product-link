import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SourceClient } from '../src/http.mjs';
import { fixtureSource } from '../src/fixture-source.mjs';
import { Archive } from '../src/archive.mjs';
import { collect } from '../src/app.mjs';

function buildFixture(overrides = {}) {
  const record = {
    link: 'LINK9', resolver: 'R1', product: 'G200',
    purpose: 'composition', language: 'zh',
    resource: 'https://supplier.invalid/G200', general: true,
  };
  const relations = {
    qualifiers: { lot: 'L7' },
    routes: [{ resolver: 'R2', preserves: ['product', 'lot'] }],
    generalizable: ['composition'],
  };
  return {
    scope: 'G200',
    resources: {
      '/resolver/products': {
        body: { resolver: 'R1', links: [{ id: 'LINK9', href: '/resolver/products/records/LINK9' }] },
      },
      '/resolver/products/records/LINK9': { body: record },
      '/resolver/products/relations/LINK9': { body: relations },
      ...overrides,
    },
  };
}

async function withArchive(source, scope, options) {
  const directory = await mkdtemp(join(tmpdir(), 'qualified-'));
  const archive = await new Archive(directory).start();
  try {
    const result = await collect(new SourceClient(source.url), archive, scope, options);
    return { result, archive, directory };
  } finally {
    archive.close();
  }
}

const lotScope = { product: 'G200', qualifiers: { lot: 'L7' } };

test('声明支持的商品级资料经合作站路由后可被批次领取，原文与关联原文都留存', async () => {
  const fixture = buildFixture();
  const source = await fixtureSource(fixture);
  const directory = await mkdtemp(join(tmpdir(), 'shared-'));
  const archive = await new Archive(directory).start();
  try {
    const result = await collect(new SourceClient(source.url), archive, lotScope);
    assert.equal(result.complete, true);
    const accepted = result.outcomes.find(item => item.status === 'accepted');
    assert.equal(accepted.facts.granularity, 'product');
    assert.equal(accepted.facts.appliesTo.granularity, 'lot');
    assert.equal(accepted.facts.sharing.kind, 'declared-generalizable');
    assert.deepEqual(accepted.basis.route, ['R1', 'R2']);
    const receipts = archive.records('G200/lot=L7');
    assert.equal(receipts.length, 1);
    assert.ok(receipts[0].relations_digest);
    const relationBytes = await archive.original(receipts[0].relations_digest);
    assert.deepEqual(JSON.parse(relationBytes.toString()).generalizable, ['composition']);
    assert.ok(source.accesses.some(item => item.path === '/resolver/products/relations/LINK9'));
  } finally { archive.close(); await source.close(); await rm(directory, { recursive: true, force: true }); }
});

test('后续站只保留商品号时不能领取为批次资料', async () => {
  const fixture = buildFixture({
    '/resolver/products/relations/LINK9': {
      body: { qualifiers: { lot: 'L7' }, routes: [{ resolver: 'R2', preserves: ['product'] }], generalizable: ['composition'] },
    },
  });
  const source = await fixtureSource(fixture);
  try {
    const { result } = await withArchive(source, lotScope);
    assert.equal(result.complete, false);
    assert.equal(result.outcomes[0].status, 'review');
    assert.match(result.outcomes[0].reason, /限定被丢弃/);
  } finally { await source.close(); }
});

test('循环跳转与限定解释冲突在真实领取中可定位停点', async () => {
  const loopFixture = buildFixture({
    '/resolver/products/relations/LINK9': {
      body: { qualifiers: { lot: 'L7' }, routes: [
        { resolver: 'R2', preserves: ['product', 'lot'] },
        { resolver: 'R1', preserves: ['product'] },
      ], generalizable: ['composition'] },
    },
  });
  const loopSource = await fixtureSource(loopFixture);
  try {
    const { result: loopResult } = await withArchive(loopSource, lotScope);
    assert.equal(loopResult.outcomes[0].status, 'loop');
    assert.equal(loopResult.outcomes[0].basis.stoppedAt, 'R1');
  } finally { await loopSource.close(); }

  const conflictFixture = buildFixture({
    '/resolver/products/relations/LINK9': {
      body: { qualifiers: { lot: 'L7' }, routes: [
        { resolver: 'R2', preserves: ['product', 'lot'], qualifiers: { lot: 'L8' } },
      ], generalizable: ['composition'] },
    },
  });
  const conflictSource = await fixtureSource(conflictFixture);
  try {
    const { result: conflictResult } = await withArchive(conflictSource, lotScope);
    assert.equal(conflictResult.outcomes[0].status, 'conflict');
    assert.equal(conflictResult.outcomes[0].stoppedAt, 'R2');
  } finally { await conflictSource.close(); }
});

test('缺少的用途与语言组合形成缺口，通用宣传页不顶替', async () => {
  const fixture = buildFixture();
  const source = await fixtureSource(fixture);
  try {
    const { result } = await withArchive(source, lotScope, {
      needs: [
        { purpose: 'composition', language: 'zh' },
        { purpose: 'composition', language: 'en' },
        { purpose: 'safety', language: 'zh' },
      ],
    });
    assert.equal(result.counts.gap, 2);
    const gapNeeds = result.outcomes.filter(item => item.status === 'gap').map(item => item.need.purpose + ':' + item.need.language).sort();
    assert.deepEqual(gapNeeds, ['composition:en', 'safety:zh']);
    assert.match(result.outcomes.find(item => item.status === 'gap').reason, /缺口/);
  } finally { await source.close(); }
});

test('关联资料 404 不虚报删除，批次需求保持待处理缺口', async () => {
  const fixture = buildFixture({
    '/resolver/products/relations/LINK9': { status: 404, body: { error: '关联暂不存在' } },
  });
  const source = await fixtureSource(fixture);
  try {
    const { result } = await withArchive(source, lotScope, { needs: [{ purpose: 'composition', language: 'zh' }] });
    assert.equal(result.complete, false);
    const review = result.outcomes.find(item => item.status === 'review');
    assert.ok(review.relationsNotice);
    assert.equal(review.relationsNotice.status, 404);
    assert.match(review.relationsNotice.reason, /不解释为业务删除/);
    assert.equal(result.counts.gap, 1);
  } finally { await source.close(); }
});

test('重访发现入口解释变化时重新确认既有领取，旧原文保留', async () => {
  const fixture = buildFixture();
  const source = await fixtureSource(fixture);
  const directory = await mkdtemp(join(tmpdir(), 'revisit-'));
  const archive = await new Archive(directory).start();
  try {
    const first = await collect(new SourceClient(source.url), archive, lotScope);
    assert.equal(first.complete, true);
    const firstDigest = first.outcomes[0].digest;
    source.replace('/resolver/products/records/LINK9', {
      body: { ...fixture.resources['/resolver/products/records/LINK9'].body, language: 'en' },
    });
    const second = await collect(new SourceClient(source.url), archive, lotScope);
    const reconfirm = second.outcomes.find(item => item.status === 'reconfirm');
    assert.ok(reconfirm);
    assert.deepEqual(reconfirm.changed, ['language']);
    const receipts = archive.records('G200/lot=L7');
    assert.equal(receipts.length, 2);
    assert.deepEqual(new Set(receipts.map(item => item.record.language)), new Set(['zh', 'en']));
    const original = await archive.original(firstDigest);
    assert.ok(original.length > 0);
  } finally { archive.close(); await source.close(); await rm(directory, { recursive: true, force: true }); }
});

test('重访发现关联声明变化时重新确认，旧关联原文保留', async () => {
  const fixture = buildFixture();
  const source = await fixtureSource(fixture);
  const directory = await mkdtemp(join(tmpdir(), 'relation-change-'));
  const archive = await new Archive(directory).start();
  try {
    const first = await collect(new SourceClient(source.url), archive, lotScope);
    const firstRelationsDigest = first.outcomes[0].relationsDigest;
    assert.ok(firstRelationsDigest);
    source.replace('/resolver/products/relations/LINK9', {
      body: { ...fixture.resources['/resolver/products/relations/LINK9'].body,
        routes: [{ resolver: 'R2', preserves: ['product'] }] },
    });
    const second = await collect(new SourceClient(source.url), archive, lotScope);
    const reconfirm = second.outcomes.find(item => item.status === 'reconfirm');
    assert.ok(reconfirm);
    assert.deepEqual(reconfirm.changed, ['relations']);
    const oldRelation = await archive.original(firstRelationsDigest);
    assert.deepEqual(JSON.parse(oldRelation.toString()).routes[0].preserves, ['product', 'lot']);
  } finally { archive.close(); await source.close(); await rm(directory, { recursive: true, force: true }); }
});

test('批次专用资料按限定分别落库，网址相似也不合并', async () => {
  const lotSpecific = {
    link: 'LINK9', resolver: 'R1', product: 'G200',
    qualifiers: { lot: 'L7' }, purpose: 'composition', language: 'zh',
    resource: 'https://supplier.invalid/G200/lot', general: false,
  };
  const fixture = {
    scope: 'G200',
    resources: {
      '/resolver/products': { body: { resolver: 'R1', links: [{ id: 'LINK9', href: '/resolver/products/records/LINK9' }] } },
      '/resolver/products/records/LINK9': { body: lotSpecific },
      '/resolver/products/relations/LINK9': { status: 404, body: { error: 'none' } },
    },
  };
  const source = await fixtureSource(fixture);
  const directory = await mkdtemp(join(tmpdir(), 'separate-'));
  const archive = await new Archive(directory).start();
  try {
    await collect(new SourceClient(source.url), archive, { product: 'G200', qualifiers: { lot: 'L7' } });
    source.replace('/resolver/products/records/LINK9', {
      body: { ...lotSpecific, qualifiers: { lot: 'L8' } },
    });
    const second = await collect(new SourceClient(source.url), archive, { product: 'G200', qualifiers: { lot: 'L8' } });
    assert.equal(second.outcomes[0].status, 'accepted');
    const l7 = archive.records('G200/lot=L7');
    const l8 = archive.records('G200/lot=L8');
    assert.equal(l7.length, 1);
    assert.equal(l8.length, 1);
    assert.notEqual(l7[0].business_key, l8[0].business_key);
  } finally { archive.close(); await source.close(); await rm(directory, { recursive: true, force: true }); }
});

import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SourceClient } from '../src/http.mjs';
import { Archive } from '../src/archive.mjs';
import { fixtureSource } from '../src/fixture-source.mjs';
import { collect } from '../src/app.mjs';

const fixture = JSON.parse(await readFile(new URL('../fixtures/source.json', import.meta.url), 'utf8'));
const source = await fixtureSource(fixture);

const directory = await mkdtemp(join(tmpdir(), 'product-link-'));
const archive = await new Archive(directory).start();
try {
  const result = await collect(new SourceClient(source.url), archive, fixture.scope);
  console.log('商品级收件：');
  console.log(JSON.stringify(result, null, 2));

  const lotScope = { product: fixture.scope, qualifiers: { lot: 'L1' } };
  const qualified = await collect(new SourceClient(source.url), archive, lotScope, {
    needs: [
      { purpose: 'composition', language: 'zh' },
      { purpose: 'composition', language: 'en' },
      { purpose: 'safety', language: 'zh' },
    ],
  });
  console.log('实物限定（批次 L1）收件与缺口：');
  console.log(JSON.stringify(qualified, null, 2));

  const serialScope = { product: fixture.scope, qualifiers: { lot: 'L1', serial: 'S9' } };
  const serialRun = await collect(new SourceClient(source.url), archive, serialScope, {
    needs: [{ purpose: 'composition', language: 'zh', granularity: 'serial' }],
  });
  console.log('序列限定（S9）收件，共用声明只覆盖批次粒度：');
  console.log(JSON.stringify(serialRun, null, 2));

  const stored = archive.records(fixture.scope).length
    + archive.records(fixture.scope + '/lot=L1').length
    + archive.records(fixture.scope + '/lot=L1/serial=S9').length;
  console.log('已保存原文与收件记录：', stored);
  if (!result.complete) process.exitCode = 1;
} finally { archive.close(); await source.close();  await rm(directory, { recursive: true, force: true }); }

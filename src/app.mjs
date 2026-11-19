import { browse, retrieve, retrieveRelations } from './source.mjs';
import { interpret } from './interpret.mjs';
import { interpretRelations } from './relations.mjs';
import { assess, summarize, gapsFor, scopeKey, normalizeScope } from './receiving.mjs';

export async function preview(client) {
  const manifest = await browse(client);
  const entries = [];
  for (const ref of manifest.references) {
    const document = await retrieve(client, ref);
    entries.push(interpret(document.raw));
  }
  return { context: manifest.context, entries };
}

export async function collect(client, archive, scopeInput, options = {}) {
  const settings = typeof options === 'function' ? { operator: options } : options;
  const scope = normalizeScope(scopeInput);
  const scopeId = scopeKey(scope);
  const manifest = await browse(client);
  const outcomes = [];
  for (const reference of manifest.references) {
    let digest;
    try {
      const document = await retrieve(client, reference);
      digest = await archive.preserve(document);
      const record = interpret(document.raw);

      const relationsDocument = await retrieveRelations(client, reference);
      let relations = { qualifiers: {}, routes: [], generalizable: [] };
      let relationsDigest = null;
      let relationsNotice = null;
      if (relationsDocument.missing) {
        relationsNotice = { status: relationsDocument.status, location: relationsDocument.location,
          reason: '关联资料暂未发布或无权领取，不解释为业务删除' };
      } else {
        relationsDigest = await archive.preserve(relationsDocument);
        relations = interpretRelations(relationsDocument.raw);
      }

      const prior = archive.records(scopeId)
        .map(item => ({ record: item.record, relationsDigest: item.relations_digest }));
      const decision = assess(record, prior, scope, relations, relationsDigest);
      decision.relationsDigest = relationsDigest;
      if (relationsNotice) decision.relationsNotice = relationsNotice;
      if (settings.operator && decision.status === 'accepted') decision.portal = await settings.operator(record);
      archive.put(scopeId, decision.key ?? reference.identity, digest, record, decision, relationsDigest);
      outcomes.push({ reference: reference.identity, digest, relationsDigest, ...decision });
    } catch (error) {
      outcomes.push({ reference: reference.identity, digest, status: 'error', reason: error.message });
    }
  }
  const gaps = gapsFor(settings.needs, outcomes, scope);
  const all = [...outcomes, ...gaps];
  return { context: manifest.context, scope: { ...scope, key: scopeId }, ...summarize(all) };
}

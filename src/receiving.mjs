import { granularityOf, rank, sameItem } from './relations.mjs';

export function normalizeScope(scope) {
  if (typeof scope === 'string') return { product: scope, qualifiers: {}, granularity: 'product' };
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)) throw new Error('收件范围无效');
  if (!scope.product || typeof scope.product !== 'string') throw new Error('收件范围缺少商品身份');
  const qualifiers = scope.qualifiers ?? {};
  return { product: scope.product, qualifiers, granularity: granularityOf(qualifiers) };
}

export function scopeKey(scope) {
  const normalized = normalizeScope(scope);
  const parts = [normalized.product];
  if (normalized.qualifiers.lot) parts.push('lot=' + normalized.qualifiers.lot);
  if (normalized.qualifiers.serial) parts.push('serial=' + normalized.qualifiers.serial);
  return parts.join('/');
}

function asRecord(entry) {
  return entry && Object.hasOwn(entry, 'record') ? entry.record : entry;
}

function businessKey(record, scope = null) {
  const parts = [record.link];
  const lot = record.qualifiers.lot ?? scope?.qualifiers?.lot;
  const serial = record.qualifiers.serial ?? scope?.qualifiers?.serial;
  if (lot) parts.push('lot=' + lot);
  if (serial) parts.push('serial=' + serial);
  parts.push('purpose=' + record.purpose, 'lang=' + record.language);
  return parts.join('|');
}

function factsFor(record, relations, scope, shared) {
  return {
    product: record.product,
    qualifiers: { ...record.qualifiers },
    granularity: record.granularity,
    purpose: record.purpose,
    language: record.language,
    resource: record.resource,
    resolver: record.resolver,
    appliesTo: { product: scope.product, qualifiers: { ...scope.qualifiers }, granularity: scope.granularity },
    sharing: shared
      ? { kind: 'declared-generalizable', purposes: relations.generalizable, basis: relations.resolver ?? record.resolver }
      : { kind: 'item-specific' },
  };
}

function conflict(reason, basis, extra = {}) {
  return { status: 'conflict', reason, basis, ...extra };
}

function review(reason, basis, extra = {}) {
  return { status: 'review', reason, basis, ...extra };
}

export function assess(record, previous, scopeInput, relationsInput, currentRelationsDigest = null) {
  const scope = normalizeScope(scopeInput);
  const relations = relationsInput ?? { qualifiers: {}, routes: [], generalizable: [] };
  const basis = {
    resolver: record.resolver,
    route: [record.resolver, ...relations.routes.map(route => route.resolver)],
    preserves: relations.routes.map(route => ({ resolver: route.resolver, preserves: route.preserves })),
  };

  if (record.product !== scope.product) {
    return { status: 'outside', reason: '商品身份不匹配', basis };
  }
  if (!sameItem(record.qualifiers, scope.qualifiers)) {
    return { status: 'outside', reason: '实物限定与收件范围不是同一件实物', basis };
  }

  const interpretations = [];
  if (Object.keys(relations.qualifiers).length) interpretations.push({ resolver: relations.resolver ?? record.resolver, qualifiers: relations.qualifiers });
  for (const route of relations.routes) {
    if (route.qualifiers && Object.keys(route.qualifiers).length) {
      interpretations.push({ resolver: route.resolver, qualifiers: route.qualifiers });
    }
  }
  for (let i = 0; i < interpretations.length; i += 1) {
    for (let j = 0; j < i; j += 1) {
      const current = interpretations[i];
      const other = interpretations[j];
      for (const name of ['lot', 'serial']) {
        if (current.qualifiers[name] !== undefined && other.qualifiers[name] !== undefined
          && current.qualifiers[name] !== other.qualifiers[name]) {
          return conflict('两个解析站对实物限定的解释不一致', basis, {
            interpretations, stoppedAt: current.resolver,
          });
        }
      }
    }
  }

  const seenResolvers = new Set([record.resolver]);
  for (const route of relations.routes) {
    if (seenResolvers.has(route.resolver)) {
      return {
        status: 'loop',
        reason: '解析站之间出现循环跳转，未取得该实物的资料',
        basis: { ...basis, stoppedAt: route.resolver },
      };
    }
    seenResolvers.add(route.resolver);
  }

  const priorEntries = previous
    .filter(item => {
      const priorRecord = asRecord(item);
      return priorRecord && priorRecord.link === record.link && priorRecord.product === record.product;
    });
  const prior = priorEntries.find(item => asRecord(item).resource !== record.resource);
  if (prior) {
    return conflict('同一入口声明指向不同资源', basis, { priorResource: asRecord(prior).resource });
  }
  const priorSame = priorEntries.find(item => asRecord(item).resource === record.resource);
  if (priorSame) {
    const priorSameRecord = asRecord(priorSame);
    const changed = [];
    for (const name of ['purpose', 'language']) {
      if (priorSameRecord[name] !== record[name]) changed.push(name);
    }
    for (const name of ['lot', 'serial']) {
      const before = priorSameRecord.qualifiers?.[name];
      const after = record.qualifiers[name];
      if (before !== after) changed.push('qualifiers.' + name);
    }
    const priorRelationsDigest = Object.hasOwn(priorSame, 'relationsDigest') ? priorSame.relationsDigest : null;
    if (currentRelationsDigest && priorRelationsDigest && currentRelationsDigest !== priorRelationsDigest) {
      changed.push('relations');
    }
    if (changed.length) {
      return {
        status: 'reconfirm',
        key: businessKey(priorSameRecord, scope),
        reason: '来源对入口的解释发生变化，需要重新确认既有领取结果',
        basis, changed,
        previous: { qualifiers: { ...(priorSameRecord.qualifiers ?? {}) }, purpose: priorSameRecord.purpose, language: priorSameRecord.language, relationsDigest: priorRelationsDigest },
      };
    }
  }

  const recordRank = rank[record.granularity];
  const scopeRank = rank[scope.granularity];
  if (recordRank > scopeRank) {
    return review('资料限定比收件范围更具体，不能归并到当前实物范围', basis, {
      recordGranularity: record.granularity, scopeGranularity: scope.granularity,
    });
  }

  let shared = false;
  if (recordRank < scopeRank) {
    if (record.granularity === 'product') {
      if (!record.general) {
        return review('通用入口未声明为通用产品资料，不能当作该实物的资料', basis, {
          recordGranularity: record.granularity, scopeGranularity: scope.granularity,
        });
      }
      const preservedAll = relations.routes.every(route =>
        route.preserves.includes('product') && (!scope.qualifiers.lot || route.preserves.includes('lot'))
        && (!scope.qualifiers.serial || route.preserves.includes('serial')));
      if (!preservedAll) {
        return review('跳转链路只保留商品号，已知批次或序列限定被丢弃', basis, {
          recordGranularity: record.granularity, scopeGranularity: scope.granularity,
        });
      }
      if (!relations.generalizable.includes(record.purpose)) {
        return review('来源未声明该用途的商品级资料可供本批次复用', basis, {
          generalizable: relations.generalizable, declaredPurpose: record.purpose,
        });
      }
      shared = true;
    }
  } else if (record.granularity === 'product' && !record.general) {
    return review('不是通用产品资料入口', basis);
  }

  return {
    status: 'accepted',
    key: businessKey(record, scope),
    facts: factsFor(record, relations, scope, shared),
    basis,
  };
}

export function covers(need, decision) {
  if (decision.status !== 'accepted') return false;
  const facts = decision.facts;
  if (facts.purpose !== need.purpose || facts.language !== need.language) return false;
  const needRank = rank[need.granularity ?? facts.appliesTo.granularity];
  if (rank[facts.granularity] >= needRank) return true;
  return facts.sharing.kind === 'declared-generalizable' && needRank <= rank.lot
    && facts.sharing.purposes.includes(need.purpose);
}

export function gapsFor(needs, outcomes, scopeInput) {
  const scope = normalizeScope(scopeInput);
  const needsList = needs ?? [];
  return needsList
    .filter(need => !outcomes.some(outcome => covers(need, outcome)))
    .map(need => ({
      status: 'gap',
      reason: '尚无来源提供该实物相应用途与语言的资料，缺口保留，不以通用宣传页顶替',
      need: {
        product: scope.product,
        qualifiers: { ...scope.qualifiers },
        granularity: need.granularity ?? scope.granularity,
        purpose: need.purpose,
        language: need.language,
      },
    }));
}

export function summarize(outcomes) {
  const counts = {};
  for (const outcome of outcomes) counts[outcome.status] = (counts[outcome.status] ?? 0) + 1;
  const blocking = outcomes.some(outcome => ['conflict', 'loop', 'review', 'error', 'reconfirm', 'gap', 'outside'].includes(outcome.status));
  return {
    complete: outcomes.length > 0 && !blocking && outcomes.every(outcome => outcome.status === 'accepted'),
    counts,
    outcomes,
  };
}

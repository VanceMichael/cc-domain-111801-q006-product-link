import { text } from './validation.mjs';

export const LEVELS = ['product', 'lot', 'serial'];

export function interpretQualifiers(raw) {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new Error('实物限定不是对象');
  const qualifiers = {};
  for (const name of ['lot', 'serial']) {
    if (raw[name] !== undefined) qualifiers[name] = text(raw[name], 'qualifiers.' + name);
  }
  return qualifiers;
}

export function interpretRelations(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('关联记录不是对象');
  const relations = {
    qualifiers: interpretQualifiers(raw.qualifiers),
    routes: [],
    generalizable: [],
  };
  if (raw.resolver !== undefined) relations.resolver = text(raw.resolver, 'resolver');
  if (raw.routes !== undefined) {
    if (!Array.isArray(raw.routes)) throw new Error('路由声明不是数组');
    for (const route of raw.routes) {
      if (!route || typeof route !== 'object' || Array.isArray(route)) throw new Error('路由条目不是对象');
      const resolver = text(route.resolver, 'routes.resolver');
      if (!Array.isArray(route.preserves)) throw new Error('保留限定不是数组：' + resolver);
      const preserves = [];
      for (const value of route.preserves) {
        const level = text(value, 'routes.preserves');
        if (!LEVELS.includes(level)) throw new Error('未知限定级别：' + level);
        if (!preserves.includes(level)) preserves.push(level);
      }
      const entry = { resolver, preserves };
      if (route.qualifiers !== undefined) entry.qualifiers = interpretQualifiers(route.qualifiers);
      relations.routes.push(entry);
    }
  }
  if (raw.generalizable !== undefined) {
    if (!Array.isArray(raw.generalizable)) throw new Error('可复用用途声明不是数组');
    for (const purpose of raw.generalizable) {
      const value = text(purpose, 'generalizable');
      if (!relations.generalizable.includes(value)) relations.generalizable.push(value);
    }
  }
  return relations;
}

export function granularityOf(qualifiers) {
  if (qualifiers?.serial) return 'serial';
  if (qualifiers?.lot) return 'lot';
  return 'product';
}

export const rank = { product: 0, lot: 1, serial: 2 };

export function sameItem(a, b) {
  for (const name of ['lot', 'serial']) {
    if (a[name] !== undefined && b[name] !== undefined && a[name] !== b[name]) return false;
  }
  return true;
}

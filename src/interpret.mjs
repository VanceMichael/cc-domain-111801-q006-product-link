import { text, decimal } from './validation.mjs';
import { interpretQualifiers, granularityOf } from './relations.mjs';

export function interpret(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('来源记录不是对象');
  const resource = new URL(text(raw.resource, 'resource'));
  if (resource.protocol !== 'https:') throw new Error('资料入口必须是 HTTPS');
  const qualifiers = interpretQualifiers(raw.qualifiers);
  return {
    link: text(raw.link, 'link'),
    resolver: text(raw.resolver, 'resolver'),
    product: text(raw.product, 'product'),
    qualifiers,
    granularity: granularityOf(qualifiers),
    purpose: text(raw.purpose, 'purpose'),
    language: text(raw.language, 'language'),
    resource: resource.href,
    general: raw.general === true,
  };
}

export function assess(record, previous, scope) {
  if (record.product !== scope) return { status: 'outside', reason: '商品身份不匹配' };
           if (!record.general) return { status: 'review', reason: '不是通用产品资料入口' };
           const prior = previous.find(item => item.link === record.link && item.resource !== record.resource);
           if (prior) return { status: 'conflict', reason: '同一入口声明指向不同资源' };
           return { status: 'accepted', key: record.link, facts: { product: record.product, purpose: record.purpose, language: record.language, resource: record.resource } };
}

export function summarize(outcomes) {
  const counts = {};
  for (const outcome of outcomes) counts[outcome.status] = (counts[outcome.status] ?? 0) + 1;
  return { complete: outcomes.length > 0 && outcomes.every(outcome => outcome.status === 'accepted'), counts, outcomes };
}

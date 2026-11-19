import { text } from './validation.mjs';
import { SourceError } from './http.mjs';

export const collectionPath = "/resolver/products";
export function relationsPath(identity) {
  return "/resolver/products/relations/" + encodeURIComponent(identity);
}
export async function browse(client) {
  const document = await client.get(collectionPath);
  const raw = document.raw;
  const context = text(raw.resolver, "resolver");
  if (!Array.isArray(raw.links)) throw new Error('来源目录结构无效');
  const references = raw.links.map(entry => ({
    identity: text(entry.id, 'id'), href: text(entry.href, 'href'), context,
  }));
  if (new Set(references.map(entry => entry.identity)).size !== references.length) throw new Error('目录包含重复来源身份');
  return { context, references };
}
export async function retrieve(client, reference) {
  const document = await client.get(reference.href);
  if (document.raw.link !== reference.identity) throw new Error('原文身份与目录引用不符');
  if (document.raw.resolver !== reference.context) throw new Error('原文上下文与目录不符');
  return document;
}
export async function retrieveRelations(client, reference) {
  try {
    const document = await client.get(relationsPath(reference.identity));
    if (document.raw && document.raw.link !== undefined && document.raw.link !== reference.identity) {
      throw new Error('关联文档身份与目录引用不符');
    }
    return document;
  } catch (error) {
    if (error instanceof SourceError && (error.status === 404 || error.status === 403)) {
      return { missing: true, status: error.status, location: new URL(relationsPath(reference.identity), client.base).href };
    }
    throw error;
  }
}

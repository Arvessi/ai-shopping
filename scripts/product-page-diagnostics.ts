import { fetchText } from "../collector/http.ts";
import { getCollectorStore } from "../collector/store-registry.ts";
import { parseProductPage } from "../collector/product-page.ts";

const [slug, url] = process.argv.slice(2);
const store = slug ? getCollectorStore(slug) : undefined;
if (!store || !url) throw new Error("Usage: product-page-diagnostics <store-slug> <url>");

const html = await fetchText(url);
const compact = html
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
  .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
  .replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;|&#160;/gi, " ")
  .replace(/&euro;|&#8364;/gi, "€")
  .replace(/\s+/g, " ");

const metas = [...html.matchAll(/<meta\s+[^>]*(?:property|name|itemprop)=["']([^"']+)["'][^>]*content=["']([^"']*)["'][^>]*>/gi)]
  .map((match) => ({ key: match[1], value: match[2] }))
  .filter((entry) => /(?:price|product|og:title|og:type|og:image|brand|sku)/i.test(entry.key))
  .slice(0, 40);
const priceSnippets = [...compact.matchAll(/.{0,100}(?:\d[\d\s]*(?:[.,]\d{1,2})?\s*€|€\s*\d[\d\s]*(?:[.,]\d{1,2})?).{0,100}/g)]
  .map((match) => match[0].trim())
  .slice(0, 15);
const rawPriceSignals = [...html.matchAll(/.{0,100}(?:fullPrice|oneTimePrice|regularPrice|retailPrice|devicePrice|cashPrice|piln[aā]\s+cena|p[eē]rkot\s+uzreiz).{0,160}/gi)]
  .map((match) => match[0].replace(/\s+/g, " ").trim())
  .slice(0, 20);

console.log(JSON.stringify({
  slug,
  url,
  bytes: html.length,
  title: html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
  h1: html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
  metas,
  priceSnippets,
  rawPriceSignals,
  parsed: parseProductPage(html, url, store),
}, null, 2));

import { catalogProductLinks } from "../collector/catalog-adapter.ts";
import { fetchText } from "../collector/http.ts";
import { getCollectorStore } from "../collector/store-registry.ts";

const slug = process.argv[2];
const store = slug ? getCollectorStore(slug) : undefined;
if (!store) throw new Error("Usage: catalog-listing-diagnostics <store-slug>");

const results = [];
for (const url of store.catalogUrls || []) {
  try {
    const html = await fetchText(url);
    const links = catalogProductLinks(html, url, store);
    results.push({ url, bytes: html.length, productLinks: links.length, samples: links.slice(0, 20) });
  } catch (error) {
    results.push({ url, error: error instanceof Error ? error.message : String(error) });
  }
}
console.log(JSON.stringify({ slug, results }, null, 2));

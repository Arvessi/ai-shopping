import { getCollectorStore } from "../collector/store-registry.ts";
import { expandSitemaps, resolveStoreSitemapUrls } from "../collector/http.ts";

const slugs = ["m79", "euronics", "lmt"];

function signature(rawUrl: string) {
  try {
    const url = new URL(rawUrl);
    const parts = url.pathname.split("/").filter(Boolean);
    return "/" + parts.slice(0, 3).map((part) => {
      if (/^\d+$/.test(part)) return ":id";
      if (/^[0-9a-f-]{16,}$/i.test(part)) return ":token";
      return part.length > 40 ? ":slug" : part;
    }).join("/");
  } catch {
    return "invalid";
  }
}

for (const slug of slugs) {
  const store = getCollectorStore(slug)!;
  const roots = await resolveStoreSitemapUrls(store);
  const entries = await expandSitemaps(store, roots, 12);
  const counts = new Map<string, number>();

  for (const entry of entries) {
    const key = signature(entry.loc);
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  const topPatterns = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .map(([pattern, count]) => ({ pattern, count }));

  const samples = entries.slice(0, 20).map((entry) => entry.loc);

  console.log(JSON.stringify({
    slug,
    roots,
    totalUrls: entries.length,
    topPatterns,
    samples,
  }, null, 2));
}

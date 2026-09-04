import { fetchText } from "../collector/http.ts";

const url = "https://m79.lv/mobile-phone/mobilie-telefoni/xiaomi-redmi-note-13-dual-4g-6128gb-ice-blue-damaged-box-00101950";
const html = await fetchText(url);

const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const metas = [...html.matchAll(/<meta\s+[^>]*(?:property|name)=["']([^"']+)["'][^>]*content=["']([^"']*)["'][^>]*>/gi)]
  .map((m) => ({ key: m[1], value: m[2] }))
  .filter((m) => /^(og:|product:|twitter:)/i.test(m.key))
  .slice(0, 30);
const ldTypes = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)]
  .flatMap((m) => {
    try {
      const parsed = JSON.parse(m[1]);
      const items = Array.isArray(parsed) ? parsed : [parsed];
      return items.map((item) => item?.["@type"]).filter(Boolean);
    } catch {
      return ["invalid-jsonld"];
    }
  });

const text = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
  .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
  .replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;/gi, " ")
  .replace(/&euro;/gi, "€")
  .replace(/\s+/g, " ");

const priceSnippets = [...text.matchAll(/.{0,80}\b\d{1,5}(?:[.,]\d{1,2})?\s*€.{0,80}/g)]
  .map((m) => m[0].trim())
  .slice(0, 12);

console.log(JSON.stringify({ url, title, h1, metas, ldTypes, priceSnippets }, null, 2));

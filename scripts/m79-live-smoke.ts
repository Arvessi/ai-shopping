import { getCollectorStore } from "../collector/store-registry.ts";
import { fetchText } from "../collector/http.ts";
import { parseProductPage } from "../collector/product-page.ts";

const store = getCollectorStore("m79");
if (!store) throw new Error("M79 store config missing");

const urls = [
  "https://m79.lv/mobile-phone/mobilie-telefoni/xiaomi-redmi-note-13-dual-4g-6128gb-ice-blue-damaged-box-00101950",
  "https://m79.lv/mobile-phone/mobilie-telefoni/motorola-moto-g57-power-viedtalrunis-12gb--256gb-blue-0840493608990",
  "https://m79.lv/mobile-phone/mobilie-telefoni/zte-blade-a76-5g-171-cm-675-dual-sim-usb-typec-6-gb-128-gb-5000-mah-czarny",
];

const results = [];
for (const url of urls) {
  try {
    const html = await fetchText(url);
    results.push({ url, offer: parseProductPage(html, url, store) });
  } catch (error) {
    results.push({ url, error: error instanceof Error ? error.message : String(error) });
  }
}

console.log(JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2));
const parsed = results.filter((row: any) => row.offer).length;
console.log(`\nSUMMARY parsed=${parsed}/${urls.length}`);
process.exitCode = parsed > 0 ? 0 : 2;

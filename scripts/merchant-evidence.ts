import { fetchText } from '../collector/http.ts';
import { parseProductPage } from '../collector/product-page.ts';
import { getCollectorStore } from '../collector/store-registry.ts';
import { writeFile, mkdir } from 'node:fs/promises';
const pages = [['dateks', 'https://www.dateks.lv/cenas/viedtalruni/1249417-samsung-galaxy-s25-12gb-256gb-blue-black'], ['1a', 'https://www.1a.lv/p/mobilais-telefons-samsung-galaxy-s25-128-gb-melna-kras/wgae'], ['aio', 'https://aio.lv/lv/product--samsung-sm-s931bzsgeub--11255904'], ['tet', 'https://www.tet.lv/veikals/viedtalruni/samsung-galaxy-s25-12-128gb-navy.html'], ['220', 'https://220.lv/lv/mobilie-telefoni/telefons-samsung-galaxy-s25-ai-viedtalrunis-128-gb?id=68347003']];
await mkdir('.next/merchant-evidence', { recursive: true });
for (const [slug, url] of pages) {
    const store = getCollectorStore(slug)!;
    const results = await Promise.allSettled([fetchText(new URL('/robots.txt', url).href, 8000), fetchText(url, 10000)]);
    const robots = results[0];
    console.log(slug, 'robots', robots.status === 'fulfilled' ? robots.value.slice(0, 2200) : String(robots.reason));
    const page = results[1];
    if (page.status === 'fulfilled') {
        await writeFile(`.next/merchant-evidence/${slug}.html`, page.value);
        console.log(slug, 'product', JSON.stringify(parseProductPage(page.value, url, store)));
        console.log(slug, 'search forms', page.value.match(/<form[^>]+(?:search|action)[^>]*>/gi)?.slice(0, 4));
    }
    else
        console.log(slug, 'product', String(page.reason));
}

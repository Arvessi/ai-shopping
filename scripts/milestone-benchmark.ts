import { mkdir, writeFile } from 'node:fs/promises';
const base = process.argv[2] || 'http://127.0.0.1:3000';
const queries = ['Samsung Galaxy S25', 'iPhone 16', 'Honor 400 Lite', 'Sony WH-1000XM5', 'Lenovo Legion 5', 'LG OLED C4', 'Canon EOS R50', 'Epson EcoTank L3250', 'MacBook Air M3 16GB 512GB'];
const prompts = ['telefons līdz 600 € ar labu kameru', 'gaming laptop līdz 1200 € ar vismaz 16GB RAM', '55 collu OLED TV ar 120Hz', 'salīdzini iPhone 16 un Samsung Galaxy S25', 'portatīvais darbam un video montāžai līdz 1500 €'];
const search = [];
for (const query of queries) {
    const r = await fetch(`${base}/api/search`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ q: query }) });
    const d = await r.json();
    search.push({ query, status: r.status, results: (d.results || []).map((p: any) => ({ id: p.id, title: p.title, merchants: p.storesCount, bestPrice: p.bestPrice, variants: p.catalogVariants?.length, image: !!p.image, score: p.dealScore })), error: d.error });
}
const ai = [];
for (const prompt of prompts) {
    const r = await fetch(`${base}/api/ai`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt }) });
    const d = await r.json();
    ai.push({ prompt, status: r.status, plan: d.plan, recommendations: d.recommendations?.length || 0, error: d.error });
}
await mkdir('docs', { recursive: true });
await writeFile('docs/benchmark-results.json', JSON.stringify({ base, checkedAt: new Date().toISOString(), search, ai }, null, 2));
console.log(JSON.stringify({ search: search.map(r => ({ query: r.query, status: r.status, groups: r.results.length })), ai: ai.map(r => ({ prompt: r.prompt, status: r.status, parsed: !!r.plan, recommendations: r.recommendations })) }, null, 2));

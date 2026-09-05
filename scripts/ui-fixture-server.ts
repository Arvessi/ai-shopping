import { createServer } from 'node:http';
import { connect } from 'node:net';
import { fixtureProducts } from '../tests/fixtures/ui-catalog.ts';
import { parseShoppingIntent, rankShoppingProducts } from '../lib/shopping-intent.ts';
// Local-only UI test proxy: synthetic API responses; no DB or merchant writes.
// Run beside `npm run dev`, then visit http://127.0.0.1:3001.
const server = createServer(async (req, res) => {
    try {
        const url = new URL(req.url!, 'http://127.0.0.1:3001');
        let body = '';
        for await (const c of req)
            body += c;
        const json = (value: unknown, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); };
        if (url.pathname === '/api/search')
            return json({ results: fixtureProducts, message: 'UI pārbaude: sintētiski dati, nevis aktuālas cenas.' });
        if (url.pathname === '/api/ai') {
            const plan = parseShoppingIntent(JSON.parse(body).prompt);
            return json({ plan, recommendations: rankShoppingProducts(fixtureProducts, plan) });
        }
        if (url.pathname === '/api/popular')
            return json({ searches: ['Samsung Galaxy S25', 'samsung galaxy s25', 'iPhone 16'] });
        if (url.pathname === '/api/auth/me')
            return json({ user: null });
        if (url.pathname === '/api/wishlist' || url.pathname === '/api/alerts')
            return json({ error: 'Jāielogojas.' }, 401);
        if (/\/api\/products\/.+\/refresh/.test(url.pathname))
            return json({ pending: false, status: 'succeeded', message: 'UI testa atjaunošana pabeigta.' });
        if (/\/api\/products\/.+\/verdict/.test(url.pathname))
            return json({ verdict: { verdict: 'Salīdzini vēl', summary: 'Sintētisku datu UI tests.', reasons: ['Testa piedāvājumi.'], confidence: 'zema' }, provider: 'fixture' });
        if (url.pathname.startsWith('/api/products/')) {
            const p = fixtureProducts.find(p => url.pathname.endsWith(p.id));
            return json({ product: { ...p, selectedVariantId: url.searchParams.get('variantId') || p?.selectedVariantId, currentBestPrice: p?.bestPrice, lastEnrichedAt: new Date().toISOString(), snapshots: [{ price: 650, recordedAt: '2026-09-01' }, { price: 625, recordedAt: '2026-09-02' }, { price: 599, recordedAt: '2026-09-03' }] } });
        }
        const upstream = await fetch(`http://127.0.0.1:3000${req.url}`, { method: req.method, headers: Object.fromEntries(Object.entries({ ...req.headers, host: '127.0.0.1:3000' }).filter(([, v]) => v !== undefined).map(([k, v]) => [k, Array.isArray(v) ? v.join(',') : String(v)])), body: ['GET', 'HEAD'].includes(req.method!) ? undefined : body });
        res.writeHead(upstream.status, { 'content-type': upstream.headers.get('content-type') || 'text/html' });
        res.end(Buffer.from(await upstream.arrayBuffer()));
    }
    catch (e) {
        res.writeHead(502);
        res.end(String(e));
    }
}).listen(3001, '127.0.0.1', () => console.log('UI FIXTURES ONLY http://127.0.0.1:3001 — not real catalog data'));
server.on('upgrade', (req, socket, head) => { const upstream = connect(3000, '127.0.0.1', () => { upstream.write(`${req.method} ${req.url} HTTP/1.1\r\n${Object.entries(req.headers).map(([k, v]) => `${k}: ${v}`).join('\r\n')}\r\n\r\n`); if (head.length)
    upstream.write(head); socket.pipe(upstream).pipe(socket); }); upstream.on('error', () => socket.destroy()); socket.on('error', () => upstream.destroy()); });

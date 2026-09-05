import { NextResponse } from 'next/server';
import { databaseConfigured, prisma } from '@/lib/db';
import { isRestrictedShoppingQuery } from '@/lib/safety';
import { getCanonicalProduct, searchCanonicalCatalog } from '@/lib/canonical/catalog';
import { reconcileStrongFamilies } from '@/lib/canonical/reconcile-results';
import { parseShoppingIntent, rankShoppingProducts } from '@/lib/shopping-intent';
import { sameProduct } from '@/collector/relevance';
import type { ProductResult } from '@/lib/types';
export const maxDuration = 30;
export async function POST(request: Request) {
    try {
        const { prompt: raw } = await request.json();
        const prompt = String(raw || '').trim();
        if (!prompt || prompt.length > 700)
            return NextResponse.json({ error: 'Aprakstam jābūt no 1 līdz 700 rakstzīmēm.' }, { status: 400 });
        if (isRestrictedShoppingQuery(prompt))
            return NextResponse.json({ error: 'CENIQ AI šo produktu kategoriju neapstrādā.' }, { status: 400 });
        const plan = parseShoppingIntent(prompt);
        if (!databaseConfigured())
            return NextResponse.json({ plan, error: 'CENIQ katalogam nav konfigurēta datubāze.', recommendations: [], provider: 'ceniq-catalog' }, { status: 503 });
        const queries = plan.comparisonTargets.length === 2 ? plan.comparisonTargets : [plan.searchQuery];
        const groups = await Promise.all(queries.map(async (query) => {
            let products = await searchCanonicalCatalog(query);
            if (plan.comparisonTargets.length || query !== plan.category)
                products = products.filter(p => sameProduct(p.title, query));
            if (!plan.comparisonTargets.length && plan.category && query === plan.category) {
                const aliases: Record<string, string[]> = { laptop: ['laptop', 'notebook', 'portat'], smartphone: ['phone', 'telef', 'mobile'], TV: ['tv', 'televiz'], monitor: ['monitor'], headphones: ['headphone', 'austi'], camera: ['camera', 'kamera', 'foto'] };
                const rows = await prisma.productFamily.findMany({ where: { status: 'ACTIVE', OR: (aliases[plan.category] || [plan.category]).map(needle => ({ category: { contains: needle, mode: 'insensitive' as const } })) }, select: { id: true }, take: 60 });
                const extra = await Promise.all(rows.filter(row => !products.some(p => p.id === row.id)).map(row => getCanonicalProduct(row.id)));
                products = [...products, ...extra.filter((p): p is ProductResult => Boolean(p))];
            }
            return rankShoppingProducts(reconcileStrongFamilies(products), plan);
        }));
        const recommendations = plan.comparisonTargets.length === 2 ? groups.flatMap(group => group.slice(0, 1)) : groups[0];
        const missingTargets = plan.comparisonTargets.filter((_, index) => !groups[index]?.length);
        return NextResponse.json({ plan, recommendations, missingTargets, provider: 'ceniq-catalog', message: recommendations.length ? undefined : 'Katalogā nav pārbaudāmu piedāvājumu šīm prasībām. Pamēģini plašāku atlasi.' }, { headers: { 'Cache-Control': 'no-store' } });
    }
    catch (error) {
        console.error('CENIQ AI catalog', error);
        return NextResponse.json({ error: 'Katalogu neizdevās ielādēt. Pamēģini vēlreiz.' }, { status: 502 });
    }
}

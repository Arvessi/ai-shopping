import { NextRequest, NextResponse } from 'next/server';
import { products } from '../../../lib/mockData';

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get('q')?.trim().toLowerCase() ?? '';
  if (!q) return NextResponse.json({ results: [] });

  const terms = q.split(/\s+/).filter(Boolean);
  const results = products
    .map((product) => {
      const haystack = `${product.title} ${product.brand} ${product.category}`.toLowerCase();
      const hits = terms.filter((term) => haystack.includes(term)).length;
      return { product, score: hits / Math.max(terms.length, 1) };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || b.product.dealScore - a.product.dealScore)
    .map((x) => x.product);

  return NextResponse.json({ results });
}

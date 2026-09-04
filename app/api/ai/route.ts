import { NextResponse } from 'next/server';
import { isRestrictedShoppingQuery } from '@/lib/safety';
import type { AiShoppingPlan } from '@/lib/types';

function extractBudget(prompt: string) {
  const patterns = [
    /(?:līdz|zem|max(?:imum)?|budžets?\s*(?:ir|līdz)?|under|up to)\s*€?\s*(\d{2,6}(?:[.,]\d{1,2})?)\s*(?:€|eur|eiro)?/i,
    /(\d{2,6}(?:[.,]\d{1,2})?)\s*(?:€|eur|eiro)\b/i,
  ];
  for (const pattern of patterns) {
    const match = prompt.match(pattern);
    if (!match?.[1]) continue;
    const value = Number(match[1].replace(',', '.'));
    if (Number.isFinite(value) && value > 0) return value;
  }
  return undefined;
}

function categoryFromPrompt(prompt: string) {
  const value = prompt.toLowerCase();
  const rules: Array<[RegExp, string, string]> = [
    [/\b(portat[iī]v|laptop|notebook)\b/i, 'laptop', 'Portatīvais dators'],
    [/\b(gaming\s*(?:dators?|pc)|sp[eē][lļ]u\s*dators?|desktop|stacion[aā]r)\b/i, 'gaming computer', 'Spēļu dators'],
    [/\b(iphone|smartphone|telefons?|viedt[aā]lrun)\b/i, value.includes('iphone') ? 'iPhone' : 'smartphone', 'Viedtālrunis'],
    [/\b(monitor|displej)\b/i, 'monitor', 'Monitors'],
    [/\b(televizor|\btv\b|oled|qled)\b/i, 'TV', 'Televizors'],
    [/\b(austi[nņ]|headphone|earbud|audio)\b/i, 'headphones', 'Audio'],
    [/\b(kamera|camera|fotoapar)\b/i, 'camera', 'Kamera'],
    [/\b(plan[sš]et|tablet|ipad)\b/i, value.includes('ipad') ? 'iPad' : 'tablet', 'Planšete'],
    [/\b(ledusskap|ve[lļ]as\s*ma[sš][iī]n|trauku\s*mazg|putek[lļ]u\s*s[uū]c|sadz[iī]ves\s+tehnik)\b/i, 'home appliance', 'Sadzīves tehnika'],
    [/\b(velosip|velo|bike|bicycle)\b/i, 'bike', 'Velosipēds'],
    [/\b(sport|fitness|skrie[sš]an)\b/i, 'sports', 'Sporta prece'],
    [/\b(kosm[eē]tik|smar[zž]|beauty|skaistum)\b/i, 'beauty', 'Skaistumkopšanas prece'],
    [/\b(rota[lļ]liet|toy|b[eē]rniem)\b/i, 'toys', 'Rotaļlieta'],
    [/\b(m[eē]bel|m[aā]jai|home)\b/i, 'home', 'Prece mājai'],
  ];
  for (const [pattern, query, label] of rules) if (pattern.test(value)) return { query, label };
  return { query: '', label: 'Produkts' };
}

function explicitSpecs(prompt: string) {
  const constraints: string[] = [];
  const patterns: Array<[RegExp, (match: RegExpMatchArray) => string]> = [
    [/\b(\d{2,3})\s*(?:hz)\b/i, (m) => `${m[1]} Hz`],
    [/\b(\d{2,3}(?:[.,]\d)?)\s*(?:coll|inch|")\b/i, (m) => `${m[1]}″`],
    [/\b(\d{2,4})\s*gb\b/i, (m) => `${m[1]} GB`],
    [/\b(\d+(?:[.,]\d+)?)\s*tb\b/i, (m) => `${m[1]} TB`],
    [/\b(rtx\s*\d{4}(?:\s*ti)?|rx\s*\d{4}(?:\s*xt)?)\b/i, (m) => m[1].replace(/\s+/g, ' ').toUpperCase()],
    [/\b(oled|qled|mini\s*led|ips)\b/i, (m) => m[1].toUpperCase()],
    [/\b(4k|8k|uhd|qhd|fhd)\b/i, (m) => m[1].toUpperCase()],
  ];
  for (const [pattern, formatter] of patterns) {
    const match = prompt.match(pattern);
    if (match) constraints.push(formatter(match));
  }
  return [...new Set(constraints)];
}

function compactSearchQuery(prompt: string, categoryQuery: string) {
  let query = prompt
    .replace(/(?:līdz|zem|max(?:imum)?|budžets?\s*(?:ir|līdz)?|under|up to)\s*€?\s*\d{2,6}(?:[.,]\d{1,2})?\s*(?:€|eur|eiro)?/gi, ' ')
    .replace(/\b(man vajag|es mekl[eē]ju|mekl[eē]ju|gribu|vēlos|velos|lūdzu|please|atrodi|ieteic|lab[aā]ko?|labs?|jaud[iī]gu?|izdev[iī]gu?)\b/gi, ' ')
    .replace(/\b(ar|un|kas|būtu|butu|priekš|prieks)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (categoryQuery && !query.toLowerCase().includes(categoryQuery.toLowerCase())) query = `${categoryQuery} ${query}`.trim();
  return (query || categoryQuery || prompt).slice(0, 180);
}

function fallbackPlan(prompt: string): AiShoppingPlan {
  const maxPrice = extractBudget(prompt);
  const category = categoryFromPrompt(prompt);
  const specs = explicitSpecs(prompt);
  const constraints = [...(maxPrice ? [`Budžets līdz ${maxPrice.toLocaleString('lv-LV')} €`] : []), ...specs];
  return {
    searchQuery: compactSearchQuery(prompt, category.query),
    summary: maxPrice
      ? `Meklēšu ${category.label.toLowerCase()} variantus līdz ${maxPrice.toLocaleString('lv-LV')} € CENIQ katalogā.`
      : `Meklēšu ${category.label.toLowerCase()} variantus un salīdzināšu aktuālos veikalu piedāvājumus.`,
    constraints,
    category: category.label,
    maxPrice,
  };
}

function validPlan(value: any, fallback: AiShoppingPlan): AiShoppingPlan {
  const searchQuery = String(value?.searchQuery || '').trim();
  return {
    searchQuery: (searchQuery || fallback.searchQuery).slice(0, 180),
    summary: String(value?.summary || fallback.summary).trim().slice(0, 280),
    constraints: Array.isArray(value?.constraints)
      ? value.constraints.map((item: unknown) => String(item).trim()).filter(Boolean).slice(0, 8)
      : fallback.constraints,
    category: String(value?.category || fallback.category).trim().slice(0, 80),
    // Budget is deterministically parsed from the user's words. The model is
    // never allowed to invent a tighter/looser price ceiling.
    maxPrice: fallback.maxPrice,
  };
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const prompt = String(body?.prompt || '').trim();
    if (!prompt) return NextResponse.json({ error: 'Apraksti, ko vēlies atrast.' }, { status: 400 });
    if (isRestrictedShoppingQuery(prompt)) return NextResponse.json({ error: 'CENIQ AI šo produktu kategoriju neapstrādā.' }, { status: 400 });

    const fallback = fallbackPlan(prompt);
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return NextResponse.json({ plan: fallback, provider: 'ceniq-local-planner' });

    const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    let response: Response;
    try {
      response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            system_instruction: {
              parts: [{
                text: `Tu esi CENIQ produktu meklēšanas plānotājs Latvijai. Atbildi TIKAI JSON ar laukiem searchQuery, summary, constraints, category.\n- searchQuery ir īsa produkta identitātes/meklēšanas frāze, nevis pilns teikums.\n- Budžetu neiekļauj searchQuery.\n- Neizdomā modeli vai specifikāciju, ko lietotājs nav prasījis.\n- Saglabā precīzu modeli, ja lietotājs to nosauc.\n- summary raksti īsi latviski.\n- Rezultātus meklēs tikai CENIQ iekšējā katalogā; neapgalvo, ka konkrēta prece ir pieejama.`,
              }],
            },
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { responseMimeType: 'application/json', temperature: 0.1, maxOutputTokens: 350 },
          }),
          cache: 'no-store',
          signal: AbortSignal.timeout(8_000),
        },
      );
    } catch {
      return NextResponse.json({ plan: fallback, provider: 'ceniq-local-planner' });
    }

    if (!response.ok) return NextResponse.json({ plan: fallback, provider: 'ceniq-local-planner' });
    const json = await response.json();
    const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return NextResponse.json({ plan: fallback, provider: 'ceniq-local-planner' });

    try {
      return NextResponse.json({ plan: validPlan(JSON.parse(text), fallback), provider: 'gemini' });
    } catch {
      return NextResponse.json({ plan: fallback, provider: 'ceniq-local-planner' });
    }
  } catch {
    return NextResponse.json({ error: 'CENIQ AI neizdevās.' }, { status: 502 });
  }
}

import { NextResponse } from 'next/server';
import { isRestrictedShoppingQuery } from '@/lib/safety';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const prompt = String(body?.prompt || '').trim();
    if (!prompt) return NextResponse.json({ error: 'Apraksti, ko vēlies atrast.' }, { status: 400 });
    if (isRestrictedShoppingQuery(prompt)) return NextResponse.json({ error: 'Ceniq AI šo produktu kategoriju neapstrādā.' }, { status: 400 });
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return NextResponse.json({ error: 'OPENAI_API_KEY nav konfigurēts.' }, { status: 500 });

    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-5.6-sol',
        instructions: 'Tu esi Ceniq AI — Latvijas pircēja produktu atlases asistents. Izveido konkrētu Google Shopping meklēšanas frāzi angļu valodā, saglabājot modeļus, izmērus un tehniskos parametrus. Neizdomā parametrus, kurus lietotājs nav prasījis. Kopsavilkumu raksti latviski. Nekad neiesaki aizliegtas vai vecumam ierobežotas preces.',
        input: prompt,
        text: {
          format: {
            type: 'json_schema',
            name: 'ceniq_shopping_plan',
            strict: true,
            schema: {
              type: 'object',
              properties: {
                searchQuery: { type: 'string' },
                summary: { type: 'string' },
                constraints: { type: 'array', items: { type: 'string' } },
                category: { type: 'string' }
              },
              required: ['searchQuery', 'summary', 'constraints', 'category'],
              additionalProperties: false
            }
          }
        }
      }),
      cache: 'no-store'
    });
    const json = await response.json();
    if (!response.ok) throw new Error(json?.error?.message || 'OpenAI pieprasījums neizdevās.');
    const outputText = json?.output?.flatMap((item: any) => item?.content || []).find((c: any) => c?.type === 'output_text')?.text;
    if (!outputText) throw new Error('Ceniq AI neatgrieza atbildi.');
    return NextResponse.json({ plan: JSON.parse(outputText) });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Ceniq AI neizdevās.' }, { status: 502 });
  }
}

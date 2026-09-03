import { NextResponse } from 'next/server';
import { isRestrictedShoppingQuery } from '@/lib/safety';

type ShoppingPlan = {
  searchQuery: string;
  summary: string;
  constraints: string[];
  category: string;
};

function fallbackPlan(
  prompt: string,
): ShoppingPlan {
  return {
    searchQuery: prompt,
    summary:
      'Meklēšu pēc tava apraksta. Bez AI atslēgas CENIQ izmanto pašu tekstu kā meklēšanas frāzi.',
    constraints: [],
    category: 'shopping',
  };
}

export async function POST(
  request: Request,
) {
  try {
    const body =
      await request.json();

    const prompt = String(
      body?.prompt || '',
    ).trim();

    if (!prompt) {
      return NextResponse.json(
        {
          error:
            'Apraksti, ko vēlies atrast.',
        },
        { status: 400 },
      );
    }

    if (
      isRestrictedShoppingQuery(
        prompt,
      )
    ) {
      return NextResponse.json(
        {
          error:
            'CENIQ AI šo produktu kategoriju neapstrādā.',
        },
        { status: 400 },
      );
    }

    const apiKey =
      process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return NextResponse.json({
        plan:
          fallbackPlan(prompt),
        provider:
          'ceniq-fallback',
      });
    }

    const model =
      process.env.GEMINI_MODEL ||
      'gemini-2.5-flash';

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
        model,
      )}:generateContent?key=${encodeURIComponent(
        apiKey,
      )}`,
      {
        method: 'POST',
        headers: {
          'Content-Type':
            'application/json',
        },
        body: JSON.stringify({
          system_instruction: {
            parts: [
              {
                text:
                  'Tu esi CENIQ AI — Latvijas pircēja produktu atlases asistents. Izveido konkrētu Google Shopping meklēšanas frāzi, saglabājot modeļus, izmērus, budžetu un tehniskos parametrus. Neizdomā prasības. Atgriez tikai JSON ar searchQuery, summary, constraints, category.',
              },
            ],
          },
          contents: [
            {
              parts: [
                {
                  text: prompt,
                },
              ],
            },
          ],
          generationConfig: {
            responseMimeType:
              'application/json',
            temperature: 0.2,
            maxOutputTokens: 350,
          },
        }),
        cache: 'no-store',
      },
    );

    const json =
      await response.json();

    if (!response.ok) {
      return NextResponse.json({
        plan:
          fallbackPlan(prompt),
        provider:
          'ceniq-fallback',
      });
    }

    const text =
      json?.candidates?.[0]
        ?.content?.parts?.[0]
        ?.text;

    if (!text) {
      return NextResponse.json({
        plan:
          fallbackPlan(prompt),
        provider:
          'ceniq-fallback',
      });
    }

    try {
      return NextResponse.json({
        plan:
          JSON.parse(text),
        provider: 'gemini',
      });
    } catch {
      return NextResponse.json({
        plan:
          fallbackPlan(prompt),
        provider:
          'ceniq-fallback',
      });
    }
  } catch {
    return NextResponse.json(
      {
        error:
          'CENIQ AI neizdevās.',
      },
      { status: 502 },
    );
  }
}

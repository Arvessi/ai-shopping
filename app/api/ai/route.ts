import { NextResponse } from 'next/server';
import { isRestrictedShoppingQuery } from '@/lib/safety';

export const maxDuration = 30;

function extractOutputText(json: any) {
  return json?.output
    ?.flatMap(
      (item: any) => item?.content || [],
    )
    ?.find(
      (content: any) =>
        content?.type === 'output_text',
    )?.text;
}

export async function POST(
  request: Request,
) {
  try {
    const body = await request.json();
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
      isRestrictedShoppingQuery(prompt)
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
      process.env.OPENAI_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        {
          error:
            'CENIQ AI vēl nav aktivizēts. Vercel jāpievieno OPENAI_API_KEY.',
        },
        { status: 503 },
      );
    }

    const response = await fetch(
      'https://api.openai.com/v1/responses',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type':
            'application/json',
        },
        body: JSON.stringify({
          model:
            process.env.OPENAI_MODEL ||
            'gpt-5.6-luna',
          reasoning: { effort: 'low' },
          instructions:
            'Tu esi CENIQ AI — Latvijas pircēja produktu atlases asistents. Izveido konkrētu Google Shopping meklēšanas frāzi angļu valodā, saglabājot modeļus, izmērus un tehniskos parametrus. Neizdomā parametrus, kurus lietotājs nav prasījis. Kopsavilkumu raksti latviski un īsi.',
          input: prompt,
          text: {
            format: {
              type: 'json_schema',
              name: 'ceniq_shopping_plan',
              strict: true,
              schema: {
                type: 'object',
                properties: {
                  searchQuery: {
                    type: 'string',
                  },
                  summary: {
                    type: 'string',
                  },
                  constraints: {
                    type: 'array',
                    items: {
                      type: 'string',
                    },
                  },
                  category: {
                    type: 'string',
                  },
                },
                required: [
                  'searchQuery',
                  'summary',
                  'constraints',
                  'category',
                ],
                additionalProperties: false,
              },
            },
          },
          max_output_tokens: 350,
        }),
        cache: 'no-store',
      },
    );

    const json = await response.json();

    if (!response.ok) {
      throw new Error(
        json?.error?.message ||
          'OpenAI pieprasījums neizdevās.',
      );
    }

    const outputText =
      extractOutputText(json);

    if (!outputText) {
      throw new Error(
        'CENIQ AI neatgrieza atbildi.',
      );
    }

    return NextResponse.json({
      plan: JSON.parse(outputText),
    });
  } catch (error) {
    console.error('CENIQ AI:', error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'CENIQ AI neizdevās.',
      },
      { status: 502 },
    );
  }
}

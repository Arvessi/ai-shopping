import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export const maxDuration = 30;

type VerdictResponse = {
  verdict: 'Pērc tagad' | 'Pagaidi' | 'Salīdzini vēl';
  summary: string;
  reasons: string[];
  confidence: 'zema' | 'vidēja' | 'augsta';
};

function extractOutputText(json: any) {
  return json?.output
    ?.flatMap((item: any) => item?.content || [])
    ?.find((content: any) => content?.type === 'output_text')
    ?.text;
}

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;

    const product = await prisma.product.findUnique({
      where: { id },
      include: {
        offers: {
          orderBy: [{ isBestOverall: 'desc' }, { totalPrice: 'asc' }],
          take: 8,
        },
        snapshots: {
          orderBy: { recordedAt: 'asc' },
          take: 180,
        },
      },
    });

    if (!product) {
      return NextResponse.json(
        { error: 'Produkts nav atrasts.' },
        { status: 404 },
      );
    }

    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        {
          error:
            'CENIQ AI vēl nav aktivizēts. Vercel jāpievieno OPENAI_API_KEY.',
        },
        { status: 503 },
      );
    }

    const prices = product.snapshots
      .map((snapshot) => snapshot.price)
      .filter((price) => Number.isFinite(price) && price > 0);

    const firstPrice = prices[0];
    const latestPrice = prices[prices.length - 1];

    const trendPercent =
      firstPrice && latestPrice
        ? ((latestPrice - firstPrice) / firstPrice) * 100
        : null;

    const priceHistory =
      prices.length > 0
        ? {
            samples: prices.length,
            min: Math.min(...prices),
            max: Math.max(...prices),
            first: firstPrice,
            latest: latestPrice,
            trendPercent:
              trendPercent == null ? null : Number(trendPercent.toFixed(2)),
          }
        : null;

    const offers = product.offers.map((offer) => {
      const shippingKnown =
        offer.shipping > 0 || Boolean(offer.deliveryMessage);

      return {
        merchant: offer.merchant,
        price: offer.price,
        shipping: offer.shipping > 0 ? offer.shipping : null,
        shippingKnown,
        deliveryMessage: offer.deliveryMessage,
        totalPrice: offer.totalPrice,
        sellerRating: offer.sellerRating,
        sellerVotes: offer.sellerVotes,
        isCheapest: offer.isCheapest,
        isBestOverall: offer.isBestOverall,
      };
    });

    const input = JSON.stringify({
      product: {
        title: product.title,
        brand: product.brand,
        currentBestPrice: product.currentBestPrice,
        currency: product.currency,
        ceniqScore: product.dealScore,
      },
      offers,
      priceHistory,
    });

    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.OPENAI_VERDICT_MODEL || 'gpt-5.6-luna',
        reasoning: { effort: 'low' },
        instructions:
          'Tu esi CENIQ AI iepirkšanās analītiķis Latvijā. Atbildi latviski. Izvērtē tikai dotos datus. Neizdomā piegādes cenu, noliktavas atlikumu, veikala reputāciju vai cenu vēsturi, ja tie nav doti. Ja ir tikai viens piedāvājums vai trūkst piegādes/reitinga/cenu vēstures datu, pazemini confidence un, ja nepieciešams, izvēlies “Salīdzini vēl”. “Pērc tagad” izmanto tikai tad, ja dotie signāli to pietiekami pamato. Esi īss, konkrēts un praktisks.',
        input,
        text: {
          format: {
            type: 'json_schema',
            name: 'ceniq_product_verdict',
            strict: true,
            schema: {
              type: 'object',
              properties: {
                verdict: {
                  type: 'string',
                  enum: ['Pērc tagad', 'Pagaidi', 'Salīdzini vēl'],
                },
                summary: { type: 'string' },
                reasons: {
                  type: 'array',
                  items: { type: 'string' },
                },
                confidence: {
                  type: 'string',
                  enum: ['zema', 'vidēja', 'augsta'],
                },
              },
              required: ['verdict', 'summary', 'reasons', 'confidence'],
              additionalProperties: false,
            },
          },
        },
        max_output_tokens: 500,
      }),
      cache: 'no-store',
    });

    const json = await response.json();

    if (!response.ok) {
      throw new Error(
        json?.error?.message || 'OpenAI pieprasījums neizdevās.',
      );
    }

    const outputText = extractOutputText(json);

    if (!outputText) {
      throw new Error('CENIQ AI neatgrieza viedokli.');
    }

    const verdict = JSON.parse(outputText) as VerdictResponse;

    return NextResponse.json({ verdict });
  } catch (error) {
    console.error('CENIQ product verdict:', error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'CENIQ AI analīze neizdevās.',
      },
      { status: 502 },
    );
  }
}

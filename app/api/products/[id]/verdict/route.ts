import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getCanonicalProduct, searchCanonicalCatalog } from '@/lib/canonical/catalog';
import { normalizeText } from '@/lib/canonical/domain';
import { shapeCanonicalResults } from '@/lib/canonical/result-shaping';

export const maxDuration = 30;

type Verdict = {
  verdict: 'Pērc tagad' | 'Pagaidi' | 'Salīdzini vēl';
  summary: string;
  reasons: string[];
  confidence: 'zema' | 'vidēja' | 'augsta';
};

function localVerdict(product: any): Verdict {
  const offers = product.offers || [];
  const stores = new Set(offers.map((offer: any) => offer.merchantDomain || offer.merchant)).size;

  const current = Number(product.currentBestPrice) || 0;
  const historical = (product.snapshots || [])
    .map((snapshot: any) => Number(snapshot.price))
    .filter((price: number) => Number.isFinite(price) && price > 0);

  // Current live price must participate in the range. Without this, an older
  // observation could be shown as the "minimum" even when today's live offer is lower.
  const prices = current > 0 ? [...historical, current] : historical;

  if (stores < 2) {
    return {
      verdict: 'Salīdzini vēl',
      summary: 'CENIQ pagaidām redz pārāk maz veikalu, lai godīgi pateiktu “pērc tagad”.',
      reasons: [
        `Atrasts ${stores || 0} veikals.`,
        prices.length >= 2
          ? 'Cenu vēsture ir sākta, bet veikalu salīdzinājums vēl ir vājš.'
          : 'Vēl nav pietiekamas cenu vēstures.',
      ],
      confidence: 'zema',
    };
  }

  if (prices.length >= 3 && current > 0) {
    const min = Math.min(...prices);
    const first = prices[0];
    const latest = current;
    const nearLow = current <= min * 1.03;
    const trend = first > 0 ? (latest - first) / first : 0;

    if (nearLow) {
      return {
        verdict: 'Pērc tagad',
        summary: 'Pašreizējā cena ir tuvu CENIQ fiksētajam minimumam un ir vairāki veikali salīdzināšanai.',
        reasons: [
          `Salīdzināti ${stores} veikali.`,
          `Pašreizējā cena ir tuvu fiksētajam minimumam ${min.toFixed(2)} €.`,
        ],
        confidence: stores >= 3 ? 'augsta' : 'vidēja',
      };
    }

    if (trend < -0.04) {
      return {
        verdict: 'Pagaidi',
        summary: 'Cena pēdējos CENIQ novērojumos ir kritusies, tāpēc ir pamats vēl nedaudz pagaidīt.',
        reasons: [
          `Cena kopš pirmā novērojuma mainījusies par ${(trend * 100).toFixed(1)}%.`,
          `Salīdzināti ${stores} veikali.`,
        ],
        confidence: 'vidēja',
      };
    }
  }

  return {
    verdict: 'Salīdzini vēl',
    summary: 'Cena nav acīmredzami slikta, bet CENIQ vēl neredz pietiekami spēcīgu signālu.',
    reasons: [
      `Salīdzināti ${stores} veikali.`,
      prices.length >= 3
        ? 'Ir cenu vēsture, bet nav izteikta minimuma vai tendences.'
        : 'Cenu vēsture vēl ir īsa.',
    ],
    confidence: stores >= 3 ? 'vidēja' : 'zema',
  };
}

async function geminiVerdict(product: any, fallback: Verdict): Promise<Verdict | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: {
          parts: [{
            text: 'Tu esi CENIQ iepirkšanās analītiķis Latvijā. Atbildi latviski, īsi un tikai no dotajiem datiem. Neizdomā piegādi, noliktavas atlikumu, reputāciju vai cenu vēsturi. Ja salīdzināts tikai viens veikals, izvēlies “Salīdzini vēl” un zemu pārliecību.',
          }],
        },
        contents: [{
          parts: [{
            text: JSON.stringify({
              product: {
                title: product.title,
                brand: product.brand,
                currentBestPrice: product.currentBestPrice,
                currency: product.currency,
              },
              offers: product.offers.map((offer: any) => ({
                merchant: offer.merchant,
                variant: offer.variantLabel,
                price: offer.price,
                totalPrice: offer.totalPrice,
                sellerRating: offer.sellerRating,
                deliveryMessage: offer.deliveryMessage,
                ceniqScore: offer.dealScore || null,
              })),
              priceHistory: product.snapshots,
              deterministicCeniqCheck: fallback,
            }),
          }],
        }],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.2,
          maxOutputTokens: 350,
        },
      }),
      cache: 'no-store',
    },
  );

  const json = await response.json();
  if (!response.ok) return null;
  const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) return null;

  try {
    return JSON.parse(text) as Verdict;
  } catch {
    return null;
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const variantId = new URL(request.url).searchParams.get('variantId') || undefined;
    const canonical = await getCanonicalProduct(id, variantId);

    let product: any = null;
    if (canonical) {
      const related = await searchCanonicalCatalog(canonical.title);
      const shaped = shapeCanonicalResults(related, canonical.title, variantId);
      const merged = shaped.find((item) => normalizeText(item.title) === normalizeText(canonical.title)) || canonical;
      const selectedVariantId = merged.selectedVariantId;
      const selectedOffers = (merged.offers || []).filter((offer: any) => offer.variantId === selectedVariantId);
      const snapshots = selectedVariantId
        ? (await prisma.offerObservation.findMany({
            where: { offer: { variantId: selectedVariantId }, totalPrice: { not: null } },
            orderBy: { observedAt: 'asc' },
            take: 180,
          })).map((row) => ({ price: row.totalPrice, recordedAt: row.observedAt }))
        : [];

      product = {
        ...merged,
        currentBestPrice: merged.bestPrice,
        offers: selectedOffers,
        snapshots,
      };
    } else {
      product = await prisma.product.findUnique({
        where: { id },
        include: {
          offers: { orderBy: { totalPrice: 'asc' }, take: 20 },
          snapshots: { orderBy: { recordedAt: 'asc' }, take: 180 },
        },
      });
    }

    if (!product) {
      return NextResponse.json({ error: 'Produkts nav atrasts.' }, { status: 404 });
    }

    const fallback = localVerdict(product);
    const ai = await geminiVerdict(product, fallback).catch(() => null);

    return NextResponse.json({
      verdict: ai || fallback,
      provider: ai ? 'gemini' : 'ceniq-rules',
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'CENIQ analīze neizdevās.' },
      { status: 502 },
    );
  }
}

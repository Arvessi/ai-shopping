import { NextResponse } from 'next/server';
export async function POST() { return NextResponse.json({ deprecated: true, message: 'Legacy feed persistence is retired; feeds must emit NormalizedOfferCandidate records.' }, { status: 410 }); }

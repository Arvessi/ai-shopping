import { NextResponse } from 'next/server';
export async function GET() { return NextResponse.json({ deprecated: true, message: 'Legacy source administration is retired pending canonical feed adapters.' }, { status: 410 }); }
export async function POST() { return GET(); }

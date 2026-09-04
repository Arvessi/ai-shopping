import { NextResponse } from 'next/server';
export async function GET() { return NextResponse.json({ deprecated: true, replacement: '/api/search', message: 'The v3.4 adapter runtime is retired; all candidates must use canonical ingestion.' }, { status: 410 }); }

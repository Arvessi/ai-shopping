import { NextResponse } from 'next/server';
export async function GET() { return NextResponse.json({ deprecated: true, replacement: '/api/search', message: 'The duplicate catalog status endpoint is retired.' }, { status: 410 }); }

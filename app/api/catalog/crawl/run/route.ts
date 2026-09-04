import { NextResponse } from 'next/server';
export async function POST() { return NextResponse.json({ deprecated: true, message: 'The query crawler is retired from active runtime.' }, { status: 410 }); }

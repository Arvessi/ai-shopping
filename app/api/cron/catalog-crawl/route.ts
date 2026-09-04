import { NextResponse } from 'next/server';
export async function GET() { return NextResponse.json({ deprecated: true, message: 'The v3.3 crawler cron is retired and must not write competing catalog data.' }, { status: 410 }); }

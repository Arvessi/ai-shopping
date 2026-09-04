import { NextResponse } from 'next/server';
export async function GET() { return NextResponse.json({ deprecated: true, message: 'The duplicate crawler status endpoint is retired.' }, { status: 410 }); }

import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  const { password } = await request.json()
  const valid = password === process.env.ADMIN_PASSWORD
  return NextResponse.json({ valid })
}

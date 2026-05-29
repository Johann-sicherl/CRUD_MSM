import { NextRequest, NextResponse } from 'next/server'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

const FILE = join(process.cwd(), 'src', 'data', 'field-options.json')

function read(): Record<string, string[]> {
  return JSON.parse(readFileSync(FILE, 'utf-8'))
}

function write(data: Record<string, string[]>) {
  writeFileSync(FILE, JSON.stringify(data, null, 2) + '\n', 'utf-8')
}

export async function GET() {
  return NextResponse.json(read())
}

export async function POST(req: NextRequest) {
  const { key, value } = await req.json()
  if (!key || !value) return NextResponse.json({ error: 'key e value obrigatórios' }, { status: 400 })
  const data = read()
  if (!data[key]) data[key] = []
  const upper = String(value).toUpperCase().trim()
  if (!data[key].includes(upper)) data[key].push(upper)
  write(data)
  return NextResponse.json(data[key])
}

export async function DELETE(req: NextRequest) {
  const { key, value } = await req.json()
  if (!key || !value) return NextResponse.json({ error: 'key e value obrigatórios' }, { status: 400 })
  const data = read()
  if (data[key]) data[key] = data[key].filter(v => v !== value)
  write(data)
  return NextResponse.json(data[key] ?? [])
}

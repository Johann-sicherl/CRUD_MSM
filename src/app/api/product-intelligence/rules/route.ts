import { NextResponse } from 'next/server'
import { REGRAS_CATALOGO } from '@/lib/productIntelligence'

// Só leitura, sem credencial nenhuma — devolve o catálogo estático das
// regras de Inteligência do Produto (documentação, não dado de negócio).
// Usada pelo botão "Copiar todas as regras" de /inteligencia-produto.
export async function GET() {
  return NextResponse.json({ regras: REGRAS_CATALOGO })
}

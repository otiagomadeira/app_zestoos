/**
 * R-TEST 2 — Cozinha Real Desorganizada.
 *
 * Bateria criativa pós-Iter 2 que tenta partir o parser e o ArticleForm com
 * nomes reais de cozinha, fornecedores, WhatsApp, faturas e listas mal
 * escritas. Usa o pipeline real (buildArticleDraft + getCountingModeOptions),
 * sem inventar API. Não substitui test-parser.ts — é exploratório.
 *
 * Regras:
 *   - Falsos positivos perigosos (apagar nome essencial) → P0
 *   - Embalagem antes do nome / categoria muito errada / nome enganador → P1
 *   - Abreviatura rara, formato exótico, melhoria estética → P2
 *   - Output coerente OU degradação segura sem mentir → OK
 *
 * Correr: npx tsx scripts/stress-kitchen-chaos.ts
 */

import { buildArticleDraft, getCountingModeOptions } from '../src/lib/articleDraft'
import type { ConfidenceLevel } from '../src/lib/articleConfidence'

type Family =
  | 'A' // Embalagem antes do nome
  | 'B' // Carnes
  | 'C' // Peixes e marisco
  | 'D' // Congelados
  | 'E' // Bebidas
  | 'F' // Legumes
  | 'G' // Frutas
  | 'H' // Lacticínios e ovos
  | 'I' // Mercearia seca
  | 'J' // Conservas, molhos e frascos
  | 'K' // Pastelaria
  | 'L' // Erros, colados e WhatsApp
  | 'M' // Devem preservar nome

type Risk = 'P0' | 'P1' | 'P2' | 'OK'

type Probe = {
  family:          Family
  input:           string
  /** Palavras que NUNCA devem aparecer no nome final */
  forbidInName?:   string[]
  /** Subsequências que TÊM de estar no nome final */
  requireInName?:  string[]
  /** Intent kind esperado */
  expectIntent?:   string
  /** Número de counting options esperado */
  expectOptions?:  1 | 2
  /** Categoria esperada quando determinística */
  expectCategory?: string
  /** Risco máximo aceitável quando há flag (default P2) */
  riskOnFlag?:     'P0' | 'P1' | 'P2'
  /** Comentário humano */
  note?:           string
}

const PROBES: Probe[] = [
  // ───────────────────── A) Embalagem antes do nome ─────────────────────
  // Hipótese: parser detecta peso/volume primeiro mas extractName não sabe
  // limpar embalagem que vem antes do produto. Crítico se acontecer com
  // produtos comuns.
  { family: 'A', input: 'caixa 10kg frango',
    forbidInName: ['caixa', '10kg'], requireInName: ['Frango'],
    expectIntent: 'PACKAGED_WEIGHT', expectCategory: 'Carnes',
    riskOnFlag: 'P1' },
  { family: 'A', input: 'cx 10kg frango',
    forbidInName: ['cx', '10kg'], requireInName: ['Frango'],
    expectIntent: 'PACKAGED_WEIGHT', expectCategory: 'Carnes',
    riskOnFlag: 'P1' },
  { family: 'A', input: 'saco 25kg farinha',
    forbidInName: ['saco', '25kg'], requireInName: ['Farinha'],
    expectIntent: 'PACKAGED_WEIGHT', expectCategory: 'Mercearia',
    riskOnFlag: 'P1' },
  { family: 'A', input: 'sc 25kg farinha',
    forbidInName: ['sc'], requireInName: ['Farinha'],
    riskOnFlag: 'P2', note: 'sc abreviado fora de scope (Iter 3)' },
  { family: 'A', input: 'balde 5kg azeitona',
    forbidInName: ['balde'], requireInName: ['Azeitona'],
    expectIntent: 'PACKAGED_WEIGHT', riskOnFlag: 'P1' },
  { family: 'A', input: 'balde 3kg pickles',
    forbidInName: ['balde'], requireInName: ['Pickles'],
    expectIntent: 'PACKAGED_WEIGHT', riskOnFlag: 'P1' },
  { family: 'A', input: 'garrafa 5l azeite',
    forbidInName: ['garrafa'], requireInName: ['Azeite'],
    expectIntent: 'PACKAGED_VOLUME', expectCategory: 'Mercearia',
    riskOnFlag: 'P1' },
  { family: 'A', input: 'garrafão 5l azeite',
    forbidInName: ['garrafão', 'garrafao'], requireInName: ['Azeite'],
    expectIntent: 'PACKAGED_VOLUME', riskOnFlag: 'P1' },
  { family: 'A', input: 'pack 6uni leite 1l',
    forbidInName: ['pack'], requireInName: ['Leite'],
    expectIntent: 'PACKAGED_VOLUME', expectCategory: 'Lacticínios e Ovos',
    riskOnFlag: 'P1' },
  { family: 'A', input: 'caixa 6uni leite 1l',
    forbidInName: ['caixa'], requireInName: ['Leite'],
    riskOnFlag: 'P1' },
  { family: 'A', input: 'caixa 6x1l leite',
    forbidInName: ['caixa'], requireInName: ['Leite'],
    riskOnFlag: 'P2', note: '6x1l antes do nome — fora de scope explícito' },
  { family: 'A', input: 'pack 24x0.5l água',
    forbidInName: ['pack'], requireInName: ['Água', 'Agua'],
    riskOnFlag: 'P1' },
  { family: 'A', input: 'caixa 12uni alface',
    forbidInName: ['caixa'], requireInName: ['Alface'],
    expectIntent: 'COUNTABLE_PACKAGED', riskOnFlag: 'P1' },
  { family: 'A', input: 'caixa 50uni limão',
    forbidInName: ['caixa'], requireInName: ['Limão'],
    expectIntent: 'COUNTABLE_PACKAGED', riskOnFlag: 'P1' },
  { family: 'A', input: 'caixa 180uni ovos',
    forbidInName: ['caixa'], requireInName: ['Ovos', 'Ovo'],
    expectIntent: 'COUNTABLE_PACKAGED', expectCategory: 'Lacticínios e Ovos',
    riskOnFlag: 'P1' },
  { family: 'A', input: 'lata 2.5kg tomate pelado',
    forbidInName: [], requireInName: ['Tomate', 'Pelado'],
    note: 'lata fica no nome (CONTAINER_KEEP_IN_NAME) — esperado' },
  { family: 'A', input: 'lata 400g tomate triturado',
    forbidInName: [], requireInName: ['Tomate'] },
  { family: 'A', input: 'pacote 1l nata 35%',
    forbidInName: ['pacote'], requireInName: ['Nata', '35%'],
    riskOnFlag: 'P1' },
  { family: 'A', input: 'caixa 6l nata pacote 1l',
    forbidInName: ['caixa', 'pacote'], requireInName: ['Nata'],
    riskOnFlag: 'P1', note: 'nested invertido: outer antes, inner depois' },

  // ─────────────────────────── B) Carnes ───────────────────────────
  { family: 'B', input: 'frango 10kg',
    forbidInName: ['10kg'], requireInName: ['Frango'],
    expectIntent: 'WEIGHT_LOOSE', expectCategory: 'Carnes' },
  { family: 'B', input: 'frango caixa 10kg',
    forbidInName: ['caixa'], requireInName: ['Frango'],
    expectIntent: 'PACKAGED_WEIGHT', expectCategory: 'Carnes' },
  { family: 'B', input: 'frango peito 5kg',
    requireInName: ['Frango', 'Peito'], expectCategory: 'Carnes' },
  { family: 'B', input: 'peito de frango 5kg',
    requireInName: ['Peito', 'Frango'], expectCategory: 'Carnes' },
  { family: 'B', input: 'peito frango caixa 5kg',
    forbidInName: ['caixa'], requireInName: ['Peito', 'Frango'],
    expectCategory: 'Carnes' },
  { family: 'B', input: 'coxa frango 10kg',
    requireInName: ['Coxa', 'Frango'], expectCategory: 'Carnes' },
  { family: 'B', input: 'asas frango saco 5kg',
    forbidInName: ['saco'], requireInName: ['Asas', 'Frango'],
    expectCategory: 'Carnes' },
  { family: 'B', input: 'picanha peça 1.5kg',
    requireInName: ['Picanha'], expectCategory: 'Carnes',
    note: 'peça é formato — pode ficar ou sair, não é label canónico' },
  { family: 'B', input: 'vazia peça 3kg',
    requireInName: ['Vazia'], note: 'vazia=corte, peça=formato' },
  { family: 'B', input: 'entrecôte peça 2kg',
    requireInName: ['Entrecôte'] },
  { family: 'B', input: 'lombo novilho peça 2kg',
    requireInName: ['Lombo', 'Novilho'], expectCategory: 'Carnes' },
  { family: 'B', input: 'acém 5kg',
    requireInName: ['Acém'] },
  { family: 'B', input: 'carne picada 5kg',
    requireInName: ['Carne', 'Picada'], expectCategory: 'Carnes' },
  { family: 'B', input: 'carne picada vacuo 2kg',
    requireInName: ['Carne', 'Picada'], expectCategory: 'Carnes',
    note: 'vacuo é embalagem — sair ou ficar? aceitável manter' },
  { family: 'B', input: 'hambúrguer 160g caixa 30uni',
    forbidInName: ['caixa'], requireInName: ['Hambúrguer'],
    expectCategory: 'Carnes',
    note: 'multipack peso × count: PACKAGED_WEIGHT 30×160' },
  { family: 'B', input: 'hambúrguer 180g caixa 24uni',
    forbidInName: ['caixa'], requireInName: ['Hambúrguer'] },
  { family: 'B', input: 'bacon fatiado 1kg',
    requireInName: ['Bacon'], expectCategory: 'Carnes' },
  { family: 'B', input: 'chouriço unidade',
    requireInName: ['Chouriço'], expectCategory: 'Carnes' },
  { family: 'B', input: 'presunto fatiado 500g',
    requireInName: ['Presunto'], expectCategory: 'Carnes' },
  { family: 'B', input: 'fiambre barra 3kg',
    requireInName: ['Fiambre'], note: 'barra é formato' },
  { family: 'B', input: 'fiambre fatiado 1kg',
    requireInName: ['Fiambre'] },

  // ───────────────────── C) Peixes e marisco ─────────────────────
  { family: 'C', input: 'salmão 5kg',
    requireInName: ['Salmão'], expectCategory: 'Peixe e Marisco' },
  { family: 'C', input: 'salmao 5kg',
    requireInName: ['Salmão'], expectCategory: 'Peixe e Marisco' },
  { family: 'C', input: 'salmão filete 2kg',
    requireInName: ['Salmão'], expectCategory: 'Peixe e Marisco' },
  { family: 'C', input: 'filete salmão 2kg',
    requireInName: ['Salmão'], expectCategory: 'Peixe e Marisco' },
  { family: 'C', input: 'bacalhau demolhado 5kg',
    requireInName: ['Bacalhau'], expectCategory: 'Peixe e Marisco' },
  { family: 'C', input: 'bacalhau posta 5kg',
    requireInName: ['Bacalhau'], expectCategory: 'Peixe e Marisco' },
  { family: 'C', input: 'polvo 2kg',
    requireInName: ['Polvo'], expectCategory: 'Peixe e Marisco' },
  { family: 'C', input: 'polvo congelado 2kg',
    requireInName: ['Polvo'], expectCategory: 'Congelados' },
  { family: 'C', input: 'camarão 20/30 2kg',
    requireInName: ['Camarão', '20/30'],
    expectCategory: 'Peixe e Marisco', riskOnFlag: 'P1',
    note: 'calibre 20/30 deve preservar' },
  { family: 'C', input: 'camarão 30/40 caixa 2kg',
    forbidInName: ['caixa'], requireInName: ['Camarão', '30/40'],
    expectCategory: 'Peixe e Marisco', riskOnFlag: 'P1' },
  { family: 'C', input: 'amêijoa 1kg',
    requireInName: ['Amêijoa'], expectCategory: 'Peixe e Marisco' },
  { family: 'C', input: 'mexilhão 1kg',
    requireInName: ['Mexilhão'], expectCategory: 'Peixe e Marisco' },
  { family: 'C', input: 'lula limpa 2kg',
    requireInName: ['Lula'], expectCategory: 'Peixe e Marisco' },
  { family: 'C', input: 'choco limpo 2kg',
    requireInName: ['Choco'], expectCategory: 'Peixe e Marisco' },
  { family: 'C', input: 'robalo inteiro 600g',
    requireInName: ['Robalo'], expectCategory: 'Peixe e Marisco' },
  { family: 'C', input: 'dourada inteira 600g',
    requireInName: ['Dourada'], expectCategory: 'Peixe e Marisco' },
  { family: 'C', input: 'atum lombo 2kg',
    requireInName: ['Atum'], expectCategory: 'Peixe e Marisco',
    note: 'lombo da Carne pode contaminar — deve continuar Peixe' },
  { family: 'C', input: 'atum lata 120g pack 3',
    requireInName: ['Atum'],
    note: 'atum lata vs atum lombo: categoria pode flippar' },

  // ─────────────────────────── D) Congelados ──────────────────────
  { family: 'D', input: 'batata congelada 2.5kg',
    requireInName: ['Batata'], expectCategory: 'Congelados' },
  { family: 'D', input: 'batata pré frita 2.5kg',
    requireInName: ['Batata'],
    note: '"pré frita" não dispara congelados; deve fallback F&L?' },
  { family: 'D', input: 'ervilhas congeladas 1kg',
    requireInName: ['Ervilhas'], expectCategory: 'Congelados' },
  { family: 'D', input: 'espinafres congelados 1kg',
    requireInName: ['Espinafres'], expectCategory: 'Congelados' },
  { family: 'D', input: 'frutos vermelhos congelados 1kg',
    requireInName: ['Frutos', 'Vermelhos'], expectCategory: 'Congelados' },
  { family: 'D', input: 'camarão congelado 2kg',
    requireInName: ['Camarão'], expectCategory: 'Congelados',
    note: 'override frozen prevalece — esperado' },
  { family: 'D', input: 'pão congelado caixa 40uni',
    forbidInName: ['caixa'], requireInName: ['Pão'],
    expectCategory: 'Congelados', riskOnFlag: 'P1' },
  { family: 'D', input: 'croissant congelado caixa 60uni',
    forbidInName: ['caixa'], requireInName: ['Croissant'],
    expectCategory: 'Congelados' },
  { family: 'D', input: 'pão de alho congelado caixa 30uni',
    forbidInName: ['caixa'], requireInName: ['Pão', 'Alho'],
    expectCategory: 'Congelados' },
  { family: 'D', input: 'legumes congelados 2.5kg',
    requireInName: ['Legumes'], expectCategory: 'Congelados' },
  { family: 'D', input: 'cogumelos congelados 1kg',
    requireInName: ['Cogumelos'], expectCategory: 'Congelados' },

  // ─────────────────────────── E) Bebidas ─────────────────────────
  { family: 'E', input: 'água 0.5L pack 24',
    forbidInName: ['pack'], requireInName: ['Água'],
    expectCategory: 'Bebidas', riskOnFlag: 'P1' },
  { family: 'E', input: 'agua 0.5l pack 24',
    forbidInName: ['pack'], requireInName: ['Água'],
    expectCategory: 'Bebidas', riskOnFlag: 'P1' },
  { family: 'E', input: 'água 1.5L pack 6',
    forbidInName: ['pack'], requireInName: ['Água'],
    expectCategory: 'Bebidas', riskOnFlag: 'P1' },
  { family: 'E', input: 'coca cola lata 330ml pack 24',
    forbidInName: ['pack'], requireInName: ['Coca'],
    expectCategory: 'Bebidas', riskOnFlag: 'P1',
    note: 'lata mantém-se (CONTAINER_KEEP_IN_NAME), pack é outer' },
  { family: 'E', input: 'coca cola garrafa 1.5l pack 6',
    forbidInName: ['garrafa', 'pack'], requireInName: ['Coca'],
    expectCategory: 'Bebidas', riskOnFlag: 'P1' },
  { family: 'E', input: 'cerveja garrafa 33cl caixa 24',
    forbidInName: ['garrafa', 'caixa'], requireInName: ['Cerveja'],
    expectCategory: 'Bebidas', riskOnFlag: 'P1' },
  { family: 'E', input: 'vinho branco garrafa 75cl caixa 6',
    forbidInName: ['garrafa', 'caixa'], requireInName: ['Vinho', 'Branco'],
    expectCategory: 'Bebidas', riskOnFlag: 'P1' },
  { family: 'E', input: 'vinho tinto garrafa 75cl caixa 6',
    forbidInName: ['garrafa', 'caixa'], requireInName: ['Vinho', 'Tinto'],
    expectCategory: 'Bebidas', riskOnFlag: 'P1' },
  { family: 'E', input: 'vinho do porto garrafa 75cl',
    forbidInName: ['garrafa'], requireInName: ['Vinho', 'Porto'],
    expectCategory: 'Bebidas', riskOnFlag: 'P0',
    note: 'P0 se "porto" desaparecer do nome — preservação obrigatória' },
  { family: 'E', input: 'sumo laranja 1l pack 6',
    forbidInName: ['pack'], requireInName: ['Sumo'],
    expectCategory: 'Bebidas', riskOnFlag: 'P1' },
  { family: 'E', input: 'leite 1l pack 6',
    forbidInName: ['pack'], requireInName: ['Leite'],
    riskOnFlag: 'P1', note: 'pode cair em Bebidas (leite está em ambos)' },
  { family: 'E', input: 'leite meio gordo 1l pack 6',
    forbidInName: ['pack'], requireInName: ['Leite', 'Meio', 'Gordo'],
    riskOnFlag: 'P1' },
  { family: 'E', input: 'bebida vegetal aveia 1l caixa 6l',
    forbidInName: ['caixa'], requireInName: ['Bebida'],
    expectCategory: 'Bebidas' },
  { family: 'E', input: 'café grão 1kg',
    requireInName: ['Café', 'Grão'], expectCategory: 'Mercearia',
    riskOnFlag: 'P0', note: 'grão NÃO pode ser apagado' },
  { family: 'E', input: 'café moído 250g',
    requireInName: ['Café'], expectCategory: 'Mercearia' },
  { family: 'E', input: 'chá camomila caixa 20 saquetas',
    forbidInName: ['caixa'], requireInName: ['Chá', 'Camomila'],
    expectCategory: 'Mercearia',
    note: 'saquetas não é label conhecido — vai cair em "unit"' },

  // ─────────────────────────── F) Legumes ─────────────────────────
  { family: 'F', input: 'cebola 20kg',
    requireInName: ['Cebola'], expectCategory: 'Frutas e Legumes' },
  { family: 'F', input: 'cebola roxa 20kg',
    requireInName: ['Cebola', 'Roxa'], expectCategory: 'Frutas e Legumes',
    riskOnFlag: 'P1' },
  { family: 'F', input: 'cebola roxa saco 20kg',
    forbidInName: ['saco'], requireInName: ['Cebola', 'Roxa'],
    expectCategory: 'Frutas e Legumes', riskOnFlag: 'P1' },
  { family: 'F', input: 'cenoura 10kg',
    requireInName: ['Cenoura'], expectCategory: 'Frutas e Legumes' },
  { family: 'F', input: 'batata 10kg',
    requireInName: ['Batata'], expectCategory: 'Frutas e Legumes' },
  { family: 'F', input: 'batata agria 20kg',
    requireInName: ['Batata', 'Agria'], expectCategory: 'Frutas e Legumes',
    riskOnFlag: 'P1' },
  { family: 'F', input: 'batata doce 10kg',
    requireInName: ['Batata', 'Doce'], expectCategory: 'Frutas e Legumes',
    riskOnFlag: 'P1' },
  { family: 'F', input: 'alho descascado 1kg',
    requireInName: ['Alho', 'Descascado'], expectCategory: 'Frutas e Legumes' },
  { family: 'F', input: 'alho com casca 1kg',
    requireInName: ['Alho', 'Casca'], expectCategory: 'Frutas e Legumes' },
  { family: 'F', input: 'tomate cherry 3kg',
    requireInName: ['Tomate', 'Cherry'], expectCategory: 'Frutas e Legumes',
    riskOnFlag: 'P1' },
  { family: 'F', input: 'tomate rama 5kg',
    requireInName: ['Tomate', 'Rama'], expectCategory: 'Frutas e Legumes',
    riskOnFlag: 'P1' },
  { family: 'F', input: 'tomate coração de boi 5kg',
    requireInName: ['Tomate', 'Coração'], expectCategory: 'Frutas e Legumes' },
  { family: 'F', input: 'alface iceberg caixa 12uni',
    forbidInName: ['caixa'], requireInName: ['Alface', 'Iceberg'],
    expectCategory: 'Frutas e Legumes' },
  { family: 'F', input: 'rúcula saco 200g',
    forbidInName: ['saco'], requireInName: ['Rúcula'],
    expectCategory: 'Frutas e Legumes' },
  { family: 'F', input: 'rucula saco 200g',
    forbidInName: ['saco'], requireInName: ['Rúcula'],
    expectCategory: 'Frutas e Legumes' },
  { family: 'F', input: 'espinafres saco 500g',
    forbidInName: ['saco'], requireInName: ['Espinafres'],
    expectCategory: 'Frutas e Legumes' },
  { family: 'F', input: 'cogumelos paris 3kg',
    requireInName: ['Cogumelos'], expectCategory: 'Frutas e Legumes' },
  { family: 'F', input: 'cogumelos portobello caixa 2kg',
    forbidInName: ['caixa'], requireInName: ['Cogumelos', 'Portobello'],
    expectCategory: 'Frutas e Legumes' },
  { family: 'F', input: 'pimento vermelho 5kg',
    requireInName: ['Pimento', 'Vermelho'], expectCategory: 'Frutas e Legumes' },
  { family: 'F', input: 'curgete 5kg',
    requireInName: ['Curgete'], expectCategory: 'Frutas e Legumes' },
  { family: 'F', input: 'beringela 5kg',
    requireInName: ['Beringela'], expectCategory: 'Frutas e Legumes' },
  { family: 'F', input: 'pepino 5kg',
    requireInName: ['Pepino'], expectCategory: 'Frutas e Legumes' },

  // ─────────────────────────── G) Frutas ──────────────────────────
  { family: 'G', input: 'banana cacho',
    requireInName: ['Banana'], expectCategory: 'Frutas e Legumes',
    note: 'cacho não é label canónico — fica no nome ou some?' },
  { family: 'G', input: 'banana madura cacho',
    requireInName: ['Banana'] },
  { family: 'G', input: 'maçã golden 10kg',
    requireInName: ['Maçã', 'Golden'], expectCategory: 'Frutas e Legumes',
    riskOnFlag: 'P1' },
  { family: 'G', input: 'maca golden 10kg',
    requireInName: ['Maçã', 'Golden'] },
  { family: 'G', input: 'maçã granny smith 10kg',
    requireInName: ['Maçã', 'Granny'] },
  { family: 'G', input: 'laranja 15kg',
    requireInName: ['Laranja'], expectCategory: 'Frutas e Legumes' },
  { family: 'G', input: 'limão caixa 50uni',
    forbidInName: ['caixa'], requireInName: ['Limão'],
    expectCategory: 'Frutas e Legumes' },
  { family: 'G', input: 'lima caixa 50uni',
    forbidInName: ['caixa'], requireInName: ['Lima'],
    expectCategory: 'Frutas e Legumes' },
  { family: 'G', input: 'morango caixa 2kg',
    forbidInName: ['caixa'], requireInName: ['Morango'] },
  { family: 'G', input: 'framboesa caixa 125g',
    forbidInName: ['caixa'], requireInName: ['Framboesa'] },
  { family: 'G', input: 'mirtilo caixa 125g',
    forbidInName: ['caixa'], requireInName: ['Mirtilo'] },
  { family: 'G', input: 'manga avião caixa 6uni',
    forbidInName: ['caixa'], requireInName: ['Manga'],
    note: 'avião = origem, deveria preservar mas é raro' },
  { family: 'G', input: 'abacate caixa 16uni',
    forbidInName: ['caixa'], requireInName: ['Abacate'] },
  { family: 'G', input: 'ananás unidade',
    requireInName: ['Ananás'] },
  { family: 'G', input: 'melancia unidade',
    requireInName: ['Melancia'] },
  { family: 'G', input: 'melão unidade',
    requireInName: ['Melão'] },
  { family: 'G', input: 'pêra rocha 10kg',
    requireInName: ['Pêra', 'Rocha'], expectCategory: 'Frutas e Legumes' },
  { family: 'G', input: 'pera rocha 10kg',
    requireInName: ['Pêra', 'Rocha'], expectCategory: 'Frutas e Legumes' },

  // ──────────────────── H) Lacticínios e ovos ─────────────────────
  { family: 'H', input: 'nata 35% pacote 1l caixa 6l',
    forbidInName: ['caixa', 'pacote'], requireInName: ['Nata', '35%'],
    expectIntent: 'PACKAGED_VOLUME', expectOptions: 2,
    expectCategory: 'Lacticínios e Ovos', riskOnFlag: 'P1' },
  { family: 'H', input: 'nata 20% pacote 1l caixa 6l',
    forbidInName: ['caixa', 'pacote'], requireInName: ['Nata', '20%'],
    expectIntent: 'PACKAGED_VOLUME', expectOptions: 2,
    expectCategory: 'Lacticínios e Ovos', riskOnFlag: 'P1' },
  { family: 'H', input: 'creme culinário pacote 1l caixa 6l',
    forbidInName: ['caixa', 'pacote'], requireInName: ['Creme', 'Culinário'],
    expectIntent: 'PACKAGED_VOLUME', expectOptions: 2,
    expectCategory: 'Lacticínios e Ovos' },
  { family: 'H', input: 'leite 1l pack 6',
    forbidInName: ['pack'], requireInName: ['Leite'],
    riskOnFlag: 'P1' },
  { family: 'H', input: 'leite meio gordo 1l pack 6',
    forbidInName: ['pack'], requireInName: ['Leite', 'Meio', 'Gordo'] },
  { family: 'H', input: 'manteiga sem sal bloco 1kg',
    forbidInName: ['bloco'], requireInName: ['Manteiga'],
    expectCategory: 'Lacticínios e Ovos' },
  { family: 'H', input: 'manteiga bloco 250g caixa 40un',
    forbidInName: ['caixa', 'bloco'], requireInName: ['Manteiga'],
    expectCategory: 'Lacticínios e Ovos', riskOnFlag: 'P1',
    note: 'nested: bloco (inner) caixa (outer)' },
  { family: 'H', input: 'queijo mozzarella ralado 2kg',
    requireInName: ['Mozzarella'], expectCategory: 'Lacticínios e Ovos' },
  { family: 'H', input: 'queijo mozzarella bola 125g caixa 12uni',
    forbidInName: ['caixa'], requireInName: ['Mozzarella'],
    expectCategory: 'Lacticínios e Ovos',
    note: 'bola é formato não embalagem — deve preservar?' },
  { family: 'H', input: 'queijo parmesão peça 2kg',
    requireInName: ['Parmesão'], expectCategory: 'Lacticínios e Ovos' },
  { family: 'H', input: 'queijo creme balde 1kg',
    forbidInName: ['balde'], requireInName: ['Queijo', 'Creme'],
    expectCategory: 'Lacticínios e Ovos' },
  { family: 'H', input: 'iogurte natural 125g pack 4',
    forbidInName: ['pack'], requireInName: ['Iogurte'],
    expectCategory: 'Lacticínios e Ovos',
    note: 'multipack peso × count: PACKAGED_WEIGHT 4×125g' },
  { family: 'H', input: 'ovos caixa 180uni',
    forbidInName: ['caixa'], requireInName: ['Ovos', 'Ovo'],
    expectIntent: 'COUNTABLE_PACKAGED', expectCategory: 'Lacticínios e Ovos' },
  { family: 'H', input: 'ovos cx 180un',
    forbidInName: ['cx'], requireInName: ['Ovos', 'Ovo'],
    expectIntent: 'COUNTABLE_PACKAGED' },
  { family: 'H', input: 'ovos dúzia',
    requireInName: ['Ovos', 'Ovo'],
    note: 'dúzia fora de scope explícito (Iter 3)' },
  { family: 'H', input: 'gema pasteurizada 1kg',
    requireInName: ['Gema'], expectCategory: 'Lacticínios e Ovos' },
  { family: 'H', input: 'clara pasteurizada 1kg',
    requireInName: ['Clara'], expectCategory: 'Lacticínios e Ovos' },

  // ──────────────────────── I) Mercearia seca ─────────────────────
  { family: 'I', input: 'farinha t55 saco 25kg',
    forbidInName: ['saco'], requireInName: ['Farinha', 'T55'],
    expectCategory: 'Mercearia', riskOnFlag: 'P0',
    note: 'T55 NÃO pode ser apagado' },
  { family: 'I', input: 'farinha t65 saco 25kg',
    forbidInName: ['saco'], requireInName: ['Farinha', 'T65'],
    expectCategory: 'Mercearia', riskOnFlag: 'P0' },
  { family: 'I', input: 'açúcar 25kg',
    requireInName: ['Açúcar'], expectCategory: 'Mercearia' },
  { family: 'I', input: 'açúcar em pó 5kg',
    requireInName: ['Açúcar'], expectCategory: 'Mercearia',
    note: '"em pó" pode sair pelos NAME_CONNECTORS' },
  { family: 'I', input: 'sal grosso 25kg',
    requireInName: ['Sal', 'Grosso'], expectCategory: 'Mercearia' },
  { family: 'I', input: 'flor de sal 1kg',
    requireInName: ['Flor', 'Sal'], expectCategory: 'Mercearia' },
  { family: 'I', input: 'arroz agulha 20kg',
    requireInName: ['Arroz', 'Agulha'], expectCategory: 'Mercearia' },
  { family: 'I', input: 'arroz carolino 20kg',
    requireInName: ['Arroz', 'Carolino'], expectCategory: 'Mercearia' },
  { family: 'I', input: 'massa penne 5kg',
    requireInName: ['Massa', 'Penne'], expectCategory: 'Mercearia' },
  { family: 'I', input: 'massa linguine 5kg',
    requireInName: ['Massa', 'Linguine'] },
  { family: 'I', input: 'massa fresca 1kg',
    requireInName: ['Massa', 'Fresca'] },
  { family: 'I', input: 'couscous 1kg',
    requireInName: ['Couscous'], expectCategory: 'Mercearia' },
  { family: 'I', input: 'pão ralado 1kg',
    requireInName: ['Pão', 'Ralado'], expectCategory: 'Mercearia' },
  { family: 'I', input: 'fermento seco 500g',
    requireInName: ['Fermento'], expectCategory: 'Mercearia' },
  { family: 'I', input: 'fermento fresco 500g',
    requireInName: ['Fermento', 'Fresco'], expectCategory: 'Mercearia' },
  { family: 'I', input: 'chocolate 70% 1kg',
    requireInName: ['Chocolate', '70%'], expectCategory: 'Mercearia',
    riskOnFlag: 'P0' },
  { family: 'I', input: 'chocolate branco 30% 1kg',
    requireInName: ['Chocolate', 'Branco', '30%'],
    expectCategory: 'Mercearia', riskOnFlag: 'P0' },
  { family: 'I', input: 'cacau pó 1kg',
    requireInName: ['Cacau'], expectCategory: 'Mercearia' },

  // ─────────────── J) Conservas, molhos e frascos ─────────────────
  { family: 'J', input: 'tomate pelado lata 2.5kg',
    requireInName: ['Tomate', 'Pelado'], expectCategory: 'Mercearia',
    note: 'lata mantém-se (CONTAINER_KEEP_IN_NAME)' },
  { family: 'J', input: 'tomate triturado lata 2.5kg',
    requireInName: ['Tomate'], expectCategory: 'Mercearia' },
  { family: 'J', input: 'tomate concentrado lata 800g',
    requireInName: ['Tomate', 'Concentrado'] },
  { family: 'J', input: 'milho lata 340g',
    requireInName: ['Milho'], note: 'milho é F&L mas em lata é Mercearia' },
  { family: 'J', input: 'grão lata 800g',
    requireInName: ['Grão'], expectCategory: 'Mercearia',
    riskOnFlag: 'P0', note: 'grão não pode desaparecer' },
  { family: 'J', input: 'feijão lata 800g',
    requireInName: ['Feijão'], expectCategory: 'Mercearia' },
  { family: 'J', input: 'atum lata 120g pack 3',
    requireInName: ['Atum'],
    note: 'nested: lata (inner) pack (outer); categoria Peixe/Mercearia?' },
  { family: 'J', input: 'azeitona frasco 1kg',
    forbidInName: ['frasco'], requireInName: ['Azeitona'],
    expectCategory: 'Mercearia' },
  { family: 'J', input: 'pickles frasco 1kg',
    forbidInName: ['frasco'], requireInName: ['Pickles'] },
  { family: 'J', input: 'pickles balde 3kg',
    forbidInName: ['balde'], requireInName: ['Pickles'] },
  { family: 'J', input: 'maionese balde 5l',
    forbidInName: ['balde'], requireInName: ['Maionese'],
    expectCategory: 'Mercearia' },
  { family: 'J', input: 'ketchup garrafa 1l pack 6',
    forbidInName: ['garrafa', 'pack'], requireInName: ['Ketchup'],
    expectCategory: 'Mercearia',
    note: 'nested: garrafa (inner) pack (outer)' },
  { family: 'J', input: 'mostarda frasco 500g',
    forbidInName: ['frasco'], requireInName: ['Mostarda'] },
  { family: 'J', input: 'molho soja garrafa 1l',
    forbidInName: ['garrafa'], requireInName: ['Molho', 'Soja'],
    expectCategory: 'Mercearia' },
  { family: 'J', input: 'vinagre garrafa 1l',
    forbidInName: ['garrafa'], requireInName: ['Vinagre'],
    expectCategory: 'Mercearia' },
  { family: 'J', input: 'óleo garrafa 5l',
    forbidInName: ['garrafa'], requireInName: ['Óleo'],
    expectCategory: 'Mercearia' },
  { family: 'J', input: 'azeite garrafa 5l',
    forbidInName: ['garrafa'], requireInName: ['Azeite'],
    expectCategory: 'Mercearia' },
  { family: 'J', input: 'pesto frasco 500g',
    forbidInName: ['frasco'], requireInName: ['Pesto'],
    expectCategory: 'Mercearia' },

  // ─────────────────────────── K) Pastelaria ──────────────────────
  { family: 'K', input: 'amêndoa laminada 1kg',
    requireInName: ['Amêndoa'], expectCategory: 'Mercearia' },
  { family: 'K', input: 'avelã inteira 1kg',
    requireInName: ['Avelã'], expectCategory: 'Mercearia' },
  { family: 'K', input: 'pistácio granulado 1kg',
    requireInName: ['Pistácio'], expectCategory: 'Mercearia' },
  { family: 'K', input: 'gelatina folha caixa 1kg',
    forbidInName: ['caixa'], requireInName: ['Gelatina', 'Folha'],
    expectCategory: 'Mercearia', riskOnFlag: 'P0',
    note: 'folha NÃO pode desaparecer' },
  { family: 'K', input: 'baunilha vagem 100g',
    requireInName: ['Baunilha', 'Vagem'], expectCategory: 'Mercearia',
    riskOnFlag: 'P1' },
  { family: 'K', input: 'leite condensado lata 397g',
    requireInName: ['Leite', 'Condensado'],
    note: 'lata mantém-se' },
  { family: 'K', input: 'doce de ovos balde 5kg',
    forbidInName: ['balde'], requireInName: ['Doce', 'Ovos'] },
  { family: 'K', input: 'massa folhada 1kg',
    requireInName: ['Massa', 'Folhada'], expectCategory: 'Mercearia' },
  { family: 'K', input: 'massa quebrada 1kg',
    requireInName: ['Massa', 'Quebrada'], expectCategory: 'Mercearia' },

  // ─────────────────── L) Erros, colados e WhatsApp ───────────────
  { family: 'L', input: 'leite1lpack6',
    requireInName: ['Leite'], note: 'tudo colado' },
  { family: 'L', input: 'leite 1 l pack6',
    requireInName: ['Leite'] },
  { family: 'L', input: 'leite 1lpack 6',
    requireInName: ['Leite'] },
  { family: 'L', input: 'nata35%pacote1lcaixa6l',
    requireInName: ['Nata'], note: 'tudo colado com %' },
  { family: 'L', input: 'ovoscaixa180uni',
    requireInName: ['Ovos', 'Ovo'], note: 'tudo colado' },
  { family: 'L', input: 'arrozsaco20kg',
    requireInName: ['Arroz'] },
  { family: 'L', input: 'frangocaixa10kg',
    requireInName: ['Frango'] },
  { family: 'L', input: 'tomate lata2,5kg',
    requireInName: ['Tomate'] },
  { family: 'L', input: 'azeite garrafa5l',
    forbidInName: ['garrafa'], requireInName: ['Azeite'] },
  { family: 'L', input: 'agua pack24x0.5l',
    forbidInName: ['pack'], requireInName: ['Água', 'Agua'] },
  { family: 'L', input: 'salmao fumado 500gr',
    requireInName: ['Salmão', 'Fumado'], expectCategory: 'Peixe e Marisco' },
  { family: 'L', input: 'rucula saco200g',
    forbidInName: ['saco'], requireInName: ['Rúcula'] },
  { family: 'L', input: 'cafe grao1kg',
    requireInName: ['Café'], note: 'grao colado a 1kg' },
  { family: 'L', input: 'queijo mozzarella125g caixa12',
    forbidInName: ['caixa'], requireInName: ['Mozzarella'] },
  { family: 'L', input: 'hamburguer180g caixa24',
    forbidInName: ['caixa'], requireInName: ['Hambúrguer'] },

  // ─────────────────── M) Devem preservar nome ────────────────────
  // P0 quando palavra essencial é apagada — falsos positivos perigosos.
  { family: 'M', input: 'bola de berlim',
    requireInName: ['Bola', 'Berlim'], riskOnFlag: 'P0' },
  { family: 'M', input: 'queijo da ilha',
    requireInName: ['Queijo', 'Ilha'], riskOnFlag: 'P0' },
  { family: 'M', input: 'vinho do porto',
    requireInName: ['Vinho', 'Porto'], expectCategory: 'Bebidas',
    riskOnFlag: 'P0' },
  { family: 'M', input: 'tomate coração de boi',
    requireInName: ['Tomate', 'Coração'], riskOnFlag: 'P0' },
  { family: 'M', input: 'pimenta em grão',
    requireInName: ['Pimenta'], riskOnFlag: 'P1',
    note: '"em grão" pode ser stripped por NAME_CONNECTORS' },
  { family: 'M', input: 'café em grão',
    requireInName: ['Café'], riskOnFlag: 'P1' },
  { family: 'M', input: 'folha de louro',
    requireInName: ['Louro'], riskOnFlag: 'P1' },
  { family: 'M', input: 'gelatina folha',
    requireInName: ['Gelatina', 'Folha'], riskOnFlag: 'P0' },
  { family: 'M', input: 'flor de sal',
    requireInName: ['Flor', 'Sal'], riskOnFlag: 'P0' },
  { family: 'M', input: 'leite creme',
    requireInName: ['Leite', 'Creme'], riskOnFlag: 'P0' },
  { family: 'M', input: 'creme de leite',
    requireInName: ['Creme', 'Leite'], riskOnFlag: 'P0' },
  { family: 'M', input: 'massa folhada',
    requireInName: ['Massa', 'Folhada'], riskOnFlag: 'P0' },
  { family: 'M', input: 'massa fresca',
    requireInName: ['Massa', 'Fresca'], riskOnFlag: 'P0' },
  { family: 'M', input: 'frango inteiro',
    requireInName: ['Frango'], riskOnFlag: 'P1' },
  { family: 'M', input: 'robalo inteiro',
    requireInName: ['Robalo'], riskOnFlag: 'P1' },
  { family: 'M', input: 'lombo inteiro',
    requireInName: ['Lombo'], riskOnFlag: 'P1' },
  { family: 'M', input: 'pão de alho',
    requireInName: ['Pão', 'Alho'], riskOnFlag: 'P0' },
  { family: 'M', input: 'pão ralado',
    requireInName: ['Pão', 'Ralado'], riskOnFlag: 'P0' },
]

// ── Execução ─────────────────────────────────────────────────────────────────

type Row = {
  family:       Family
  input:        string
  name:         string
  unit:         string
  intent:       string
  options:      string
  category:     string
  hint:         string
  warnings:     string
  flags:        string[]
  risk:         Risk
  note:         string
  confidence:   ConfidenceLevel
}

const rows: Row[] = []

function intentDesc(intent: ReturnType<typeof buildArticleDraft>['intent']): string {
  switch (intent.kind) {
    case 'PACKAGED_WEIGHT':
      return `PACKAGED_WEIGHT(${intent.orderUnit}, ${intent.basePerOrder}${
        intent.multipack ? `, mp=${intent.multipack.count}×${intent.multipack.perPack}${
          intent.multipack.innerLabel ? `[${intent.multipack.innerLabel}]` : ''
        }` : ''
      })`
    case 'PACKAGED_VOLUME':
      return `PACKAGED_VOLUME(${intent.orderUnit}, ${intent.basePerOrder}${
        intent.multipack ? `, mp=${intent.multipack.count}×${intent.multipack.perPack}${
          intent.multipack.innerLabel ? `[${intent.multipack.innerLabel}]` : ''
        }` : ''
      })`
    case 'COUNTABLE_PACKAGED':
      return `COUNTABLE_PACKAGED(${intent.orderUnit}, ${intent.perPack})`
    default:
      return intent.kind
  }
}

function classifyRisk(
  flags: string[],
  riskOnFlag: 'P0' | 'P1' | 'P2' | undefined,
): Risk {
  if (flags.length === 0) return 'OK'
  // CRASH é sempre P0
  if (flags.some(f => f.startsWith('CRASH'))) return 'P0'
  // requireInName falhado quando o probe declara P0 → falso positivo perigoso
  if (riskOnFlag) return riskOnFlag
  // Default conservativo: P1 se forbid violado, P2 caso contrário
  return flags.some(f => f.includes('contém')) ? 'P1' : 'P2'
}

for (const probe of PROBES) {
  let row: Row
  try {
    const draft   = buildArticleDraft(probe.input)
    const options = getCountingModeOptions({ intent: draft.intent })
    const flags: string[] = []

    if (probe.forbidInName) {
      const nameNorm = draft.name.toLowerCase()
      for (const f of probe.forbidInName) {
        if (nameNorm.includes(f.toLowerCase())) flags.push(`name contém "${f}"`)
      }
    }
    if (probe.requireInName) {
      const nameNorm = draft.name.toLowerCase()
      // requireInName é OR-list em variantes (ex: ['Ovos','Ovo']) — só falha
      // se NENHUMA variante aparecer. Mas para manter compat com stress-battery
      // tratamos cada string como obrigação independente excepto quando o
      // primeiro caráter-base é o mesmo (heurística: 'Ovos' e 'Ovo' partilham
      // 'ovo' lowercase).
      const allMissing = probe.requireInName.every(
        r => !nameNorm.includes(r.toLowerCase())
      )
      if (allMissing) {
        for (const r of probe.requireInName) {
          flags.push(`name falta "${r}"`)
        }
      }
    }
    if (probe.expectIntent && draft.intent.kind !== probe.expectIntent) {
      flags.push(`intent ${draft.intent.kind} ≠ ${probe.expectIntent}`)
    }
    if (probe.expectOptions != null && options.length !== probe.expectOptions) {
      flags.push(`options ${options.length} ≠ ${probe.expectOptions}`)
    }
    if (probe.expectCategory && draft.category !== probe.expectCategory) {
      flags.push(`category "${draft.category}" ≠ "${probe.expectCategory}"`)
    }

    const optsDesc = options.map(o => `${o.count_unit}/${o.base_per_unit}`).join(' | ')
    const hint     = draft.detected_label
      ? `${draft.detected_label}${draft.detected_qty ? ` ${draft.detected_qty}` : ''}${
          draft.detected_multipack ? ` (mp ${draft.detected_multipack.count}×${draft.detected_multipack.perPack})` : ''
        }`
      : (draft.detected_qty ? `qty ${draft.detected_qty}` : '')
    const warnings = draft.warnings.join(',') || '(none)'

    row = {
      family:     probe.family,
      input:      probe.input,
      name:       draft.name || '(vazio)',
      unit:       draft.unit,
      intent:     intentDesc(draft.intent),
      options:    optsDesc,
      category:   draft.category ?? '(none)',
      hint,
      warnings,
      flags,
      risk:       classifyRisk(flags, probe.riskOnFlag),
      note:       probe.note ?? '',
      confidence: draft.confidence,
    }
  } catch (err) {
    row = {
      family:     probe.family,
      input:      probe.input,
      name:       '(CRASH)',
      unit:       '',
      intent:     '',
      options:    '',
      category:   '',
      hint:       '',
      warnings:   '',
      flags:      [`CRASH: ${(err as Error).message}`],
      risk:       'P0',
      note:       probe.note ?? '',
      confidence: 'low',
    }
  }
  rows.push(row)
}

// ── Output ───────────────────────────────────────────────────────────────────

const FAMILY_NAMES: Record<Family, string> = {
  A: 'Embalagem antes do nome',
  B: 'Carnes',
  C: 'Peixes e marisco',
  D: 'Congelados',
  E: 'Bebidas',
  F: 'Legumes',
  G: 'Frutas',
  H: 'Lacticínios e ovos',
  I: 'Mercearia seca',
  J: 'Conservas, molhos e frascos',
  K: 'Pastelaria',
  L: 'Erros, colados e WhatsApp',
  M: 'Devem preservar nome',
}

const RISK_GLYPH: Record<Risk, string> = { OK: '✓', P2: '·', P1: '⚠', P0: '✗' }

let countOK = 0, countP0 = 0, countP1 = 0, countP2 = 0
for (const r of rows) {
  if (r.risk === 'OK') countOK++
  if (r.risk === 'P2') countP2++
  if (r.risk === 'P1') countP1++
  if (r.risk === 'P0') countP0++
}

for (const family of ['A','B','C','D','E','F','G','H','I','J','K','L','M'] as const) {
  const fam = rows.filter(r => r.family === family)
  if (fam.length === 0) continue
  console.log(`\n━━━━━━━━━━━━ Família ${family} — ${FAMILY_NAMES[family]} (${fam.length}) ━━━━━━━━━━━━`)
  for (const r of fam) {
    console.log(`${RISK_GLYPH[r.risk]} [${r.risk}] "${r.input}"`)
    console.log(`   nome:     ${r.name}`)
    console.log(`   unit:     ${r.unit}`)
    console.log(`   intent:   ${r.intent}`)
    console.log(`   options:  ${r.options}`)
    console.log(`   category: ${r.category}`)
    if (r.hint)     console.log(`   hint:     ${r.hint}`)
    if (r.warnings && r.warnings !== '(none)') console.log(`   warnings: ${r.warnings}`)
    if (r.note)     console.log(`   nota:     ${r.note}`)
    if (r.flags.length > 0) {
      for (const f of r.flags) console.log(`   ⚠ ${f}`)
    }
  }
}

console.log(`\n────── Resumo R-TEST 2 ──────`)
console.log(`Total casos: ${rows.length}`)
console.log(`OK: ${countOK} · P2: ${countP2} · P1: ${countP1} · P0: ${countP0}`)

// Top failures (P0 + P1)
const failures = rows.filter(r => r.risk === 'P0' || r.risk === 'P1')
if (failures.length > 0) {
  console.log(`\n────── Top falhas (P0/P1) ──────`)
  for (const r of failures.slice(0, 20)) {
    console.log(`${RISK_GLYPH[r.risk]} [${r.family}/${r.risk}] "${r.input}" → "${r.name}" (${r.category})`)
    for (const f of r.flags) console.log(`   • ${f}`)
  }
}

// ── Histograma de confiança + gate de calibração ───────────────────────────
const confCounts: Record<ConfidenceLevel, number> = { high: 0, medium: 0, low: 0 }
for (const r of rows) confCounts[r.confidence]++
const total = rows.length || 1
const pct   = (n: number) => ((n / total) * 100).toFixed(1)

console.log(`\n────── Histograma de confiança ──────`)
console.log(`high:   ${pct(confCounts.high)}%  (${confCounts.high}/${total})`)
console.log(`medium: ${pct(confCounts.medium)}%  (${confCounts.medium}/${total})`)
console.log(`low:    ${pct(confCounts.low)}%  (${confCounts.low}/${total})`)

const highPct = (confCounts.high / total) * 100
const lowPct  = (confCounts.low  / total) * 100
const gateHigh = highPct >= 60
const gateLow  = lowPct  <= 20
const gatePass = gateHigh && gateLow
console.log(`\nGate de calibração (chaos): ${gatePass ? 'PASS' : 'FAIL'}`)
console.log(`  high ≥ 60%:  ${gateHigh ? 'PASS' : 'FAIL'}  (${highPct.toFixed(1)}%)`)
console.log(`  low  ≤ 20%:  ${gateLow  ? 'PASS' : 'FAIL'}  (${lowPct.toFixed(1)}%)`)

process.exit(0) // exploratório, nunca regressão

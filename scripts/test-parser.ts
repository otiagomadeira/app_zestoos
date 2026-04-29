/**
 * Validação leve do motor de parsing de artigos.
 *
 * Cobre:
 *   - 12 casos críticos (definidos por produto após 50 produtos difíceis)
 *   - 6 regressões próximas pedidas pelo chef
 *   - 3 regressões defensivas (Mel frasco, Hortelã pimenta, Camembert)
 *
 * Sem framework. Sem dependências extra. Usa tsx (já em devDependencies).
 *
 * Correr: npm run test:parser
 * Sai com código 1 se algum caso falhar.
 */

import { buildArticleDraft, formatDraftHint, getCountingMode, getCountingModeOptions, inferIntent, type ArticleIntent, type CountingMode } from '../src/lib/articleDraft'
import { parseProductLines } from '../src/lib/parseProductLines'
import { parsePackagingQuantity, type ArticleBaseUnit } from '../src/lib/units'
import { getSuggestedUnitWeight } from '../src/lib/unitWeightSuggestions'
import { assessConfidence, type ConfidenceLevel, type ConfidenceReason } from '../src/lib/articleConfidence'
import { resolveArticleInputAction } from '../src/lib/resolveArticleAction'

type Expect = {
  name?:             string
  unit?:             'g' | 'mL' | 'un'
  category?:         string | null
  orderUnit?:        string | null
  conversionFactor?: number | null
  detectedQty?:      number | null
  multipackCount?:   number | null
  multipackPerPack?: number | null
  hint?:             string | null
  intent?:           ArticleIntent['kind']
  intentOrderUnit?:  string
  intentFactor?:     number
  confidence?:       ConfidenceLevel
  reasons?:          ConfidenceReason[]
}

type Case = {
  tag:    'CRITICAL' | 'REGRESSION'
  input:  string
  expect: Expect
}

const CASES: Case[] = [
  // ── 12 casos críticos ──────────────────────────────────────────────
  { tag: 'CRITICAL', input: 'Ovo caixa 180 uni',
    expect: { name: 'Ovo', unit: 'un', orderUnit: 'caixa', conversionFactor: 180 } },
  { tag: 'CRITICAL', input: 'Ovos classe M caixa 180 uni',
    expect: { name: 'Ovos Classe M', unit: 'un', orderUnit: 'caixa', conversionFactor: 180 } },
  { tag: 'CRITICAL', input: 'Limão caixa 60 uni',
    expect: { name: 'Limão', unit: 'un', orderUnit: 'caixa', conversionFactor: 60 } },
  { tag: 'CRITICAL', input: 'Alface iceberg caixa 12 uni',
    expect: { name: 'Alface Iceberg', unit: 'un', orderUnit: 'caixa', conversionFactor: 12 } },
  { tag: 'CRITICAL', input: 'Manjericão vaso 1 uni',
    expect: { name: 'Manjericão', unit: 'un', orderUnit: 'vaso', conversionFactor: 1 } },
  { tag: 'CRITICAL', input: 'Leite sem lactose cx 6x1L',
    expect: { name: 'Leite Sem Lactose', unit: 'mL', orderUnit: 'caixa', conversionFactor: 6000,
              multipackCount: 6, multipackPerPack: 1000, hint: '6 x 1 L · caixa' } },
  { tag: 'CRITICAL', input: 'Atum em lata 1kg',
    expect: { name: 'Atum em Lata', unit: 'g', category: 'Mercearia', orderUnit: 'lata', conversionFactor: 1000 } },
  { tag: 'CRITICAL', input: 'Feijão em lata 2.5kg',
    expect: { name: 'Feijão em Lata', unit: 'g', category: 'Mercearia', orderUnit: 'lata', conversionFactor: 2500 } },
  { tag: 'CRITICAL', input: 'Feijão seco saco 5kg',
    expect: { name: 'Feijão Seco', unit: 'g', orderUnit: 'saco', conversionFactor: 5000 } },
  { tag: 'CRITICAL', input: 'Caldo galinha em pó balde 1kg',
    expect: { name: 'Caldo Galinha em Pó', unit: 'g', category: 'Mercearia', orderUnit: 'balde', conversionFactor: 1000 } },
  { tag: 'CRITICAL', input: 'Mel rosmaninho balde 5kg',
    expect: { name: 'Mel Rosmaninho', category: 'Mercearia', orderUnit: 'balde', conversionFactor: 5000 } },
  { tag: 'CRITICAL', input: 'Chocolate negro callets saco 2.5kg',
    expect: { name: 'Chocolate Negro Callets', category: 'Mercearia', orderUnit: 'saco', conversionFactor: 2500 } },

  // ── Regressões próximas ────────────────────────────────────────────
  { tag: 'REGRESSION', input: 'Rúcula saco 200g',
    expect: { name: 'Rúcula', unit: 'g', orderUnit: 'saco', conversionFactor: 200 } },
  { tag: 'REGRESSION', input: 'Tomate pelado lata 2.5kg',
    expect: { name: 'Tomate Pelado em Lata', unit: 'g', category: 'Mercearia', orderUnit: 'lata', conversionFactor: 2500 } },
  { tag: 'REGRESSION', input: 'Choco limpo 1kg',
    expect: { name: 'Choco Limpo', unit: 'g', category: 'Peixe e Marisco' } },
  { tag: 'REGRESSION', input: 'Chocolate em pó saco 1kg',
    expect: { name: 'Chocolate em Pó', unit: 'g', category: 'Mercearia', orderUnit: 'saco', conversionFactor: 1000 } },
  { tag: 'REGRESSION', input: 'Água cx 12x1.5L',
    expect: { name: 'Água', unit: 'mL', category: 'Bebidas', orderUnit: 'caixa', conversionFactor: 18000,
              multipackCount: 12, multipackPerPack: 1500, hint: '12 x 1.5 L · caixa' } },
  { tag: 'REGRESSION', input: 'Natas cx 12x200ml',
    expect: { name: 'Natas', unit: 'mL', category: 'Lacticínios e Ovos', orderUnit: 'caixa', conversionFactor: 2400,
              multipackCount: 12, multipackPerPack: 200, hint: '12 x 200 mL · caixa' } },
  { tag: 'REGRESSION', input: 'Cerveja cx 24x33cl',
    expect: { name: 'Cerveja', unit: 'mL', category: 'Bebidas', orderUnit: 'caixa', conversionFactor: 7920,
              multipackCount: 24, multipackPerPack: 330, hint: '24 x 330 mL · caixa' } },

  // ── Conserva / enlatado: bug do supplierSeed silenciosamente perdido ───
  // R-PATCH simétrico: o branch CONTAINER_KEEP agora canonicaliza para
  // "X em <suffix>" também quando o label vem DEPOIS do produto. As três formas
  // ("Atum em Conserva" via DICT, "Atum conserva 1kg", "Atum em conserva 1kg")
  // colapsam na mesma chave canónica — pré-requisito para o duplicate detection
  // do BulkImportPanel apanhar a variante.
  { tag: 'CRITICAL', input: 'Atum conserva 1kg',
    expect: { name: 'Atum em Conserva', unit: 'g', category: 'Mercearia', orderUnit: 'conserva', conversionFactor: 1000 } },
  { tag: 'CRITICAL', input: 'Atum enlatado 1kg',
    expect: { name: 'Atum em Lata', unit: 'g', category: 'Mercearia', orderUnit: 'lata', conversionFactor: 1000 } },
  { tag: 'CRITICAL', input: 'Pimentos em conserva frasco 1kg',
    expect: { name: 'Pimentos em Conserva', unit: 'g', category: 'Mercearia', orderUnit: 'frasco', conversionFactor: 1000 } },

  // ── R-PATCH: container-keep com label antes do produto ──────────────────
  // Bug histórico: branch CONTAINER_KEEP retornava `before || after`, descartando
  // o produto quando `before` era só o label. Resultado virava "Lata" puro.
  // Fix em normalizeArticle.ts: quando `before` é apenas label, ir buscar
  // produto a `after` e sufixar com "em <suffix>".
  { tag: 'CRITICAL', input: 'lata 2.5kg tomate pelado',
    expect: { name: 'Tomate Pelado em Lata', unit: 'g', category: 'Mercearia', orderUnit: 'lata', conversionFactor: 2500 } },
  { tag: 'CRITICAL', input: 'lata 400g tomate triturado',
    expect: { name: 'Tomate Triturado em Lata', unit: 'g', category: 'Mercearia', orderUnit: 'lata', conversionFactor: 400 } },

  // ── R-PATCH: container-keep com label DEPOIS do produto ──────────────────
  // Bug simétrico ao acima: "tomate pelado lata 2.5kg" produzia
  // "Tomate Pelado Lata" (label vazava como nome). A canonicalização "em <suffix>"
  // só disparava quando o label era a ÚNICA palavra de `before`. Fix: quando
  // o label é a última palavra de `before` (não-só-label), strip + sufixo.
  // Necessário para que o duplicate detection do BulkImportPanel apanhe a
  // forma natural "<produto> <embalagem> <peso>" → mesma chave canónica que
  // "<embalagem> <peso> <produto>".
  { tag: 'CRITICAL', input: 'tomate pelado lata 2.5kg',
    expect: { name: 'Tomate Pelado em Lata', unit: 'g', category: 'Mercearia', orderUnit: 'lata', conversionFactor: 2500 } },
  { tag: 'CRITICAL', input: 'atum lata 1kg',
    expect: { name: 'Atum em Lata', unit: 'g', category: 'Mercearia', orderUnit: 'lata', conversionFactor: 1000 } },

  // ── Caso "duplicado + tamanho" sem packaging label (variant flow no Bulk) ─
  // "tomate pelado 2.5kg" sem "lata" — parser não infere embalagem.
  // O nome canónico colide com "Tomate Pelado" existente; supplierSeed=undefined
  // mas detected_qty=2500 fica disponível para o BulkImportPanel oferecer
  // "Adicionar tamanho · 2,5 kg" na DuplicateCard.
  { tag: 'CRITICAL', input: 'tomate pelado 2.5kg',
    expect: { name: 'Tomate Pelado', unit: 'g', detectedQty: 2500, orderUnit: null, conversionFactor: null } },

  // ── Regressão: label de embalagem antes do produto sem CONTAINER_KEEP ─────
  // "frasco 1L azeite" — frasco NÃO está em CONTAINER_KEEP_IN_NAME, então o
  // branch normal apaga o label e o produto fica em `after`.
  { tag: 'REGRESSION', input: 'frasco 1L azeite',
    expect: { name: 'Azeite', unit: 'mL', orderUnit: 'frasco', conversionFactor: 1000 } },

  // ── R-PATCH: categoria por word-boundary + priority phrases ─────────────
  // Falsos positivos eliminados: "porto" em "portobello" deixa de cair em
  // Bebidas; "coração" em "coração de boi" e "lombo" em "atum lombo" são
  // resolvidos por PRIORITY_KEYWORDS antes do loop genérico.
  { tag: 'CRITICAL', input: 'cogumelos portobello caixa 2kg',
    expect: { category: 'Frutas e Legumes' } },
  { tag: 'CRITICAL', input: 'tomate coração de boi 5kg',
    expect: { category: 'Frutas e Legumes' } },
  { tag: 'CRITICAL', input: 'atum lombo 2kg',
    expect: { category: 'Peixe e Marisco' } },

  // ── R-PATCH 2: "molho X" não é embalagem quando é prefixo do nome ────────
  // Bug histórico: "molho" em CONTAINER_CONTEXT_WORDS era strippado pelo
  // fallback de stripContainersAndBareNumbersList. "molho inglês" → "Inglês".
  // Fix em normalizeArticle.ts: idx===0 com palavras a seguir é prefixo de
  // nome. Casos com qty (garrafa/frasco) já funcionavam por outro path.
  { tag: 'CRITICAL', input: 'molho inglês',
    expect: { name: 'Molho Inglês', category: 'Mercearia' } },
  { tag: 'CRITICAL', input: 'molho madeira',
    expect: { name: 'Molho Madeira', category: 'Mercearia' } },
  { tag: 'CRITICAL', input: 'molho barbecue',
    expect: { name: 'Molho Barbecue', category: 'Mercearia' } },
  { tag: 'CRITICAL', input: 'molho holandês',
    expect: { name: 'Molho Holandês', category: 'Mercearia' } },
  { tag: 'CRITICAL', input: 'molho soja garrafa 1l',
    expect: { name: 'Molho Soja', category: 'Mercearia', orderUnit: 'garrafa', conversionFactor: 1000 } },
  { tag: 'CRITICAL', input: 'molho ostra garrafa 700ml',
    expect: { name: 'Molho Ostra', category: 'Mercearia', orderUnit: 'garrafa', conversionFactor: 700 } },
  { tag: 'CRITICAL', input: 'molho peixe garrafa 725ml',
    expect: { name: 'Molho Peixe', category: 'Mercearia', orderUnit: 'garrafa', conversionFactor: 725 } },
  { tag: 'CRITICAL', input: 'molho hoisin frasco 397g',
    expect: { name: 'Molho Hoisin', category: 'Mercearia', orderUnit: 'frasco', conversionFactor: 397 } },
  // Não-regressão: "molho" noutra posição mantém path actual; nome pode
  // perder "molho" mas NÃO pode perder "espargos verdes/brancos".
  { tag: 'REGRESSION', input: 'espargos verdes molho',
    expect: { name: 'Espargos Verdes' } },
  { tag: 'REGRESSION', input: 'espargos brancos molho',
    expect: { name: 'Espargos Brancos' } },

  // ── Multipack-equivalente: peso/volume + label + count solto ──────
  // Bug histórico: "6uni" colado e "pack 4" sem suffix ficavam fora do
  // ALT_MULTIPACK_COUNT_RE; multipack era ignorado e conversion_factor
  // ficava em qty (1L em vez de 6L). Casos abaixo cobrem o fix.
  { tag: 'CRITICAL', input: 'leite 1L pack 6uni',
    expect: { name: 'Leite', unit: 'mL', orderUnit: 'pack', conversionFactor: 6000,
              multipackCount: 6, multipackPerPack: 1000 } },
  { tag: 'CRITICAL', input: 'leite pack 6x1L',
    expect: { name: 'Leite', unit: 'mL', orderUnit: 'pack', conversionFactor: 6000,
              multipackCount: 6, multipackPerPack: 1000 } },
  { tag: 'CRITICAL', input: 'manteiga 200g pack 4',
    expect: { name: 'Manteiga', unit: 'g', orderUnit: 'pack', conversionFactor: 800,
              multipackCount: 4, multipackPerPack: 200 } },
  // Total na mesma família depois do label ("pack 6L" = total no pack)
  { tag: 'CRITICAL', input: 'leite 1L pack 6L',
    expect: { name: 'Leite', unit: 'mL', orderUnit: 'pack', conversionFactor: 6000,
              multipackCount: 6, multipackPerPack: 1000 } },
  { tag: 'CRITICAL', input: 'manteiga 200g pack 800g',
    expect: { name: 'Manteiga', unit: 'g', orderUnit: 'pack', conversionFactor: 800,
              multipackCount: 4, multipackPerPack: 200 } },
  { tag: 'CRITICAL', input: 'leite 250ml pack 1L',
    expect: { name: 'Leite', unit: 'mL', orderUnit: 'pack', conversionFactor: 1000,
              multipackCount: 4, multipackPerPack: 250 } },
  // Ratio não-inteiro: total preservado, multipack undefined
  { tag: 'CRITICAL', input: 'azeite 750ml garrafa 5L',
    expect: { unit: 'mL', orderUnit: 'garrafa', conversionFactor: 5000,
              multipackCount: null, multipackPerPack: null } },
  // Nested packaging: inner label antes + outer label depois ("pacote 1l caixa 6l")
  // → outer="caixa" (encomenda), inner="pacote" (label da alternativa).
  { tag: 'CRITICAL', input: 'Nata 20% pacote 1l caixa 6l',
    expect: { name: 'Nata 20%', unit: 'mL', category: 'Lacticínios e Ovos',
              orderUnit: 'caixa', conversionFactor: 6000,
              multipackCount: 6, multipackPerPack: 1000 } },
  // Nata singular (sem "s") devia também cair em Lacticínios e Ovos
  { tag: 'CRITICAL', input: 'Nata 35%',
    expect: { name: 'Nata 35%', unit: 'mL', category: 'Lacticínios e Ovos' } },
  // "Creme culinário" caía em Bebidas via unit-fallback (mL sem keyword) —
  // categoria explícita em Lacticínios resolve.
  { tag: 'CRITICAL', input: 'creme culinário pacote 1l caixa 6l',
    expect: { name: 'Creme Culinário', unit: 'mL', category: 'Lacticínios e Ovos',
              orderUnit: 'caixa', conversionFactor: 6000,
              multipackCount: 6, multipackPerPack: 1000 } },
  { tag: 'CRITICAL', input: 'leite meio gordo pacote 1l caixa 6l',
    expect: { name: 'Leite Meio Gordo', unit: 'mL', orderUnit: 'caixa', conversionFactor: 6000,
              multipackCount: 6, multipackPerPack: 1000 } },
  { tag: 'CRITICAL', input: 'manteiga pacote 200g caixa 800g',
    expect: { name: 'Manteiga', unit: 'g', orderUnit: 'caixa', conversionFactor: 800,
              multipackCount: 4, multipackPerPack: 200 } },
  { tag: 'CRITICAL', input: 'Ovos caixa 180 uni',
    expect: { name: 'Ovos', unit: 'un', orderUnit: 'caixa', conversionFactor: 180,
              multipackCount: null, multipackPerPack: null } },

  // ── Defensivas (não-regressão de cobertura existente) ──────────────
  { tag: 'REGRESSION', input: 'Mel frasco 1kg',
    expect: { name: 'Mel', category: 'Mercearia', orderUnit: 'frasco', conversionFactor: 1000 } },
  { tag: 'REGRESSION', input: 'Hortelã pimenta',
    expect: { category: 'Frutas e Legumes' } },
  { tag: 'REGRESSION', input: 'Camembert',
    expect: { category: 'Lacticínios e Ovos' } },

  // ── Congelado/fresco como adjetivo do nome (não categoria própria) ─
  // Decisão de produto: "Congelados" deixa de ser categoria. "congelado",
  // "fresco" e "refrigerado" preservam-se no nome porque distinguem
  // produtos operacionalmente diferentes (perna fresca ≠ perna congelada),
  // mas a categoria é decidida pelo ingrediente base.
  { tag: 'CRITICAL', input: 'perna de frango congelada caixa 10kg',
    expect: { name: 'Perna de Frango Congelada', unit: 'g', category: 'Carnes',
              orderUnit: 'caixa', conversionFactor: 10000 } },
  { tag: 'CRITICAL', input: 'perna de frango fresca caixa 5kg',
    expect: { name: 'Perna de Frango Fresca', unit: 'g', category: 'Carnes',
              orderUnit: 'caixa', conversionFactor: 5000 } },
  { tag: 'CRITICAL', input: 'perna de frango congelada caixa 15kg',
    expect: { name: 'Perna de Frango Congelada', unit: 'g', category: 'Carnes',
              orderUnit: 'caixa', conversionFactor: 15000 } },
  { tag: 'REGRESSION', input: 'salmão congelado 1kg',
    expect: { name: 'Salmão Congelado', unit: 'g', category: 'Peixe e Marisco' } },
  { tag: 'REGRESSION', input: 'ervilhas congeladas saco 500g',
    expect: { name: 'Ervilhas Congeladas', unit: 'g', category: 'Frutas e Legumes',
              orderUnit: 'saco', conversionFactor: 500 } },

  // ── Categoria accent-insensitive: input do chef sem acentos ────────
  { tag: 'REGRESSION', input: 'feijao seco saco 5kg',
    expect: { category: 'Mercearia', orderUnit: 'saco', conversionFactor: 5000 } },
  { tag: 'REGRESSION', input: 'limao caixa 60 uni',
    expect: { unit: 'un', category: 'Frutas e Legumes', orderUnit: 'caixa', conversionFactor: 60 } },
  { tag: 'REGRESSION', input: 'brocolos 1kg',
    expect: { category: 'Frutas e Legumes' } },
  { tag: 'REGRESSION', input: 'acucar saco 1kg',
    expect: { category: 'Mercearia', orderUnit: 'saco', conversionFactor: 1000 } },

  // ── Fase A: bloco + dimensões + label-first ────────────────────────
  // Nota: DICT canoniza 'manteiga sem sal' → 'Manteiga sem Sal' (preposição
  // "sem" minúscula, escolha estilística PT existente no projeto).
  { tag: 'CRITICAL', input: 'manteiga sem sal bloco 1kg',
    expect: { name: 'Manteiga sem Sal', unit: 'g', category: 'Lacticínios e Ovos',
              orderUnit: 'bloco', conversionFactor: 1000 } },
  { tag: 'CRITICAL', input: 'sacos vacuo 20x30 caixa 100 uni',
    expect: { name: 'Sacos Vacuo 20x30', unit: 'un', category: 'Embalagens e Descartáveis',
              orderUnit: 'caixa', conversionFactor: 100 } },
  { tag: 'CRITICAL', input: 'caixa 180 uni ovos',
    expect: { name: 'Ovos', unit: 'un', category: 'Lacticínios e Ovos',
              orderUnit: 'caixa', conversionFactor: 180 } },
  { tag: 'CRITICAL', input: 'caixa 60 uni limao',
    expect: { name: 'Limão', unit: 'un', category: 'Frutas e Legumes',
              orderUnit: 'caixa', conversionFactor: 60 } },
  { tag: 'CRITICAL', input: 'caixa 6x1L leite meio gordo',
    expect: { name: 'Leite Meio Gordo', unit: 'mL', category: 'Lacticínios e Ovos',
              orderUnit: 'caixa', conversionFactor: 6000,
              multipackCount: 6, multipackPerPack: 1000, hint: '6 x 1 L · caixa' } },

  // ── Tokens compactos "<n>un" (sem espaço) ───────────────────────────
  // O parser perdia "Abacate 6un" porque "6un" não é peso, volume nem bare
  // number, e os filtros de UNIT_QTY_TOKENS/isBareNumber não apanhavam um
  // token misto. COMPACT_UNIT_QTY_RE fecha o buraco sem afetar dimensões
  // como "20x30" (têm 'x').
  { tag: 'CRITICAL', input: 'Abacate 6un',
    expect: { name: 'Abacate', unit: 'un', category: 'Frutas e Legumes' } },
  { tag: 'CRITICAL', input: 'Cebola 12un',
    expect: { name: 'Cebola', unit: 'un', category: 'Frutas e Legumes' } },
  { tag: 'CRITICAL', input: 'Ovos 6uni',
    expect: { name: 'Ovos', unit: 'un', category: 'Lacticínios e Ovos' } },
  { tag: 'CRITICAL', input: 'Pão de leite 6un',
    expect: { name: 'Pão de Leite', unit: 'un' } },
  { tag: 'CRITICAL', input: 'Maçã 6unidades',
    expect: { name: 'Maçã', unit: 'un', category: 'Frutas e Legumes' } },

  // ── Fase B: multipack-equivalente "qty unit + label + count uni" ───
  // Padrão: weight/volume + label adjacente DEPOIS + N uni no resto
  // → trata como multipack {count:N, perPack:qty}.
  { tag: 'CRITICAL', input: '1lt caixa 6 uni leite m.g.',
    expect: { unit: 'mL', category: 'Lacticínios e Ovos',
              orderUnit: 'caixa', conversionFactor: 6000,
              multipackCount: 6, multipackPerPack: 1000, hint: '6 x 1 L · caixa' } },
  { tag: 'CRITICAL', input: '1L caixa 6 uni leite sem lactose',
    expect: { name: 'Leite Sem Lactose', unit: 'mL', category: 'Lacticínios e Ovos',
              orderUnit: 'caixa', conversionFactor: 6000,
              multipackCount: 6, multipackPerPack: 1000, hint: '6 x 1 L · caixa' } },

  // ── Intent (Iteração 1: dispatch de UX para par_level visual) ────────
  // Driver: design doc 2026-04-27-article-intent-design.md.
  // Cobertura por caso obrigatório do produto. COUNTABLE_UNIT puro tem
  // cobertura directa em INTENT_DIRECT_CASES abaixo (não depende do parser
  // de nome — a inferência de "frango inteiro" → un exigiria expandir
  // suggestUnit, fora de scope na Iteração 1).
  { tag: 'CRITICAL', input: 'frango 10kg',
    expect: { name: 'Frango', unit: 'g', intent: 'WEIGHT_LOOSE',
              orderUnit: null, conversionFactor: null } },
  { tag: 'CRITICAL', input: 'frango caixa 10kg',
    expect: { name: 'Frango', unit: 'g', intent: 'PACKAGED_WEIGHT',
              orderUnit: 'caixa', conversionFactor: 10000,
              intentOrderUnit: 'caixa', intentFactor: 10000 } },
  { tag: 'CRITICAL', input: 'leite 1L',
    expect: { name: 'Leite', unit: 'mL', intent: 'VOLUME',
              orderUnit: null, conversionFactor: null } },
  { tag: 'CRITICAL', input: 'ovos caixa 180 uni',
    expect: { name: 'Ovos', unit: 'un', intent: 'COUNTABLE_PACKAGED',
              orderUnit: 'caixa', conversionFactor: 180,
              intentOrderUnit: 'caixa', intentFactor: 180 } },
  { tag: 'CRITICAL', input: 'rúcula saco 200g',
    expect: { name: 'Rúcula', unit: 'g', intent: 'PACKAGED_WEIGHT',
              orderUnit: 'saco', conversionFactor: 200,
              intentOrderUnit: 'saco', intentFactor: 200 } },
  // Volume com packaging — variante não pedida no spec mas cobre PACKAGED_VOLUME.
  // "Leite caixa 1L" → caixa de 1L → PACKAGED_VOLUME.
  { tag: 'CRITICAL', input: 'leite caixa 1L',
    expect: { name: 'Leite', unit: 'mL', intent: 'PACKAGED_VOLUME',
              orderUnit: 'caixa', conversionFactor: 1000,
              intentOrderUnit: 'caixa', intentFactor: 1000 } },

  // ── Camada de confiança v1: confidence + reasons ────────────────────────
  // 3 níveis (high/medium/low) + lista frozen de 6 reasons. LOW pede revisão
  // ao chef; medium não interrompe form mas marca dot subtil em bulk import.
  // Regra de agregação NÃO worst-of-three: ver src/lib/articleConfidence.ts.

  // ── HIGH (9 casos do spec) ──
  { tag: 'CRITICAL', input: 'frango 10kg',
    expect: { confidence: 'high', reasons: [] } },
  { tag: 'CRITICAL', input: 'frango caixa 10kg',
    expect: { confidence: 'high', reasons: [] } },
  { tag: 'CRITICAL', input: 'leite 1L pack 6uni',
    expect: { confidence: 'high', reasons: [] } },
  { tag: 'CRITICAL', input: 'ovos caixa 180 uni',
    expect: { confidence: 'high', reasons: [] } },
  { tag: 'CRITICAL', input: 'lata 2.5kg tomate pelado',
    expect: { confidence: 'high', reasons: [] } },
  { tag: 'CRITICAL', input: 'molho inglês',
    expect: { confidence: 'high', reasons: [] } },
  { tag: 'CRITICAL', input: 'molho madeira',
    expect: { confidence: 'high', reasons: [] } },
  { tag: 'CRITICAL', input: 'molho ostra',
    expect: { confidence: 'high', reasons: [] } },
  { tag: 'CRITICAL', input: 'molho peixe',
    expect: { confidence: 'high', reasons: [] } },

  // ── LOW (9 casos do spec) ──
  // Códigos puros: nome curto / alfanumérico → name_is_code (hard-low).
  // category_uncertain dispara em consequência (não há keyword conhecida).
  { tag: 'CRITICAL', input: 'COD123',
    expect: { confidence: 'low', reasons: ['name_is_code', 'category_uncertain'] } },
  { tag: 'CRITICAL', input: 'ART.456',
    expect: { confidence: 'low', reasons: ['name_is_code', 'category_uncertain'] } },
  { tag: 'CRITICAL', input: 'REF9988',
    expect: { confidence: 'low', reasons: ['name_is_code', 'category_uncertain'] } },
  { tag: 'CRITICAL', input: 'CX6',
    expect: { confidence: 'low', reasons: ['name_is_code', 'category_uncertain'] } },
  // Embalagem que parece comida: container word stripped sem qty + categoria
  // fraca → product_name_lost_risk + category_uncertain → LOW.
  { tag: 'CRITICAL', input: 'caixa pizza',
    expect: { confidence: 'low' } },
  // Descartável kraft no input → possible_disposable (hard-low).
  { tag: 'CRITICAL', input: 'caixa hambúrguer kraft',
    expect: { confidence: 'low' } },
  // Saco vácuo → possible_disposable + product_name_lost_risk → LOW.
  { tag: 'CRITICAL', input: 'saco vácuo',
    expect: { confidence: 'low' } },
  // Container word como nome único → name_too_generic (hard-low).
  { tag: 'CRITICAL', input: 'caixa',
    expect: { confidence: 'low' } },
  { tag: 'CRITICAL', input: 'pacote',
    expect: { confidence: 'low' } },

  // ── MEDIUM (6 casos: 1 sinal não-hard) ──
  // Categoria incerta sozinha → MEDIUM (regra crítica do spec). Nome aceitável
  // (não é code, não é genérico, sem descartável), unidade inferida por
  // fallback → category_uncertain só.
  { tag: 'CRITICAL', input: 'mistura especiarias',
    expect: { confidence: 'medium', reasons: ['category_uncertain'] } },
  // Embalagem detectada sem qty + nome com categoria conhecida →
  // intent_uncertain só (não trigga product_name_lost_risk porque categoria
  // não é fraca).
  { tag: 'CRITICAL', input: 'arroz saco',
    expect: { confidence: 'medium', reasons: ['intent_uncertain'] } },
  { tag: 'CRITICAL', input: 'azeite garrafa',
    expect: { confidence: 'medium', reasons: ['intent_uncertain'] } },
  // Nome desconhecido isolado (sem container, sem descartável, sem qty) →
  // category_uncertain só.
  { tag: 'CRITICAL', input: 'xpto',
    expect: { confidence: 'medium', reasons: ['category_uncertain'] } },
  // Nomes de molho que NÃO estão em PRIORITY_KEYWORDS — categoria cai em
  // Mercearia confidente (palavra "molho" no INGREDIENT_KEYWORDS Mercearia).
  // Não há sinal → HIGH. Confirmação que molho holandês/barbecue ficam HIGH.
  { tag: 'REGRESSION', input: 'molho holandês',
    expect: { confidence: 'high', reasons: [] } },
  { tag: 'REGRESSION', input: 'molho barbecue',
    expect: { confidence: 'high', reasons: [] } },

  // ── PATCH 2026-04-27: confirmações pedidas pelo chef após auditoria ───────
  // Adicionados ANTES da implementação para capturar o estado actual.

  // P1: multipack-equivalente — label antes da qty + count "uni" entre os dois
  // "leite pack 6 uni 1lt" → o label "pack" não está adjacente ao "1lt"; o
  // token "6" + "uni" fica de permeio. findAdjacentPackagingLabel deve saltar
  // tokens uni/un/unidade quando procura embalagem.
  { tag: 'CRITICAL', input: 'Leite pack 6 uni 1lt',
    expect: { name: 'Leite', unit: 'mL', orderUnit: 'pack', conversionFactor: 6000,
              multipackCount: 6, multipackPerPack: 1000 } },

  // P2: count=1 NÃO é multipack. "Leite 1x6lt" não deve inventar "1 pacote
  // de 6L". MULTIPACK_RE deve rejeitar count <= 1. Comportamento esperado:
  // multipackCount=null e o sistema marca como volume simples ou ambíguo.
  { tag: 'CRITICAL', input: 'Leite 1x6lt',
    expect: { multipackCount: null, multipackPerPack: null } },

  // P3: "molho" sozinho com qty é demasiado genérico. Não deve sair HIGH —
  // chef ficaria sem saber qual molho é. name_too_generic é hard-low → LOW.
  // ("molho inglês" / "molho madeira" / "molho ostra" continuam HIGH por
  // terem 2 palavras → isTooGeneric retorna false.)
  { tag: 'CRITICAL', input: 'molho garrafa 1L',
    expect: { confidence: 'low', reasons: ['name_too_generic'] } },

  // P6 (KNOWN GAP — não corrigido neste patch):
  // "saco farinha 25kg" — pattern LABEL + NAME + QTY. classifyLine procura
  // label adjacente à qty ("farinha" antes de "25kg") e não encontra. O label
  // está antes do nome, não antes da qty.
  //
  // Fix seguro requer distinguir "saco farinha" (embalagem + ingrediente) de
  // "saco lixo 50L" / "saco vácuo" / "saco plástico" (nome legítimo que começa
  // por palavra-embalagem). Isto exige consulta ao INGREDIENT_KEYWORDS dentro
  // de classifyLine — acoplamento entre camadas que não cabe num patch pequeno.
  //
  // Workaround para o chef: escrever "farinha saco 25kg" (ordem natural) — caso
  // P7 abaixo confirma que funciona correctamente.
  //
  // Este teste fixa o comportamento ACTUAL para evitar regressão silenciosa
  // até que o gap seja resolvido em patch dedicado.
  { tag: 'REGRESSION', input: 'saco farinha 25kg',
    expect: { name: 'Saco Farinha', orderUnit: null, conversionFactor: null } },

  // P7: "farinha saco 25kg" — caso standard de label adjacente. Deve já
  // funcionar; teste de não-regressão.
  { tag: 'CRITICAL', input: 'farinha saco 25kg',
    expect: { name: 'Farinha', unit: 'g', orderUnit: 'saco', conversionFactor: 25000 } },
]

let pass = 0
let fail = 0
const failures: string[] = []

for (const c of CASES) {
  const d    = buildArticleDraft(c.input)
  const errs: string[] = []

  if (c.expect.name !== undefined && d.name !== c.expect.name) {
    errs.push(`name: esperado "${c.expect.name}" obteve "${d.name}"`)
  }
  if (c.expect.unit !== undefined && d.unit !== c.expect.unit) {
    errs.push(`unit: esperado "${c.expect.unit}" obteve "${d.unit}"`)
  }
  if (c.expect.category !== undefined && d.category !== c.expect.category) {
    errs.push(`category: esperado "${c.expect.category}" obteve "${d.category}"`)
  }
  if (c.expect.orderUnit !== undefined) {
    const got = d.supplierSeed?.order_unit ?? null
    if (got !== c.expect.orderUnit) errs.push(`orderUnit: esperado "${c.expect.orderUnit}" obteve "${got}"`)
  }
  if (c.expect.conversionFactor !== undefined) {
    const got = d.supplierSeed?.conversion_factor ?? null
    if (got !== c.expect.conversionFactor) errs.push(`conversionFactor: esperado ${c.expect.conversionFactor} obteve ${got}`)
  }
  if (c.expect.detectedQty !== undefined) {
    const got = d.detected_qty ?? null
    if (got !== c.expect.detectedQty) errs.push(`detected_qty: esperado ${c.expect.detectedQty} obteve ${got}`)
  }
  if (c.expect.multipackCount !== undefined) {
    const got = d.detected_multipack?.count ?? null
    if (got !== c.expect.multipackCount) errs.push(`multipackCount: esperado ${c.expect.multipackCount} obteve ${got}`)
  }
  if (c.expect.multipackPerPack !== undefined) {
    const got = d.detected_multipack?.perPack ?? null
    if (got !== c.expect.multipackPerPack) errs.push(`multipackPerPack: esperado ${c.expect.multipackPerPack} obteve ${got}`)
  }
  if (c.expect.hint !== undefined) {
    const got = formatDraftHint(d)
    if (got !== c.expect.hint) errs.push(`hint: esperado "${c.expect.hint}" obteve "${got}"`)
  }
  if (c.expect.intent !== undefined && d.intent.kind !== c.expect.intent) {
    errs.push(`intent.kind: esperado "${c.expect.intent}" obteve "${d.intent.kind}"`)
  }
  if (c.expect.intentOrderUnit !== undefined) {
    const got = 'orderUnit' in d.intent ? d.intent.orderUnit : null
    if (got !== c.expect.intentOrderUnit) {
      errs.push(`intent.orderUnit: esperado "${c.expect.intentOrderUnit}" obteve "${got}"`)
    }
  }
  if (c.expect.intentFactor !== undefined) {
    const got = d.intent.kind === 'PACKAGED_WEIGHT'   ? d.intent.basePerOrder
              : d.intent.kind === 'PACKAGED_VOLUME'   ? d.intent.basePerOrder
              : d.intent.kind === 'COUNTABLE_PACKAGED'? d.intent.perPack
              : null
    if (got !== c.expect.intentFactor) {
      errs.push(`intent.factor: esperado ${c.expect.intentFactor} obteve ${got}`)
    }
  }
  if (c.expect.confidence !== undefined && d.confidence !== c.expect.confidence) {
    errs.push(`confidence: esperado "${c.expect.confidence}" obteve "${d.confidence}" (reasons: [${d.confidenceReasons.join(', ')}])`)
  }
  if (c.expect.reasons !== undefined) {
    const got  = [...d.confidenceReasons].sort().join(',')
    const want = [...c.expect.reasons].sort().join(',')
    if (got !== want) errs.push(`reasons: esperado [${want}] obteve [${got}]`)
  }

  if (errs.length === 0) {
    pass++
    console.log(`  ✓  [${c.tag}] ${c.input}`)
  } else {
    fail++
    console.log(`  ✗  [${c.tag}] ${c.input}`)
    for (const e of errs) console.log(`        ${e}`)
    failures.push(c.input)
  }
}

// ── inferIntent: cobertura directa das 6 ramificações ───────────────────────
//
// Independente do parser de nome — testa a função pura. Cobre o que o
// dispatch do ArticleForm precisa de saber para escolher a unidade visual
// do par_level. Casos do parser acima cobrem o feliz caminho integrado;
// estes asseguram que cada ramo do switch é alcançável.

console.log('\n── inferIntent (puro) ──')
const INTENT_DIRECT_CASES: Array<{
  label:    string
  args:     Parameters<typeof inferIntent>[0]
  expected: ArticleIntent
}> = [
  { label: 'g sem seed', args: { unit: 'g' },
    expected: { kind: 'WEIGHT_LOOSE' } },
  { label: 'mL sem seed', args: { unit: 'mL' },
    expected: { kind: 'VOLUME' } },
  { label: 'un sem seed', args: { unit: 'un' },
    expected: { kind: 'COUNTABLE_UNIT' } },
  { label: 'g + caixa 10000', args: { unit: 'g', supplierSeed: { order_unit: 'caixa', conversion_factor: 10000, source: 'detected' } },
    expected: { kind: 'PACKAGED_WEIGHT', orderUnit: 'caixa', basePerOrder: 10000 } },
  { label: 'mL + caixa 1000', args: { unit: 'mL', supplierSeed: { order_unit: 'caixa', conversion_factor: 1000, source: 'detected' } },
    expected: { kind: 'PACKAGED_VOLUME', orderUnit: 'caixa', basePerOrder: 1000 } },
  { label: 'un + caixa 180', args: { unit: 'un', supplierSeed: { order_unit: 'caixa', conversion_factor: 180, source: 'detected' } },
    expected: { kind: 'COUNTABLE_PACKAGED', orderUnit: 'caixa', perPack: 180 } },
  // Edge cases: seed sem factor (R1 do design doc) → cair para *_LOOSE
  { label: 'g + order_unit sem factor → WEIGHT_LOOSE',
    args: { unit: 'g', supplierSeed: { order_unit: 'caixa', source: 'detected' } },
    expected: { kind: 'WEIGHT_LOOSE' } },
  { label: 'un + order_unit sem factor → COUNTABLE_UNIT',
    args: { unit: 'un', supplierSeed: { order_unit: 'caixa', source: 'detected' } },
    expected: { kind: 'COUNTABLE_UNIT' } },
  { label: 'g + factor=0 → WEIGHT_LOOSE (defensivo)',
    args: { unit: 'g', supplierSeed: { order_unit: 'caixa', conversion_factor: 0, source: 'detected' } },
    expected: { kind: 'WEIGHT_LOOSE' } },
]

for (const c of INTENT_DIRECT_CASES) {
  const got = inferIntent(c.args)
  const ok  = JSON.stringify(got) === JSON.stringify(c.expected)
  if (ok) {
    pass++
    console.log(`  ✓  [INTENT] ${c.label}`)
  } else {
    fail++
    console.log(`  ✗  [INTENT] ${c.label}`)
    console.log(`        esperado ${JSON.stringify(c.expected)}`)
    console.log(`        obteve   ${JSON.stringify(got)}`)
    failures.push(c.label)
  }
}

// ── getCountingMode: cobertura directa ────────────────────────────────────────
//
// Helper consumido pelo bloco "Formatos de uso" no ArticleForm/BulkImportPanel.
// Testa cada ramo do switch + precedência de article_sizes sobre intent.

console.log('\n── getCountingMode (puro) ──')
const COUNTING_MODE_DIRECT_CASES: Array<{
  label:    string
  args:     Parameters<typeof getCountingMode>[0]
  expected: CountingMode
}> = [
  { label: 'WEIGHT_LOOSE → kg/1000/needs',
    args: { intent: { kind: 'WEIGHT_LOOSE' } },
    expected: { count_unit: 'kg', base_per_unit: 1000, needs_supplier: true } },
  { label: 'VOLUME → L/1000/needs',
    args: { intent: { kind: 'VOLUME' } },
    expected: { count_unit: 'L', base_per_unit: 1000, needs_supplier: true } },
  { label: 'COUNTABLE_UNIT → un/1/needs',
    args: { intent: { kind: 'COUNTABLE_UNIT' } },
    expected: { count_unit: 'un', base_per_unit: 1, needs_supplier: true } },
  { label: 'PACKAGED_WEIGHT caixa 10kg',
    args: { intent: { kind: 'PACKAGED_WEIGHT', orderUnit: 'caixa', basePerOrder: 10000 } },
    expected: { count_unit: 'caixa', base_per_unit: 10000, needs_supplier: false } },
  { label: 'PACKAGED_VOLUME caixa 1L',
    args: { intent: { kind: 'PACKAGED_VOLUME', orderUnit: 'caixa', basePerOrder: 1000 } },
    expected: { count_unit: 'caixa', base_per_unit: 1000, needs_supplier: false } },
  { label: 'COUNTABLE_PACKAGED caixa 180un',
    args: { intent: { kind: 'COUNTABLE_PACKAGED', orderUnit: 'caixa', perPack: 180 } },
    expected: { count_unit: 'caixa', base_per_unit: 180, needs_supplier: false } },
  { label: 'article_sizes ganha sobre WEIGHT_LOOSE',
    args: { intent: { kind: 'WEIGHT_LOOSE' }, articleSizes: [{ label: 'saco', base_per_unit: 5000 }] },
    expected: { count_unit: 'saco', base_per_unit: 5000, needs_supplier: false } },
  { label: 'article_sizes vazio cai para intent',
    args: { intent: { kind: 'COUNTABLE_UNIT' }, articleSizes: [] },
    expected: { count_unit: 'un', base_per_unit: 1, needs_supplier: true } },
]

for (const c of COUNTING_MODE_DIRECT_CASES) {
  const got = getCountingMode(c.args)
  const ok  = JSON.stringify(got) === JSON.stringify(c.expected)
  if (ok) {
    pass++
    console.log(`  ✓  [COUNT] ${c.label}`)
  } else {
    fail++
    console.log(`  ✗  [COUNT] ${c.label}`)
    console.log(`        esperado ${JSON.stringify(c.expected)}`)
    console.log(`        obteve   ${JSON.stringify(got)}`)
    failures.push(c.label)
  }
}

// ── getCountingModeOptions: alternativas multipack ────────────────────────────
//
// Quando o input descreve um multipack PACKAGED_*, o helper deve devolver
// 2 opções (pack default, unidade individual). Casos sem multipack ou
// COUNTABLE_PACKAGED ficam com 1 só opção.

console.log('\n── getCountingModeOptions (puro) ──')
const COUNTING_OPTIONS_DIRECT_CASES: Array<{
  label:    string
  args:     Parameters<typeof getCountingModeOptions>[0]
  expected: CountingMode[]
}> = [
  { label: 'PACKAGED_VOLUME multipack 6×1L → 2 opções',
    args: { intent: { kind: 'PACKAGED_VOLUME', orderUnit: 'pack', basePerOrder: 6000,
                       multipack: { count: 6, perPack: 1000 } } },
    expected: [
      { count_unit: 'pack',    base_per_unit: 6000, needs_supplier: false },
      { count_unit: 'unidade', base_per_unit: 1000, needs_supplier: false },
    ] },
  { label: 'PACKAGED_WEIGHT multipack 4×200g → 2 opções',
    args: { intent: { kind: 'PACKAGED_WEIGHT', orderUnit: 'pack', basePerOrder: 800,
                       multipack: { count: 4, perPack: 200 } } },
    expected: [
      { count_unit: 'pack',    base_per_unit: 800, needs_supplier: false },
      { count_unit: 'unidade', base_per_unit: 200, needs_supplier: false },
    ] },
  { label: 'PACKAGED_VOLUME nested → innerLabel substitui "unidade"',
    args: { intent: { kind: 'PACKAGED_VOLUME', orderUnit: 'caixa', basePerOrder: 6000,
                       multipack: { count: 6, perPack: 1000, innerLabel: 'pacote' } } },
    expected: [
      { count_unit: 'caixa',  base_per_unit: 6000, needs_supplier: false },
      { count_unit: 'pacote', base_per_unit: 1000, needs_supplier: false },
    ] },
  { label: 'PACKAGED_VOLUME sem multipack → 1 opção',
    args: { intent: { kind: 'PACKAGED_VOLUME', orderUnit: 'caixa', basePerOrder: 10000 } },
    expected: [{ count_unit: 'caixa', base_per_unit: 10000, needs_supplier: false }] },
  { label: 'PACKAGED_WEIGHT sem multipack → 1 opção',
    args: { intent: { kind: 'PACKAGED_WEIGHT', orderUnit: 'caixa', basePerOrder: 10000 } },
    expected: [{ count_unit: 'caixa', base_per_unit: 10000, needs_supplier: false }] },
  { label: 'COUNTABLE_PACKAGED nunca tem alternativa (regra "ovos caixa 180")',
    args: { intent: { kind: 'COUNTABLE_PACKAGED', orderUnit: 'caixa', perPack: 180 } },
    expected: [{ count_unit: 'caixa', base_per_unit: 180, needs_supplier: false }] },
  { label: 'WEIGHT_LOOSE → 1 opção',
    args: { intent: { kind: 'WEIGHT_LOOSE' } },
    expected: [{ count_unit: 'kg', base_per_unit: 1000, needs_supplier: true }] },
  { label: 'article_sizes vence sobre multipack',
    args: {
      intent: { kind: 'PACKAGED_VOLUME', orderUnit: 'pack', basePerOrder: 6000,
                 multipack: { count: 6, perPack: 1000 } },
      articleSizes: [{ label: 'saco', base_per_unit: 5000 }],
    },
    expected: [{ count_unit: 'saco', base_per_unit: 5000, needs_supplier: false }] },
  { label: 'múltiplos article_sizes → uma chip por size',
    args: {
      intent: { kind: 'WEIGHT_LOOSE' },
      articleSizes: [
        { label: 'saco',  base_per_unit: 25000 },
        { label: 'caixa', base_per_unit: 10000 },
      ],
    },
    expected: [
      { count_unit: 'saco',  base_per_unit: 25000, needs_supplier: false },
      { count_unit: 'caixa', base_per_unit: 10000, needs_supplier: false },
    ] },
]

for (const c of COUNTING_OPTIONS_DIRECT_CASES) {
  const got = getCountingModeOptions(c.args)
  const ok  = JSON.stringify(got) === JSON.stringify(c.expected)
  if (ok) {
    pass++
    console.log(`  ✓  [OPTS] ${c.label}`)
  } else {
    fail++
    console.log(`  ✗  [OPTS] ${c.label}`)
    console.log(`        esperado ${JSON.stringify(c.expected)}`)
    console.log(`        obteve   ${JSON.stringify(got)}`)
    failures.push(c.label)
  }
}

// ── inferIntent: propagação do multipack à intent ─────────────────────────────
//
// inferIntent passa multipack só quando count > 1 e perPack > 0; só para
// PACKAGED_WEIGHT/PACKAGED_VOLUME (COUNTABLE_PACKAGED é deliberadamente excluído).

console.log('\n── inferIntent (multipack) ──')
const INTENT_MULTIPACK_CASES: Array<{
  label:    string
  args:     Parameters<typeof inferIntent>[0]
  expected: ArticleIntent
}> = [
  { label: 'mL + caixa 6000 + multipack 6×1000',
    args: { unit: 'mL',
            supplierSeed: { order_unit: 'caixa', conversion_factor: 6000, source: 'detected' },
            multipack: { count: 6, perPack: 1000 } },
    expected: { kind: 'PACKAGED_VOLUME', orderUnit: 'caixa', basePerOrder: 6000,
                multipack: { count: 6, perPack: 1000 } } },
  { label: 'g + pack 800 + multipack 4×200',
    args: { unit: 'g',
            supplierSeed: { order_unit: 'pack', conversion_factor: 800, source: 'detected' },
            multipack: { count: 4, perPack: 200 } },
    expected: { kind: 'PACKAGED_WEIGHT', orderUnit: 'pack', basePerOrder: 800,
                multipack: { count: 4, perPack: 200 } } },
  { label: 'count=1 não conta como multipack',
    args: { unit: 'mL',
            supplierSeed: { order_unit: 'caixa', conversion_factor: 1000, source: 'detected' },
            multipack: { count: 1, perPack: 1000 } },
    expected: { kind: 'PACKAGED_VOLUME', orderUnit: 'caixa', basePerOrder: 1000 } },
  { label: 'COUNTABLE_PACKAGED não recebe multipack (excluído por design)',
    args: { unit: 'un',
            supplierSeed: { order_unit: 'caixa', conversion_factor: 180, source: 'detected' },
            multipack: { count: 6, perPack: 30 } },
    expected: { kind: 'COUNTABLE_PACKAGED', orderUnit: 'caixa', perPack: 180 } },
]

for (const c of INTENT_MULTIPACK_CASES) {
  const got = inferIntent(c.args)
  const ok  = JSON.stringify(got) === JSON.stringify(c.expected)
  if (ok) {
    pass++
    console.log(`  ✓  [INTENT-MP] ${c.label}`)
  } else {
    fail++
    console.log(`  ✗  [INTENT-MP] ${c.label}`)
    console.log(`        esperado ${JSON.stringify(c.expected)}`)
    console.log(`        obteve   ${JSON.stringify(got)}`)
    failures.push(c.label)
  }
}

// ── parseProductLines: propagação de detected_multipack à ParsedLine ──────────
//
// O hint visual no Bulk Import (`SeedHint`) lê line.detected_multipack do
// ParsedLine, não do ArticleDraft. Sem esta propagação, "leite cx 6x1L" cai
// para o formato simplificado "caixa · 6 L" em vez de "caixa · 6 x 1 L".

console.log('\n── parseProductLines (multipack propagation) ──')
const PL_CASES: Array<{ input: string; count: number; perPack: number }> = [
  { input: 'leite sem lactose cx 6x1L', count: 6,  perPack: 1000 },
  { input: 'natas cx 12x200ml',          count: 12, perPack: 200  },
  { input: 'cerveja cx 24x33cl',         count: 24, perPack: 330  },
]

for (const c of PL_CASES) {
  const lines = parseProductLines(c.input, [])
  const errs: string[] = []
  if (lines.length !== 1) {
    errs.push(`esperado 1 linha, obteve ${lines.length}`)
  } else {
    const mp = lines[0].detected_multipack
    if (!mp) errs.push('detected_multipack ausente em ParsedLine')
    else {
      if (mp.count   !== c.count)   errs.push(`count: esperado ${c.count} obteve ${mp.count}`)
      if (mp.perPack !== c.perPack) errs.push(`perPack: esperado ${c.perPack} obteve ${mp.perPack}`)
    }
  }
  if (errs.length === 0) {
    pass++
    console.log(`  ✓  [PARSED-LINE] ${c.input}`)
  } else {
    fail++
    console.log(`  ✗  [PARSED-LINE] ${c.input}`)
    for (const e of errs) console.log(`        ${e}`)
    failures.push(c.input)
  }
}

// ── parseProductLines (base fallback dedup) ────────────────────────────────
//
// Quando o parser canonicaliza "X em <container>" e a DB só tem o nome base
// "X", a 2ª passagem da dedup procura sem o sufixo. Match → variante do base
// em vez de novo artigo, com size derivada de detected_label/qty.
//
// CONTAINER_KEEP_IN_NAME (lata/conserva) é o único set elegível — outros
// containers (frasco, saco, garrafa…) nunca aparecem no canónico do nome,
// já são order_unit puro.

console.log('\n── parseProductLines (base fallback dedup) ──')

type DedupCase = {
  label:    string
  input:    string
  existing: { id: string; name: string }[]
  expect:   {
    isDuplicate:         boolean
    isBaseFallback:      boolean
    existingArticleId?:  string
    existingArticleName?: string
  }
}

const DEDUP_CASES: DedupCase[] = [
  // ── Base fallback hits (P1 do patch) ──
  { label: 'lata após produto + só base na DB',
    input: 'tomate pelado lata 2.5kg',
    existing: [{ id: 'TP', name: 'Tomate Pelado' }],
    expect: { isDuplicate: true, isBaseFallback: true, existingArticleId: 'TP', existingArticleName: 'Tomate Pelado' } },
  { label: 'lata antes produto + só base na DB',
    input: 'lata 2.5kg tomate pelado',
    existing: [{ id: 'TP', name: 'Tomate Pelado' }],
    expect: { isDuplicate: true, isBaseFallback: true, existingArticleId: 'TP', existingArticleName: 'Tomate Pelado' } },
  { label: 'em lata explícito + só base',
    input: 'tomate pelado em lata 2.5kg',
    existing: [{ id: 'TP', name: 'Tomate Pelado' }],
    expect: { isDuplicate: true, isBaseFallback: true, existingArticleId: 'TP', existingArticleName: 'Tomate Pelado' } },
  { label: 'enlatado canonicaliza para lata',
    input: 'atum enlatado 1kg',
    existing: [{ id: 'A', name: 'Atum' }],
    expect: { isDuplicate: true, isBaseFallback: true, existingArticleId: 'A', existingArticleName: 'Atum' } },
  { label: 'conserva sufixo',
    input: 'pimentos em conserva 1kg',
    existing: [{ id: 'P', name: 'Pimentos' }],
    expect: { isDuplicate: true, isBaseFallback: true, existingArticleId: 'P', existingArticleName: 'Pimentos' } },

  // ── Exato vence base fallback ──
  { label: 'ambos na DB → exato wins',
    input: 'tomate pelado lata 2.5kg',
    existing: [
      { id: 'TP',  name: 'Tomate Pelado' },
      { id: 'TPL', name: 'Tomate Pelado em Lata' },
    ],
    expect: { isDuplicate: true, isBaseFallback: false, existingArticleId: 'TPL', existingArticleName: 'Tomate Pelado em Lata' } },

  // ── Não-regressões ──
  { label: 'exato sem container (já testado em fluxo anterior)',
    input: 'tomate pelado 2.5kg',
    existing: [{ id: 'TP', name: 'Tomate Pelado' }],
    expect: { isDuplicate: true, isBaseFallback: false, existingArticleId: 'TP', existingArticleName: 'Tomate Pelado' } },
  { label: 'sem container word + sem match → NOVO',
    input: 'frango 10kg',
    existing: [{ id: 'TP', name: 'Tomate Pelado' }],
    expect: { isDuplicate: false, isBaseFallback: false, existingArticleId: undefined, existingArticleName: undefined } },
  { label: 'container word mas DB vazia → NOVO',
    input: 'tomate pelado lata 2.5kg',
    existing: [],
    expect: { isDuplicate: false, isBaseFallback: false, existingArticleId: undefined, existingArticleName: undefined } },
  { label: 'frasco NÃO faz fallback (não está em CONTAINER_KEEP)',
    input: 'mel frasco 1kg',
    existing: [{ id: 'M', name: 'Mel' }],
    expect: { isDuplicate: true, isBaseFallback: false, existingArticleId: 'M', existingArticleName: 'Mel' } },
]

for (const c of DEDUP_CASES) {
  const lines = parseProductLines(c.input, c.existing)
  const errs: string[] = []
  if (lines.length !== 1) {
    errs.push(`esperado 1 linha, obteve ${lines.length}`)
  } else {
    const l = lines[0] as typeof lines[0] & { isBaseFallback?: boolean; existingArticleName?: string }
    if (l.isDuplicate !== c.expect.isDuplicate) {
      errs.push(`isDuplicate: esperado ${c.expect.isDuplicate} obteve ${l.isDuplicate}`)
    }
    if (Boolean(l.isBaseFallback) !== c.expect.isBaseFallback) {
      errs.push(`isBaseFallback: esperado ${c.expect.isBaseFallback} obteve ${Boolean(l.isBaseFallback)}`)
    }
    if (l.existingArticleId !== c.expect.existingArticleId) {
      errs.push(`existingArticleId: esperado ${c.expect.existingArticleId ?? 'undef'} obteve ${l.existingArticleId ?? 'undef'}`)
    }
    if ((l.existingArticleName ?? undefined) !== c.expect.existingArticleName) {
      errs.push(`existingArticleName: esperado ${c.expect.existingArticleName ?? 'undef'} obteve ${l.existingArticleName ?? 'undef'}`)
    }
  }
  if (errs.length === 0) {
    pass++
    console.log(`  ✓  [DEDUP-FB] ${c.label}`)
  } else {
    fail++
    console.log(`  ✗  [DEDUP-FB] ${c.label}`)
    for (const e of errs) console.log(`        ${e}`)
    failures.push(c.label)
  }
}

// ── parsePackagingQuantity (linguagem de cozinha → base_unit) ────────────────
//
// Cobre o spec do campo "Cada embalagem traz" do bloco de fornecedor:
//   chef escreve "10kg" → guarda 10000 (em base_unit g)
//   chef escreve "5L"   → guarda 5000  (em base_unit mL)
//   chef escreve "180"  → guarda 180   (em base_unit un)
//
// Casos OK + casos INCOMPATIBLE_UNIT (família errada) + INVALID (lixo).

console.log('\n── parsePackagingQuantity ──')

type PkgCase = {
  input: string
  unit:  ArticleBaseUnit
  expected:
    | { ok: true;  value: number }
    | { ok: false; reason: 'INCOMPATIBLE_UNIT' | 'INVALID' }
}

const PKG_CASES: PkgCase[] = [
  // ── unit=g: peso em todas as formas ──────────────────────────────────
  { input: '10kg',       unit: 'g', expected: { ok: true, value: 10000 } },
  { input: '10 kg',      unit: 'g', expected: { ok: true, value: 10000 } },
  { input: '10000g',     unit: 'g', expected: { ok: true, value: 10000 } },
  { input: '10000gr',    unit: 'g', expected: { ok: true, value: 10000 } },
  { input: '10000 g',    unit: 'g', expected: { ok: true, value: 10000 } },
  { input: '2,5kg',      unit: 'g', expected: { ok: true, value: 2500 } },
  { input: '2.5kg',      unit: 'g', expected: { ok: true, value: 2500 } },
  { input: '3k',         unit: 'g', expected: { ok: true, value: 3000 } },
  { input: '3kg',        unit: 'g', expected: { ok: true, value: 3000 } },
  { input: '500g',       unit: 'g', expected: { ok: true, value: 500 } },
  { input: '500',        unit: 'g', expected: { ok: true, value: 500 } },
  { input: '500 gramas', unit: 'g', expected: { ok: true, value: 500 } },

  // ── unit=mL: volume em todas as formas ───────────────────────────────
  { input: '5L',     unit: 'mL', expected: { ok: true, value: 5000 } },
  { input: '5 l',    unit: 'mL', expected: { ok: true, value: 5000 } },
  { input: '5000ml', unit: 'mL', expected: { ok: true, value: 5000 } },
  { input: '2,5L',   unit: 'mL', expected: { ok: true, value: 2500 } },
  { input: '2.5L',   unit: 'mL', expected: { ok: true, value: 2500 } },
  { input: '750ml',  unit: 'mL', expected: { ok: true, value: 750 } },
  { input: '33cl',   unit: 'mL', expected: { ok: true, value: 330 } },
  { input: '5dl',    unit: 'mL', expected: { ok: true, value: 500 } },
  { input: '750',    unit: 'mL', expected: { ok: true, value: 750 } },

  // ── unit=un: contagem ────────────────────────────────────────────────
  { input: '6un',         unit: 'un', expected: { ok: true, value: 6 } },
  { input: '6 un',        unit: 'un', expected: { ok: true, value: 6 } },
  { input: '12uni',       unit: 'un', expected: { ok: true, value: 12 } },
  { input: '180 unidades',unit: 'un', expected: { ok: true, value: 180 } },
  { input: '180',         unit: 'un', expected: { ok: true, value: 180 } },

  // ── INCOMPATIBLE_UNIT: família errada ────────────────────────────────
  { input: '5L',   unit: 'g',  expected: { ok: false, reason: 'INCOMPATIBLE_UNIT' } },
  { input: '10kg', unit: 'mL', expected: { ok: false, reason: 'INCOMPATIBLE_UNIT' } },
  { input: '10kg', unit: 'un', expected: { ok: false, reason: 'INCOMPATIBLE_UNIT' } },
  { input: '5L',   unit: 'un', expected: { ok: false, reason: 'INCOMPATIBLE_UNIT' } },
  { input: '6un',  unit: 'g',  expected: { ok: false, reason: 'INCOMPATIBLE_UNIT' } },
  { input: '6un',  unit: 'mL', expected: { ok: false, reason: 'INCOMPATIBLE_UNIT' } },

  // ── INVALID: lixo, vazio, zero, formato impossível ───────────────────
  { input: '',        unit: 'g',  expected: { ok: false, reason: 'INVALID' } },
  { input: '',        unit: 'mL', expected: { ok: false, reason: 'INVALID' } },
  { input: '',        unit: 'un', expected: { ok: false, reason: 'INVALID' } },
  { input: 'abc',     unit: 'g',  expected: { ok: false, reason: 'INVALID' } },
  { input: '0kg',     unit: 'g',  expected: { ok: false, reason: 'INVALID' } },
  { input: '-10kg',   unit: 'g',  expected: { ok: false, reason: 'INVALID' } },
  { input: '10kg2',   unit: 'g',  expected: { ok: false, reason: 'INVALID' } },
  { input: '5.5.5kg', unit: 'g',  expected: { ok: false, reason: 'INVALID' } },
  { input: '10xyz',   unit: 'g',  expected: { ok: false, reason: 'INVALID' } },
]

for (const c of PKG_CASES) {
  const result = parsePackagingQuantity(c.input, c.unit)
  const okMatch =
    result.ok === c.expected.ok &&
    (result.ok && c.expected.ok
      ? result.value === c.expected.value
      : !result.ok && !c.expected.ok
        ? result.reason === c.expected.reason
        : false)
  if (okMatch) {
    pass++
    const expr = c.expected.ok
      ? String(c.expected.value)
      : c.expected.reason
    console.log(`  ✓  [PKG] ${JSON.stringify(c.input)} (${c.unit}) → ${expr}`)
  } else {
    fail++
    const got = result.ok ? String(result.value) : result.reason
    const want = c.expected.ok ? String(c.expected.value) : c.expected.reason
    console.log(`  ✗  [PKG] ${JSON.stringify(c.input)} (${c.unit})`)
    console.log(`        esperado ${want}, obteve ${got}`)
    failures.push(`PKG ${c.input} (${c.unit})`)
  }
}

// ── getSuggestedUnitWeight (peso médio por unidade) ──────────────────────────
//
// Cobre matching seguro: exact match contra chave normalizada (lowercase +
// accent-strip), token fallback apenas para whitelist explícita. Casos
// críticos: "Lima" não bate em "Limão", "Batata Doce" → null (token 'batata'
// fora da whitelist), "Ovo de Codorniz" → null (token 'ovo' fora).

console.log('\n── getSuggestedUnitWeight ──')

const SUG_CASES: Array<{ name: string; expected: number | null }> = [
  // Exact match — base
  { name: 'Maçã',             expected: 180 },
  { name: 'Lima',             expected: 70  },
  { name: 'Limão',            expected: 100 },
  { name: 'Cebola Roxa',      expected: 180 },
  { name: 'Batata',           expected: 200 },
  { name: 'Tomate',           expected: 150 },
  { name: 'Ovo',              expected: 52  },
  { name: 'Alface Iceberg',   expected: 500 },
  { name: 'Alface Romana',    expected: 350 },
  // Token fallback (whitelist)
  { name: 'Limão Siciliano',  expected: 100 },
  { name: 'Cebola Doce',      expected: 180 },
  // Token fallback bloqueado (não whitelist)
  { name: 'Tomate Cherry',    expected: null },
  { name: 'Ovo de Codorniz',  expected: null },
  { name: 'Alface',           expected: null },
  // Sem qualquer match
  { name: '',                 expected: null },

  // ── Base expandida ────────────────────────────────────────────────────
  // Maçã (variedades)
  { name: 'Maçã Royal Gala',  expected: 170 },
  { name: 'Maçã Reineta',     expected: 220 },
  // Pêra (com e sem acento; rocha + base)
  { name: 'Pêra',             expected: 160 },
  { name: 'Pêra Rocha',       expected: 140 },
  { name: 'Pera Rocha',       expected: 140 },
  { name: 'Pera',             expected: 160 },  // antes era null; agora exact
  // Cogumelos (exact + null seguro)
  { name: 'Cogumelo Portobello', expected: 80 },
  { name: 'Cogumelo Laminado',   expected: null },
  // Batata (variedades + doce passa a 300; palha → null)
  { name: 'Batata Agria',     expected: 220 },
  { name: 'Batata Doce',      expected: 300 },  // antes era null; agora exact
  { name: 'Batata Palha',     expected: null },
  // Pimentos (variedades, padrón com singular e plural)
  { name: 'Pimento Vermelho', expected: 180 },
  { name: 'Pimento Padrón',   expected: 12 },
  { name: 'Pimentos Padrón',  expected: 12 },   // de-pluralize → "pimento padron"
  { name: 'Malagueta',        expected: 8  },
]

for (const c of SUG_CASES) {
  const got = getSuggestedUnitWeight(c.name)
  if (got === c.expected) {
    pass++
    console.log(`  ✓  [SUG] ${JSON.stringify(c.name)} → ${got}`)
  } else {
    fail++
    console.log(`  ✗  [SUG] ${JSON.stringify(c.name)}`)
    console.log(`        esperado ${c.expected}, obteve ${got}`)
    failures.push(`SUG ${c.name}`)
  }
}

// ── assessConfidence: cobertura directa de cada reason ──────────────────────
//
// Independente do parser — passa argumentos sintéticos e verifica que cada
// reason dispara/não-dispara como esperado, e que a regra de agregação
// (NÃO worst-of-three) está correta.

console.log('\n── assessConfidence (puro) ──')

type AssessExpected = { confidence: ConfidenceLevel; reasons: ConfidenceReason[] }
type AssessCase = {
  label:    string
  args:     Parameters<typeof assessConfidence>[0]
  expected: AssessExpected
}

const ASSESS_DIRECT_CASES: AssessCase[] = [
  // 0 sinais → HIGH
  { label: 'nome limpo + intent packaged + categoria confiante → HIGH',
    args: { rawInput: 'frango caixa 10kg', finalName: 'Frango', category: 'Carnes',
            categoryConfident: true,
            intent: { kind: 'PACKAGED_WEIGHT', orderUnit: 'caixa', basePerOrder: 10000 },
            trace: { strippedPackagingNoQty: false }, detectedLabel: 'caixa', detectedQty: 10000 },
    expected: { confidence: 'high', reasons: [] } },

  // 1 sinal não-hard → MEDIUM
  { label: 'category null sozinho → MEDIUM',
    args: { rawInput: 'xpto', finalName: 'Xpto', category: null,
            categoryConfident: false,
            intent: { kind: 'WEIGHT_LOOSE' },
            trace: { strippedPackagingNoQty: false } },
    expected: { confidence: 'medium', reasons: ['category_uncertain'] } },

  { label: 'detectedLabel sem factor (intent loose) → MEDIUM',
    args: { rawInput: 'arroz saco', finalName: 'Arroz', category: 'Mercearia',
            categoryConfident: true,
            intent: { kind: 'WEIGHT_LOOSE' },
            trace: { strippedPackagingNoQty: false }, detectedLabel: 'saco' },
    expected: { confidence: 'medium', reasons: ['intent_uncertain'] } },

  // 1 sinal hard → LOW
  { label: 'name_is_code sozinho → LOW',
    args: { rawInput: 'COD123', finalName: 'Cod123', category: 'Mercearia',
            categoryConfident: true, // simulado: isolar só o sinal de código
            intent: { kind: 'WEIGHT_LOOSE' },
            trace: { strippedPackagingNoQty: false } },
    expected: { confidence: 'low', reasons: ['name_is_code'] } },

  { label: 'name_too_generic sozinho → LOW',
    args: { rawInput: 'caixa', finalName: 'Caixa', category: 'Embalagens e Descartáveis',
            categoryConfident: true,
            intent: { kind: 'WEIGHT_LOOSE' },
            trace: { strippedPackagingNoQty: false } },
    expected: { confidence: 'low', reasons: ['name_too_generic'] } },

  { label: 'possible_disposable sozinho → LOW',
    args: { rawInput: 'kraft', finalName: 'Kraft', category: 'Embalagens e Descartáveis',
            categoryConfident: true,
            intent: { kind: 'WEIGHT_LOOSE' },
            trace: { strippedPackagingNoQty: false } },
    expected: { confidence: 'low', reasons: ['possible_disposable'] } },

  { label: 'product_name_lost_risk + category null → LOW (3 sinais)',
    args: { rawInput: 'caixa pizza', finalName: 'Pizza', category: null,
            categoryConfident: false,
            intent: { kind: 'WEIGHT_LOOSE' },
            trace: { strippedPackagingNoQty: true } },
    expected: { confidence: 'low',
                reasons: ['product_name_lost_risk', 'category_uncertain', 'intent_uncertain'] } },

  // 2+ sinais não-hard → LOW
  { label: 'category_uncertain + intent_uncertain → LOW (regra 2+ sinais)',
    args: { rawInput: 'bla saco', finalName: 'Bla', category: null,
            categoryConfident: false,
            intent: { kind: 'WEIGHT_LOOSE' },
            trace: { strippedPackagingNoQty: false }, detectedLabel: 'saco' },
    expected: { confidence: 'low', reasons: ['category_uncertain', 'intent_uncertain'] } },

  // Composto papel — só conta nos compostos aprovados
  { label: 'papel sozinho NÃO dispara possible_disposable',
    args: { rawInput: 'mel papel', finalName: 'Mel Papel', category: 'Mercearia',
            categoryConfident: true,
            intent: { kind: 'WEIGHT_LOOSE' },
            trace: { strippedPackagingNoQty: false } },
    expected: { confidence: 'high', reasons: [] } },

  { label: 'papel mãos DISPARA possible_disposable',
    args: { rawInput: 'papel mãos rolo', finalName: 'Papel Mãos Rolo', category: null,
            categoryConfident: false,
            intent: { kind: 'WEIGHT_LOOSE' },
            trace: { strippedPackagingNoQty: false } },
    expected: { confidence: 'low', reasons: ['possible_disposable', 'category_uncertain'] } },

  // product_name_lost_risk NÃO dispara quando categoria é forte; mas
  // strippedPackagingNoQty + intent loose → intent_uncertain (1 sinal não-hard
  // → MEDIUM). "frango caixa" sem peso é razoavelmente medium: chef indicou
  // packaging mas não tamanho.
  { label: 'frango caixa: strippedPackagingNoQty + categoria forte → MEDIUM (intent_uncertain só)',
    args: { rawInput: 'frango caixa', finalName: 'Frango', category: 'Carnes',
            categoryConfident: true,
            intent: { kind: 'WEIGHT_LOOSE' },
            trace: { strippedPackagingNoQty: true } },
    expected: { confidence: 'medium', reasons: ['intent_uncertain'] } },
]

for (const c of ASSESS_DIRECT_CASES) {
  const got = assessConfidence(c.args)
  const gotReasons  = [...got.reasons].sort().join(',')
  const wantReasons = [...c.expected.reasons].sort().join(',')
  const ok = got.confidence === c.expected.confidence && gotReasons === wantReasons
  if (ok) {
    pass++
    console.log(`  ✓  [CONF] ${c.label}`)
  } else {
    fail++
    console.log(`  ✗  [CONF] ${c.label}`)
    console.log(`        esperado ${c.expected.confidence} [${wantReasons}]`)
    console.log(`        obteve   ${got.confidence} [${gotReasons}]`)
    failures.push(c.label)
  }
}

// ── normalizedKey: produtos com adjetivo distintivo são artigos diferentes ──
//
// Invariant de produto: "congelado"/"fresco" no nome distinguem dois artigos
// reais. Se a normalização colapsasse o adjetivo, a dedup tratava-os como o
// mesmo artigo e a cozinha perdia a distinção operacional. Os testes principais
// já cobrem `name` distinto; este bloco fixa explicitamente que `normalizedKey`
// também difere — qualquer refactor a `normalizeName`/`normalizeKey` que junte
// adjetivos falha aqui antes de chegar à UI.

console.log('\n── normalizedKey (dedup com adjetivo) ──')

const DEDUP_PAIRS: Array<{ label: string; a: string; b: string }> = [
  { label: 'Perna de Frango Congelada ≠ Perna de Frango Fresca',
    a: 'perna de frango congelada caixa 10kg',
    b: 'perna de frango fresca caixa 5kg' },
  { label: 'Salmão Congelado ≠ Salmão Fresco',
    a: 'salmão congelado 1kg',
    b: 'salmão fresco 1kg' },
]

for (const c of DEDUP_PAIRS) {
  const da = buildArticleDraft(c.a)
  const db = buildArticleDraft(c.b)
  if (da.normalizedKey !== db.normalizedKey) {
    pass++
    console.log(`  ✓  [DEDUP] ${c.label}`)
    console.log(`        a="${da.name}" key="${da.normalizedKey}"`)
    console.log(`        b="${db.name}" key="${db.normalizedKey}"`)
  } else {
    fail++
    console.log(`  ✗  [DEDUP] ${c.label}`)
    console.log(`        ambos colapsaram em key="${da.normalizedKey}"`)
    console.log(`        a.name="${da.name}" b.name="${db.name}"`)
    failures.push(c.label)
  }
}

// ── resolveArticleInputAction ──────────────────────────────────────────────
//
// Função única partilhada entre ArticleForm (manual) e BulkImportPanel.
// Cobre os 3 ramos: create_article (sem match), add_size (match + qty útil),
// duplicate_only (match sem qty útil). Foco nos casos do bug original e
// regra de produto declarada pelo chef.

console.log('\n── resolveArticleInputAction (puro) ──')

type ResolveCase = {
  label:    string
  input:    string
  existing: { id: string; name: string }[]
  expect: {
    kind:                 'create_article' | 'add_size' | 'duplicate_only'
    existingArticleId?:   string
    existingArticleName?: string
    isBaseFallback?:      boolean
    sizeLabel?:           string
    basePerUnit?:         number
  }
}

const RESOLVE_CASES: ResolveCase[] = [
  // ── A) create_article ──
  { label: 'sem match → create_article',
    input: 'frango fresco', existing: [{ id: 'TP', name: 'Tomate Pelado' }],
    expect: { kind: 'create_article' } },
  { label: 'sem nome → create_article (defensivo)',
    input: '   ', existing: [],
    expect: { kind: 'create_article' } },

  // ── B) add_size — caso do bug reportado ──
  { label: 'Açúcar Branco 25kg → add_size 25 kg',
    input: 'Açúcar Branco 25kg', existing: [{ id: 'AB', name: 'Açúcar Branco' }],
    expect: { kind: 'add_size', existingArticleId: 'AB', existingArticleName: 'Açúcar Branco', isBaseFallback: false, sizeLabel: '25 kg', basePerUnit: 25000 } },

  // ── B) add_size — outros obrigatórios ──
  { label: 'Tomate Pelado 2.5kg → add_size 2,5 kg',
    input: 'Tomate Pelado 2.5kg', existing: [{ id: 'TP', name: 'Tomate Pelado' }],
    expect: { kind: 'add_size', existingArticleId: 'TP', existingArticleName: 'Tomate Pelado', isBaseFallback: false, sizeLabel: '2,5 kg', basePerUnit: 2500 } },
  { label: 'Tomate Pelado lata 2.5kg + só base → add_size lata 2,5 kg (base fallback)',
    input: 'Tomate Pelado lata 2.5kg', existing: [{ id: 'TP', name: 'Tomate Pelado' }],
    expect: { kind: 'add_size', existingArticleId: 'TP', existingArticleName: 'Tomate Pelado', isBaseFallback: true, sizeLabel: 'lata 2,5 kg', basePerUnit: 2500 } },
  { label: 'Leite 1L → add_size 1 L',
    input: 'Leite 1L', existing: [{ id: 'L', name: 'Leite' }],
    expect: { kind: 'add_size', existingArticleId: 'L', existingArticleName: 'Leite', isBaseFallback: false, sizeLabel: '1 L', basePerUnit: 1000 } },
  { label: 'Ovos caixa 180 uni → add_size caixa 180 un',
    input: 'Ovos caixa 180 uni', existing: [{ id: 'O', name: 'Ovos' }],
    expect: { kind: 'add_size', existingArticleId: 'O', existingArticleName: 'Ovos', isBaseFallback: false, sizeLabel: 'caixa 180 un', basePerUnit: 180 } },
  { label: 'Arroz Carolino saco 20kg → add_size saco 20 kg',
    input: 'Arroz Carolino saco 20kg', existing: [{ id: 'AC', name: 'Arroz Carolino' }],
    expect: { kind: 'add_size', existingArticleId: 'AC', existingArticleName: 'Arroz Carolino', isBaseFallback: false, sizeLabel: 'saco 20 kg', basePerUnit: 20000 } },
  { label: 'Frango 10kg + Frango → add_size 10 kg (default kg label aceite)',
    input: 'Frango 10kg', existing: [{ id: 'F', name: 'Frango' }],
    expect: { kind: 'add_size', existingArticleId: 'F', existingArticleName: 'Frango', isBaseFallback: false, sizeLabel: '10 kg', basePerUnit: 10000 } },

  // ── B) add_size — exato vence base fallback ──
  { label: 'Tomate Pelado lata 2.5kg + ambos → exato wins (TPL)',
    input: 'Tomate Pelado lata 2.5kg',
    existing: [
      { id: 'TP',  name: 'Tomate Pelado' },
      { id: 'TPL', name: 'Tomate Pelado em Lata' },
    ],
    expect: { kind: 'add_size', existingArticleId: 'TPL', existingArticleName: 'Tomate Pelado em Lata', isBaseFallback: false, sizeLabel: 'lata 2,5 kg', basePerUnit: 2500 } },

  // ── C) duplicate_only — match sem qty útil ──
  { label: 'Açúcar Branco (sem qty) → duplicate_only',
    input: 'Açúcar Branco', existing: [{ id: 'AB', name: 'Açúcar Branco' }],
    expect: { kind: 'duplicate_only', existingArticleId: 'AB', existingArticleName: 'Açúcar Branco', isBaseFallback: false } },
  { label: 'Tomate Pelado (sem qty) → duplicate_only',
    input: 'Tomate Pelado', existing: [{ id: 'TP', name: 'Tomate Pelado' }],
    expect: { kind: 'duplicate_only', existingArticleId: 'TP', existingArticleName: 'Tomate Pelado', isBaseFallback: false } },
]

for (const c of RESOLVE_CASES) {
  const action = resolveArticleInputAction({ input: c.input, existingArticles: c.existing })
  const errs: string[] = []

  if (action.kind !== c.expect.kind) {
    errs.push(`kind: esperado "${c.expect.kind}" obteve "${action.kind}"`)
  }
  if (c.expect.existingArticleId !== undefined && action.kind !== 'create_article') {
    if (action.existingArticleId !== c.expect.existingArticleId) {
      errs.push(`existingArticleId: esperado "${c.expect.existingArticleId}" obteve "${action.existingArticleId}"`)
    }
  }
  if (c.expect.existingArticleName !== undefined && action.kind !== 'create_article') {
    if (action.existingArticleName !== c.expect.existingArticleName) {
      errs.push(`existingArticleName: esperado "${c.expect.existingArticleName}" obteve "${action.existingArticleName}"`)
    }
  }
  if (c.expect.isBaseFallback !== undefined && action.kind !== 'create_article') {
    if (action.isBaseFallback !== c.expect.isBaseFallback) {
      errs.push(`isBaseFallback: esperado ${c.expect.isBaseFallback} obteve ${action.isBaseFallback}`)
    }
  }
  if (c.expect.sizeLabel !== undefined) {
    if (action.kind !== 'add_size' || action.sizeLabel !== c.expect.sizeLabel) {
      errs.push(`sizeLabel: esperado "${c.expect.sizeLabel}" obteve "${action.kind === 'add_size' ? action.sizeLabel : '(N/A)'}"`)
    }
  }
  if (c.expect.basePerUnit !== undefined) {
    if (action.kind !== 'add_size' || action.basePerUnit !== c.expect.basePerUnit) {
      errs.push(`basePerUnit: esperado ${c.expect.basePerUnit} obteve ${action.kind === 'add_size' ? action.basePerUnit : '(N/A)'}`)
    }
  }

  if (errs.length === 0) {
    pass++
    console.log(`  ✓  [RESOLVE] ${c.label}`)
  } else {
    fail++
    console.log(`  ✗  [RESOLVE] ${c.label}`)
    for (const e of errs) console.log(`        ${e}`)
    failures.push(c.label)
  }
}

console.log(`\n${pass}/${pass + fail} passaram`)
if (fail > 0) {
  console.log('\nFalharam:')
  for (const f of failures) console.log(`  - ${f}`)
  process.exit(1)
}

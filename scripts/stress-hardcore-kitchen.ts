/**
 * R-TEST 3 — Hardcore Kitchen Chaos.
 *
 * Última ronda de stress com produtos internacionais, descartáveis,
 * embalagens, OCR sujo, calibres de peixe, cortes ibéricos, malicioso e
 * preservação de nomes. Usa o pipeline real, sem inventar API.
 *
 * Critério (acordado com o chef):
 *   P0 — crash, perde nome essencial, vira só embalagem/código, executa JS,
 *        unidade/pill perigosa com confiança.
 *   P1 — caso comum falha, descartável↔comida, OCR vira código, dimensões
 *        essenciais desaparecem, categoria errada confiante em produto comum.
 *   P2 — nome feio mas seguro, inglês sem categoria, abreviatura rara.
 *   OK — correto ou degradação segura sem mentir.
 *
 * Famílias P (bulk 100) e Q (Playwright UI) são testadas manualmente,
 * fora deste script.
 *
 * Correr: npx tsx scripts/stress-hardcore-kitchen.ts
 */

import { buildArticleDraft, getCountingModeOptions } from '../src/lib/articleDraft'
import type { ConfidenceLevel } from '../src/lib/articleConfidence'

type Family =
  | 'A' // Ásia
  | 'B' // México/LatAm
  | 'C' // Itália/França/Espanha
  | 'D' // Peixes calibres/formas
  | 'E' // Carnes cortes/maturações
  | 'F' // Legumes/frutas difíceis
  | 'G' // Pastelaria hardcore
  | 'H' // Bebidas/bar
  | 'I' // Embalagens/descartáveis
  | 'J' // Embalagens que parecem comida
  | 'K' // Limpeza/operação
  | 'L' // OCR/fornecedor sujo
  | 'M' // Mistura de línguas
  | 'N' // Maliciosos/estranhos
  | 'O' // Preservar nome a todo custo

type Risk = 'P0' | 'P1' | 'P2' | 'OK'

type Probe = {
  family:          Family
  input:           string
  forbidInName?:   string[]
  requireInName?:  string[]
  expectIntent?:   string
  expectOptions?:  1 | 2
  expectCategory?: string | null
  /**
   * `relaxed` = sucesso se nome essencial preservado + unit coerente, mesmo
   * sem categoria (Família M inglês, K limpeza, I não-canónica).
   * Critério: nenhum requireInName falha + categoria não é claramente errada.
   */
  relaxed?:        boolean
  riskOnFlag?:     'P0' | 'P1' | 'P2'
  note?:           string
}

const PROBES: Probe[] = [
  // ───────────────────────── A) Ásia ─────────────────────────
  { family: 'A', input: 'gochujang balde 3kg',
    forbidInName: ['balde'], requireInName: ['Gochujang'],
    note: 'gochujang ausente do dicionário — esperado null/Mercearia', riskOnFlag: 'P2' },
  { family: 'A', input: 'gochujang pasta 500g',
    requireInName: ['Gochujang', 'Pasta'], note: 'pasta deve ficar', riskOnFlag: 'P1' },
  { family: 'A', input: 'miso branco balde 5kg',
    forbidInName: ['balde'], requireInName: ['Miso', 'Branco'],
    note: 'miso está em Mercearia keywords', riskOnFlag: 'P1' },
  { family: 'A', input: 'miso vermelho 1kg',
    requireInName: ['Miso', 'Vermelho'], expectCategory: 'Mercearia' },
  { family: 'A', input: 'kimchi balde 5kg',
    forbidInName: ['balde'], requireInName: ['Kimchi'], riskOnFlag: 'P2' },
  { family: 'A', input: 'kimchi frasco 1kg',
    forbidInName: ['frasco'], requireInName: ['Kimchi'], riskOnFlag: 'P2' },
  { family: 'A', input: 'molho soja garrafa 1l',
    forbidInName: ['garrafa'], requireInName: ['Molho', 'Soja'],
    expectCategory: 'Mercearia' },
  { family: 'A', input: 'molho soja light garrafa 1l',
    forbidInName: ['garrafa'], requireInName: ['Soja', 'Light'], riskOnFlag: 'P1' },
  { family: 'A', input: 'molho soja dark garrafa 1l',
    forbidInName: ['garrafa'], requireInName: ['Soja', 'Dark'], riskOnFlag: 'P1' },
  { family: 'A', input: 'molho peixe garrafa 725ml',
    forbidInName: ['garrafa'], requireInName: ['Molho', 'Peixe'], riskOnFlag: 'P1',
    note: 'peixe está em Peixe keyword — pode poluir' },
  { family: 'A', input: 'molho ostra garrafa 700ml',
    forbidInName: ['garrafa'], requireInName: ['Molho', 'Ostra'], riskOnFlag: 'P1' },
  { family: 'A', input: 'molho hoisin frasco 397g',
    forbidInName: ['frasco'], requireInName: ['Hoisin'] },
  { family: 'A', input: 'sriracha garrafa 740ml',
    forbidInName: ['garrafa'], requireInName: ['Sriracha'] },
  { family: 'A', input: 'mirin garrafa 1l',
    forbidInName: ['garrafa'], requireInName: ['Mirin'], relaxed: true },
  { family: 'A', input: 'sake culinário garrafa 1l',
    forbidInName: ['garrafa'], requireInName: ['Sake'], relaxed: true },
  { family: 'A', input: 'vinagre arroz garrafa 1l',
    forbidInName: ['garrafa'], requireInName: ['Vinagre', 'Arroz'] },
  { family: 'A', input: 'óleo sésamo garrafa 500ml',
    forbidInName: ['garrafa'], requireInName: ['Óleo', 'Sésamo'] },
  { family: 'A', input: 'pasta caril vermelho lata 400g',
    requireInName: ['Pasta', 'Caril'], expectCategory: 'Mercearia',
    riskOnFlag: 'P1', note: 'pasta deve ficar; lata é container-keep' },
  { family: 'A', input: 'pasta caril verde lata 400g',
    requireInName: ['Pasta', 'Caril', 'Verde'], riskOnFlag: 'P1' },
  { family: 'A', input: 'leite coco lata 400ml',
    requireInName: ['Leite', 'Coco'], note: 'leite coco em lata' },
  { family: 'A', input: 'creme coco lata 400ml',
    requireInName: ['Creme', 'Coco'] },
  { family: 'A', input: 'panko saco 10kg',
    forbidInName: ['saco'], requireInName: ['Panko'], relaxed: true },
  { family: 'A', input: 'tempura mix saco 10kg',
    forbidInName: ['saco'], requireInName: ['Tempura', 'Mix'], relaxed: true },
  { family: 'A', input: 'edamame congelado 1kg',
    requireInName: ['Edamame'], expectCategory: 'Congelados' },
  { family: 'A', input: 'wakame seco 500g',
    requireInName: ['Wakame'], relaxed: true, riskOnFlag: 'P2' },
  { family: 'A', input: 'alga nori pack 50 folhas',
    forbidInName: ['pack'], requireInName: ['Alga', 'Nori'], riskOnFlag: 'P1',
    note: '"folhas" no fim é ambíguo — pode ficar' },
  { family: 'A', input: 'folha arroz pack 500g',
    forbidInName: ['pack'], requireInName: ['Folha', 'Arroz'], riskOnFlag: 'P0',
    note: 'P0 se "folha" for stripped — produto distinto de "papel arroz"' },
  { family: 'A', input: 'massa udon pack 5x200g',
    forbidInName: ['pack'], requireInName: ['Massa', 'Udon'], riskOnFlag: 'P1',
    note: 'multipack 5×200g esperado' },
  { family: 'A', input: 'massa ramen 5kg',
    requireInName: ['Massa', 'Ramen'], expectCategory: 'Mercearia' },
  { family: 'A', input: 'noodles arroz 5kg',
    requireInName: ['Noodles', 'Arroz'], relaxed: true },

  // ─────────────────────── B) México / LatAm ─────────────────
  { family: 'B', input: 'tortilla milho pack 12uni',
    forbidInName: ['pack'], requireInName: ['Tortilla', 'Milho'],
    note: 'compacto 12uni fora de scope', riskOnFlag: 'P1' },
  { family: 'B', input: 'tortilla trigo pack 12uni',
    forbidInName: ['pack'], requireInName: ['Tortilla', 'Trigo'], riskOnFlag: 'P1' },
  { family: 'B', input: 'nachos saco 500g',
    forbidInName: ['saco'], requireInName: ['Nachos'], relaxed: true },
  { family: 'B', input: 'jalapeños frasco 3kg',
    forbidInName: ['frasco'], requireInName: ['Jalapeños', 'Jalapenos'], relaxed: true },
  { family: 'B', input: 'jalapenos frasco 3kg',
    forbidInName: ['frasco'], requireInName: ['Jalapenos'], relaxed: true },
  { family: 'B', input: 'chipotle lata 2.8kg',
    requireInName: ['Chipotle'], note: 'lata container-keep' },
  { family: 'B', input: 'feijão preto lata 800g',
    requireInName: ['Feijão', 'Preto'], expectCategory: 'Mercearia',
    riskOnFlag: 'P0', note: 'feijão e preto essenciais' },
  { family: 'B', input: 'feijão vermelho lata 800g',
    requireInName: ['Feijão', 'Vermelho'], riskOnFlag: 'P0' },
  { family: 'B', input: 'molho pico de gallo balde 2kg',
    forbidInName: ['balde'], requireInName: ['Pico', 'Gallo'], riskOnFlag: 'P1' },
  { family: 'B', input: 'guacamole balde 1kg',
    forbidInName: ['balde'], requireInName: ['Guacamole'], relaxed: true },
  { family: 'B', input: 'abacate polpa congelada 1kg',
    requireInName: ['Abacate', 'Polpa'], expectCategory: 'Congelados', riskOnFlag: 'P1' },
  { family: 'B', input: 'queso fresco peça 1kg',
    requireInName: ['Queso', 'Fresco'], relaxed: true,
    note: 'queso=queijo em ES; fora do dicionário' },
  { family: 'B', input: 'queso cheddar ralado 2kg',
    requireInName: ['Queso', 'Cheddar'], note: 'cheddar está em Lacticínios' },
  { family: 'B', input: 'creme azedo balde 1kg',
    forbidInName: ['balde'], requireInName: ['Creme', 'Azedo'], riskOnFlag: 'P1' },
  { family: 'B', input: 'sour cream balde 1kg',
    forbidInName: ['balde'], requireInName: ['Sour', 'Cream'], relaxed: true },
  { family: 'B', input: 'salsa verde frasco 1kg',
    forbidInName: ['frasco'], requireInName: ['Salsa', 'Verde'], riskOnFlag: 'P1',
    note: 'salsa molho ≠ erva salsa' },
  { family: 'B', input: 'salsa roja frasco 1kg',
    forbidInName: ['frasco'], requireInName: ['Salsa', 'Roja'], riskOnFlag: 'P1' },
  { family: 'B', input: 'masa harina saco 25kg',
    forbidInName: ['saco'], requireInName: ['Masa', 'Harina'], relaxed: true },
  { family: 'B', input: 'dulce de leche lata 397g',
    requireInName: ['Dulce', 'Leche'], note: 'lata container-keep' },

  // ──────────────── C) Itália / França / Espanha ─────────────
  { family: 'C', input: 'guanciale peça 1kg',
    requireInName: ['Guanciale'], relaxed: true,
    note: 'guanciale fora dicionário; "peça" pode ficar' },
  { family: 'C', input: 'pancetta arrotolata peça 2kg',
    requireInName: ['Pancetta'], note: 'pancetta está em Carnes keywords' },
  { family: 'C', input: 'prosciutto crudo fatiado 500g',
    requireInName: ['Prosciutto', 'Crudo'], relaxed: true },
  { family: 'C', input: 'bresaola fatiada 500g',
    requireInName: ['Bresaola'], relaxed: true },
  { family: 'C', input: 'mortadella pistachio peça 3kg',
    requireInName: ['Mortadella'], relaxed: true },
  { family: 'C', input: 'mozzarella fior di latte bola 125g caixa 12uni',
    forbidInName: ['caixa'], requireInName: ['Mozzarella'],
    expectCategory: 'Lacticínios e Ovos', riskOnFlag: 'P1' },
  { family: 'C', input: 'burrata 125g caixa 6uni',
    forbidInName: ['caixa'], requireInName: ['Burrata'], expectCategory: 'Lacticínios e Ovos' },
  { family: 'C', input: 'stracciatella balde 1kg',
    forbidInName: ['balde'], requireInName: ['Stracciatella'], relaxed: true },
  { family: 'C', input: 'ricotta balde 1.5kg',
    forbidInName: ['balde'], requireInName: ['Ricotta'], expectCategory: 'Lacticínios e Ovos' },
  { family: 'C', input: 'mascarpone balde 2kg',
    forbidInName: ['balde'], requireInName: ['Mascarpone'], expectCategory: 'Lacticínios e Ovos' },
  { family: 'C', input: 'parmesan reggiano peça 2kg',
    requireInName: ['Parmesan', 'Reggiano'], expectCategory: 'Lacticínios e Ovos' },
  { family: 'C', input: 'grana padano peça 2kg',
    requireInName: ['Grana', 'Padano'], relaxed: true },
  { family: 'C', input: 'gorgonzola dolce peça 1.5kg',
    requireInName: ['Gorgonzola', 'Dolce'], expectCategory: 'Lacticínios e Ovos' },
  { family: 'C', input: 'taleggio peça 2kg',
    requireInName: ['Taleggio'], relaxed: true },
  { family: 'C', input: 'crème fraîche balde 1kg',
    forbidInName: ['balde'], requireInName: ['Crème', 'Fraîche'], relaxed: true },
  { family: 'C', input: 'foie gras bloco 500g',
    forbidInName: ['bloco'], requireInName: ['Foie', 'Gras'], relaxed: true },
  { family: 'C', input: 'magret pato 2uni pack',
    requireInName: ['Magret', 'Pato'], expectCategory: 'Carnes', riskOnFlag: 'P1' },
  { family: 'C', input: 'confit pato lata 1.25kg',
    requireInName: ['Confit', 'Pato'], note: 'lata container-keep' },
  { family: 'C', input: 'rillettes frasco 500g',
    forbidInName: ['frasco'], requireInName: ['Rillettes'], relaxed: true },
  { family: 'C', input: 'piquillo lata 2.5kg',
    requireInName: ['Piquillo'], relaxed: true },
  { family: 'C', input: 'anchovas lata 800g',
    requireInName: ['Anchovas'], note: 'anchovas é Peixe; lata mantém' },
  { family: 'C', input: 'boquerones balde 1kg',
    forbidInName: ['balde'], requireInName: ['Boquerones'], relaxed: true },
  { family: 'C', input: 'jamon iberico fatiado 500g',
    requireInName: ['Jamon', 'Iberico'], relaxed: true },
  { family: 'C', input: 'chorizo vela peça 1kg',
    requireInName: ['Chorizo'], note: 'chorizo está em Carnes (chouriço)' },

  // ─────────────────── D) Peixes calibres/formas ─────────────
  { family: 'D', input: 'camarão 16/20 caixa 2kg',
    forbidInName: ['caixa'], requireInName: ['Camarão', '16/20'],
    expectCategory: 'Peixe e Marisco', riskOnFlag: 'P0' },
  { family: 'D', input: 'camarão 20/30 caixa 2kg',
    forbidInName: ['caixa'], requireInName: ['Camarão', '20/30'],
    expectCategory: 'Peixe e Marisco', riskOnFlag: 'P0' },
  { family: 'D', input: 'gambas 30/40 caixa 2kg',
    forbidInName: ['caixa'], requireInName: ['Gambas', '30/40'],
    expectCategory: 'Peixe e Marisco', riskOnFlag: 'P0' },
  { family: 'D', input: 'vieira 10/20 congelada 1kg',
    requireInName: ['Vieira', '10/20'], expectCategory: 'Congelados', riskOnFlag: 'P1' },
  { family: 'D', input: 'vieira sem coral 1kg',
    requireInName: ['Vieira'], expectCategory: 'Peixe e Marisco' },
  { family: 'D', input: 'mexilhão meia concha caixa 1kg',
    forbidInName: ['caixa'], requireInName: ['Mexilhão'], expectCategory: 'Peixe e Marisco' },
  { family: 'D', input: 'lula tubo 5kg',
    requireInName: ['Lula'], expectCategory: 'Peixe e Marisco' },
  { family: 'D', input: 'lula argola 2kg',
    requireInName: ['Lula', 'Argola'], expectCategory: 'Peixe e Marisco' },
  { family: 'D', input: 'polvo t6 2kg',
    requireInName: ['Polvo', 'T6'], expectCategory: 'Peixe e Marisco', riskOnFlag: 'P0' },
  { family: 'D', input: 'polvo t7 2kg',
    requireInName: ['Polvo', 'T7'], expectCategory: 'Peixe e Marisco', riskOnFlag: 'P0' },
  { family: 'D', input: 'bacalhau asa branca 5kg',
    requireInName: ['Bacalhau'], expectCategory: 'Peixe e Marisco' },
  { family: 'D', input: 'bacalhau migas 5kg',
    requireInName: ['Bacalhau'], expectCategory: 'Peixe e Marisco' },
  { family: 'D', input: 'bacalhau lombo 5kg',
    requireInName: ['Bacalhau'], expectCategory: 'Peixe e Marisco', riskOnFlag: 'P1',
    note: 'lombo é Carnes substring — risco P1' },
  { family: 'D', input: 'salmão trim d 5kg',
    requireInName: ['Salmão'], expectCategory: 'Peixe e Marisco' },
  { family: 'D', input: 'salmão superior 5kg',
    requireInName: ['Salmão'], expectCategory: 'Peixe e Marisco' },
  { family: 'D', input: 'atum akami 1kg',
    requireInName: ['Atum'], expectCategory: 'Peixe e Marisco' },
  { family: 'D', input: 'atum chutoro 1kg',
    requireInName: ['Atum'], expectCategory: 'Peixe e Marisco' },
  { family: 'D', input: 'atum otoro 1kg',
    requireInName: ['Atum'], expectCategory: 'Peixe e Marisco' },
  { family: 'D', input: 'robalo 400/600 caixa 5kg',
    forbidInName: ['caixa'], requireInName: ['Robalo', '400/600'],
    expectCategory: 'Peixe e Marisco', riskOnFlag: 'P0' },
  { family: 'D', input: 'dourada 600/800 caixa 5kg',
    forbidInName: ['caixa'], requireInName: ['Dourada', '600/800'],
    expectCategory: 'Peixe e Marisco', riskOnFlag: 'P0' },
  { family: 'D', input: 'pregado 1/2kg caixa',
    requireInName: ['Pregado'], note: '1/2kg ambíguo — calibre ou meio kg?', riskOnFlag: 'P2' },
  { family: 'D', input: 'peixe galo 1kg',
    requireInName: ['Peixe', 'Galo'], expectCategory: 'Peixe e Marisco' },

  // ──────────────── E) Carnes cortes/maturações ──────────────
  { family: 'E', input: 'novilho vazia maturada peça 3kg',
    requireInName: ['Novilho', 'Vazia'], expectCategory: 'Carnes' },
  { family: 'E', input: 'novilho entrecôte maturado peça 4kg',
    requireInName: ['Novilho', 'Entrecôte'], expectCategory: 'Carnes' },
  { family: 'E', input: 'picanha argentina peça 1.5kg',
    requireInName: ['Picanha'], expectCategory: 'Carnes' },
  { family: 'E', input: 'black angus burger 180g caixa 24uni',
    forbidInName: ['caixa'], requireInName: ['Black', 'Angus'],
    expectCategory: 'Carnes', riskOnFlag: 'P1' },
  { family: 'E', input: 'wagyu burger 160g caixa 20uni',
    forbidInName: ['caixa'], requireInName: ['Wagyu'], riskOnFlag: 'P1' },
  { family: 'E', input: 'presa ibérica peça 1kg',
    requireInName: ['Presa', 'Ibérica'], expectCategory: 'Carnes', riskOnFlag: 'P1' },
  { family: 'E', input: 'secreto ibérico peça 1kg',
    requireInName: ['Secreto', 'Ibérico'], expectCategory: 'Carnes', riskOnFlag: 'P1' },
  { family: 'E', input: 'pluma ibérica peça 1kg',
    requireInName: ['Pluma', 'Ibérica'], expectCategory: 'Carnes', riskOnFlag: 'P1' },
  { family: 'E', input: 'bochecha porco 5kg',
    requireInName: ['Bochecha', 'Porco'], expectCategory: 'Carnes' },
  { family: 'E', input: 'rabo boi 5kg',
    requireInName: ['Rabo', 'Boi'], expectCategory: 'Carnes' },
  { family: 'E', input: 'língua vaca 2kg',
    requireInName: ['Língua', 'Vaca'], expectCategory: 'Carnes' },
  { family: 'E', input: 'fígado vitela 2kg',
    requireInName: ['Fígado', 'Vitela'], expectCategory: 'Carnes' },
  { family: 'E', input: 'coração frango 1kg',
    requireInName: ['Coração', 'Frango'], expectCategory: 'Carnes' },
  { family: 'E', input: 'moelas frango 1kg',
    requireInName: ['Moelas', 'Frango'], expectCategory: 'Carnes', relaxed: true },
  { family: 'E', input: 'pato inteiro 2kg',
    requireInName: ['Pato'], expectCategory: 'Carnes' },
  { family: 'E', input: 'codorniz caixa 12uni',
    forbidInName: ['caixa'], requireInName: ['Codorniz'], expectCategory: 'Carnes', riskOnFlag: 'P1' },
  { family: 'E', input: 'coelho inteiro 1.2kg',
    requireInName: ['Coelho'], expectCategory: 'Carnes' },
  { family: 'E', input: 'carré borrego peça 1kg',
    requireInName: ['Borrego'], expectCategory: 'Carnes', relaxed: true,
    note: '"carré" pode ficar' },
  { family: 'E', input: 'costeleta borrego caixa 5kg',
    forbidInName: ['caixa'], requireInName: ['Costeleta', 'Borrego'], expectCategory: 'Carnes' },
  { family: 'E', input: 'ossobuco vitela 5kg',
    requireInName: ['Ossobuco', 'Vitela'], expectCategory: 'Carnes' },

  // ──────────────── F) Legumes/frutas difíceis ───────────────
  { family: 'F', input: 'tomate coração de boi 5kg',
    requireInName: ['Tomate', 'Coração'], expectCategory: 'Frutas e Legumes', riskOnFlag: 'P0' },
  { family: 'F', input: 'tomate zebra 5kg',
    requireInName: ['Tomate', 'Zebra'], expectCategory: 'Frutas e Legumes', riskOnFlag: 'P1' },
  { family: 'F', input: 'tomate kumato 5kg',
    requireInName: ['Tomate', 'Kumato'], expectCategory: 'Frutas e Legumes', riskOnFlag: 'P1' },
  { family: 'F', input: 'tomate san marzano lata 2.5kg',
    requireInName: ['Tomate', 'San', 'Marzano'], note: 'lata container-keep', riskOnFlag: 'P1' },
  { family: 'F', input: 'tomate datterino lata 400g',
    requireInName: ['Tomate', 'Datterino'], note: 'lata container-keep' },
  { family: 'F', input: 'mini cenoura 2kg',
    requireInName: ['Mini', 'Cenoura'], expectCategory: 'Frutas e Legumes' },
  { family: 'F', input: 'cenoura baby 2kg',
    requireInName: ['Cenoura', 'Baby'], expectCategory: 'Frutas e Legumes' },
  { family: 'F', input: 'courgette amarela 5kg',
    requireInName: ['Courgette', 'Amarela'], expectCategory: 'Frutas e Legumes' },
  { family: 'F', input: 'abóbora hokkaido unidade',
    requireInName: ['Abóbora', 'Hokkaido'], expectCategory: 'Frutas e Legumes' },
  { family: 'F', input: 'abóbora butternut unidade',
    requireInName: ['Abóbora', 'Butternut'], expectCategory: 'Frutas e Legumes' },
  { family: 'F', input: 'batata violeta 5kg',
    requireInName: ['Batata', 'Violeta'], expectCategory: 'Frutas e Legumes' },
  { family: 'F', input: 'batata ratte 5kg',
    requireInName: ['Batata', 'Ratte'], expectCategory: 'Frutas e Legumes' },
  { family: 'F', input: 'funcho 5kg',
    requireInName: ['Funcho'], expectCategory: 'Frutas e Legumes' },
  { family: 'F', input: 'ruibarbo 1kg',
    requireInName: ['Ruibarbo'], relaxed: true, riskOnFlag: 'P2' },
  { family: 'F', input: 'tupinambo 2kg',
    requireInName: ['Tupinambo'], relaxed: true, riskOnFlag: 'P2' },
  { family: 'F', input: 'alcachofra caixa 12uni',
    forbidInName: ['caixa'], requireInName: ['Alcachofra'],
    expectCategory: 'Frutas e Legumes', riskOnFlag: 'P1' },
  { family: 'F', input: 'espargos verdes molho',
    requireInName: ['Espargos', 'Verdes'], expectCategory: 'Frutas e Legumes',
    riskOnFlag: 'P0', note: '"molho" é unidade de venda — não confundir com molho líquido' },
  { family: 'F', input: 'espargos brancos molho',
    requireInName: ['Espargos', 'Brancos'], riskOnFlag: 'P0' },
  { family: 'F', input: 'microgreens caixa 50g',
    forbidInName: ['caixa'], requireInName: ['Microgreens'], relaxed: true },
  { family: 'F', input: 'rebentos ervilha caixa 50g',
    forbidInName: ['caixa'], requireInName: ['Rebentos', 'Ervilha'] },
  { family: 'F', input: 'flor comestível caixa 50uni',
    forbidInName: ['caixa'], requireInName: ['Flor', 'Comestível'],
    riskOnFlag: 'P0', note: 'flor não pode virar flor de sal' },
  { family: 'F', input: 'yuzu unidade',
    requireInName: ['Yuzu'], relaxed: true },
  { family: 'F', input: 'bergamota 2kg',
    requireInName: ['Bergamota'], relaxed: true },
  { family: 'F', input: 'finger lime caixa 250g',
    forbidInName: ['caixa'], requireInName: ['Finger', 'Lime'], relaxed: true },
  { family: 'F', input: 'physalis caixa 1kg',
    forbidInName: ['caixa'], requireInName: ['Physalis'], relaxed: true },
  { family: 'F', input: 'groselha caixa 125g',
    forbidInName: ['caixa'], requireInName: ['Groselha'], expectCategory: 'Frutas e Legumes' },
  { family: 'F', input: 'lichias lata 565g',
    requireInName: ['Lichias'], note: 'lata container-keep' },

  // ────────────────── G) Pastelaria hardcore ─────────────────
  { family: 'G', input: 'glucose balde 5kg',
    forbidInName: ['balde'], requireInName: ['Glucose'], expectCategory: 'Mercearia' },
  { family: 'G', input: 'trimoline balde 7kg',
    forbidInName: ['balde'], requireInName: ['Trimoline'], relaxed: true },
  { family: 'G', input: 'açúcar invertido balde 7kg',
    forbidInName: ['balde'], requireInName: ['Açúcar', 'Invertido'], expectCategory: 'Mercearia' },
  { family: 'G', input: 'pectina nh 1kg',
    requireInName: ['Pectina', 'NH'], expectCategory: 'Mercearia', riskOnFlag: 'P1' },
  { family: 'G', input: 'pectina jaune 1kg',
    requireInName: ['Pectina', 'Jaune'], expectCategory: 'Mercearia', riskOnFlag: 'P1' },
  { family: 'G', input: 'gelatina folha bronze 1kg',
    requireInName: ['Gelatina', 'Folha', 'Bronze'], expectCategory: 'Mercearia', riskOnFlag: 'P0' },
  { family: 'G', input: 'gelatina folha prata 1kg',
    requireInName: ['Gelatina', 'Folha', 'Prata'], riskOnFlag: 'P0' },
  { family: 'G', input: 'gelatina pó 1kg',
    requireInName: ['Gelatina'], expectCategory: 'Mercearia',
    riskOnFlag: 'P1', note: '"em pó" pode ser stripped por NAME_CONNECTORS' },
  { family: 'G', input: 'agar agar 500g',
    requireInName: ['Agar'], expectCategory: 'Mercearia' },
  { family: 'G', input: 'xantana 500g',
    requireInName: ['Xantana'], expectCategory: 'Mercearia' },
  { family: 'G', input: 'lecitina soja 500g',
    requireInName: ['Lecitina', 'Soja'], expectCategory: 'Mercearia' },
  { family: 'G', input: 'dextrose 5kg',
    requireInName: ['Dextrose'], expectCategory: 'Mercearia' },
  { family: 'G', input: 'maltodextrina 5kg',
    requireInName: ['Maltodextrina'], relaxed: true },
  { family: 'G', input: 'isomalt 5kg',
    requireInName: ['Isomalt'], relaxed: true },
  { family: 'G', input: 'praliné avelã balde 5kg',
    forbidInName: ['balde'], requireInName: ['Praliné', 'Avelã'], expectCategory: 'Mercearia' },
  { family: 'G', input: 'pasta pistácio balde 3kg',
    forbidInName: ['balde'], requireInName: ['Pasta', 'Pistácio'],
    riskOnFlag: 'P0', note: 'pasta não pode ser strippada' },
  { family: 'G', input: 'pasta baunilha frasco 1kg',
    forbidInName: ['frasco'], requireInName: ['Pasta', 'Baunilha'], riskOnFlag: 'P0' },
  { family: 'G', input: 'vagem baunilha tubo 100g',
    requireInName: ['Vagem', 'Baunilha'], expectCategory: 'Mercearia',
    riskOnFlag: 'P1', note: 'tubo não é label canónico — pode ficar' },
  { family: 'G', input: 'chocolate 70% saco 5kg',
    forbidInName: ['saco'], requireInName: ['Chocolate', '70%'],
    expectCategory: 'Mercearia', riskOnFlag: 'P0' },
  { family: 'G', input: 'chocolate 64% pistoles saco 5kg',
    forbidInName: ['saco'], requireInName: ['Chocolate', '64%', 'Pistoles'], riskOnFlag: 'P0' },
  { family: 'G', input: 'chocolate branco 30% saco 5kg',
    forbidInName: ['saco'], requireInName: ['Chocolate', 'Branco', '30%'], riskOnFlag: 'P0' },
  { family: 'G', input: 'cacau alcalino 1kg',
    requireInName: ['Cacau'], expectCategory: 'Mercearia' },
  { family: 'G', input: 'amêndoa farinha 1kg',
    requireInName: ['Amêndoa', 'Farinha'], expectCategory: 'Mercearia' },
  { family: 'G', input: 'avelã inteira 1kg',
    requireInName: ['Avelã'], expectCategory: 'Mercearia' },
  { family: 'G', input: 'pistácio cru 1kg',
    requireInName: ['Pistácio'], expectCategory: 'Mercearia' },

  // ──────────────────── H) Bebidas/bar ───────────────────────
  { family: 'H', input: 'coca cola lata 330ml pack 24',
    forbidInName: ['pack'], requireInName: ['Coca'],
    expectCategory: 'Bebidas', riskOnFlag: 'P1' },
  { family: 'H', input: 'coca cola zero lata 330ml pack 24',
    forbidInName: ['pack'], requireInName: ['Coca', 'Zero'], riskOnFlag: 'P1' },
  { family: 'H', input: 'tónica garrafa 200ml caixa 24',
    forbidInName: ['garrafa', 'caixa'], requireInName: ['Tónica'],
    expectCategory: 'Bebidas', riskOnFlag: 'P1' },
  { family: 'H', input: 'ginger beer garrafa 200ml caixa 24',
    forbidInName: ['garrafa', 'caixa'], requireInName: ['Ginger', 'Beer'], relaxed: true },
  { family: 'H', input: 'água pedras garrafa 250ml caixa 24',
    forbidInName: ['garrafa', 'caixa'], requireInName: ['Água', 'Pedras'],
    expectCategory: 'Bebidas', riskOnFlag: 'P1' },
  { family: 'H', input: 'água castello garrafa 250ml caixa 24',
    forbidInName: ['garrafa', 'caixa'], requireInName: ['Água', 'Castello'], riskOnFlag: 'P1' },
  { family: 'H', input: 'sumo maçã garrafa 1l caixa 6',
    forbidInName: ['garrafa', 'caixa'], requireInName: ['Sumo', 'Maçã'],
    expectCategory: 'Bebidas', riskOnFlag: 'P1' },
  { family: 'H', input: 'polpa maracujá garrafa 1l',
    forbidInName: ['garrafa'], requireInName: ['Polpa', 'Maracujá'] },
  { family: 'H', input: 'xarope açúcar garrafa 1l',
    forbidInName: ['garrafa'], requireInName: ['Xarope', 'Açúcar'] },
  { family: 'H', input: 'xarope baunilha garrafa 700ml',
    forbidInName: ['garrafa'], requireInName: ['Xarope', 'Baunilha'] },
  { family: 'H', input: 'café grão saco 1kg',
    forbidInName: ['saco'], requireInName: ['Café', 'Grão'],
    expectCategory: 'Mercearia', riskOnFlag: 'P0' },
  { family: 'H', input: 'descafeinado cápsulas caixa 100uni',
    forbidInName: ['caixa'], requireInName: ['Descafeinado'], riskOnFlag: 'P1' },
  { family: 'H', input: 'chá earl grey caixa 20 saquetas',
    forbidInName: ['caixa'], requireInName: ['Chá', 'Earl', 'Grey'],
    expectCategory: 'Mercearia', riskOnFlag: 'P1' },
  { family: 'H', input: 'chá verde caixa 20 saquetas',
    forbidInName: ['caixa'], requireInName: ['Chá', 'Verde'], riskOnFlag: 'P1' },
  { family: 'H', input: 'matcha lata 500g',
    requireInName: ['Matcha'], expectCategory: 'Mercearia' },
  { family: 'H', input: 'vinho branco garrafa 75cl caixa 6',
    forbidInName: ['garrafa', 'caixa'], requireInName: ['Vinho', 'Branco'],
    expectCategory: 'Bebidas', riskOnFlag: 'P1' },
  { family: 'H', input: 'vinho tinto garrafa 0.75l caixa 6',
    forbidInName: ['garrafa', 'caixa'], requireInName: ['Vinho', 'Tinto'],
    expectCategory: 'Bebidas', riskOnFlag: 'P1' },
  { family: 'H', input: 'vinho do porto garrafa 75cl',
    forbidInName: ['garrafa'], requireInName: ['Vinho', 'Porto'],
    expectCategory: 'Bebidas', riskOnFlag: 'P0' },
  { family: 'H', input: 'prosecco garrafa 75cl caixa 6',
    forbidInName: ['garrafa', 'caixa'], requireInName: ['Prosecco'],
    expectCategory: 'Bebidas', riskOnFlag: 'P1' },

  // ───────────── I) Embalagens/descartáveis (núcleo) ─────────
  // Critério user: OK se nome+dimensões preservados + categoria
  // Embalagens/null. P1 se cair em Mercearia/Bebidas/Carnes confiante.
  { family: 'I', input: 'saco vacuo 20x30 caixa 100uni',
    forbidInName: ['caixa'], requireInName: ['Sacos', 'Saco', 'Vacuo', '20x30'],
    riskOnFlag: 'P1' },
  { family: 'I', input: 'saco vácuo 25x35 caixa 100 uni',
    forbidInName: ['caixa'], requireInName: ['Vácuo', 'Vacuo', '25x35'], riskOnFlag: 'P1' },
  { family: 'I', input: 'sacos vacuo 20x30 cx 100',
    forbidInName: ['cx'], requireInName: ['Sacos', '20x30'], riskOnFlag: 'P1' },
  { family: 'I', input: 'saco congelação 3l rolo 50uni',
    requireInName: ['Saco', 'Congelação'], riskOnFlag: 'P1',
    note: '"rolo" não é label canónico' },
  { family: 'I', input: 'película aderente rolo 300m',
    requireInName: ['Película', 'Aderente'], expectCategory: 'Embalagens e Descartáveis' },
  { family: 'I', input: 'pelicula aderente 45cm rolo',
    requireInName: ['Pelicula', 'Aderente', '45cm'], riskOnFlag: 'P1' },
  { family: 'I', input: 'alumínio rolo 200m',
    requireInName: ['Alumínio'], expectCategory: 'Embalagens e Descartáveis', riskOnFlag: 'P1' },
  { family: 'I', input: 'papel vegetal folha caixa 500uni',
    forbidInName: ['caixa'], requireInName: ['Papel', 'Vegetal'],
    expectCategory: 'Embalagens e Descartáveis', riskOnFlag: 'P1' },
  { family: 'I', input: 'papel forno rolo 50m',
    requireInName: ['Papel', 'Forno'], riskOnFlag: 'P1' },
  { family: 'I', input: 'papel absorvente rolo pack 6',
    requireInName: ['Papel', 'Absorvente'], riskOnFlag: 'P1' },
  { family: 'I', input: 'guardanapo 40x40 caixa 1200uni',
    forbidInName: ['caixa'], requireInName: ['Guardanapo', '40x40'],
    expectCategory: 'Embalagens e Descartáveis', riskOnFlag: 'P0',
    note: '40x40 essencial' },
  { family: 'I', input: 'guardanapo cocktail caixa 2000uni',
    forbidInName: ['caixa'], requireInName: ['Guardanapo', 'Cocktail'], riskOnFlag: 'P1' },
  { family: 'I', input: 'toalhete desinfetante caixa 100uni',
    forbidInName: ['caixa'], requireInName: ['Toalhete'], relaxed: true },
  { family: 'I', input: 'palhinha preta caixa 1000uni',
    forbidInName: ['caixa'], requireInName: ['Palhinha', 'Preta'], relaxed: true },
  { family: 'I', input: 'mexedor café caixa 1000uni',
    forbidInName: ['caixa'], requireInName: ['Mexedor', 'Café'], riskOnFlag: 'P1',
    note: '"café" pode levar a Mercearia incorretamente' },
  { family: 'I', input: 'colher descartável caixa 1000uni',
    forbidInName: ['caixa'], requireInName: ['Colher', 'Descartável'],
    expectCategory: 'Embalagens e Descartáveis', riskOnFlag: 'P1' },
  { family: 'I', input: 'garfo descartável caixa 1000uni',
    forbidInName: ['caixa'], requireInName: ['Garfo', 'Descartável'], riskOnFlag: 'P1' },
  { family: 'I', input: 'faca descartável caixa 1000uni',
    forbidInName: ['caixa'], requireInName: ['Faca', 'Descartável'], riskOnFlag: 'P1' },
  { family: 'I', input: 'copo papel 240ml caixa 1000uni',
    forbidInName: ['caixa'], requireInName: ['Copo', 'Papel'],
    riskOnFlag: 'P0', note: '240ml pode virar volume — copo NÃO é Bebidas' },
  { family: 'I', input: 'copo plástico 500ml caixa 500uni',
    forbidInName: ['caixa'], requireInName: ['Copo', 'Plástico'],
    riskOnFlag: 'P0' },
  { family: 'I', input: 'tampa copo 90mm caixa 1000uni',
    forbidInName: ['caixa'], requireInName: ['Tampa', 'Copo', '90mm'],
    riskOnFlag: 'P1' },
  { family: 'I', input: 'caixa hambúrguer kraft caixa 200uni',
    forbidInName: ['caixa'], requireInName: ['Hambúrguer', 'Kraft'],
    riskOnFlag: 'P0', note: 'caixa hambúrguer NÃO pode virar carne' },
  { family: 'I', input: 'caixa pizza 33cm caixa 100uni',
    forbidInName: ['caixa'], requireInName: ['Pizza', '33cm'],
    riskOnFlag: 'P0', note: 'caixa pizza NÃO pode virar comida' },
  { family: 'I', input: 'caixa take away 750ml caixa 300uni',
    forbidInName: ['caixa'], requireInName: ['Take', 'Away'], riskOnFlag: 'P1' },
  { family: 'I', input: 'caixa take away 1000ml caixa 300uni',
    forbidInName: ['caixa'], requireInName: ['Take', 'Away'], riskOnFlag: 'P1' },
  { family: 'I', input: 'embalagem sushi 18x12 caixa 400uni',
    forbidInName: ['caixa'], requireInName: ['Embalagem', 'Sushi', '18x12'], riskOnFlag: 'P1' },
  { family: 'I', input: 'saco papel asa 26x17x25 caixa 250uni',
    forbidInName: ['caixa'], requireInName: ['Saco', 'Papel', '26x17x25'],
    riskOnFlag: 'P0', note: '3-D dimension preservada' },
  { family: 'I', input: 'saco lixo 100l rolo 25uni',
    requireInName: ['Saco', 'Lixo', '100l'], riskOnFlag: 'P1' },
  { family: 'I', input: 'luva nitrilo m caixa 100uni',
    forbidInName: ['caixa'], requireInName: ['Luva', 'Nitrilo'],
    expectCategory: 'Embalagens e Descartáveis', riskOnFlag: 'P1' },
  { family: 'I', input: 'luva nitrilo l caixa 100uni',
    forbidInName: ['caixa'], requireInName: ['Luva', 'Nitrilo'], riskOnFlag: 'P1' },
  { family: 'I', input: 'touca descartável caixa 100uni',
    forbidInName: ['caixa'], requireInName: ['Touca'], riskOnFlag: 'P1' },
  { family: 'I', input: 'máscara descartável caixa 50uni',
    forbidInName: ['caixa'], requireInName: ['Máscara'], relaxed: true },

  // ────────── J) Embalagens que parecem comida ───────────────
  { family: 'J', input: 'folha alumínio rolo 200m',
    requireInName: ['Folha', 'Alumínio'], expectCategory: 'Embalagens e Descartáveis',
    riskOnFlag: 'P1' },
  { family: 'J', input: 'folha arroz pack 500g',
    forbidInName: ['pack'], requireInName: ['Folha', 'Arroz'],
    riskOnFlag: 'P0', note: 'folha arroz é comida — distinta de papel arroz' },
  { family: 'J', input: 'papel arroz 500g',
    requireInName: ['Papel', 'Arroz'], riskOnFlag: 'P0' },
  { family: 'J', input: 'papel vegetal folha caixa 500uni',
    forbidInName: ['caixa'], requireInName: ['Papel', 'Vegetal'],
    expectCategory: 'Embalagens e Descartáveis', riskOnFlag: 'P1' },
  { family: 'J', input: 'flor comestível caixa 50uni',
    forbidInName: ['caixa'], requireInName: ['Flor', 'Comestível'],
    expectCategory: 'Frutas e Legumes', riskOnFlag: 'P0' },
  { family: 'J', input: 'flor de sal 1kg',
    requireInName: ['Flor', 'Sal'], expectCategory: 'Mercearia', riskOnFlag: 'P0' },
  { family: 'J', input: 'café em grão 1kg',
    requireInName: ['Café'], expectCategory: 'Mercearia',
    riskOnFlag: 'P0', note: '"em grão" estilo PT pode ser stripped' },
  { family: 'J', input: 'pimenta em grão 1kg',
    requireInName: ['Pimenta'], expectCategory: 'Mercearia', riskOnFlag: 'P1' },
  { family: 'J', input: 'grão bico lata 800g',
    requireInName: ['Grão', 'Bico'], expectCategory: 'Mercearia', riskOnFlag: 'P0',
    note: 'grão bico ≠ café em grão' },
  { family: 'J', input: 'massa folhada 1kg',
    requireInName: ['Massa', 'Folhada'], expectCategory: 'Mercearia', riskOnFlag: 'P0' },
  { family: 'J', input: 'massa fresca 1kg',
    requireInName: ['Massa', 'Fresca'], expectCategory: 'Mercearia', riskOnFlag: 'P0' },
  { family: 'J', input: 'massa udon 5kg',
    requireInName: ['Massa', 'Udon'], expectCategory: 'Mercearia', riskOnFlag: 'P1' },
  { family: 'J', input: 'pasta pistácio 3kg',
    requireInName: ['Pasta', 'Pistácio'], expectCategory: 'Mercearia', riskOnFlag: 'P0' },
  { family: 'J', input: 'pasta caril lata 400g',
    requireInName: ['Pasta', 'Caril'], expectCategory: 'Mercearia', riskOnFlag: 'P0' },
  { family: 'J', input: 'creme de leite lata 400g',
    requireInName: ['Creme', 'Leite'], expectCategory: 'Lacticínios e Ovos', riskOnFlag: 'P0' },
  { family: 'J', input: 'leite creme 1kg',
    requireInName: ['Leite', 'Creme'], expectCategory: 'Lacticínios e Ovos', riskOnFlag: 'P0' },

  // ─────────────── K) Limpeza/operação ───────────────────────
  // Critério user: P1 só se cair confiantemente em Mercearia/Bebidas/Carnes.
  // null/Sem-categoria é P2.
  { family: 'K', input: 'detergente loiça garrafa 5l',
    forbidInName: ['garrafa'], requireInName: ['Detergente', 'Loiça'],
    relaxed: true, riskOnFlag: 'P1' },
  { family: 'K', input: 'detergente máquina loiça bidão 10l',
    requireInName: ['Detergente', 'Máquina'], relaxed: true, riskOnFlag: 'P1',
    note: 'bidão não é label canónico' },
  { family: 'K', input: 'abrilhantador máquina loiça bidão 10l',
    requireInName: ['Abrilhantador'], relaxed: true, riskOnFlag: 'P1' },
  { family: 'K', input: 'desengordurante garrafa 5l',
    forbidInName: ['garrafa'], requireInName: ['Desengordurante'], relaxed: true, riskOnFlag: 'P1' },
  { family: 'K', input: 'lava tudo garrafa 5l',
    forbidInName: ['garrafa'], requireInName: ['Lava'], relaxed: true, riskOnFlag: 'P1' },
  { family: 'K', input: 'álcool gel garrafa 5l',
    forbidInName: ['garrafa'], requireInName: ['Álcool', 'Gel'], relaxed: true, riskOnFlag: 'P1' },
  { family: 'K', input: 'sabão mãos recarga 5l',
    requireInName: ['Sabão', 'Mãos'], relaxed: true, riskOnFlag: 'P1' },
  { family: 'K', input: 'esfregão verde pack 10uni',
    forbidInName: ['pack'], requireInName: ['Esfregão', 'Verde'], relaxed: true },
  { family: 'K', input: 'esponja amarela pack 10uni',
    forbidInName: ['pack'], requireInName: ['Esponja', 'Amarela'], relaxed: true },
  { family: 'K', input: 'pano microfibra pack 10uni',
    forbidInName: ['pack'], requireInName: ['Pano', 'Microfibra'], relaxed: true },
  { family: 'K', input: 'pano azul rolo 500 folhas',
    requireInName: ['Pano', 'Azul'], relaxed: true, riskOnFlag: 'P1' },
  { family: 'K', input: 'papel mãos caixa 4000 folhas',
    forbidInName: ['caixa'], requireInName: ['Papel', 'Mãos'], relaxed: true, riskOnFlag: 'P1' },
  { family: 'K', input: 'bobine industrial pack 6 rolos',
    forbidInName: ['pack'], requireInName: ['Bobine', 'Industrial'], relaxed: true, riskOnFlag: 'P1' },
  { family: 'K', input: 'saco lixo 100l rolo 25uni',
    requireInName: ['Saco', 'Lixo'], relaxed: true, riskOnFlag: 'P1' },

  // ─────────────── L) OCR/fornecedor sujo ────────────────────
  { family: 'L', input: 'COD123 TOMATE PELADO LATA 2,5KG',
    requireInName: ['Tomate', 'Pelado'], riskOnFlag: 'P1',
    note: 'COD123 não deve virar nome' },
  { family: 'L', input: '78901 LEITE UHT MG 1L CX6',
    requireInName: ['Leite'], riskOnFlag: 'P1', note: '78901 código' },
  { family: 'L', input: 'ART.456 SACO VACUO 20X30 CX100',
    requireInName: ['Saco', 'Vacuo', '20X30'], riskOnFlag: 'P1' },
  { family: 'L', input: 'REF 9988 HAMBURGER 180GR CX24',
    requireInName: ['Hamburger'], riskOnFlag: 'P1' },
  { family: 'L', input: '12X AGUA 0.5L PACK',
    requireInName: ['Agua', 'Água'], riskOnFlag: 'P1' },
  { family: 'L', input: 'CX6 NATA 35% 1LT',
    requireInName: ['Nata', '35%'], riskOnFlag: 'P1' },
  { family: 'L', input: 'CX 24 COCA COLA LATA 33CL',
    requireInName: ['Coca'], riskOnFlag: 'P1' },
  { family: 'L', input: '6 UNI GARRAFA AZEITE 1L',
    requireInName: ['Azeite'], riskOnFlag: 'P1' },
  { family: 'L', input: 'FARINHA T55 25 KG SACO',
    forbidInName: ['saco'], requireInName: ['Farinha', 'T55'], riskOnFlag: 'P1' },
  { family: 'L', input: 'OVOS CLASSE M CX180',
    requireInName: ['Ovos', 'Classe', 'M'], riskOnFlag: 'P1' },
  { family: 'L', input: 'CAMARAO 30/40 2KG CONG.',
    requireInName: ['Camarao', '30/40'], riskOnFlag: 'P1' },
  { family: 'L', input: 'POLVO T6 2KG IQF',
    requireInName: ['Polvo', 'T6'], riskOnFlag: 'P1' },
  { family: 'L', input: 'SACO LIXO 100 LT RL25',
    requireInName: ['Saco', 'Lixo'], riskOnFlag: 'P1' },
  { family: 'L', input: 'TAMPA COPO 90 MM CX1000',
    requireInName: ['Tampa', 'Copo'], riskOnFlag: 'P1' },
  { family: 'L', input: 'CAIXA PIZZA 33 CM CX100',
    requireInName: ['Pizza'], riskOnFlag: 'P1' },

  // ─────────────── M) Mistura de línguas ────────────────────
  { family: 'M', input: 'chicken breast box 5kg',
    requireInName: ['Chicken', 'Breast'], relaxed: true },
  { family: 'M', input: 'beef ribeye piece 3kg',
    requireInName: ['Beef', 'Ribeye'], relaxed: true },
  { family: 'M', input: 'pork belly sliced 1kg',
    requireInName: ['Pork', 'Belly'], relaxed: true },
  { family: 'M', input: 'salmon fillet box 5kg',
    requireInName: ['Salmon', 'Fillet'], relaxed: true,
    note: 'salmon está em Peixe keyword' },
  { family: 'M', input: 'tuna loin 2kg',
    requireInName: ['Tuna'], relaxed: true },
  { family: 'M', input: 'frozen peas bag 1kg',
    requireInName: ['Frozen', 'Peas'], relaxed: true },
  { family: 'M', input: 'tomato peeled can 2.5kg',
    requireInName: ['Tomato'], relaxed: true,
    riskOnFlag: 'P1', note: 'can não é label PT — pode ficar; tomato essencial' },
  { family: 'M', input: 'coconut milk can 400ml',
    requireInName: ['Coconut', 'Milk'], relaxed: true },
  { family: 'M', input: 'paper cup 240ml case 1000',
    requireInName: ['Paper', 'Cup'], relaxed: true },
  { family: 'M', input: 'pizza box 33cm case 100',
    requireInName: ['Pizza', 'Box'], relaxed: true,
    riskOnFlag: 'P1', note: 'pizza box não pode virar comida' },
  { family: 'M', input: 'vacuum bag 20x30 case 100',
    requireInName: ['Vacuum', 'Bag', '20x30'], relaxed: true },
  { family: 'M', input: 'nitrile gloves m box 100',
    requireInName: ['Nitrile', 'Gloves'], relaxed: true },
  { family: 'M', input: 'mozzarella ball 125g box 12',
    requireInName: ['Mozzarella'], relaxed: true },
  { family: 'M', input: 'parmesan wheel piece 2kg',
    requireInName: ['Parmesan', 'Wheel'], relaxed: true },
  { family: 'M', input: 'ham sliced 500g',
    requireInName: ['Ham'], relaxed: true },

  // ─────────────── N) Maliciosos/estranhos ──────────────────
  { family: 'N', input: '<script>alert(1)</script> tomate 1kg',
    requireInName: ['Tomate'], riskOnFlag: 'P0',
    note: 'segurança: não pode crashar; React escapa' },
  { family: 'N', input: 'tomate "especial" 1kg',
    requireInName: ['Tomate'], riskOnFlag: 'P1' },
  { family: 'N', input: 'tomate; DROP TABLE articles; 1kg',
    requireInName: ['Tomate'], riskOnFlag: 'P0',
    note: 'segurança: SQL nunca chega à DB raw (Supabase usa prepared)' },
  { family: 'N', input: 'tomate & manjericão 1kg',
    requireInName: ['Tomate', 'Manjericão'], riskOnFlag: 'P1' },
  { family: 'N', input: 'tomate/manjericão 1kg',
    requireInName: ['Tomate'], riskOnFlag: 'P1',
    note: '"/" pode ser stripped' },
  { family: 'N', input: 'peixe (robalo) 1kg',
    requireInName: ['Peixe', 'Robalo'], riskOnFlag: 'P1' },
  { family: 'N', input: 'frango [peito] 5kg',
    requireInName: ['Frango'], riskOnFlag: 'P1' },
  { family: 'N', input: 'farinha_t55_25kg',
    requireInName: ['Farinha'], riskOnFlag: 'P1', note: '_ separadores' },
  { family: 'N', input: 'leite-1l-pack-6',
    requireInName: ['Leite'], riskOnFlag: 'P1', note: '- separadores' },
  { family: 'N', input: 'nata35%pacote1lcaixa6l',
    requireInName: ['Nata'], riskOnFlag: 'P1', note: 'tudo colado' },
  { family: 'N', input: 'saco vacuo 20*30 cx100',
    requireInName: ['Saco', 'Vacuo'], riskOnFlag: 'P1' },
  { family: 'N', input: 'saco vacuo 20 x 30 cx 100',
    requireInName: ['Saco', '20', '30'], note: 'separated dimensions' },
  { family: 'N', input: 'queijo mozzarella 125 g cx 12',
    forbidInName: ['cx'], requireInName: ['Mozzarella'], expectCategory: 'Lacticínios e Ovos' },
  { family: 'N', input: 'arroz agulha — saco 20kg',
    forbidInName: ['saco'], requireInName: ['Arroz', 'Agulha'], expectCategory: 'Mercearia' },

  // ──────────── O) Preservar nome a todo custo ──────────────
  { family: 'O', input: 'vinho do porto',
    requireInName: ['Vinho', 'Porto'], expectCategory: 'Bebidas', riskOnFlag: 'P0' },
  { family: 'O', input: 'queijo da ilha',
    requireInName: ['Queijo', 'Ilha'], expectCategory: 'Lacticínios e Ovos', riskOnFlag: 'P0' },
  { family: 'O', input: 'bola de berlim',
    requireInName: ['Bola', 'Berlim'], riskOnFlag: 'P0' },
  { family: 'O', input: 'folha de louro',
    requireInName: ['Louro'], riskOnFlag: 'P0' },
  { family: 'O', input: 'gelatina folha',
    requireInName: ['Gelatina', 'Folha'], expectCategory: 'Mercearia', riskOnFlag: 'P0' },
  { family: 'O', input: 'flor de sal',
    requireInName: ['Flor', 'Sal'], expectCategory: 'Mercearia', riskOnFlag: 'P0' },
  { family: 'O', input: 'café em grão',
    requireInName: ['Café'], expectCategory: 'Mercearia', riskOnFlag: 'P0' },
  { family: 'O', input: 'pimenta em grão',
    requireInName: ['Pimenta'], expectCategory: 'Mercearia', riskOnFlag: 'P0' },
  { family: 'O', input: 'tomate coração de boi',
    requireInName: ['Tomate', 'Coração'], expectCategory: 'Frutas e Legumes', riskOnFlag: 'P0' },
  { family: 'O', input: 'leite creme',
    requireInName: ['Leite', 'Creme'], expectCategory: 'Lacticínios e Ovos', riskOnFlag: 'P0' },
  { family: 'O', input: 'creme de leite',
    requireInName: ['Creme', 'Leite'], expectCategory: 'Lacticínios e Ovos', riskOnFlag: 'P0' },
  { family: 'O', input: 'massa folhada',
    requireInName: ['Massa', 'Folhada'], expectCategory: 'Mercearia', riskOnFlag: 'P0' },
  { family: 'O', input: 'massa fresca',
    requireInName: ['Massa', 'Fresca'], expectCategory: 'Mercearia', riskOnFlag: 'P0' },
  { family: 'O', input: 'pão de alho',
    requireInName: ['Pão', 'Alho'], riskOnFlag: 'P0' },
  { family: 'O', input: 'pão ralado',
    requireInName: ['Pão', 'Ralado'], expectCategory: 'Mercearia', riskOnFlag: 'P0' },
  { family: 'O', input: 'molho inglês',
    requireInName: ['Molho', 'Inglês'], expectCategory: 'Mercearia', riskOnFlag: 'P0' },
  { family: 'O', input: 'molho barbecue',
    requireInName: ['Molho', 'Barbecue'], expectCategory: 'Mercearia', riskOnFlag: 'P1' },
  { family: 'O', input: 'molho madeira',
    requireInName: ['Molho', 'Madeira'], expectCategory: 'Mercearia', riskOnFlag: 'P0',
    note: 'madeira é Bebidas keyword (vinho da Madeira) — risco' },
  { family: 'O', input: 'nata 35%',
    requireInName: ['Nata', '35%'], expectCategory: 'Lacticínios e Ovos', riskOnFlag: 'P0' },
  { family: 'O', input: 'farinha t55',
    requireInName: ['Farinha', 'T55'], expectCategory: 'Mercearia', riskOnFlag: 'P0' },
  { family: 'O', input: 'chocolate 70%',
    requireInName: ['Chocolate', '70%'], expectCategory: 'Mercearia', riskOnFlag: 'P0' },
]

// ── Execução ─────────────────────────────────────────────────────────────────

type Row = {
  family:     Family
  input:      string
  name:       string
  unit:       string
  intent:     string
  options:    string
  category:   string
  hint:       string
  warnings:   string
  flags:      string[]
  risk:       Risk
  note:       string
  confidence: ConfidenceLevel
}

function intentDesc(intent: ReturnType<typeof buildArticleDraft>['intent']): string {
  switch (intent.kind) {
    case 'PACKAGED_WEIGHT':
      return `PACKAGED_WEIGHT(${intent.orderUnit}, ${intent.basePerOrder}${
        intent.multipack ? `, mp=${intent.multipack.count}×${intent.multipack.perPack}` : ''
      })`
    case 'PACKAGED_VOLUME':
      return `PACKAGED_VOLUME(${intent.orderUnit}, ${intent.basePerOrder}${
        intent.multipack ? `, mp=${intent.multipack.count}×${intent.multipack.perPack}` : ''
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
  relaxed: boolean | undefined,
): Risk {
  if (flags.length === 0) return 'OK'
  if (flags.some(f => f.startsWith('CRASH'))) return 'P0'
  if (relaxed) {
    // Critério relaxado: só falhas categóricas reais (forbid violado, name falta, intent kind errado).
    const onlyCategoryFlag = flags.every(f => f.startsWith('category '))
    if (onlyCategoryFlag) return 'OK'
    return riskOnFlag ?? 'P2'
  }
  if (riskOnFlag) return riskOnFlag
  return flags.some(f => f.includes('contém')) ? 'P1' : 'P2'
}

const rows: Row[] = []

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
      // requireInName é OR-list quando todas as variantes são próximas (ex: "Sacos"|"Saco"
      // share root). Heurística simples: se NENHUMA aparece, falha; se uma aparece, passa.
      const anyMatch = probe.requireInName.some(r => nameNorm.includes(r.toLowerCase()))
      if (!anyMatch) {
        for (const r of probe.requireInName) flags.push(`name falta "${r}"`)
      }
    }
    if (probe.expectIntent && draft.intent.kind !== probe.expectIntent) {
      flags.push(`intent ${draft.intent.kind} ≠ ${probe.expectIntent}`)
    }
    if (probe.expectOptions != null && options.length !== probe.expectOptions) {
      flags.push(`options ${options.length} ≠ ${probe.expectOptions}`)
    }
    if (probe.expectCategory !== undefined && draft.category !== probe.expectCategory) {
      flags.push(`category "${draft.category}" ≠ "${probe.expectCategory ?? 'null'}"`)
    }

    const optsDesc = options.map(o => `${o.count_unit}/${o.base_per_unit}`).join(' | ')
    const hint     = draft.detected_label
      ? `${draft.detected_label}${draft.detected_qty ? ` ${draft.detected_qty}` : ''}${
          draft.detected_multipack ? ` (mp ${draft.detected_multipack.count}×${draft.detected_multipack.perPack})` : ''
        }`
      : (draft.detected_qty ? `qty ${draft.detected_qty}` : '')
    const warnings = draft.warnings.join(',') || ''

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
      risk:       classifyRisk(flags, probe.riskOnFlag, probe.relaxed),
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
  A: 'Ásia',
  B: 'México/LatAm',
  C: 'Itália/França/Espanha',
  D: 'Peixes calibres/formas',
  E: 'Carnes cortes/maturações',
  F: 'Legumes/frutas difíceis',
  G: 'Pastelaria hardcore',
  H: 'Bebidas/bar',
  I: 'Embalagens/descartáveis',
  J: 'Embalagens que parecem comida',
  K: 'Limpeza/operação',
  L: 'OCR/fornecedor sujo',
  M: 'Mistura de línguas',
  N: 'Maliciosos/estranhos',
  O: 'Preservar nome a todo custo',
}

const RISK_GLYPH: Record<Risk, string> = { OK: '✓', P2: '·', P1: '⚠', P0: '✗' }

const counts: Record<Risk, number> = { OK: 0, P2: 0, P1: 0, P0: 0 }
for (const r of rows) counts[r.risk]++

for (const family of ['N','O','I','J','K','L','A','B','C','D','E','F','G','H','M'] as const) {
  const fam = rows.filter(r => r.family === family)
  if (fam.length === 0) continue
  console.log(`\n━━━━ Família ${family} — ${FAMILY_NAMES[family]} (${fam.length}) ━━━━`)
  for (const r of fam) {
    console.log(`${RISK_GLYPH[r.risk]} [${r.risk}] "${r.input}"`)
    console.log(`   nome:     ${r.name}`)
    console.log(`   unit:     ${r.unit}`)
    console.log(`   intent:   ${r.intent}`)
    console.log(`   options:  ${r.options}`)
    console.log(`   category: ${r.category}`)
    if (r.hint)     console.log(`   hint:     ${r.hint}`)
    if (r.warnings) console.log(`   warnings: ${r.warnings}`)
    if (r.note)     console.log(`   nota:     ${r.note}`)
    if (r.flags.length > 0) {
      for (const f of r.flags) console.log(`   ⚠ ${f}`)
    }
  }
}

console.log(`\n────── Resumo R-TEST 3 Hardcore ──────`)
console.log(`Total casos: ${rows.length}`)
console.log(`OK: ${counts.OK} · P2: ${counts.P2} · P1: ${counts.P1} · P0: ${counts.P0}`)

// Top failures
const failures = rows.filter(r => r.risk === 'P0' || r.risk === 'P1')
if (failures.length > 0) {
  console.log(`\n────── Top falhas (P0/P1) ──────`)
  for (const r of failures) {
    console.log(`${RISK_GLYPH[r.risk]} [${r.family}/${r.risk}] "${r.input}"`)
    console.log(`   → "${r.name}" / ${r.category}`)
    for (const f of r.flags) console.log(`   • ${f}`)
  }
}

// ── Histograma de confiança + gate de calibração ───────────────────────────
// Métrica de saúde da camada de confiança (articleConfidence.ts). Os limites
// abaixo são guardrail: se medium/low explodem, o pill vira ruído e o chef
// ignora — calibração > cobertura. Hardcore tem density alta de inputs
// adversariais por design, por isso o limite de LOW é mais largo aqui (≤ 30%).
const confCounts: Record<ConfidenceLevel, number> = { high: 0, medium: 0, low: 0 }
for (const r of rows) confCounts[r.confidence]++
const total = rows.length || 1
const pct   = (n: number) => ((n / total) * 100).toFixed(1)

console.log(`\n────── Histograma de confiança ──────`)
console.log(`high:   ${pct(confCounts.high)}%  (${confCounts.high}/${total})`)
console.log(`medium: ${pct(confCounts.medium)}%  (${confCounts.medium}/${total})`)
console.log(`low:    ${pct(confCounts.low)}%  (${confCounts.low}/${total})`)

const highPct = (confCounts.high   / total) * 100
const lowPct  = (confCounts.low    / total) * 100
const gateHigh = highPct >= 50
const gateLow  = lowPct  <= 30
const gatePass = gateHigh && gateLow
console.log(`\nGate de calibração (hardcore): ${gatePass ? 'PASS' : 'FAIL'}`)
console.log(`  high ≥ 50%:  ${gateHigh ? 'PASS' : 'FAIL'}  (${highPct.toFixed(1)}%)`)
console.log(`  low  ≤ 30%:  ${gateLow  ? 'PASS' : 'FAIL'}  (${lowPct.toFixed(1)}%)`)

// Hardcore é exploratório por design (P0/P1 conhecidos). Saída sempre 0 — o
// gate só é informativo aqui. Os scripts mais "limpos" (chaos, battery) são
// que carregam o gate como condição de merge.
process.exit(0)

/**
 * Sistema de sugestão de categoria e unidade base.
 *
 * Categorias: Carnes | Peixe e Marisco | Frutas e Legumes |
 *             Lacticínios e Ovos | Mercearia | Bebidas |
 *             Embalagens e Descartáveis
 *
 * "Congelado", "fresco" e "refrigerado" não são categorias — são adjetivos
 * que distinguem produtos operacionalmente diferentes (ex: "Perna de Frango
 * Congelada" ≠ "Perna de Frango Fresca"). Ficam no nome; a categoria é
 * decidida pelo ingrediente base.
 *
 * Prioridade de correspondência:
 *   1. Bebidas (keywords específicas) — antes de container words para evitar
 *      "Cerveja em lata" → Mercearia
 *   2. Container words (lata, conserva, pelado, frasco…) → Mercearia
 *   3. Keywords de ingrediente (Carnes, Peixe, Frutas, Lacticínios, Mercearia, Embalagens)
 *   4. Fallback por unidade líquida (mL) → Bebidas, confident=false
 *   5. null, confident=false
 */

// ── Container/formato: indica produto processado → Mercearia ─────────────────
// Não inclui saco/caixa/pacote/embalagem (neutros para categoria)

const CONTAINER_WORDS = [
  'lata', 'latas',
  'frasco', 'frascos',
  'conserva', 'conservas',
  'enlatado', 'enlatada', 'enlatados', 'enlatadas',
  'pelado', 'pelada', 'pelados', 'peladas',
  'bisnaga',
]

// ── Override de Mercearia para palavras dominantes ───────────────────────────
// Allowlist mínima validada caso a caso. NÃO transformar em "first-word global"
// sem antes enumerar regressões — keywords como 'pimenta'/'galinha' têm
// significado válido noutras categorias (Hortelã Pimenta → F&L, Galinha → Carnes).
//
// Resolve:
//   "Mel Rosmaninho"          (rosmaninho está em F&L, mas mel domina)
//   "Caldo Galinha em Pó"     (galinha está em Carnes, mas caldo domina)
//   "Chocolate Negro Callets" ('choco' substring colide com Peixe e Marisco)
//
// Uso de \b para evitar falsos positivos: "Camembert"/"Caramelo"/"Vermelho"
// contêm "mel" como substring mas \bmel\b não casa por estar dentro de palavra.
const STRONG_MERCEARIA_RE = /\b(mel|caldo|chocolate|callets)\b/i

// ── Ingrediente base ──────────────────────────────────────────────────────────

const INGREDIENT_KEYWORDS: Array<{ words: string[]; category: string }> = [
  {
    category: 'Bebidas',
    words: [
      'água', 'agua', 'sumo', 'néctar', 'nectar', 'refrigerante',
      'cerveja', 'vinho', 'vinho tinto', 'vinho branco', 'vinho verde',
      'espumante', 'prosecco', 'cava', 'champagne', 'champanhe',
      'licor', 'aguardente', 'brandy', 'cognac', 'whisky', 'whiskey',
      'bourbon', 'gin', 'vodka', 'rum', 'tequila', 'cachaça',
      'porto', 'madeira', 'moscatel', 'jerez', 'sangria',
      'tónica', 'tonica', 'soda', 'coca-cola', 'coca cola', 'pepsi',
      'laranjada', 'limonada', 'ice tea', 'kombucha', 'kefir de água',
      'leite de coco', 'bebida vegetal', 'bebida de aveia', 'bebida de soja',
    ],
  },
  {
    category: 'Carnes',
    words: [
      // Bovino
      'vaca', 'novilho', 'vitela', 'bife', 'bifes', 'entrecosto', 'costeleta',
      'lombo', 'lombinho', 'pojadouro', 'alcatra', 'chambão', 'rabadilha',
      'ossobuco', 'músculo', 'cachaço', 'carne picada', 'hamburguer',
      // Suíno
      'porco', 'leitão', 'presunto', 'bacon', 'pancetta', 'chouriço',
      'linguiça', 'morcela', 'farinheira', 'salsicha', 'salpicão',
      'paio', 'pá de porco', 'pernil', 'entrecosto de porco',
      // Borrego / Cabrito
      'borrego', 'cordeiro', 'cabrito', 'cabra',
      // Aves
      'frango', 'peru', 'pato', 'codorniz', 'faisão', 'pombo', 'galinha',
      'peito de frango', 'coxa de frango', 'asa de frango', 'coelho',
      // Caça
      'veado', 'javali', 'perdiz', 'lebre',
      // Miudezas
      'fígado', 'rim', 'coração', 'língua', 'tripas', 'miolos', 'rabo',
      'tutano', 'pata', 'chispe',
      // Enchidos genérico (sem 'fumado' — palavra ambígua que afeta Salmão fumado etc.)
      'enchido', 'charcutaria',
    ],
  },
  {
    category: 'Peixe e Marisco',
    words: [
      // Peixe
      'bacalhau', 'salmão', 'salmon', 'dourada', 'robalo', 'pregado',
      'solha', 'linguado', 'sardinha', 'carapau', 'corvina', 'atum',
      'espadarte', 'peixe-espada', 'ruivo', 'salmonete', 'garoupa',
      'faneca', 'pargo', 'cherne', 'tamboril', 'raia', 'skrei',
      'truta', 'enguia', 'lampreia', 'anchova', 'arenque',
      // Marisco
      'camarão', 'gambas', 'lagosta', 'lavagante', 'sapateira',
      'caranguejo', 'santola', 'navalheira', 'percebes',
      // Moluscos
      'lula', 'choco', 'polvo', 'amêijoa', 'mexilhão', 'berbigão',
      'longueirão', 'ostra', 'ostras', 'vieira', 'búzio',
      // Genérico
      'peixe', 'marisco', 'mariscos', 'crustáceo',
    ],
  },
  {
    category: 'Frutas e Legumes',
    words: [
      // Legumes / vegetais
      'tomate', 'cebola', 'alho', 'pimento', 'cenoura', 'batata',
      'batata-doce', 'couve', 'brócolos', 'espinafres', 'espinafre',
      'alface', 'rúcula', 'rucula', 'pepino', 'beringela', 'ervilha',
      'ervilhas', 'feijão verde', 'cogumelo', 'cogumelos', 'champignon',
      'portobello', 'shiitake', 'curgete', 'courgette', 'nabo', 'aipo',
      'alho-francês', 'alho francês', 'funcho', 'agrião', 'rabanete',
      'beterraba', 'abóbora', 'milho', 'couve-flor', 'couve flor',
      'repolho', 'pak choi', 'alcachofra', 'espargo', 'espargos',
      'chicória', 'endívia', 'acelga', 'grão-de-bico', 'salsify',
      'topinambur', 'nori', 'alga', 'algas', 'trufas', 'trufa',
      'erva', 'ervas', 'salsa', 'coentros', 'coentro', 'manjericão',
      'manjericao', 'tomilho', 'rosmaninho', 'louro', 'estragão',
      'cebolinho', 'hortelã', 'hortelã-pimenta', 'oregãos', 'oregaos',
      'segurelha', 'lúcio', 'lúcia-lima',
      // Frutas
      'maçã', 'maca', 'pera', 'banana', 'laranja', 'limão', 'limao',
      'lima', 'toranja', 'pomelo', 'clementina', 'tangerina', 'mandarina',
      'morango', 'morangos', 'framboesa', 'mirtilo', 'amora',
      'groselha', 'manga', 'ananás', 'ananas', 'uva', 'uvas',
      'melão', 'melancia', 'kiwi', 'abacaxi', 'papaia', 'pêssego',
      'pessego', 'nectarina', 'ameixa', 'cereja', 'figo', 'romã',
      'maracujá', 'coco', 'abacate', 'dióspiro', 'marmelo', 'nêspera',
      'lichia', 'rambutan', 'pitaia', 'fruta da paixão',
    ],
  },
  {
    category: 'Lacticínios e Ovos',
    words: [
      // Lacticínios
      'leite', 'nata', 'natas', 'manteiga', 'queijo', 'iogurte', 'iogurte grego',
      'requeijão', 'mozzarella', 'mozarela', 'burrata', 'brie',
      'camembert', 'parmesão', 'parmesan', 'parmigiano', 'ricotta',
      'mascarpone', 'creme fraiche', 'crème fraîche', 'gorgonzola',
      'emmental', 'gruyère', 'gruyere', 'cheddar', 'gouda', 'edam',
      'roquefort', 'stilton', 'manchego', 'pecorino', 'provolone',
      'halloumi', 'feta', 'cottage', 'kefir', 'buttermilk',
      'soro de leite', 'whey', 'creme de leite',
      'creme culinário', 'creme culinario',
      // Ovos
      'ovo', 'ovos', 'clara', 'gema',
    ],
  },
  {
    category: 'Mercearia',
    words: [
      // Farinhas e amidos
      'farinha', 'amido', 'fécula', 'maizena', 'polvilho', 'sêmola',
      'semola', 'polenta', 'tapioca', 'farelo', 'pão ralado', 'pao ralado',
      // Cereais e massas
      'arroz', 'massa', 'esparguete', 'spaghetti', 'penne', 'fusilli',
      'lasanha', 'tagliatelle', 'rigatoni', 'macarrão', 'orzo', 'cuscuz',
      'bulgur', 'quinoa', 'aveia', 'millet', 'espelta', 'trigo',
      // Leguminosas
      'feijão', 'grão', 'lentilha', 'lentilhas', 'ervilha seca',
      'fava', 'favas', 'soja', 'edamame',
      // Açúcares e adoçantes
      'açúcar', 'acucar', 'mel', 'melaço', 'melaco', 'xarope',
      'agave', 'stevia', 'mascavado', 'demerara', 'glaçúcar', 'glucose',
      'frutose', 'lactose', 'dextrose',
      // Óleos e gorduras
      'azeite', 'óleo', 'oleo', 'banha', 'margarina', 'ghee',
      // Vinagres e acidificantes
      'vinagre', 'sumo de limão', 'ácido cítrico',
      // Molhos e condimentos
      'ketchup', 'maionese', 'mostarda', 'molho', 'tabasco', 'sriracha',
      'worcestershire', 'miso', 'tahini', 'harissa', 'pesto',
      'concentrado de tomate', 'passata', 'polpa de tomate',
      // Conservas e enlatados (keywords de produto, não de formato)
      'anchova em lata', 'atum em lata',
      // Especiarias e sal
      'sal', 'flor de sal', 'pimenta', 'paprika', 'cominhos', 'curcuma',
      'cúrcuma', 'canela', 'noz-moscada', 'noz moscada', 'cardamomo',
      'cravinho', 'anis', 'feno-grego', 'za\'atar',
      'ras el hanout', 'curry', 'garam masala', 'açafrão', 'acafrao',
      'baunilha', 'gengibre', 'alho em pó', 'alho em po', 'cebola em pó',
      'piri-piri', 'malagueta', 'cayenne', 'fumaça líquida',
      // Fermentos e leveduras
      'fermento', 'levedura', 'bicarbonato', 'cremor tártaro',
      // Gelatinas e espessantes
      'gelatina', 'agar', 'agar-agar', 'pectina', 'carragenina',
      'xantana', 'lecitina', 'metilcelulose',
      // Padaria e pastelaria
      'pão', 'pao', 'broa', 'brioche', 'croissant', 'baguette', 'baguete',
      'ciabatta', 'focaccia', 'tortilla', 'wrap', 'pita', 'naan',
      'bolacha', 'biscoito', 'crackers',
      // Frutos secos e sementes
      'amêndoa', 'amendoa', 'noz', 'nozes', 'avelã', 'avela',
      'pistáchio', 'pistachio', 'pinhão', 'pinhao', 'castanha',
      'cajú', 'caju', 'amendoim', 'sésamo', 'sesamo', 'linhaça',
      'chia', 'girassol', 'abóbora semente', 'cânhamo',
      // Chocolate e cacau
      'chocolate', 'cacau', 'cacao', 'massa de cacau', 'manteiga de cacau',
      // Café e chá
      'café', 'cafe', 'chá', 'cha', 'matcha', 'rooibos',
      // Outros mercearia
      'caldo', 'stock', 'extrato', 'extracto', 'dashi', 'kombu',
    ],
  },
  {
    category: 'Embalagens e Descartáveis',
    words: [
      'papel', 'película', 'película aderente', 'alumínio', 'foil',
      'manga pasteleiro', 'manga pasteleira', 'luvas', 'luva',
      'touca', 'toucas', 'avental', 'aventais', 'guardanapo', 'guardanapos',
      'palito', 'palitos', 'espeto', 'espetos', 'copos descartáveis',
      'pratos descartáveis', 'talheres descartáveis', 'cuvete', 'cuvetes',
      'marmita', 'marmitas', 'take away', 'takeaway', 'delivery',
      'vácuo', 'vacuum', 'sous vide', 'termómetro', 'papel vegetal',
      'papel manteiga', 'papel de forno', 'cartão', 'etiqueta', 'etiquetas',
      'rótulo', 'rótulos', 'fita', 'clips', 'elástico', 'fio de cozinha',
    ],
  },
]

// ── Lista canónica de categorias ─────────────────────────────────────────────

export const ARTICLE_CATEGORIES = [
  'Carnes',
  'Peixe e Marisco',
  'Frutas e Legumes',
  'Lacticínios e Ovos',
  'Mercearia',
  'Bebidas',
  'Embalagens e Descartáveis',
] as const

// ── Normalização canónica ────────────────────────────────────────────────────
// Mapeia categorias legadas (singulares ou subdivididas) para a canónica.
// SSOT de mapeamento — adicionar aqui qualquer nova alias antiga em vez de
// inferir lowercase/fuzzy. Inputs desconhecidos retornam null para que o UI
// caia em "Sem categoria" — sujidade fica visível em vez de ser disfarçada.
const LEGACY_CATEGORY_MAP: Record<string, string> = {
  'Peixe':       'Peixe e Marisco',
  'Legumes':     'Frutas e Legumes',
  'Frutas':      'Frutas e Legumes',
  'Lacticínios': 'Lacticínios e Ovos',
  'Ovos':        'Lacticínios e Ovos',
  'Conservas':   'Mercearia',
  'Especiarias': 'Mercearia',
  'Enchidos':    'Carnes',
}

export function normalizeCanonicalCategory(raw: string | null | undefined): string | null {
  if (!raw) return null
  if ((ARTICLE_CATEGORIES as readonly string[]).includes(raw)) return raw
  return LEGACY_CATEGORY_MAP[raw] ?? null
}

// ── Tipo de resultado ─────────────────────────────────────────────────────────

export type CategoryResult = {
  category: string | null
  confident: boolean
  reason?: string
}

// Comparação accent-insensitive: a lista de keywords mantém-se com acentos
// (display intacto), mas o matching ignora diacríticos para apanhar inputs do
// chef sem acento ("feijao seco" → "feijão", "brocolos" → "brócolos").
function stripDiacritics(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
}

/**
 * Match com word-boundary e tolerância a plurais simples (s/es).
 * `text` deve já estar lowercase + stripDiacritics. `keyword` é normalizada
 * dentro da função (não exige preprocessamento do caller).
 *
 * Resolve falsos positivos por substring:
 *   "cogumelos portobello" + keyword "porto" → não casa (lookahead falha)
 *   "vinho do porto" + keyword "porto"        → casa (fim de string)
 *   "peras rocha" + keyword "pera"            → casa (s/es opcional)
 *   "perar" + keyword "pera"                  → não casa (sem boundary)
 *
 * Multi-palavra suportado (ex: "vinho do porto", "alho-francês") — o regex
 * trata espaços e hífens como literais.
 */
function containsWord(text: string, keyword: string): boolean {
  const k       = stripDiacritics(keyword.toLowerCase())
  const escaped = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?:^|\\W)${escaped}(?:s|es)?(?=\\W|$)`, 'i').test(text)
}

// ── Priority phrases ──────────────────────────────────────────────────────────
// Produtos compostos cujo nome contém uma palavra que pertence legitimamente
// a outra categoria. "Tomate coração de boi" tem "coração" (Carnes); "Atum
// lombo" tem "lombo" (Carnes); mas o produto composto é unambíguo e pertence
// a F&L / Peixe respetivamente. São avaliados ANTES do shortcut Bebidas e do
// loop INGREDIENT_KEYWORDS para vencer naturalmente sem alterar a ordem
// global das categorias.
const PRIORITY_KEYWORDS: Array<{ phrase: string; category: string }> = [
  { phrase: 'tomate coração de boi', category: 'Frutas e Legumes' },
  { phrase: 'coração de boi',        category: 'Frutas e Legumes' },
  { phrase: 'atum lombo',            category: 'Peixe e Marisco' },
  { phrase: 'lombo de atum',         category: 'Peixe e Marisco' },
  // R-PATCH 2: 'madeira' é Bebidas keyword (vinho da Madeira); 'ostra'/'peixe'
  // são Peixe e Marisco. Para os compostos "Molho X" o produto vive
  // operacionalmente na despensa (Mercearia), não na categoria do ingrediente
  // base. Sem estas entradas o loop INGREDIENT_KEYWORDS capturava o nome.
  { phrase: 'molho madeira',         category: 'Mercearia' },
  { phrase: 'molho ostra',           category: 'Mercearia' },
  { phrase: 'molho peixe',           category: 'Mercearia' },
]

// ── suggestCategory ───────────────────────────────────────────────────────────

export function suggestCategory(ctx: {
  name: string
  unit?: string
  label?: string
  raw?: string
}): CategoryResult {
  const { name, unit, label, raw } = ctx
  const lower    = stripDiacritics(name.toLowerCase())
  const lowerRaw = stripDiacritics((raw ?? name).toLowerCase())

  // 1. Priority phrases — produtos compostos com palavra ambígua de outra
  //    categoria ("tomate coração de boi", "atum lombo"). Avaliado antes do
  //    shortcut Bebidas para garantir que palavras como 'lombo'/'coração'
  //    não decidem mal pelo loop genérico.
  for (const p of PRIORITY_KEYWORDS) {
    if (containsWord(lowerRaw, p.phrase) || containsWord(lower, p.phrase)) {
      return { category: p.category, confident: true, reason: 'priority-phrase' }
    }
  }

  // 2. Bebidas por keyword de ingrediente (antes de container words para não
  //    reclassificar "Cerveja em lata" como Mercearia)
  const bebidasGroup = INGREDIENT_KEYWORDS.find(g => g.category === 'Bebidas')!
  if (bebidasGroup.words.some(w => containsWord(lower, w))) {
    return { category: 'Bebidas', confident: true, reason: 'ingredient-keyword' }
  }

  // 3. Container words → Mercearia (lata, conserva, pelado, frasco…)
  const lowerLabel = stripDiacritics((label ?? '').toLowerCase())
  if (CONTAINER_WORDS.some(w => containsWord(lowerRaw, w) || lowerLabel === stripDiacritics(w))) {
    return { category: 'Mercearia', confident: true, reason: 'container-format' }
  }

  // 3.5 Strong-Mercearia override (allowlist) — domina sobre o loop seguinte.
  // STRONG_MERCEARIA_RE só contém palavras sem acentos, mas testamos contra
  // input já normalizado por consistência.
  if (STRONG_MERCEARIA_RE.test(lower) || STRONG_MERCEARIA_RE.test(lowerRaw)) {
    return { category: 'Mercearia', confident: true, reason: 'strong-mercearia' }
  }

  // 4. Keywords de ingrediente (todos os grupos excepto Bebidas, já verificado)
  for (const group of INGREDIENT_KEYWORDS) {
    if (group.category === 'Bebidas') continue
    if (group.words.some(w => containsWord(lower, w))) {
      return { category: group.category, confident: true, reason: 'ingredient-keyword' }
    }
  }

  // 5. Fallback por unidade líquida
  if (unit) {
    const u = unit.toLowerCase()
    if (['l', 'cl', 'dl', 'ml'].includes(u)) {
      return { category: 'Bebidas', confident: false, reason: 'unit-fallback' }
    }
  }

  return { category: null, confident: false }
}

// ── suggestUnit ───────────────────────────────────────────────────────────────

const UNIT_ML_WORDS = [
  'leite', 'nata', 'natas', 'creme de leite', 'kefir', 'buttermilk',
  'sumo', 'néctar', 'nectar', 'água', 'agua', 'refrigerante',
  'cerveja', 'vinho', 'espumante', 'prosecco', 'champagne', 'champanhe',
  'licor', 'aguardente', 'brandy', 'cognac', 'whisky', 'whiskey',
  'bourbon', 'gin', 'vodka', 'rum', 'tequila', 'cachaça',
  'porto', 'moscatel', 'sangria', 'tónica', 'tonica', 'soda',
  'laranjada', 'limonada', 'kombucha',
  'azeite', 'óleo', 'oleo', 'vinagre', 'caldo', 'stock',
  'molho soja', 'tabasco', 'sriracha', 'worcestershire',
  'extrato', 'extracto', 'fumaça líquida',
]

const UNIT_UN_WORDS = [
  'ovo', 'ovos', 'clara', 'gema',
  'pão', 'pao', 'broa', 'brioche', 'croissant', 'baguette', 'baguete',
  'laranja', 'limão', 'limao', 'lima', 'toranja', 'pomelo',
  'clementina', 'tangerina', 'mandarina', 'maçã', 'maca', 'pera',
  'banana', 'kiwi', 'manga', 'abacate', 'coco', 'romã', 'maracujá',
  'dióspiro', 'marmelo', 'nêspera', 'pêssego', 'pessego',
  'nectarina', 'ameixa', 'figo',
  'trufa', 'trufas',
  'dose', 'porção',
]

export function suggestUnit(name: string): 'g' | 'mL' | 'un' | null {
  const lower = name.toLowerCase()
  if (UNIT_ML_WORDS.some(w => lower.includes(w))) return 'mL'
  if (UNIT_UN_WORDS.some(w => lower.includes(w))) return 'un'
  if (lower.trim().length > 0) return 'g'
  return null
}

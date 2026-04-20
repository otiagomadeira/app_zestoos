/**
 * Sistema de sugestão de categoria baseado em palavras-chave.
 *
 * Lógica em duas camadas:
 *   1. Override forte: palavras de formato/conservação (lata, congelado, etc.)
 *      ganham sempre, independentemente do ingrediente.
 *   2. Ingrediente base: se não houver override, identifica pela palavra do produto.
 *
 * Nota: "saco", "pacote" e "embalagem" são neutros — não determinam categoria,
 * porque rúcula também vem em saco mas é Legume, não Seco.
 */

// ── Overrides fortes ──────────────────────────────────────────────────────────
// Palavra encontrada no nome → categoria, independentemente do ingrediente

const FORMAT_OVERRIDES: Array<{ words: string[]; category: string }> = [
  {
    words: ['lata', 'enlatado', 'enlatada', 'pelado', 'pelada', 'conserva', 'conservas', 'frasco'],
    category: 'Conservas',
  },
  {
    words: ['congelado', 'congelada', 'congelados', 'congeladas', 'iqf'],
    category: 'Congelados',
  },
]

// ── Ingrediente base ──────────────────────────────────────────────────────────
// Ordem importa: mais específico primeiro

const INGREDIENT_KEYWORDS: Array<{ words: string[]; category: string }> = [
  {
    words: [
      'frango', 'peru', 'pato', 'codorniz', 'carne', 'vitela', 'borrego', 'cordeiro',
      'porco', 'vaca', 'novilho', 'entrecosto', 'costeleta', 'lombo', 'lombinho',
      'presunto', 'bacon', 'pancetta', 'chouriço', 'linguiça', 'morcela', 'salsicha',
      'hamburguer', 'almôndega', 'picada', 'bifes', 'peito', 'coxa', 'asa',
      'perna', 'rabo', 'tripas', 'fígado', 'rim', 'coração', 'língua',
    ],
    category: 'Carnes',
  },
  {
    words: [
      'peixe', 'atum', 'salmão', 'bacalhau', 'dourada', 'robalo', 'pregado',
      'solha', 'linguado', 'sardinha', 'sardinhas', 'carapau', 'corvina',
      'camarão', 'gambas', 'lagosta', 'lavagante', 'sapateira', 'caranguejo',
      'lula', 'choco', 'polvo', 'amêijoa', 'mexilhão', 'berbigão', 'ostras',
      'mariscos', 'marisco',
    ],
    category: 'Peixes e Mariscos',
  },
  {
    words: [
      'leite', 'natas', 'manteiga', 'queijo', 'iogurte', 'requeijão',
      'mozzarella', 'mozarela', 'brie', 'camembert', 'parmesão', 'parmesan',
      'ricotta', 'mascarpone', 'creme fraîche', 'crème fraîche',
      'gorgonzola', 'emmental', 'gruyère', 'cheddar',
    ],
    category: 'Lacticínios',
  },
  {
    words: [
      'ovo', 'ovos',
    ],
    category: 'Ovos',
  },
  {
    words: [
      'tomate', 'cebola', 'alho', 'pimento', 'cenoura', 'batata', 'couve',
      'brócolos', 'brocolis', 'espinafres', 'espinafre', 'alface', 'rúcula',
      'rucula', 'pepino', 'abobrinha', 'beringela', 'ervilhas', 'ervilha',
      'feijão verde', 'cogumelos', 'cogumelo', 'champignon', 'curgete',
      'courgette', 'nabo', 'aipo', 'alho-francês', 'alho francês', 'funcho',
      'agrião', 'rabanete', 'beterraba', 'abóbora', 'milho', 'couve-flor',
      'couve flor', 'repolho', 'pak choi', 'alcachofra', 'espargos',
    ],
    category: 'Legumes',
  },
  {
    words: [
      'maçã', 'maca', 'pera', 'banana', 'laranja', 'limão', 'limao',
      'morango', 'morangos', 'framboesa', 'mirtilo', 'manga', 'ananás',
      'ananas', 'uva', 'uvas', 'melão', 'melon', 'melancia', 'kiwi',
      'abacaxi', 'papaia', 'pêssego', 'pessego', 'ameixa', 'cereja',
      'figo', 'romã', 'maracujá', 'coco', 'abacate',
    ],
    category: 'Frutas',
  },
  {
    words: [
      'farinha', 'arroz', 'massa', 'esparguete', 'spaghetti', 'penne',
      'fusilli', 'lasanha', 'feijão', 'grão', 'lentilhas', 'lentilha',
      'quinoa', 'cuscuz', 'bulgur', 'aveia', 'açúcar', 'acucar',
      'sal', 'bicarbonato', 'amido', 'pão ralado', 'pao ralado',
      'sêmola', 'semola', 'polenta', 'tapioca', 'maizena',
    ],
    category: 'Secos',
  },
  {
    words: [
      'pão', 'pao', 'broa', 'brioche', 'croissant', 'baguette', 'baguete',
      'ciabatta', 'focaccia', 'tortilla', 'wrap', 'pita', 'naan',
      'bolo', 'tarte', 'pastel', 'queque', 'muffin',
    ],
    category: 'Padaria',
  },
  {
    words: [
      'azeite', 'óleo', 'oleo', 'vinagre', 'molho', 'ketchup',
      'maionese', 'mostarda', 'soja', 'tabasco', 'sriracha', 'worcestershire',
      'pimenta', 'paprika', 'cominhos', 'orégãos', 'oregaos', 'tomilho',
      'rosmaninho', 'louro', 'manjericão', 'manjericao', 'coentros', 'coentro',
      'salsa', 'açafrão', 'acafrao', 'curcuma', 'cúrcuma', 'canela',
      'noz-moscada', 'noz moscada', 'baunilha', 'ervas', 'especiarias',
      'flor de sal', 'alho em pó', 'alho em po',
    ],
    category: 'Condimentos',
  },
  {
    words: [
      'água', 'agua', 'sumo', 'refrigerante', 'cerveja', 'vinho', 'espumante',
      'prosecco', 'cava', 'champagne', 'licor', 'whisky', 'gin', 'vodka',
      'rum', 'tónica', 'tonica', 'coca-cola', 'coca cola', 'laranjada',
      'limonada', 'ice tea', 'chá', 'cha', 'café', 'cafe', 'kombucha',
    ],
    category: 'Bebidas',
  },
]

// ── Função principal ──────────────────────────────────────────────────────────

/**
 * Sugere uma categoria com base no nome do produto e unidade.
 * Retorna null se não houver sugestão confiante.
 *
 * Camada 1 — override de formato (lata/frasco → Conservas, congelado → Congelados)
 * Camada 2 — palavras do ingrediente
 * Camada 3 — unidade (L/cl/dl sem alimento identificado → Bebidas)
 */
export function suggestCategory(name: string, unit?: string): string | null {
  const lower = name.toLowerCase()

  // Camada 1: overrides de formato
  for (const override of FORMAT_OVERRIDES) {
    if (override.words.some(w => lower.includes(w))) {
      return override.category
    }
  }

  // Camada 2: ingrediente base
  for (const group of INGREDIENT_KEYWORDS) {
    if (group.words.some(w => lower.includes(w))) {
      return group.category
    }
  }

  // Camada 3: unidade de volume sem alimento identificado → Bebidas
  if (unit) {
    const u = unit.toLowerCase()
    if (['l', 'cl', 'dl', 'ml'].includes(u)) {
      return 'Bebidas'
    }
  }

  return null
}

# Article Intent — Iteração 1

Data: 2026-04-27
Scope: Artigos (criação manual e edição). Sem schema novo.

## Problema

O formulário de criação de artigo trata o stock mínimo de forma instável:

- Para `unit='g'` ou `unit='mL'` sem packaging detetado, o input do par_level é
  feito em `g` / `mL`. Para "frango 10kg" o chef escreveria `5000` em vez de `5`.
- Quando há fornecedor, o par_level passa a estar em `order_unit` do
  fornecedor preferido (com fallback para qualquer link). Trocar/apagar
  fornecedor muda silenciosamente a unidade visual do par_level — e o número.
- Em edição, o `parsedSeed` (estado de UI) já não existe; a unidade visual
  do par_level pode mudar entre criação e edição do mesmo artigo.
- `article_sizes` já são gravados em criação (`createArticleSizeIfMissing`)
  mas o `ArticleForm` nunca os lê de volta — dado correto, sub-utilizado.

## Decisão

1. Introduzir um **campo derivado `intent`** em `ArticleDraft` (sem mudanças
   de schema, sem nova tabela, sem persistência adicional). É um discriminador
   puro:

   ```ts
   type ArticleIntent =
     | { kind: 'COUNTABLE_UNIT' }
     | { kind: 'WEIGHT_LOOSE' }
     | { kind: 'VOLUME' }
     | { kind: 'PACKAGED_WEIGHT';   orderUnit: string; basePerOrder: number }
     | { kind: 'PACKAGED_VOLUME';   orderUnit: string; basePerOrder: number }
     | { kind: 'COUNTABLE_PACKAGED'; orderUnit: string; perPack: number }
   ```

   `intent` é derivado dos campos já produzidos por `classifyLine` /
   `buildArticleDraft`. Não altera output existente. Helper `inferIntent`
   no mesmo módulo.

2. **`ArticleForm` usa `intent`** (e não `parPreferredLink/parFallbackLink`)
   para decidir a unidade visual do par_level:

   - WEIGHT_LOOSE → input em `kg` (factor 1000), guarda em `g`.
   - VOLUME → input em `L` (factor 1000), guarda em `mL`.
   - PACKAGED_WEIGHT / PACKAGED_VOLUME / COUNTABLE_PACKAGED → input no
     `orderUnit` (caixa, saco, frasco), guarda em base_unit.
   - COUNTABLE_UNIT → input em `un`.

3. **`ArticleForm` carrega `article_sizes`** ao abrir um artigo em edição.
   Se existir um size, é a fonte estável da unidade visual do par_level
   (label + base_per_unit). Sobrepõe-se ao supplier link como fonte. Permite
   que "frango caixa 10kg" mostre `5 caixa` em criação **e** em edição.

4. **Dissociar par_level display do fornecedor.** Adicionar/trocar/remover
   um fornecedor não muda mais a unidade visual do par_level. O fornecedor
   só passa a ser fonte de unidade visual quando **não há** intent claro
   nem `article_sizes` — preserva o comportamento existente para artigos
   antigos sem packaging.

## Não-objetivos

- Não tratar "Black Angus Vazia 5kg" (palavra desconhecida entre nome e
  peso). Iteração 2.
- Não criar coluna nova em `articles` para min_stock_unit. `article_sizes`
  já existe e serve este caso.
- Não tocar em `BulkImportPanel`. `parseProductLines` continua igual; só
  consome o novo campo se for útil.
- Não mexer em `classifyLine` (é estável e tem regressões cobertas).
- Não migrar artigos antigos. Sem `intent` claro, comportamento inalterado.

## Plano mínimo

1. **`src/lib/articleDraft.ts`**
   - Exportar `ArticleIntent` (tagged union acima).
   - Acrescentar `intent: ArticleIntent` ao `ArticleDraft`.
   - `inferIntent(...)` puro, derivado dos campos existentes.

2. **`src/lib/articles.ts`** (novo, segue regra "não usar `supabase.ts`
   para novas funções"):
   - `fetchArticleSizes(articleId): Promise<ArticleSize[]>` — client side,
     RLS-isolated (nenhum `organization_id` passado).

3. **`src/components/articles/ArticleForm.tsx`**
   - Carregar `article_sizes` no `useEffect` existente para `existing`.
   - Derivar `parDisplay` a partir de:
     1. `article_sizes` em edição (se existir, usar primeiro/preferido)
     2. `intent` (PACKAGED_*, COUNTABLE_PACKAGED, WEIGHT_LOOSE, VOLUME)
     3. `unit` (fallback: g/mL/un)
   - **Remover dependência** dos `parPreferredLink/parFallbackLink` para
     escolher unidade visual do par_level (mantê-los como fallback final
     para artigos legacy sem `article_sizes` nem `intent` informativo).
   - Não passar `organization_id` ao gravar nem ao ler.

4. **`scripts/test-parser.ts`**
   - Adicionar 7 casos de `intent` cobrindo:
     - `frango inteiro` → COUNTABLE_UNIT
     - `frango 10kg` → WEIGHT_LOOSE
     - `frango caixa 10kg` → PACKAGED_WEIGHT (caixa, 10000)
     - `leite 1L` → VOLUME
     - `ovos caixa 180 uni` → COUNTABLE_PACKAGED (caixa, 180)
     - `rúcula saco 200g` → PACKAGED_WEIGHT (saco, 200)
   - Não mexer nos 50+ casos existentes — só adicionar.

5. **Lint + testes**: `npm run lint` e `npm run test:parser`.

## Riscos

- **R1 — Edge cases sem qty mas com label** (e.g. "frango caixa" sem peso):
  classificação atual = `packaging`. `inferIntent` cai em
  `COUNTABLE_PACKAGED` com `perPack=qty` quando há qty, ou ignora o intent
  PACKAGED_WEIGHT por falta de `basePerOrder`. Mitigação: para
  `packaging` sem qty, `intent: { kind: 'COUNTABLE_UNIT' }` (lança o
  fornecedor como secundário). Comportamento atual preservado.
- **R2 — Artigo sem `article_sizes` em edição** (artigos antigos): `intent`
  não está disponível em edit (o `name` original foi perdido). Fallback
  para `unit`. par_level visualmente em `g`/`mL`/`un`. Mesmo
  comportamento de hoje, sem regressão. Eventualmente o chef pode adicionar
  packaging via fornecedor para "promover" o artigo.
- **R3 — Trocar de unidade base depois de input em kg**: chef escreve `5`
  com WEIGHT_LOOSE (= 5000g) e troca para `un`. O par_level **deve manter
  número visual 5** (não converter 5000un). Mitigação: reset do
  `parLevelDisplay` quando o factor visual muda, com aviso claro
  (`isDirty` = true). Já existe useEffect para sincronizar — extender.
- **R4 — Round-tripping em edição** (carrega → mostra → grava sem editar):
  factor visual é float; `formatBaseQty` arredonda para 2 casas. Para
  par_level, trabalha-se sempre em base_unit (numérico no DB) — só o
  display muda. Sem perda.
- **R5 — `article_sizes` com vários labels**: usar o de `sort_order` mais
  baixo (default 0). Comportamento determinístico.
- **R6 — Não passar `organization_id` no client**: trigger `set_organization_id`
  injecta. RLS isola SELECT. Manter.

## Casos de teste obrigatórios

1. `frango inteiro` → intent COUNTABLE_UNIT, par_level visual em `un`.
2. `frango 10kg` → intent WEIGHT_LOOSE, par_level visual em `kg`, gravado em `g`.
3. `frango caixa 10kg` → intent PACKAGED_WEIGHT, par_level visual em `caixa`.
4. `leite 1L` → intent VOLUME, par_level visual em `L`, gravado em `mL`.
5. `ovos caixa 180 uni` → intent COUNTABLE_PACKAGED, par_level visual em `caixa`.
6. `rúcula saco 200g` → intent PACKAGED_WEIGHT, par_level visual em `saco`.
7. **Edição de artigo já existente que tem `article_sizes`**: par_level visual
   continua na unidade do `article_size` após reload. Não muda quando
   trocamos fornecedor preferido nem quando apagamos um fornecedor.

## Como testar no iPhone (smoke real)

1. `npm run dev`
2. Em mobile (DevTools → iPhone 14 ou device físico em LAN):
   - `/artigos` → "+ Novo Artigo"
   - Para cada caso 1–6, escrever o nome no campo NOME → confirmar:
     - hint pequeno por baixo está coerente
     - bloco UNIDADE escondido nos casos com qty detectada
     - sufixo do par_level (kg / L / caixa / saco / un) coerente
   - Gravar caso 3 → reabrir o artigo → confirmar par_level continua em `caixa`.
   - Adicionar fornecedor → confirmar que par_level **não muda** de unidade.
3. Caso 7: artigo de teste já criado com `article_size` → reabrir → confirmar
   estabilidade visual.

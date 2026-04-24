# Zesto OS — Contexto para IA

> Cola este ficheiro no início de qualquer sessão com Claude, ChatGPT ou outra IA para retomares o trabalho sem explicar tudo de raiz.
> Última atualização: Abril 2026

---

## O que é

**Zesto OS** é um sistema operativo de cozinha para restaurantes. Não é software de gestão administrativa — é uma ferramenta de execução operacional diária, usada por chefs em contexto real: tempo limitado, atenção fragmentada, ambiente exigente.

**Objetivo:** permitir decisões rápidas com o mínimo de fricção. Cada ação deve ser possível em menos de 3 segundos.

**Restaurante de teste real:** Zazzaro. Todos os critérios de "done" são validados com dados reais do Zazzaro.

---

## Stack técnica

- **Next.js 16** (App Router) + **React 19**
- **Supabase** (PostgreSQL + Auth + RLS)
- **TypeScript**
- **Vercel** (deploy)
- Sem testes automatizados

**Comandos:**
```bash
npm run dev      # localhost:3000
npm run build
npm run lint
```

---

## Arquitetura

### Routing
- `src/app/(auth)/` — login/registo (sem sessão)
- `src/app/(app)/` — rotas protegidas, envolvidas em `AppShell`
- Proteção dupla: middleware em `src/proxy.ts` + verificação server-side no layout

### Supabase — dois clientes distintos (NUNCA misturar)
- `src/lib/supabase/client.ts` — browser (Client Components)
- `src/lib/supabase/server.ts` — server (Server Components, Server Actions, middleware)
- `src/lib/supabase.ts` — ficheiro legado, em processo de limpeza; novas funções não devem ir aqui

### Multi-tenancy
- Cada utilizador tem um `Profile` ligado a uma `Organization` (restaurante)
- RLS isola todos os dados por `organization_id` via `current_org_id()`
- O trigger `handle_new_user` cria organização e perfil automaticamente no registo
- **Regra crítica:** o código cliente nunca passa `organization_id` explicitamente — é injetado por triggers

---

## Schema de base de dados

### Migrações aplicadas (001–009)
| # | Descrição |
|---|-----------|
| 001 | Schema inicial (articles, suppliers, orders, stock_movements, productions) |
| 002 | Produções e conversões de unidades |
| 003 | Auth multi-tenant (organizations, profiles, RLS) |
| 004 | stock_unit em articles |
| 005 | stock_count_lines (contagem por linha) |
| 006 | article_sizes (variantes de embalagem) |
| 007 | order_suggestions v2 |
| 008 | ingredient_aliases (aliases por organização, auto-aprendizagem) |
| 009 | **Simplificação do modelo de stock** — remove stock_unit, simplifica views, adiciona RPC receive_order |

### Tabelas principais
- **`articles`** — ingredientes com `unit` (base: g/mL/un), `par_level`, `category`
- **`article_suppliers`** — ligação artigo ↔ fornecedor com `price`, `order_unit`, `conversion_factor`, `is_preferred`
- **`article_sizes`** — variantes de embalagem com `base_per_unit`
- **`stock_movements`** — todos os movimentos de stock (sempre em base_unit)
- **`ingredient_aliases`** — mapa de alias → nome canónico por organização
- **`orders` / `order_items`** — encomendas com snapshot de preços
- **`productions` / `production_ingredients`** — receitas e sub-produções
- **`suppliers`** — fornecedores

### Views
- **`current_stock`** — stock atual por artigo (COALESCE de movimentos)
- **`order_suggestions`** — artigos abaixo do par_level sem encomenda pendente

### RPC
- **`receive_order(p_order_id)`** — receção atómica de encomenda (insere movimentos PURCHASE + atualiza order_items + muda status)

---

## Modelo de unidades

- **Unidade base** (`unit`): g, mL, un — tudo é armazenado aqui
- **Unidade de compra** (`order_unit`): como o fornecedor vende (Balde, Saco, Caixa)
- **`conversion_factor`**: base_units por order_unit (ex: 1 Saco = 5000g → fator = 5000)
- Após migração 009: `base_per_stock = 1`, `stock_unit = unit` — não há camada intermédia

---

## Estado dos milestones

### Milestone 1 — Artigos ✅ (quase fechado)
- [x] Criar artigo em <10s (nome + unidade + enter)
- [x] Bulk import: colar lista, parse qty+unidade, preview editável, criar batch
- [x] Detecção de duplicados (aviso, não bloqueio)
- [x] Dicionário de ingredientes (`src/lib/ingredientDictionary.ts`) — normalização de nomes
- [x] Aliases por organização (`ingredient_aliases`) — aprendizagem automática
- [ ] Categoria rápida (sem scroll) — pendente
- [ ] Testar com 30 produtos reais do Zazzaro — critério de "done"

### Milestone 2 — Inventário ⏳ (não iniciado)
- [ ] Teclado numérico automático ao focar input
- [ ] Auto focus próximo item após guardar
- [ ] Scroll acompanha input activo
- [ ] "?" para artigo não contado
- [ ] Feedback imediato por artigo (✓, sem refresh)
- [ ] Estado contado vs não contado visível
- [ ] Mínimo visível por item

**Critério de done:** contar 50 produtos em <5min sem bugs com teclado iOS

### Milestone 3 — Encomendas ⏳ (não iniciado)
- [ ] necessidade = mínimo - atual, com múltiplos de compra
- [ ] Descontar encomendas pendentes
- [ ] Agrupar por fornecedor
- [ ] Quantidade editável inline
- [ ] Botão WhatsApp (mensagem formatada, 1 tap)

**Critério de done:** decidir e enviar encomenda em <2min

---

## Trabalho em progresso (não commitado)

Os seguintes ficheiros têm alterações locais ainda não commitadas:

- **`src/lib/supabase.ts`** — limpeza significativa; funções legadas removidas/simplificadas
- **`src/types/database.ts`** — simplificado (removido `stock_unit` e campos obsoletos)
- **`src/components/articles/ArticleForm.tsx`** — melhorias de UX (autoFocus, Enter para criar)
- **`src/components/articles/ArticlesScreen.tsx`** — integração de aliases
- **`src/components/articles/BulkImportPanel.tsx`** — simplificado, usa aliases
- **`src/components/inventory/ArticleCard.tsx`** — simplificado, modelo de stock novo
- **`src/components/inventory/InventoryScreen.tsx`** — simplificado
- **`src/lib/categoryKeywords.ts`** — expandido com mais keywords
- **`src/lib/parseProductLines.ts`** — pequenas correções de parse
- **`src/lib/units.ts`** — adicionado utilitário

Ficheiros novos (não commitados):
- **`src/components/articles/AliasManagerPanel.tsx`** — UI para gerir aliases aprendidos
- **`src/hooks/useOrgAliases.ts`** — hook para ler/aprender/apagar aliases
- **`src/lib/ingredientDictionary.ts`** — dicionário estático de normalização de nomes
- **`supabase/migrations/008_ingredient_aliases.sql`** — tabela de aliases
- **`supabase/migrations/009_simplify_stock_model.sql`** — simplificação do stock

---

## Design system

### Tokens CSS (sempre usar `var(--)`, nunca hex direto)
```css
/* Backgrounds */
--bg:        #F2E9DC   /* fundo base */
--surface:   #EDE0CE   /* cards, inputs */
--surface-2: #E5D5B8   /* estado pressed */
--primary:   #1F3A2E   /* header, overlay */

/* Actions */
--action:       #C46A2D   /* CTA principal */
--action-hover: #A85822

/* Text */
--text:            #1C1C1C
--text-muted:      #5C5040
--text-subtle:     #9A8A78   /* nunca para info crítica */
--text-on-primary: #F2E9DC

/* Borders */
--border:       rgba(28, 20, 10, 0.12)
--border-focus: #C46A2D

/* States */
--success: #556B47
--warning: #F59E0B
--error:   #8B2E2E

/* Utilities */
--touch-min: 44px
```

### Tipografia
- **Playfair Display** → títulos
- **Montserrat** → interface
- **JetBrains Mono** → números (stock, preços, métricas) — **números nunca usam Montserrat**

### Regras de cor
- Cor nunca é decorativa
- `--action` → apenas CTAs e ações principais
- `--success/warning/error` → apenas estados explícitos
- `--primary` → apenas estrutura e header

---

## Navegação
- `/` → Inventário
- `/encomendas` → Encomendas
- `/producoes` → Produções
- `/artigos` → Artigos
- `/fornecedores` → Fornecedores

---

## Ambiente Claude Code

Este projeto usa Claude Code com configuração específica. Se estás a trabalhar aqui com Claude Code, lê esta secção. Se estás noutro contexto (ChatGPT, etc.), ignora-a.

### Plugins ativos (globais)
| Plugin | Para que serve |
|--------|----------------|
| `superpowers` | Skills de workflow: planeamento, brainstorming, TDD, debugging, revisão de código |
| `frontend-design` | UI de qualidade — usa antes de implementar componentes visuais |
| `feature-dev` | Desenvolvimento guiado de features: exploração → arquitetura → implementação |
| `code-review` | Revisão de PRs e código |
| `playwright` | Testar a app no browser (webapp-testing skill) |
| `skill-creator` | Criar e melhorar skills |
| `claude-md-management` | Auditar e melhorar CLAUDE.md |
| `github` | Integração com GitHub (PRs, issues) |
| `swift-lsp` | LSP para Swift (não relevante neste projeto) |

### Agentes especializados (projeto)
Ficam em `.claude/agents/` e são invocados automaticamente pelo Claude quando relevante:

- **`nextjs-developer`** — implementação Next.js 16, App Router, Server Components, performance
- **`supabase-schema-architect`** — design de schema, migrações, RLS policies; invocar SEMPRE que houver mudanças na DB
- **`postgres-pro`** — otimização de queries, índices, replicação
- **`security-auditor`** — auditoria de segurança, RLS, exposição de dados

### Skills locais (projeto)
Ficam em `.claude/skills/`:

- **`senior-architect`** — decisões de arquitetura, diagramas, análise de dependências
- **`webapp-testing`** — interação com a app via Playwright (screenshots, click, fill, console logs)

### Permissões configuradas (`.claude/settings.json`)
**Permitido sem confirmação:**
- `npm run *`, `npm install *`, `npx *`
- `git commit *`, `git add *`, `git log *`, `git status`

**Pede confirmação:**
- `git push *`, `git rebase *`, `git reset *`

**Bloqueado:**
- `rm -rf *`
- Ler `.env` ou `.env.local` (nunca expor credenciais)

**Modo padrão:** `acceptEdits` — Claude edita ficheiros sem pedir permissão por cada edit.

### Hooks ativos
| Trigger | O que faz |
|---------|-----------|
| `Edit` ou `Write` em `.ts`/`.tsx` | Corre `tsc --noEmit` e mostra os primeiros 20 erros |
| `Edit` em `globals.css` | Avisa para verificar design tokens |
| `Edit` em `supabase/migrations/` | Avisa para verificar numeração do ficheiro SQL |
| `Edit` em `types/database.ts` | Avisa para verificar RLS policies |
| `Stop` (Claude termina resposta) | Lembra de atualizar o `PLAN.md` |

---

## O que a IA NÃO deve fazer

- Introduzir complexidade desnecessária
- Criar fluxos desktop-first (mobile-first sempre)
- Adicionar dashboards sem ação direta
- Usar cores como decoração
- Implementar funcionalidades fora do loop Artigos → Inventário → Encomendas
- Passar `organization_id` explicitamente no código cliente
- Usar hex diretamente no código (sempre `var(--)`)
- Editar migrações existentes (criar sempre uma nova)
- Usar `src/lib/supabase.ts` para novas funções (usar `client.ts` ou `server.ts`)

---

## Regra final

Se houver dúvida entre **mais completo** e **mais simples**:

→ escolher sempre **mais simples e mais rápido de usar em contexto real de cozinha**.

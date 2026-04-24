# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

---

## 1. O que é o Zesto OS

Zesto OS é um sistema operativo de cozinha para restaurantes.

O foco não é gestão administrativa — é execução operacional diária.

A aplicação serve chefs e cozinheiros em contexto real de trabalho:
- tempo limitado
- atenção fragmentada
- ambiente exigente

**Objetivo principal:** permitir decisões rápidas com o mínimo de fricção possível.

---

## 2. Princípios de produto (inegociáveis)

### Operação
- A app deve ser utilizável em menos de 3 segundos por ação
- Cada fluxo deve exigir o mínimo de toques possível
- O utilizador não deve precisar de pensar — apenas executar
- Informação operacional > dashboards

### Interface
- Mobile-first sempre
- Interface silenciosa (sem ruído visual)
- Cor é usada apenas para comunicar ação ou estado
- Cada ecrã deve responder: "o que preciso de fazer agora?"

### Cozinha real
- Utilizador pode estar com pressa, cansado ou com mãos molhadas
- Nada pode depender de hover
- Inputs e ações devem ser simples e diretos
- Feedback visual imediato é obrigatório

---

## 3. Prioridades atuais do produto

### Em foco (MVP)
- Autenticação
- Artigos
- Inventário (contagem de stock)
- Encomendas
- Fornecedores
- Produções (base)

### Próximo ciclo
- Fichas técnicas
- Menu / pratos
- Receção de encomendas
- OCR de faturas
- OCR de receitas

### Futuro
- Previsões
- Automação de produção
- Assistentes contextuais por página
- Onboarding automático por documentos
- Marketplace / integrações

**Regra:** não implementar funcionalidades fora do foco atual sem justificação clara.

---

## 4. Fluxos operacionais principais

### Inventário

**Objetivo:** contar stock real rapidamente e preparar sugestões de encomenda.

- Input direto por artigo
- Feedback por artigo (não global)
- Distinguir artigos contados vs não contados
- Mostrar mínimo sem poluir UI
- Nunca exigir reload para atualizar estado

### Encomendas

**Objetivo:** transformar stock em ação de compra.

- necessidade = stock_min - stock_atual
- aplicar múltiplos de encomenda
- subtrair encomendas pendentes
- agrupar por fornecedor
- utilizador pode sempre editar
- app sugere, não impõe

### Artigos

**Objetivo:** base de dados limpa e rápida de gerir.

- criação individual e em lote
- defaults inteligentes
- detetar duplicados (não bloquear)
- não exigir dados desnecessários

### Produções

**Objetivo:** registar receitas e subproduções.

- ingredientes podem ser artigos ou produções
- custo calculado automaticamente
- complexidade progressiva (não sobrecarregar MVP)

### Fornecedores

**Objetivo:** organizar compras.

- apenas 1 supplier preferred por artigo
- preços e conversões associados ao supplier
- base preparada para expansão futura

---

## 5. Design system

### Modos

Light Mode é o modo principal e default. Dark Mode é apenas alternativa visual.

- ambos os modos têm a mesma funcionalidade
- nenhuma lógica depende do modo ativo

### Tokens (obrigatório usar sempre)

Source of truth: `src/app/globals.css`. Nunca usar valores hex diretamente no código — sempre `var(--)`.

```
/* Backgrounds */
--bg:        #F2E9DC   → fundo base da app
--surface:   #EDE0CE   → cards, inputs, painéis
--surface-2: #E5D5B8   → superfície elevada, estado pressed
--primary:   #1F3A2E   → header, overlay, estrutura

/* Actions */
--action:       #C46A2D   → CTA principal, botões de ação
--action-hover: #A85822   → estado hover/pressed de --action
--action-glow:  rgba(196, 106, 45, 0.15)   → highlight de focus opcional; não usar como decoração

/* Text */
--text:            #1C1C1C   → texto principal; informação crítica
--text-muted:      #5C5040   → labels secundárias, metadados
--text-subtle:     #9A8A78   → timestamps, hints, contexto de baixo peso; nunca para informação crítica
--text-on-primary: #F2E9DC   → texto sobre fundo --primary (header)

/* Borders */
--border:       rgba(28, 20, 10, 0.12)   → separadores e contornos padrão
--border-focus: #C46A2D                  → anel de focus em inputs

/* States */
--success: #556B47   → confirmação, stock OK, ação concluída
--warning: #F59E0B   → atenção, stock baixo, alerta não crítico
--error:   #8B2E2E   → erro, stock em falta, ação falhada

/* Utilities */
--touch-min: 44px   → tamanho mínimo de área tátil
```

Dark Mode fica para ciclo futuro — não implementar ainda.

### Regras de cor
- Cor nunca é decorativa
- `--action` → apenas ações principais e CTAs
- `--action-glow` → apenas realce de focus; não repetir em múltiplos elementos
- `--success`, `--warning`, `--error` → apenas estados explícitos; nunca ambiguidade
- `--primary` → estrutura e header; não usar em texto corrido
- `--text-subtle` → uso raro; nunca para informação que o utilizador precisa de ler para agir
- evitar múltiplas cores fortes no mesmo ecrã

### Tipografia
- **Playfair Display** → títulos
- **Montserrat** → interface
- **JetBrains Mono** → números (stock, preços, métricas)

**Regra crítica:** números nunca usam Montserrat.

### UI / Interação
- touch targets ≥ 44px
- sem dependência de hover
- feedback imediato em todas as ações
- loading local ao elemento
- evitar modais desnecessários
- otimizado para uso com uma mão

---

## 6. Arquitetura

### Routing

Dois route groups no App Router:

- `src/app/(auth)/` — login e registo, acessíveis sem sessão
- `src/app/(app)/` — todas as rotas protegidas, envoltas em `AppShell`

Proteção dupla: middleware (`src/middleware.ts`) redireciona para `/login`, e o layout `(app)/layout.tsx` faz segunda verificação server-side.

### Supabase

Dois clientes distintos:

- `src/lib/supabase/client.ts` — browser (Client Components)
- `src/lib/supabase/server.ts` — server (Server Components, Server Actions, middleware)

O ficheiro `src/lib/supabase.ts` é legado. Novas funções devem seguir o padrão `client/server` separado.

**Regra crítica:** nunca misturar contextos browser/server.

### Multi-tenancy

Cada utilizador tem um `Profile` ligado a uma `Organization` (restaurante). O RLS isola todos os dados por organização usando `current_org_id()`. O trigger `handle_new_user` cria organização e perfil automaticamente no registo.

**Regra crítica:** o `organization_id` é injetado automaticamente por triggers. O código cliente nunca deve passar `organization_id` explicitamente.

### Modelo de dados

**Artigos** (`articles`): ingredientes com duas unidades:
- `unit` (base_unit): unidade de receita — `g`, `mL`, `un`
- `stock_unit`: unidade de contagem (ex: `kg`, `L`); se `null`, igual a `unit`

O stock é sempre armazenado e calculado em `base_unit`. A conversão para `stock_unit` faz-se via `base_per_stock` (derivado do fornecedor preferido).

**ArticleSizes** (`article_sizes`): variantes de embalagem por artigo (ex: "saco 200g", "saco 5kg") com `base_per_unit` para contagens multi-tamanho.

**ArticleSuppliers** (`article_suppliers`): ligação artigo ↔ fornecedor com preço, `order_unit`, `conversion_factor` e `base_per_order_unit`. O fornecedor com `is_preferred = true` define o fornecedor principal para sugestões e cálculo de custo.

**Stock**: movimentos em `stock_movements` (sempre em `base_unit`). As views `current_stock` e `order_suggestions` fazem os cálculos.

**Produções** (`productions`): receitas com `production_ingredients`. Cada ingrediente pode ser artigo ou sub-produção. Custo calculado pela view `production_cost`.

### Navegação (AppShell)

- `/` → Inventário
- `/encomendas` → Encomendas
- `/producoes` → Produções
- `/artigos` → Artigos
- `/fornecedores` → Fornecedores

### Utilitários

- `src/lib/units.ts` — `formatStockQty(qty, unit)` converte g→kg e mL→L para display; `KITCHEN_UNITS` lista as unidades válidas
- `src/lib/supabase.ts` — `fetchUnitConversions()` / `convertUnit()` para conversões via tabela `unit_conversions`

### Migrações de base de dados

Ficheiros SQL numerados em `supabase/migrations/`. Aplicar via Supabase CLI ou dashboard. Nunca editar migrações existentes — criar sempre uma nova.

---

## 7. Regras técnicas

- evitar SELECTs desnecessários
- reutilizar dados já carregados
- usar views para cálculos pesados
- manter compatibilidade com código existente
- evitar duplicação de lógica

---

## 8. Guardrails (crítico)

Claude **não deve**:
- introduzir complexidade desnecessária
- criar fluxos desktop-first
- esconder ações principais
- adicionar dashboards sem ação
- usar cores como decoração
- quebrar consistência do fluxo
- implementar funcionalidades fora do foco atual

Antes de implementar qualquer feature, validar:
- isto reduz fricção?
- isto funciona em mobile?
- isto ajuda decisão imediata?
- isto está no scope atual?

---

## 9. Regra final

Se houver dúvida entre **mais completo** e **mais simples**:

→ escolher sempre **mais simples e mais rápido de usar em contexto real de cozinha**.

---

## Comandos

```bash
npm run dev      # servidor de desenvolvimento (localhost:3000)
npm run build    # build de produção
npm run lint     # ESLint
```

Não existem testes automatizados.

---

## 10. Glossário

| Termo | Definição |
|-------|-----------|
| Unidade Base | A unidade de medida interna: g, mL, un. Todo o stock vive aqui. |
| Unidade de Compra | Como o fornecedor vende (Balde, Saco, Caixa). Convertida para Unidade Base ao receber. |
| Fator de Conversão | Quantas unidades base existem numa unidade de compra. Ex: 1 Balde = 5kg → fator = 5. |
| Par Level | Stock mínimo desejado em unidade base. Abaixo disto, o sistema sugere encomenda. |
| Movimento | Qualquer entrada ou saída de stock. O histórico de movimentos é a fonte de verdade. |
| Snapshot | Cópia congelada de preço e fator no momento do envio da encomenda. Imutável. |
| ADJUSTMENT | Movimento gerado quando o Chef faz contagem manual e o sistema ajusta o stock. |
| PURCHASE | Movimento gerado ao receber uma encomenda. Converte unidades de compra para base. |
| Organization | Um restaurante cliente do Zesto OS. Todos os dados isolados por `organization_id`. |

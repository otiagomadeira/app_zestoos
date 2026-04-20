# Zesto OS — Documento Técnico de Referência

> Lê este ficheiro completo antes de qualquer implementação.  
> Stack: Next.js + Supabase · Versão 2.0 · Abril 2026

---

## 1. Propósito

Este documento é a referência técnica única para a construção do Zesto OS.  
Os documentos de produto (PRD, Documento 0, Documento 1) definem **o que** construir. Este documento define **como** está estruturado por baixo e como se apresenta visualmente.

---

## 2. Princípios Inegociáveis

Estas regras nunca podem ser violadas, independentemente de qualquer instrução futura.

**Regra 1 — Stock por Movimentos**  
O stock de um artigo é sempre `SUM(quantity)` na tabela `movements`. Nunca existe um campo `stock_atual` editável diretamente.

**Regra 2 — Multi-tenant obrigatório**  
Cada restaurante tem um `organization_id`. Todos os registos (artigos, fornecedores, movimentos, encomendas) pertencem a uma organização. Nenhuma query pode ser feita sem filtrar por `organization_id`.

**Regra 3 — Snapshot de Encomenda**  
Quando uma encomenda muda para `status = SENT`, os campos `snapshot_purchase_unit`, `snapshot_conversion_factor` e `snapshot_price` são copiados do `article_supplier` para o `order_item` e congelados. Alterações futuras no `article_supplier` não afetam encomendas passadas.

**Regra 4 — Soft Delete**  
Artigos e fornecedores com movimentos ou encomendas associadas nunca são eliminados fisicamente. São inativados via `is_active = false`.

**Regra 5 — Lógica no Servidor**  
Toda a lógica de stock (cálculo, sugestões, movimentos) é processada no servidor (Supabase functions ou API route Next.js), nunca apenas no frontend.

---

## 3. Schema da Base de Dados (Supabase / PostgreSQL)

### 3.1 organizations

Representa cada restaurante cliente do Zesto OS. É a raiz de todo o sistema.

| Coluna | Tipo | Obrigatório | Descrição |
|--------|------|-------------|-----------|
| id | uuid (PK) | Sim | Identificador único do restaurante |
| name | text | Sim | Nome do restaurante |
| slug | text (unique) | Sim | Identificador URL (ex: zazzaro) |
| created_at | timestamptz | Sim | Data de criação |
| is_active | boolean | Sim | Restaurante ativo ou suspenso |

---

### 3.2 articles

Cada produto que existe na cozinha. O stock atual não é guardado aqui — é calculado a partir dos movimentos.

| Coluna | Tipo | Obrigatório | Descrição |
|--------|------|-------------|-----------|
| id | uuid (PK) | Sim | Identificador único |
| organization_id | uuid (FK) | Sim | Restaurante dono deste artigo |
| name | text | Sim | Nome do artigo (ex: Mel) |
| category | text | Sim | Carnes, Lacticínios, Frescos, etc. |
| base_unit | text | Sim | Unidade base: kg, L, un |
| par_level | numeric | Sim | Stock mínimo em unidade base |
| is_active | boolean | Sim | Artigo ativo (nunca apagar) |
| created_at | timestamptz | Sim | Data de criação |

> ⚠️ Nunca adicionar um campo `stock_atual` a esta tabela. O stock é sempre calculado por `SUM(movements.quantity) WHERE article_id = X`.

---

### 3.3 suppliers

Fornecedores registados por restaurante.

| Coluna | Tipo | Obrigatório | Descrição |
|--------|------|-------------|-----------|
| id | uuid (PK) | Sim | Identificador único |
| organization_id | uuid (FK) | Sim | Restaurante dono deste fornecedor |
| name | text | Sim | Nome do fornecedor |
| contact_phone | text | Não | Telemóvel de contacto |
| contact_email | text | Não | Email de contacto |
| is_active | boolean | Sim | Fornecedor ativo |

---

### 3.4 article_suppliers

Ligação entre um artigo e um fornecedor. Um artigo pode ter múltiplos fornecedores (ex: Legumes com 3 fornecedores). Guarda as condições comerciais de cada ligação.

| Coluna | Tipo | Obrigatório | Descrição |
|--------|------|-------------|-----------|
| id | uuid (PK) | Sim | Identificador único |
| article_id | uuid (FK) | Sim | Artigo associado |
| supplier_id | uuid (FK) | Sim | Fornecedor associado |
| purchase_unit | text | Sim | Unidade de compra (Balde, Saco) |
| conversion_factor | numeric | Sim | 1 Balde = 5 kg → fator = 5 |
| current_price | numeric | Sim | Preço atual por unidade de compra |
| is_preferred | boolean | Sim | Fornecedor preferencial para este artigo |
| is_active | boolean | Sim | Esta ligação está ativa |

> ⚠️ `is_preferred = true` indica o fornecedor preferencial. Para frescos, o Chef pode ter 3 fornecedores mas escolhe qual usar no momento da encomenda.

---

### 3.5 movements

O coração do sistema. Cada entrada ou saída de stock gera um movimento. Quantidade positiva = entrada. Quantidade negativa = saída.

| Coluna | Tipo | Obrigatório | Descrição |
|--------|------|-------------|-----------|
| id | uuid (PK) | Sim | Identificador único |
| organization_id | uuid (FK) | Sim | Restaurante |
| article_id | uuid (FK) | Sim | Artigo afetado |
| type | text | Sim | ADJUSTMENT, PURCHASE, WASTE, PRODUCTION_IN, PRODUCTION_OUT |
| quantity | numeric | Sim | Positivo (entrada) ou negativo (saída). Sempre em unidade base |
| order_item_id | uuid (FK) | Não | Ligação à linha de encomenda (se PURCHASE) |
| notes | text | Não | Observações opcionais |
| created_by | uuid (FK) | Sim | Utilizador que criou o movimento |
| created_at | timestamptz | Sim | Timestamp do movimento |

**Tipos de movimento:**
- `ADJUSTMENT` — contagem manual. Chef conta o que tem, sistema ajusta.
- `PURCHASE` — receção de encomenda. Converte unidades de compra para unidade base.
- `WASTE` — registo manual de desperdício.
- `PRODUCTION_OUT` — (Etapa 2) baixa de ingredientes ao concluir produção.
- `PRODUCTION_IN` — (Etapa 2) entrada do produto acabado ao concluir produção.

---

### 3.6 orders

Uma encomenda enviada a um fornecedor. Sempre para um único fornecedor.

| Coluna | Tipo | Obrigatório | Descrição |
|--------|------|-------------|-----------|
| id | uuid (PK) | Sim | Identificador único |
| organization_id | uuid (FK) | Sim | Restaurante |
| supplier_id | uuid (FK) | Sim | Fornecedor desta encomenda |
| status | text | Sim | DRAFT → SENT → PARTIALLY_RECEIVED → RECEIVED |
| sent_at | timestamptz | Não | Momento exato do envio (snapshot) |
| created_by | uuid (FK) | Sim | Utilizador que criou |
| created_at | timestamptz | Sim | Data de criação |

---

### 3.7 order_items

Cada linha de uma encomenda. Os campos `snapshot_` são cópias congeladas no momento do envio.

| Coluna | Tipo | Obrigatório | Descrição |
|--------|------|-------------|-----------|
| id | uuid (PK) | Sim | Identificador único |
| order_id | uuid (FK) | Sim | Encomenda pai |
| article_supplier_id | uuid (FK) | Sim | Ligação artigo-fornecedor usada |
| quantity_ordered | numeric | Sim | Qtd encomendada (unid. compra) |
| quantity_received | numeric | Não | Qtd recebida (unid. compra) |
| snapshot_purchase_unit | text | Sim | Cópia congelada: unidade de compra |
| snapshot_conversion_factor | numeric | Sim | Cópia congelada: fator de conversão |
| snapshot_price | numeric | Sim | Cópia congelada: preço unitário |
| status | text | Sim | PENDING → PARTIALLY_RECEIVED → FULLY_RECEIVED |

> ⚠️ Quando `orders.status` muda para `SENT`: copiar `purchase_unit`, `conversion_factor` e `current_price` do `article_supplier` para os campos `snapshot_` de cada `order_item`. Esta operação deve ser atómica (transação).

---

## 4. Fórmulas de Negócio

### 4.1 Calcular Stock Atual

```sql
SELECT COALESCE(SUM(quantity), 0) AS stock_atual
FROM movements
WHERE article_id = :article_id
  AND organization_id = :org_id
```

### 4.2 Calcular Sugestão de Encomenda

```
-- Necessidade em unidade base
necessidade = MAX(par_level - stock_atual, 0)

-- Quantidade a encomendar em unidades de compra
qtd_encomenda = CEIL(necessidade / conversion_factor)

-- Exemplo: Mel
-- par_level = 5kg | stock_atual = 2kg | conversion_factor = 5
-- necessidade = MAX(5 - 2, 0) = 3kg
-- qtd_encomenda = CEIL(3 / 5) = 1 Balde
```

### 4.3 Processar Receção

```
-- Chef confirma receção de X unidades de compra:
quantidade_base = quantity_received * snapshot_conversion_factor

-- Gerar movimento PURCHASE:
INSERT INTO movements (article_id, type, quantity, order_item_id, ...)
VALUES (:article_id, 'PURCHASE', :quantidade_base, :order_item_id, ...)

-- Atualizar order_item:
UPDATE order_items
SET quantity_received = :qty, status = 'FULLY_RECEIVED'
WHERE id = :order_item_id
```

### 4.4 Processar Contagem de Stock (ADJUSTMENT)

```
-- Chef conta o que tem: counted_quantity (em unidade base)
stock_teorico = SUM(movements.quantity) WHERE article_id = X

-- Diferença:
diferenca = counted_quantity - stock_teorico

-- Gerar movimento (pode ser positivo ou negativo):
INSERT INTO movements (article_id, type, quantity, ...)
VALUES (:article_id, 'ADJUSTMENT', :diferenca, ...)

-- Nota: se diferenca = 0, não gerar movimento.
```

---

## 5. Row Level Security (RLS)

Ativar em **todas** as tabelas. Nenhum utilizador acede a dados de outro restaurante.

```sql
-- Exemplo para a tabela articles:
ALTER TABLE articles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_isolation" ON articles
  USING (
    organization_id = (
      SELECT organization_id FROM profiles
      WHERE id = auth.uid()
    )
  );

-- Aplicar padrão idêntico a:
-- suppliers, article_suppliers, movements, orders, order_items
```

> ⚠️ Cada utilizador (`profiles`) está ligado a uma `organization_id`. O RLS usa esta ligação para filtrar automaticamente todos os dados.

---

## 6. Estrutura do Projeto Next.js

```
zesto-os/
├── app/
│   ├── (auth)/
│   │   ├── login/page.tsx
│   │   └── layout.tsx
│   ├── (app)/
│   │   ├── layout.tsx          # Layout principal com nav
│   │   ├── stock/page.tsx      # Contagem de stock
│   │   ├── orders/
│   │   │   ├── page.tsx        # Lista de encomendas
│   │   │   ├── new/page.tsx    # Criar encomenda
│   │   │   └── [id]/page.tsx   # Detalhe / receção
│   │   ├── articles/page.tsx   # Gestão de artigos
│   │   └── suppliers/page.tsx  # Gestão de fornecedores
│   └── api/
│       ├── orders/route.ts
│       ├── movements/route.ts
│       └── stock/route.ts
├── lib/
│   ├── supabase/
│   │   ├── client.ts           # Browser client
│   │   └── server.ts           # Server client (SSR)
│   ├── calculations.ts         # Fórmulas (secção 4)
│   └── types.ts                # Tipos TypeScript
├── components/
│   ├── ui/                     # Componentes base
│   ├── stock/                  # Componentes de contagem
│   └── orders/                 # Componentes de encomenda
└── supabase/
    └── migrations/             # Ficheiros SQL
```

---

## 7. Ordem de Implementação (MVP)

Construir nesta ordem. Não avançar sem o passo anterior estar testado com dados reais do Zazzaro.

1. Schema SQL completo no Supabase (tabelas + RLS + índices)
2. Auth básico — login com email/password, ligação ao `organization_id`
3. CRUD de Fornecedores — criar, editar, inativar
4. CRUD de Artigos — criar, editar, definir par level, ligar a fornecedor(es)
5. Ecrã de Stock — listar artigos com stock atual calculado e indicador abaixo do mínimo
6. Contagem de Stock — interface para inserir quantidade contada e gerar `ADJUSTMENT`
7. Gerar Sugestão de Encomenda — lista artigos abaixo do par level com qtd sugerida
8. Criar e Enviar Encomenda — editar quantidades e confirmar envio (snapshot)
9. Receção de Encomenda — confirmar quantidades recebidas e gerar `PURCHASE`
10. Testes com dados reais do Zazzaro

---

## 8. Design System

### Paleta de Cores

| Token | HEX | Uso |
|-------|-----|-----|
| Verde Escuro | #1F3A2E | Cor principal. Títulos, estrutura, top bar. |
| Bege / Creme | #F2E9DC | Fundo modo claro. |
| Terracota | #C46A2D | Destaque e ação. Botão primário, links. |
| Preto Suave | #1C1C1C | Texto corrido, números. |
| Âmbar Terroso | #B8860B | Estado de atenção. Stock a aproximar do mínimo. |
| Vermelho-Tijolo | #8B2E2E | Estado crítico. Stock em rutura, erros. |
| Verde Musgo | #556B47 | Estado de sucesso. Stock OK. |

### Tipografia

| Fonte | Uso |
|-------|-----|
| Playfair Display | Títulos grandes, nomes de secção, métricas de dashboard |
| Montserrat | Texto corrido, labels, botões, navegação |
| JetBrains Mono | Todos os valores numéricos (stock, preços, quantidades) |

> ⚠️ Números operacionais são **sempre** JetBrains Mono. Playfair Display nunca em números pequenos dentro de listas.

### Regras de Aplicação

| Situação | Decisão |
|----------|---------|
| Fundo modo claro | Creme #F2E9DC |
| Fundo modo escuro | Verde #1A2F26 |
| Top bar e nav | Verde escuro #1F3A2E (ambos os modos) |
| Cartões (modo escuro) | Verde #243A31 |
| Cartões (modo claro) | Branco #FFFFFF |
| Texto de títulos | Playfair Display, Verde Escuro (claro) / Creme (escuro) |
| Texto corrido | Montserrat, Preto Suave |
| Números | JetBrains Mono |
| Botão primário | Fundo Terracota, texto branco |
| Botão secundário | Borda Verde Escuro, texto Verde Escuro |
| Stock OK | Verde Musgo |
| Stock a atingir mínimo | Âmbar |
| Stock crítico / rutura | Vermelho-Tijolo |
| Altura mínima de toque | 44px |
| Arredondamento de cartões | 4–6px |
| Espaçamento base | Múltiplos de 4px |

---

## 9. Glossário

| Termo | Definição |
|-------|-----------|
| Unidade Base | A unidade de medida interna: kg, L, un. Todo o stock vive aqui. |
| Unidade de Compra | Como o fornecedor vende (Balde, Saco, Caixa). Convertida para Unidade Base ao receber. |
| Fator de Conversão | Quantas unidades base existem numa unidade de compra. Ex: 1 Balde = 5kg → fator = 5. |
| Par Level | Stock mínimo desejado em unidade base. Abaixo disto, o sistema sugere encomenda. |
| Movimento | Qualquer entrada ou saída de stock. O histórico de movimentos é a fonte de verdade. |
| Snapshot | Cópia congelada de preço e fator no momento do envio da encomenda. Imutável. |
| ADJUSTMENT | Movimento gerado quando o Chef faz contagem manual e o sistema ajusta o stock. |
| Organization | Um restaurante cliente do Zesto OS. Todos os dados isolados por `organization_id`. |

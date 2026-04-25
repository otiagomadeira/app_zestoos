# Zesto OS — Plano de Desenvolvimento

> Documento vivo. Atualizar a cada milestone concluído.  
> Última atualização: Abril 2026

---

## OBJETIVO GLOBAL

Fechar loop real: **Contar → Decidir → Encomendar** (sem fricção)

---

## MILESTONE 1 — PRODUTOS ✅ FECHADO (Abril 2026)

### Criação
- [x] Criar produto em <10s
- [x] Nome obrigatório
- [x] Unidade default automática (quick-pick: g / mL / un)
- [ ] Categoria rápida (sem scroll) — adiado para próximo ciclo

### Bulk Import
- [x] Colar lista sem crash
  - [x] Suporta 20+ linhas
  - [x] Ignora linhas vazias
  - [x] Não duplica
- [x] Parse correto (qty + unidade)
  - [x] "2kg tomate"
  - [x] "4 leite"
  - [x] "1cx ovos"
  - [x] Parser estabilizado — `npm run test:parser` cobre 39 casos
        (peso/volume/multipack/conserva/enlatado/uni/dimensões/
        label-first/label-after/multipack-equivalente).
  - [x] Validado com lista real de 55 produtos: 46 prontos · 7
        duplicados pré-existentes · 0 a resolver · 2 size variants.
- [x] Preview editável
  - [x] Nome editável
  - [x] Unidade editável
  - [x] Quantidade editável
- [x] Criar batch sem erro
  - [x] Promise.all estável
  - [x] Falhas não bloqueiam tudo
  - [x] Feedback claro

### Duplicados
- [x] Detectar nomes semelhantes
- [x] Avisar (não bloquear)
- [x] Permitir continuar

### UX
- [x] Input sempre focado (autoFocus no create)
- [x] Enter cria produto (quando nome + unidade preenchidos)
- [x] Zero fricção geral (validado com dados reais Zazzaro)

**DONE** = consigo criar/importar 30 produtos em <5min ✓

### Validação de fecho
- `npm run test:parser` → **39/39** (peso/volume/multipack/conserva/
  enlatado/uni/dimensões/label-first/label-after/multipack-equivalente).
- Lista real/difícil de 55 produtos validada no Bulk Import: 46 prontos,
  7 duplicados pré-existentes, **0 a resolver**, 2 size variants.

### Backlog técnico — Artigos (não bloqueiam o MVP)
1. **Espargos → Peixe e Marisco**. `lower.includes(w)` em
   `src/lib/categoryKeywords.ts` colide com substring "pargo".
   Resolver com word-boundary `\b` no matching de keywords.
2. **Word-boundary global no `suggestCategory`**. A mesma classe de
   bug pode afetar outras keywords curtas (ex.: "atum" em "atum-bom"
   ou "cha" em "macha"). Auditar quando reabrir.
3. **Packaging labels longos / cauda longa**: avaliar `bola`, `peça`,
   `vácuo`, `inteiro`. Adicionar só após enumerar regressões (ex.:
   "Bola de Berlim", "peça única" no nome legítimo).

---

## MILESTONE 2 — INVENTÁRIO

### Contagem
- [ ] Teclado numérico automático
- [ ] Auto focus próximo item
- [ ] Scroll acompanha input
- [ ] "?" para não contado

### Save
- [ ] Guardar por item (savingId)
- [ ] Feedback imediato (✓)
- [ ] Sem refresh

### Estado
- [ ] Contado vs não contado visível
- [ ] Mínimo visível por item
- [ ] Sem badges desnecessários

### Performance real
- [ ] Contar 50 produtos <5min
- [ ] Sem bugs com teclado iOS

**DONE** = consigo fazer inventário completo sem parar

---

## MILESTONE 3 — ENCOMENDAS

### Lógica
- [ ] necessidade = mínimo - atual
- [ ] Aplicar múltiplos corretamente
- [ ] Descontar pendentes

### UX
- [ ] Mostrar só baixo/esgotado
- [ ] Quantidade clara
- [ ] Editável rápido

### Agrupamento
- [ ] Agrupar por fornecedor
- [ ] Separação clara por blocos

### Envio
- [ ] Botão WhatsApp
- [ ] Mensagem formatada
- [ ] 1 tap → enviar

**DONE** = consigo decidir e enviar encomenda em <2min

---

## REGRAS

1. Para qualquer mudança importante: planear primeiro, Claude dá opinião, só depois implementar
2. Não avançar milestone sem fechar o anterior
2. Tudo testado com dados reais (Zazzaro)
3. Se não poupa tempo → remover
4. Sem novas features até fechar loop
5. Cada feature nova começa numa branch (`feat/nome-da-feature`); merge para `main` só quando estável
6. Nunca fazer push direto para `main` — sempre via branch
7. Commits pequenos e descritivos — um commit = uma coisa só
8. Testar no dispositivo real (iPhone) antes de fechar qualquer tarefa

---

## HOJE

- [ ] Escolher 1 secção
- [ ] Fechar 100%
- [ ] Testar em cenário real

---

## ROADMAP (após loop fechado)

| Etapa | Feature |
|-------|---------|
| Etapa 4 | Receção de encomendas (fechar ciclo de compra) |
| Etapa 5 | Fichas técnicas (custo por porção) |
| Etapa 6 | OCR de faturas |
| Etapa 7 | OCR de receitas |

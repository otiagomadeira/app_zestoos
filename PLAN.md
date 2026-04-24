# Zesto OS — Plano de Desenvolvimento

> Documento vivo. Atualizar a cada milestone concluído.  
> Última atualização: Abril 2026

---

## OBJETIVO GLOBAL

Fechar loop real: **Contar → Decidir → Encomendar** (sem fricção)

---

## MILESTONE 1 — PRODUTOS

### Criação
- [ ] Criar produto em <10s
- [ ] Nome obrigatório
- [ ] Unidade default automática
- [ ] Categoria rápida (sem scroll)

### Bulk Import
- [ ] Colar lista sem crash
  - [ ] Suporta 20+ linhas
  - [ ] Ignora linhas vazias
  - [ ] Não duplica
- [ ] Parse correto (qty + unidade)
  - [ ] "2kg tomate"
  - [ ] "4 leite"
  - [ ] "1cx ovos"
- [ ] Preview editável
  - [ ] Nome editável
  - [ ] Unidade editável
  - [ ] Quantidade editável
- [ ] Criar batch sem erro
  - [ ] Promise.all estável
  - [ ] Falhas não bloqueiam tudo
  - [ ] Feedback claro

### Duplicados
- [ ] Detectar nomes semelhantes
- [ ] Avisar (não bloquear)
- [ ] Permitir continuar

### UX
- [ ] Input sempre focado
- [ ] Enter cria produto
- [ ] Zero fricção geral

**DONE** = consigo criar/importar 30 produtos em <5min

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

-- ============================================================
-- ZESTO OS — Schema v20
-- Autosave idempotente para artigos multi-embalagem
-- ============================================================
--
-- Contexto:
--   017 introduziu o autosave inline (single packaging) idempotente
--   por count_session_id. O multi (PackagingLine expanded body) ainda
--   usava o legado record_stock_count, criando 1 movement por save.
--
--   Decisão de produto + arquitectura: o multi passa a ter o mesmo
--   padrão do inline — UM movement por (article, session), UPDATE
--   in-place a cada save. Frontend remove o botão Guardar e usa
--   debounced autosave (mesmo modelo do inline).
--
-- O que esta migration faz:
--   Cria record_stock_count_multi_inline(p_article_id, p_lines, p_session_id)
--   que reusa o UNIQUE INDEX parcial criado em 017
--   (organization_id, article_id, count_session_id) — partilhado com o
--   inline. Cada sessão tem no máximo 1 movement por artigo,
--   independentemente de o artigo ser inline ou multi.
--
--   Algoritmo (espelha 017):
--     1. Resolver artigo (RLS aplica via SECURITY INVOKER)
--     2. Validar p_lines (JSONB array com {label, qty, base_per_unit})
--     3. v_total_base = SUM(qty * base_per_unit) sobre todas as linhas
--     4. SELECT FOR UPDATE existing por (article, session)
--     5. Calcular baseline = current_qty − contribuição desta sessão
--     6. Calcular new_qty = total − baseline (delta de ADJUSTMENT)
--     7. Se existe → UPDATE quantity + DELETE/INSERT lines
--     8. Senão → INSERT, com EXCEPTION WHEN unique_violation a fazer
--        re-fetch + UPDATE (defensivo contra race entre 2 calls do
--        mesmo client em flight)
--
-- Compatibilidade:
--   - Sem alterações de schema; só CREATE OR REPLACE FUNCTION.
--   - record_stock_count (legado) mantém-se para o caller "Guardar"
--     enquanto migramos a UI; futuras versões podem removê-lo.
--   - record_stock_count_inline (017) intacto. Inline e multi
--     coexistem sobre o mesmo UNIQUE INDEX.
-- ============================================================

CREATE OR REPLACE FUNCTION record_stock_count_multi_inline(
  p_article_id UUID,
  p_lines      JSONB,
  p_session_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_unit          TEXT;
  v_existing_id   UUID;
  v_existing_qty  NUMERIC;
  v_baseline      NUMERIC;
  v_new_qty       NUMERIC;
  v_total_base    NUMERIC;
BEGIN
  -- 1. Resolver artigo (RLS via SECURITY INVOKER)
  SELECT a.unit INTO v_unit
  FROM articles a
  WHERE a.id = p_article_id;

  IF v_unit IS NULL THEN
    RAISE EXCEPTION 'Article % not found or not accessible', p_article_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- 2. Validar input
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' THEN
    RAISE EXCEPTION 'p_lines must be a JSONB array'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_session_id IS NULL THEN
    RAISE EXCEPTION 'p_session_id required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_lines) line
    WHERE (line->>'qty')::NUMERIC < 0
       OR (line->>'base_per_unit')::NUMERIC <= 0
       OR line->>'label' IS NULL
  ) THEN
    RAISE EXCEPTION 'Each line must have label, qty>=0, base_per_unit>0'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- 3. Total em base_unit
  SELECT COALESCE(SUM((line->>'qty')::NUMERIC * (line->>'base_per_unit')::NUMERIC), 0)
    INTO v_total_base
  FROM jsonb_array_elements(p_lines) line;

  -- 4. Lock existing movement desta sessão (concurrent writes safe)
  SELECT id, quantity INTO v_existing_id, v_existing_qty
  FROM stock_movements
  WHERE article_id = p_article_id
    AND count_session_id = p_session_id
    AND type = 'ADJUSTMENT'
  FOR UPDATE;

  -- 5. Baseline: current_qty sem a contribuição desta sessão
  SELECT current_qty INTO v_baseline FROM current_stock WHERE article_id = p_article_id;
  v_baseline := COALESCE(v_baseline, 0) - COALESCE(v_existing_qty, 0);
  v_new_qty  := v_total_base - v_baseline;

  -- 6a. Existe → UPDATE in-place + reescrever lines
  IF v_existing_id IS NOT NULL THEN
    IF abs(v_new_qty - v_existing_qty) < 0.0001 THEN
      -- Mesmo total que já estava → noop (mas garantimos lines actualizadas
      -- caso o chef tenha redistribuído entre embalagens com mesmo total).
      DELETE FROM stock_count_lines WHERE movement_id = v_existing_id;
      INSERT INTO stock_count_lines (movement_id, size_label, qty, base_per_unit, base_qty)
      SELECT v_existing_id,
             line->>'label',
             (line->>'qty')::NUMERIC,
             (line->>'base_per_unit')::NUMERIC,
             (line->>'qty')::NUMERIC * (line->>'base_per_unit')::NUMERIC
      FROM jsonb_array_elements(p_lines) line
      WHERE (line->>'qty')::NUMERIC > 0;
      RETURN v_existing_id;
    END IF;

    UPDATE stock_movements
       SET quantity   = v_new_qty,
           counted_at = NOW(),
           notes      = 'Contagem multi inline — auto-save'
     WHERE id = v_existing_id;

    DELETE FROM stock_count_lines WHERE movement_id = v_existing_id;
    INSERT INTO stock_count_lines (movement_id, size_label, qty, base_per_unit, base_qty)
    SELECT v_existing_id,
           line->>'label',
           (line->>'qty')::NUMERIC,
           (line->>'base_per_unit')::NUMERIC,
           (line->>'qty')::NUMERIC * (line->>'base_per_unit')::NUMERIC
    FROM jsonb_array_elements(p_lines) line
    WHERE (line->>'qty')::NUMERIC > 0;

    RETURN v_existing_id;
  END IF;

  -- 6b. Não existe → INSERT inicial
  IF abs(v_new_qty) < 0.0001 THEN
    -- Sem stock anterior e total = 0 → no-op. Cliente trata "no error" como
    -- sucesso e marca como contado (consistente com inline 017).
    RETURN NULL;
  END IF;

  BEGIN
    INSERT INTO stock_movements
      (article_id, type, quantity, unit, notes, counted_at, count_session_id)
    VALUES
      (p_article_id, 'ADJUSTMENT', v_new_qty, v_unit,
       'Contagem multi inline — auto-save', NOW(), p_session_id)
    RETURNING id INTO v_existing_id;

    INSERT INTO stock_count_lines (movement_id, size_label, qty, base_per_unit, base_qty)
    SELECT v_existing_id,
           line->>'label',
           (line->>'qty')::NUMERIC,
           (line->>'base_per_unit')::NUMERIC,
           (line->>'qty')::NUMERIC * (line->>'base_per_unit')::NUMERIC
    FROM jsonb_array_elements(p_lines) line
    WHERE (line->>'qty')::NUMERIC > 0;

    RETURN v_existing_id;
  EXCEPTION WHEN unique_violation THEN
    -- Race entre 2 calls concorrentes do mesmo client. Re-fetch a vencedora,
    -- recalcula baseline e UPDATE in-place.
    SELECT id, quantity INTO v_existing_id, v_existing_qty
    FROM stock_movements
    WHERE article_id = p_article_id
      AND count_session_id = p_session_id
      AND type = 'ADJUSTMENT'
    FOR UPDATE;

    IF v_existing_id IS NULL THEN
      RAISE;
    END IF;

    SELECT current_qty INTO v_baseline FROM current_stock WHERE article_id = p_article_id;
    v_baseline := COALESCE(v_baseline, 0) - COALESCE(v_existing_qty, 0);
    v_new_qty  := v_total_base - v_baseline;

    IF abs(v_new_qty - v_existing_qty) < 0.0001 THEN
      DELETE FROM stock_count_lines WHERE movement_id = v_existing_id;
      INSERT INTO stock_count_lines (movement_id, size_label, qty, base_per_unit, base_qty)
      SELECT v_existing_id,
             line->>'label',
             (line->>'qty')::NUMERIC,
             (line->>'base_per_unit')::NUMERIC,
             (line->>'qty')::NUMERIC * (line->>'base_per_unit')::NUMERIC
      FROM jsonb_array_elements(p_lines) line
      WHERE (line->>'qty')::NUMERIC > 0;
      RETURN v_existing_id;
    END IF;

    UPDATE stock_movements
       SET quantity   = v_new_qty,
           counted_at = NOW(),
           notes      = 'Contagem multi inline — auto-save'
     WHERE id = v_existing_id;

    DELETE FROM stock_count_lines WHERE movement_id = v_existing_id;
    INSERT INTO stock_count_lines (movement_id, size_label, qty, base_per_unit, base_qty)
    SELECT v_existing_id,
           line->>'label',
           (line->>'qty')::NUMERIC,
           (line->>'base_per_unit')::NUMERIC,
           (line->>'qty')::NUMERIC * (line->>'base_per_unit')::NUMERIC
    FROM jsonb_array_elements(p_lines) line
    WHERE (line->>'qty')::NUMERIC > 0;

    RETURN v_existing_id;
  END;
END;
$$;

COMMENT ON FUNCTION record_stock_count_multi_inline(UUID, JSONB, UUID) IS
  'Autosave multi-embalagem idempotente por session_id. Espelho do record_stock_count_inline (017) para múltiplas linhas. UPDATE in-place se existe; INSERT senão. Apanha unique_violation interno (race) → re-fetch + UPDATE. RLS via SECURITY INVOKER.';

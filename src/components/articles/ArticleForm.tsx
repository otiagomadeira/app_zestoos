'use client'

import { useState, useEffect, useRef } from 'react'
import type { Article, Supplier } from '@/types/database'
import {
  createArticle, updateArticle, toggleArticleActive,
  fetchAllSuppliers, fetchArticleSuppliers, saveArticleSuppliers,
  createArticleSizeIfMissing,
} from '@/lib/supabase'
import {
  ORDER_UNITS, formatStockQty, formatBaseQty,
  parsePackagingQuantity, packagingHelperText,
} from '@/lib/units'
import { ARTICLE_CATEGORIES } from '@/lib/categoryKeywords'
import { maybeLearnAlias, normalizeKey } from '@/lib/ingredientDictionary'
import { normalizeArticleInput } from '@/lib/normalizeArticle'
import { buildArticleDraft, formatDraftHint, type ArticleDraft } from '@/lib/articleDraft'
import { getSuggestedUnitWeight } from '@/lib/unitWeightSuggestions'
import { useOrgAliases } from '@/hooks/useOrgAliases'

interface Props {
  existing?:  Article
  articles?:  Article[]   // lista para deteção de duplicados client-side
  onSaved:    (article: Article) => void
  onCancel:   () => void
}

type LinkRow = {
  key:               string
  supplier_id:       string
  supplier_ref:      string
  price:             string
  order_unit:        string
  conversion_factor: string
  is_preferred:      boolean
}


// Sugestões de g_per_unit vivem em src/lib/unitWeightSuggestions.ts (helper
// puro, conhecimento global). Antes existia G_PER_UNIT_HINTS local com
// auto-fill silencioso em handleNameBlur e Unit-click — removido. Agora
// qualquer sugestão exige tap explícito do chef ("Usar sugestão"), seguindo
// o mesmo princípio do conversion_factor: dados nunca são gravados sem
// confirmação consciente.

let _key = 0
const nextKey = () => String(++_key)
const emptyLink = (): LinkRow => ({
  key:               nextKey(),
  supplier_id:       '',
  supplier_ref:      '',
  price:             '',
  order_unit:        '',
  // Vazio é intencional. Default silencioso de 1 cria dados errados em
  // artigos g/mL ("mel: 1g por embalagem"). Chef escreve "10kg" / "5L" /
  // "180un" antes de guardar; vazio → erro inline + bloqueio em handleSave.
  conversion_factor: '',
  is_preferred:      false,
})

const labelStyle: React.CSSProperties = {
  fontSize:      10,
  fontWeight:    700,
  color:         'var(--text-muted)',
  letterSpacing: '0.12em',
  marginBottom:  10,
  display:       'block',
  textTransform: 'uppercase',
}

// Info pip — micro-icon "i" ao lado de um label que revela explicação curta.
// Existe para tirar texto de helper persistente do form sem perder a
// informação: o helper passa de ruído permanente para detalhe sob demanda.
// Acessível via teclado (focus + click) e mobile (tap fora fecha).
function HelpTip({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointer = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', onPointer)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onPointer)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <span ref={ref} style={{ position: 'relative', display: 'inline-flex', verticalAlign: 'middle' }}>
      <button
        type="button"
        aria-label="Ajuda"
        aria-expanded={open}
        onClick={(e) => { e.preventDefault(); setOpen(o => !o) }}
        style={{
          width:          16,
          height:         16,
          borderRadius:   '50%',
          border:         `1px solid ${open ? 'var(--action)' : 'var(--text-subtle)'}`,
          background:     open ? 'var(--action-surface)' : 'transparent',
          color:          open ? 'var(--action)' : 'var(--text-subtle)',
          fontSize:       10,
          fontWeight:     700,
          fontFamily:     "'Playfair Display', serif",
          fontStyle:      'italic',
          cursor:         'pointer',
          display:        'flex',
          alignItems:     'center',
          justifyContent: 'center',
          padding:        0,
          flexShrink:     0,
          lineHeight:     1,
          letterSpacing:  0,
          transition:     'background 0.15s, border-color 0.15s, color 0.15s',
        }}
      >
        i
      </button>
      {open && (
        <div
          role="tooltip"
          style={{
            position:      'absolute',
            top:           'calc(100% + 6px)',
            left:          -8,
            minWidth:      220,
            maxWidth:      300,
            background:    'var(--surface-2)',
            border:        '1px solid var(--border)',
            borderRadius:  8,
            padding:       '10px 12px',
            fontSize:      12,
            fontWeight:    400,
            color:         'var(--text)',
            lineHeight:    1.5,
            letterSpacing: 0,
            textTransform: 'none',
            fontFamily:    'inherit',
            zIndex:        60,
            boxShadow:     '0 8px 22px rgba(28, 20, 10, 0.16)',
          }}
        >
          {text}
        </div>
      )}
    </span>
  )
}

// Section title com under-mark: pequena linha cor --action de 32px abaixo do
// texto. Marker tipográfico editorial em vez de border-bottom à largura toda
// (que se sente administrativo). Usado para DETALHES / FORNECEDORES.
//
// `flush` desactiva margens próprias — necessário quando o SectionTitle é
// usado como flex item directo (o flex gap do parent já provê espaçamento).
// Sem flush, a 14px de marginBottom soma-se ao gap 14 do flex e duplica.
function SectionTitle({ children, flush }: { children: React.ReactNode; flush?: boolean }) {
  return (
    <div style={{
      marginBottom: flush ? 0 : 14,
      marginTop:    flush ? 0 : 4,
    }}>
      <h4 style={{
        fontSize:      11,
        fontWeight:    800,
        color:         'var(--text)',
        letterSpacing: '0.16em',
        textTransform: 'uppercase',
        margin:        0,
        marginBottom:  6,
      }}>
        {children}
      </h4>
      <span style={{
        display:      'block',
        width:         32,
        height:        2,
        background:    'var(--action)',
        borderRadius:  2,
      }} />
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width:        '100%',
  height:       48,
  background:   'var(--surface)',
  border:       '1px solid var(--border)',
  borderRadius: 8,
  padding:      '0 14px',
  color:        'var(--text)',
  fontSize:     15,
  outline:      'none',
  fontFamily:   'inherit',
  transition:   'border-color 0.15s, box-shadow 0.15s',
}

const cellInput: React.CSSProperties = {
  width:        '100%',
  height:       44,
  background:   'var(--surface)',
  border:       '1px solid var(--border)',
  borderRadius: 6,
  padding:      '0 10px',
  color:        'var(--text)',
  fontSize:     14,
  outline:      'none',
  fontFamily:   'inherit',
  transition:   'border-color 0.15s, box-shadow 0.15s',
}

// Estilo para inputs numéricos hero (Stock mínimo, Peso por unidade).
// Mono font para os números ganharem o peso visual que merecem; o chef
// procura este número em primeiro lugar quando consulta a ficha.
// Height 48 (reduzido de 56) — ainda confortável tap-target acima do
// 44 obrigatório, com mais densidade vertical na ficha.
const numericInputStyle: React.CSSProperties = {
  ...inputStyle,
  flex:          1,
  minWidth:      0,
  height:        48,
  fontSize:      20,
  fontFamily:    "'JetBrains Mono', monospace",
  fontWeight:    600,
  letterSpacing: '-0.01em',
  textAlign:     'left',
  paddingRight:  16,
}

export default function ArticleForm({ existing, articles, onSaved, onCancel }: Props) {
  const isEdit = !!existing

  const [name,               setName]              = useState(existing?.name     ?? '')
  const [category,           setCategory]          = useState(existing?.category ?? '')
  const [unit,               setUnit]              = useState<'g' | 'mL' | 'un'>((existing?.unit as 'g' | 'mL' | 'un') ?? 'g')
  const [parLevel,           setParLevel]          = useState(existing ? String(existing.par_level) : '')
  const [parLevelDisplay,    setParLevelDisplay]   = useState('')
  const [gPerUnit,           setGPerUnit]          = useState(existing?.g_per_unit != null ? String(existing.g_per_unit) : '')
  const [links,              setLinks]             = useState<LinkRow[]>([])
  const [suppliers,          setSuppliers]         = useState<Supplier[]>([])
  const [expandedLinks,      setExpandedLinks]     = useState<Set<string>>(new Set())
  const [saving,             setSaving]            = useState(false)
  const [error,              setError]             = useState<string | null>(null)
  const [isDirty,            setIsDirty]           = useState(false)
  const [duplicateWarning,   setDuplicateWarning]  = useState<string | null>(null)
  const [parsedHint,         setParsedHint]         = useState<ArticleDraft | null>(null)
  const [autoFillMsg,        setAutoFillMsg]        = useState<{ key: string; text: string } | null>(null)
  // Campos preenchidos automaticamente (parser ou heurística). Limpos quando user edita.
  // Keys: 'gPerUnit' | `orderUnit_${linkKey}` | `conv_${linkKey}`
  const [autoFilled,         setAutoFilled]         = useState<Set<string>>(new Set())
  // Erros de parse "Cada embalagem traz" por link. Set on blur, clear on next change.
  // O input aceita linguagem de cozinha ("10kg", "2,5L") e parsePackagingQuantity
  // valida contra a unit do artigo. Erros NÃO bloqueiam digitação — só blur/save.
  const [convErrors,         setConvErrors]         = useState<Record<string, string>>({})
  // Erro de parse de "Peso médio por unidade". Mesmo padrão do convErrors:
  // setado no save se inválido (ex.: "1un", "500ml"), limpo on next change.
  const [gPerUnitError,      setGPerUnitError]      = useState<string | null>(null)

  const { aliases, learnAlias } = useOrgAliases()
  const rawNameRef              = useRef(existing?.name ?? '')
  const nameChangedAfterBlurRef = useRef(false)
  const parsedSeedRef           = useRef<ArticleDraft | null>(null)
  const autoFillTimerRef        = useRef<ReturnType<typeof setTimeout> | null>(null)
  const unitManuallySet         = useRef(!!existing)

  // ── Stock Mínimo: fonte de unidade (preferred → qualquer link → seed → base) ──
  // Usada para mostrar/inputar par level na unidade que o chef pensa (caixa, frasco)
  // mantendo par_level guardado em base_unit.
  //
  // conversion_factor vive em linguagem humana ("10 kg", "5 L"). parseFloat
  // disso devolve 10 / 5 — não 10000 / 5000. Usar parsePackagingQuantity
  // para extrair o factor real em base_unit.
  const linkFactor = (l: LinkRow): number => {
    const r = parsePackagingQuantity(l.conversion_factor, unit)
    return r.ok ? r.value : 0
  }
  const parPreferredLink = links.find(l =>
    l.is_preferred && l.order_unit.trim() && linkFactor(l) > 0
  )
  const parFallbackLink = !parPreferredLink
    ? links.find(l => l.order_unit.trim() && linkFactor(l) > 0)
    : undefined
  const parSeed = (!parPreferredLink && !parFallbackLink)
    ? parsedHint?.supplierSeed
    : undefined
  const parSeedHasFactor = !!parSeed?.order_unit && parSeed.conversion_factor != null
  const parMinUnit = parPreferredLink?.order_unit
    ?? parFallbackLink?.order_unit
    ?? (parSeedHasFactor ? parSeed!.order_unit : null)
  const parMinFactor = parPreferredLink
    ? linkFactor(parPreferredLink)
    : parFallbackLink
    ? linkFactor(parFallbackLink)
    : parSeedHasFactor
    ? parSeed!.conversion_factor!
    : 1
  const parUseOrderUnit = !!parMinUnit && parMinFactor > 0

  // Esconder bloco "Mede em" quando o parser detetou unidade base explícita
  // (weight/volume/unit com qty). Em edição mantém visível porque o artigo
  // já está guardado e o chef pode querer ajustar.
  const hideUnitBlock = !isEdit && parsedHint?.detected_qty != null

  const unmarkAuto = (field: string) => setAutoFilled(prev => {
    if (!prev.has(field)) return prev
    const next = new Set(prev)
    next.delete(field)
    return next
  })

  // Formata um conversion_factor (input em "linguagem de cozinha") para
  // display canónico. Round-trip via parsePackagingQuantity → formatBaseQty:
  //   "10kg" → 10000 → "10 kg"
  //   "5L"   → 5000  → "5 L"
  //   "180"  → 180   → "180 un"
  // Se não parsar (lixo), devolve raw inalterado para o user editar.
  const fmtFactor = (raw: string) => {
    const parsed = parsePackagingQuantity(raw, unit)
    if (parsed.ok) return formatBaseQty(parsed.value, unit)
    return raw
  }

  const handleNameBlur = () => {
    if (!name.trim()) return

    // Pipeline única — normaliza nome, infere unidade e categoria
    const normalized = normalizeArticleInput(name, aliases)

    // Normalizar nome (sempre — preserva escolha do utilizador via DICT/aliases)
    setName(normalized.name)
    // Bloco de normalização correu — reset do flag de edição manual
    nameChangedAfterBlurRef.current = false

    // Preencher campos vazios (nunca sobrescrever escolhas conscientes)
    if (!isEdit) {
      if (category.trim() === '' && normalized.category) setCategory(normalized.category)
      if (!unitManuallySet.current) setUnit(normalized.unit)
    }

    // Deteção de duplicados (só para artigos novos)
    if (!isEdit && articles) {
      const key = normalized.normalizedKey
      const dup = articles.find(a => normalizeKey(a.name) === key)
      setDuplicateWarning(dup ? `Artigo semelhante já existe: "${dup.name}"` : null)
    }
  }

  useEffect(() => {
    fetchAllSuppliers()
      .then(sups => setSuppliers(sups.filter(s => s.is_active)))
      .catch(() => {})

    if (existing) {
      fetchArticleSuppliers(existing.id)
        .then(rows => setLinks(rows.map(r => ({
          key:               nextKey(),
          supplier_id:       r.supplier_id,
          supplier_ref:      r.supplier_ref ?? '',
          price:             String(r.price),
          order_unit:        r.order_unit,
          // DB guarda em base_unit (10000 para 10kg). Display em "linguagem
          // de cozinha" via formatBaseQty: 10000 → "10 kg", 5000 → "5 L",
          // 180 → "180 un". parsePackagingQuantity faz round-trip seguro.
          conversion_factor: formatBaseQty(r.conversion_factor, (existing.unit ?? 'g') as 'g' | 'mL' | 'un'),
          is_preferred:      r.is_preferred,
        }))))
        .catch(() => {})
    }
  }, [existing])

  // Sincronizar display do Stock Mínimo quando a fonte de unidade muda
  // (e.g., adiciona/remove fornecedor, muda preferred ou conversion_factor).
  // Não inclui parLevel nas deps — durante digitação, o display é controlado
  // pelo onChange e re-derivar partiria valores intermédios como "1.".
  useEffect(() => {
    const base = parseFloat(parLevel) || 0
    if (base <= 0) {
      setParLevelDisplay('')
      return
    }
    setParLevelDisplay(
      parUseOrderUnit
        ? String(+(base / parMinFactor).toFixed(2))
        : parLevel
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parUseOrderUnit, parMinFactor])

  const updateLink = (key: string, partial: Partial<LinkRow>) =>
    setLinks(prev => prev.map(l => l.key === key ? { ...l, ...partial } : l))

  const setPreferred = (key: string) =>
    setLinks(prev => prev.map(l => ({ ...l, is_preferred: l.key === key })))

  const removeLink = (key: string) => {
    setLinks(prev => prev.filter(l => l.key !== key))
    setConvErrors(prev => {
      if (!prev[key]) return prev
      const next = { ...prev }
      delete next[key]
      return next
    })
  }

  const handleSave = async () => {
    if (!name.trim()) return setError('Nome é obrigatório')
    const par = parseFloat(parLevel)
    if (isNaN(par) || par < 0) return setError('Stock mínimo inválido')

    const validLinks = links.filter(l =>
      l.supplier_id && parseFloat(l.price) > 0 && l.order_unit.trim()
    )

    // Validar "Cada embalagem traz" para cada link válido. Vazio bloqueia
    // (não há default — silenciar 1 cria stocks errados em g/mL). Recolhe
    // TODOS os erros antes de bloquear para o chef ver tudo de uma vez.
    // "1" sem sufixo continua válido (= 1 base_unit, dose individual).
    const parsedFactors: Record<string, number>  = {}
    const newConvErrors: Record<string, string>  = {}
    for (const link of validLinks) {
      const raw = link.conversion_factor.trim()
      if (raw === '') {
        newConvErrors[link.key] = 'Indica quanto traz cada embalagem.'
        continue
      }
      const parsed = parsePackagingQuantity(raw, unit)
      if (!parsed.ok) {
        newConvErrors[link.key] = parsed.reason === 'INCOMPATIBLE_UNIT'
          ? 'Esta quantidade não combina com a unidade do artigo.'
          : 'Formato inválido. ' + packagingHelperText(unit) + '.'
        continue
      }
      parsedFactors[link.key] = parsed.value
    }

    if (Object.keys(newConvErrors).length > 0) {
      setConvErrors(prev => ({ ...prev, ...newConvErrors }))
      const errKeys = Object.keys(newConvErrors)
      if (errKeys.length === 1) {
        const k = errKeys[0]
        const lk = validLinks.find(l => l.key === k)!
        const supplierName = suppliers.find(s => s.id === lk.supplier_id)?.name ?? 'desconhecido'
        return setError(`Fornecedor "${supplierName}": ${newConvErrors[k]}`)
      }
      return setError('Verifica os fornecedores: campos com erro.')
    }

    // Validar "Peso médio por unidade" — input livre que aceita "180", "180g",
    // "0,18kg". Reusa parsePackagingQuantity com 'g' como articleUnit, o que
    // automaticamente rejeita "1un" e "500ml" como INCOMPATIBLE_UNIT.
    let gPerValue: number | null = null
    if (unit === 'un') {
      const rawG = gPerUnit.trim()
      if (rawG !== '') {
        const parsedG = parsePackagingQuantity(rawG, 'g')
        if (!parsedG.ok) {
          setGPerUnitError('Indica um peso válido por unidade.')
          return setError('Peso médio por unidade: indica um peso válido (ex: 180g).')
        }
        gPerValue = parsedG.value
      }
    }

    setSaving(true)
    setError(null)
    try {
      const normalized = normalizeArticleInput(name.trim(), aliases)
      const input = {
        name:       normalized.name,
        unit:       unit.trim(),
        par_level:  par,
        category:   category.trim() || undefined,
        g_per_unit: gPerValue,
      }

      let saved: Article
      if (isEdit && existing) {
        await updateArticle(existing.id, input)
        saved = { ...existing, ...input } as Article
      } else {
        saved = await createArticle(input)
      }

      await saveArticleSuppliers(saved.id, validLinks.map((l) => ({
        supplier_id:       l.supplier_id,
        supplier_ref:      l.supplier_ref.trim() || null,
        price:             parseFloat(l.price),
        order_unit:        l.order_unit.trim(),
        // parsedFactors[l.key] está sempre populado: a validação acima
        // bloqueia o save em qualquer link válido sem factor parsado.
        conversion_factor: parsedFactors[l.key],
        is_preferred:      validLinks.length === 1 ? true : l.is_preferred,
      })))

      // Criação manual: se o parser detetou supplierSeed e não foi guardado
      // nenhum fornecedor real, persistir a embalagem como article_size para
      // o inventário ter unidade operacional. Idempotente; falha não bloqueia.
      const seed = parsedSeedRef.current?.supplierSeed
      if (
        !isEdit &&
        validLinks.length === 0 &&
        seed?.order_unit &&
        seed.conversion_factor != null &&
        seed.conversion_factor > 0 &&
        seed.order_unit !== input.unit
      ) {
        try {
          await createArticleSizeIfMissing(saved.id, seed.order_unit, seed.conversion_factor)
        } catch (e) {
          console.error('createArticleSize falhou:', { articleId: saved.id, label: seed.order_unit, error: e })
        }
      }

      maybeLearnAlias(
        rawNameRef.current,
        input.name,
        aliases,
        learnAlias,
        nameChangedAfterBlurRef.current,
      )

      setIsDirty(false)
      onSaved(saved)
    } catch (e: unknown) {
      setError((e as Error).message ?? 'Erro ao guardar')
    } finally {
      setSaving(false)
    }
  }

  const handleToggleActive = async () => {
    if (!existing) return
    if (existing.is_active && !confirm(`Desativar "${existing.name}"? O artigo deixa de aparecer nas sugestões de encomenda.`)) return
    setSaving(true)
    setError(null)
    try {
      await toggleArticleActive(existing.id, !existing.is_active)
      onSaved({ ...existing, is_active: !existing.is_active })
    } catch (e: unknown) {
      setError((e as Error).message ?? 'Erro ao alterar estado')
    } finally {
      setSaving(false)
    }
  }

  const handleCancel = () => {
    if (isDirty && !confirm('Tens alterações não guardadas. Sair na mesma?')) return
    onCancel()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Estilos scoped — focus rings, hover do chevron e do save CTA.
          Inline porque são :pseudo-classes que CSS-in-JS não suporta
          directamente, e o pattern (style block local) já existe em
          InventoryScreen para keyframes. */}
      <style>{`
        .zesto-form-input:focus,
        .zesto-form-cell:focus,
        .zesto-form-num:focus,
        .zesto-form-input-wrap:focus-within {
          border-color: var(--action);
          box-shadow: 0 0 0 4px var(--action-glow);
        }
        .zesto-back-btn:hover {
          background: var(--action-glow);
          color: var(--action);
        }
        .zesto-back-btn:active {
          transform: scale(0.94);
        }
        .zesto-save-cta {
          box-shadow: 0 6px 16px rgba(196, 106, 45, 0.28),
                      0 1px 0 rgba(168, 88, 34, 0.6) inset;
        }
        .zesto-save-cta:hover:not(:disabled) {
          background: var(--action-hover);
          transform: translateY(-1px);
          box-shadow: 0 10px 22px rgba(196, 106, 45, 0.34),
                      0 1px 0 rgba(168, 88, 34, 0.6) inset;
        }
        .zesto-save-cta:active:not(:disabled) {
          transform: translateY(0);
          box-shadow: 0 3px 10px rgba(196, 106, 45, 0.22),
                      0 1px 0 rgba(168, 88, 34, 0.6) inset;
        }
        .zesto-option:hover {
          background: var(--bg) !important;
        }
        .zesto-option[aria-selected="true"]:hover {
          background: var(--action-surface) !important;
        }
      `}</style>

      {/* Header editorial — título Playfair Display 22px com ponto separador.
          Promovido de eyebrow tracked (10px) para título a sério, alinhado
          com o peso visual de "Artigos · 124" da lista. O nome do artigo
          continua a viver só no campo NOME do body, sem duplicação. */}
      <div style={{
        flexShrink: 0,
        padding:    '18px 28px 14px',
        display:    'flex',
        alignItems: 'center',
        gap:        14,
      }}>
        <button
          type="button"
          onClick={handleCancel}
          aria-label="Voltar"
          className="zesto-back-btn"
          style={{
            width:          'var(--touch-min)',
            height:         'var(--touch-min)',
            borderRadius:   '50%',
            border:         'none',
            background:     'transparent',
            color:          'var(--text-muted)',
            fontSize:       22,
            cursor:         'pointer',
            display:        'flex',
            alignItems:     'center',
            justifyContent: 'center',
            flexShrink:     0,
            touchAction:    'manipulation',
            transition:     'background 0.18s, color 0.18s, transform 0.18s',
          }}
        >
          ←
        </button>
        <h1 style={{
          fontFamily:    "'Playfair Display', serif",
          fontSize:      22,
          fontWeight:    500,
          color:         'var(--action)',
          letterSpacing: '-0.01em',
          margin:        0,
          lineHeight:    1.2,
        }}>
          {isEdit ? 'Editar' : 'Novo'}
          <span style={{ color: 'var(--text-subtle)', margin: '0 8px', fontWeight: 400 }}>·</span>
          Artigo
        </h1>
      </div>

      {/* Hairline separator */}
      <div style={{
        flexShrink: 0,
        height:     1,
        background: 'var(--border)',
        margin:     '0 28px',
      }} />

      {/* Body — gap 14 + top padding 18 para máxima densidade sem
          perder respiração. Padding lateral 28px alinha com header. */}
      <div style={{
        flex:          1,
        overflowY:     'auto',
        display:       'flex',
        flexDirection: 'column',
        gap:           14,
        padding:       '18px 28px 12px',
      }}>

        {/* Section: Detalhes — agrupa identidade (nome, categoria), unidade
            (base + peso médio) e stock mínimo. Em par com FORNECEDORES (a
            outra colecção mais abaixo) cria duas âncoras editoriais claras.
            `flush` porque é flex item directo: o gap do parent (14) é o que
            espaça do NOME que vem a seguir. */}
        <SectionTitle flush>Detalhes</SectionTitle>

        {/* Name */}
        <div>
          <label style={labelStyle}>NOME</label>
          <input
            type="text"
            placeholder="ex: Mel Silvestre"
            value={name}
            autoFocus={!isEdit}
            onChange={e => {
              const val = e.target.value
              setName(val)
              rawNameRef.current = val
              nameChangedAfterBlurRef.current = true
              setIsDirty(true)
              if (duplicateWarning) setDuplicateWarning(null)
              // Inferência de unidade base em tempo real
              if (!isEdit && !unitManuallySet.current) {
                setUnit(normalizeArticleInput(val, aliases).unit)
              }
              // Hint de parsing em tempo real + seed para auto-fill do fornecedor
              const draft = buildArticleDraft(val, aliases)
              const hasExtracted =
                draft.detected_qty != null ||
                draft.detected_label != null ||
                draft.supplierSeed != null
              setParsedHint(hasExtracted ? draft : null)
              parsedSeedRef.current = hasExtracted ? draft : null
            }}
            onBlur={handleNameBlur}
            onKeyDown={e => { if (e.key === 'Enter' && name.trim()) handleSave() }}
            className="zesto-form-input"
            style={{
              ...inputStyle,
              height:        48,
              fontSize:      17,
              fontFamily:    "'Playfair Display', serif",
              fontWeight:    500,
              letterSpacing: '-0.01em',
              padding:       '0 16px',
            }}
          />
          {duplicateWarning && (
            <p style={{ fontSize: 11, color: 'var(--warning)', marginTop: 4 }}>
              {duplicateWarning}
            </p>
          )}
          {parsedHint && !duplicateWarning && (
            <p style={{
              fontSize:   11,
              color:      'var(--text-muted)',
              marginTop:  4,
              lineHeight: 1.4,
              fontFamily: 'JetBrains Mono, monospace',
            }}>
              {formatDraftHint(parsedHint)}
            </p>
          )}
        </div>

        {/* Categoria — chips em scroll horizontal (mesmo pattern dos
            filtros da lista: familiar, compacto, mobile-first). Custom
            categoria é um toggle discreto que só aparece quando preciso —
            no caso normal, o parser já preencheu uma categoria standard
            e o chef apenas confirma com um tap. */}
        <CategoryField
          value={category}
          onChange={(v) => { setCategory(v); setIsDirty(true) }}
        />

        {/* UNIDADE — sozinha na sua row. PESO MÉDIO desce para a row
            seguinte com a Sugestão Zesto inline ao lado. Vantagem dupla:
            (1) input do peso ganha largura confortável; (2) sugestão fica
            fisicamente adjacente ao alvo onde será injectada — proximidade
            espacial = relação causal directa, o tap "puxa" o valor para o
            input ao lado. hideUnitBlock continua a esconder em criação
            quando o parser detectou peso/volume explícito. */}
        {!hideUnitBlock && (
          <>
          <div>
            <label style={labelStyle}>UNIDADE</label>
            <div style={{
              display:      'inline-flex',
              padding:      4,
              borderRadius: 12,
              background:   'var(--surface)',
              border:       '1px solid var(--border)',
              gap:          2,
            }}>
              {(['g', 'mL', 'un'] as const).map((u) => {
                const isSelected = unit === u
                return (
                  <button
                    key={u}
                    type="button"
                    onClick={() => {
                      setUnit(u)
                      unitManuallySet.current = true
                      setIsDirty(true)
                    }}
                    style={{
                      minWidth:      48,
                      height:        40,
                      padding:       '0 14px',
                      border:        'none',
                      borderRadius:  8,
                      background:    isSelected ? 'var(--action)' : 'transparent',
                      color:         isSelected ? 'var(--text-on-primary)' : 'var(--text-muted)',
                      fontFamily:    "'JetBrains Mono', monospace",
                      fontSize:      14,
                      fontWeight:    isSelected ? 700 : 500,
                      letterSpacing: '0.02em',
                      cursor:        'pointer',
                      transition:    'background 0.18s, color 0.18s, box-shadow 0.18s',
                      boxShadow:     isSelected ? '0 2px 8px rgba(196, 106, 45, 0.3)' : 'none',
                    }}
                  >
                    {u}
                  </button>
                )
              })}
            </div>
          </div>

          {/* PESO MÉDIO POR UNIDADE — input + sugestão Zesto inline */}
          {unit === 'un' && (() => {
            const parsedG    = parsePackagingQuantity(gPerUnit, 'g')
            const gNum       = parsedG.ok ? parsedG.value : null
            const hasValue   = gNum != null && gNum > 0
            const outOfRange = hasValue && (gNum < 5 || gNum > 2000)
            const suggestion = !gPerUnit.trim() && name.trim().length >= 3
              ? getSuggestedUnitWeight(name)
              : null
            return (
              <div>
                <div style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span>PESO MÉDIO POR UNIDADE</span>
                  <HelpTip text="Peso bruto do produto cru/inteiro, como chega à cozinha (com casca, pele ou caroço quando aplicável)." />
                </div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'stretch', flexWrap: 'wrap' }}>
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="ex: 180g"
                    value={gPerUnit}
                    onChange={e => {
                      setGPerUnit(e.target.value)
                      setIsDirty(true)
                      if (gPerUnitError) setGPerUnitError(null)
                    }}
                    className="zesto-form-num"
                    style={{ ...numericInputStyle, flex: '1 1 180px' }}
                  />
                  {suggestion != null && (
                    <button
                      type="button"
                      onClick={() => {
                        setGPerUnit(String(suggestion))
                        setIsDirty(true)
                      }}
                      aria-label={`Usar sugestão Zesto: ${suggestion}g`}
                      style={{
                        flex:           '0 1 auto',
                        minWidth:       0,
                        height:         48,
                        padding:        '0 14px',
                        background:     'var(--action-surface)',
                        border:         '1px solid var(--action-glow)',
                        borderRadius:   8,
                        cursor:         'pointer',
                        fontFamily:     'inherit',
                        fontSize:       13,
                        color:          'var(--text-muted)',
                        touchAction:    'manipulation',
                        display:        'flex',
                        alignItems:     'center',
                        gap:            10,
                        whiteSpace:     'nowrap',
                        transition:     'background 0.15s, border-color 0.15s',
                      }}
                    >
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
                        ≈{' '}
                        <span style={{
                          fontFamily: "'JetBrains Mono', monospace",
                          fontWeight: 700,
                          color:      'var(--action)',
                        }}>
                          {suggestion}g
                        </span>
                      </span>
                      <span style={{
                        color:         'var(--action)',
                        fontWeight:    600,
                        fontSize:      12,
                        letterSpacing: '0.02em',
                        flexShrink:    0,
                      }}>
                        Usar →
                      </span>
                    </button>
                  )}
                </div>
                {gPerUnitError && (
                  <p style={{ fontSize: 11, color: 'var(--error)', margin: '6px 0 0', lineHeight: 1.4 }}>
                    {gPerUnitError}
                  </p>
                )}
                {!gPerUnitError && outOfRange && (
                  <p style={{ fontSize: 11, color: 'var(--warning)', margin: '6px 0 0', lineHeight: 1.5 }}>
                    Valor fora do esperado (5–2000g) — confirma se correto.
                  </p>
                )}
              </div>
            )
          })()}
          </>
        )}

        {/* STOCK MÍNIMO — único campo na zona de stock. SectionTitle
            "Stock" eliminado: 1 campo não justifica section header. A
            label "STOCK MÍNIMO" (uppercase + tracking) já actua como
            organizador visual. SectionTitle FORNECEDORES mantém-se
            porque é colecção real (várias linhas).
            Input + sufixo "un" partilham a mesma caixa via wrapper com
            focus-within: ler "5 un" como uma unidade visual em vez de
            "5" + chip flutuante de unidade ao lado. Largura cheia para
            consistência com os outros inputs (NOME, PESO MÉDIO). */}
        <div>
          <div style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span>STOCK MÍNIMO</span>
            <HelpTip text="Abaixo deste valor, o Zesto sugere encomenda." />
          </div>
          <div className="zesto-form-input-wrap" style={{
            display:      'flex',
            alignItems:   'center',
            height:       48,
            background:   'var(--surface)',
            border:       '1px solid var(--border)',
            borderRadius: 8,
            padding:      '0 14px',
            transition:   'border-color 0.15s, box-shadow 0.15s',
          }}>
            <input
              type="text"
              inputMode="decimal"
              placeholder="0"
              value={parLevelDisplay}
              onChange={e => {
                const v = e.target.value
                setParLevelDisplay(v)
                const num = parseFloat(v)
                if (v === '' || isNaN(num) || num < 0) {
                  setParLevel('')
                } else {
                  setParLevel(String(parUseOrderUnit ? num * parMinFactor : num))
                }
                setIsDirty(true)
              }}
              style={{
                flex:          1,
                minWidth:      0,
                height:        '100%',
                background:    'transparent',
                border:        'none',
                outline:       'none',
                color:         'var(--text)',
                fontFamily:    "'JetBrains Mono', monospace",
                fontSize:      20,
                fontWeight:    600,
                letterSpacing: '-0.01em',
                padding:       0,
              }}
            />
            <span style={{
              fontSize:      13,
              fontWeight:    600,
              color:         'var(--text-muted)',
              fontFamily:    "'JetBrains Mono', monospace",
              letterSpacing: '0.04em',
              flexShrink:    0,
              paddingLeft:   8,
            }}>
              {parMinUnit ?? unit}
            </span>
          </div>
          {parUseOrderUnit && (parseFloat(parLevel) || 0) > 0 && (
            <p style={{
              fontSize:   11,
              color:      'var(--text-subtle)',
              fontFamily: "'JetBrains Mono', monospace",
              margin:     '6px 0 0',
            }}>
              ≈ {formatStockQty(parseFloat(parLevel), unit)}
            </p>
          )}
        </div>

        {/* Supplier links */}
        <div>
          <SectionTitle>Fornecedores</SectionTitle>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {links.map(link => {
              // Aviso de inconsistência: mesmo order_unit, conversion_factor diferente.
              // Comparação em base_unit via parsePackagingQuantity (estado armazena
              // texto humano "10kg", não número raw).
              const currentParsed = parsePackagingQuantity(link.conversion_factor, unit)
              const refLink = link.order_unit.trim()
                ? links.find(l => {
                    if (l.key === link.key || l.order_unit.trim() !== link.order_unit.trim()) return false
                    const p = parsePackagingQuantity(l.conversion_factor, unit)
                    return p.ok && p.value > 0
                  })
                : undefined
              const refParsed = refLink ? parsePackagingQuantity(refLink.conversion_factor, unit) : null
              const conversionMismatch =
                currentParsed.ok && refParsed?.ok && refParsed.value !== currentParsed.value
                  ? `Este artigo já usa 1 ${refLink!.order_unit} = ${formatBaseQty(refParsed.value, unit)} noutro fornecedor`
                  : null

              return (
              <div
                key={link.key}
                style={{
                  background:    'var(--surface)',
                  border:        '1px solid var(--border)',
                  borderRadius:  10,
                  padding:       '10px 12px',
                  display:       'flex',
                  flexDirection: 'column',
                  gap:           8,
                }}
              >
                {/* Row 1: supplier + star + delete */}
                <div style={{ display: 'flex', gap: 8 }}>
                  <SupplierSelect
                    value={link.supplier_id}
                    onChange={(id) => { updateLink(link.key, { supplier_id: id }); setIsDirty(true) }}
                    suppliers={suppliers}
                  />
                  <button
                    onClick={() => setPreferred(link.key)}
                    title="Fornecedor preferido"
                    style={{
                      width: 44, height: 44, borderRadius: 6, flexShrink: 0,
                      border: link.is_preferred ? '1px solid var(--action)' : '1px solid var(--border)',
                      background: link.is_preferred ? 'var(--action)' : 'transparent',
                      color: link.is_preferred ? 'var(--text-on-primary)' : 'var(--text-subtle)',
                      fontSize: 18, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}
                  >{link.is_preferred ? '★' : '☆'}</button>
                  <button
                    onClick={() => { removeLink(link.key); setIsDirty(true) }}
                    style={{ width: 44, height: 44, borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-subtle)', fontSize: 18, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
                  >×</button>
                </div>

                {/* Row 2: price + order unit */}
                <div style={{ display: 'flex', gap: 8 }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: 10, color: 'var(--text-subtle)', display: 'block', marginBottom: 2 }}>PREÇO (€)</label>
                    <input
                      type="text"
                      inputMode="decimal"
                      placeholder="0.00"
                      value={link.price}
                      onChange={e => { updateLink(link.key, { price: e.target.value }); setIsDirty(true) }}
                      className="zesto-form-cell" style={cellInput}
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={{
                      fontSize: 10, color: 'var(--text-subtle)',
                      display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2,
                      letterSpacing: '0.08em', fontWeight: 700, textTransform: 'uppercase',
                    }}>
                      <span>Compra em</span>
                      {autoFilled.has(`orderUnit_${link.key}`) && (
                        <span style={{
                          fontFamily:    'JetBrains Mono, monospace',
                          letterSpacing: '0.05em',
                          color:         'var(--text-subtle)',
                          fontWeight:    400,
                        }}>·auto</span>
                      )}
                    </label>
                    <UnitCombo
                      value={link.order_unit}
                      onChange={(v) => {
                        updateLink(link.key, { order_unit: v })
                        unmarkAuto(`orderUnit_${link.key}`)
                        setIsDirty(true)
                        if (autoFillMsg?.key === link.key) setAutoFillMsg(null)
                      }}
                      onBlur={() => updateLink(link.key, { order_unit: link.order_unit.trim().toLowerCase() })}
                      options={ORDER_UNITS}
                      placeholder="caixa, saco, frasco…"
                    />
                  </div>
                </div>

                {/* Auto-fill feedback */}
                {autoFillMsg?.key === link.key && (
                  <p style={{
                    fontSize:    10,
                    color:       'var(--text-subtle)',
                    fontFamily:  'JetBrains Mono, monospace',
                    letterSpacing: '0.04em',
                    margin:      0,
                  }}>
                    {autoFillMsg.text}
                  </p>
                )}

                {/* "Cada embalagem traz" — visível por defeito (deixou de
                    estar atrás de toggle). Aceita linguagem de cozinha
                    ("10kg", "2,5L", "180") via parsePackagingQuantity.
                    Validação só on blur/save — não interrompe digitação. */}
                <div>
                  <label style={{
                    fontSize: 10, color: 'var(--text-subtle)',
                    display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2,
                    letterSpacing: '0.08em', fontWeight: 700, textTransform: 'uppercase',
                  }}>
                    <span>Cada embalagem traz</span>
                    {autoFilled.has(`conv_${link.key}`) && (
                      <span style={{
                        fontFamily:    'JetBrains Mono, monospace',
                        letterSpacing: '0.05em',
                        color:         'var(--text-subtle)',
                        fontWeight:    400,
                      }}>·auto</span>
                    )}
                  </label>
                  <input
                    type="text"
                    placeholder={packagingHelperText(unit).replace('Ex: ', '').split(',')[0]}
                    value={link.conversion_factor}
                    onChange={e => {
                      updateLink(link.key, { conversion_factor: e.target.value })
                      unmarkAuto(`conv_${link.key}`)
                      setIsDirty(true)
                      if (autoFillMsg?.key === link.key) setAutoFillMsg(null)
                      // Limpa erro on next change — chef recomeçou a editar.
                      if (convErrors[link.key]) {
                        setConvErrors(prev => { const n = {...prev}; delete n[link.key]; return n })
                      }
                    }}
                    onBlur={e => {
                      const raw = e.target.value.trim()
                      if (!raw || raw === '1') return  // default OK, sem validação
                      const parsed = parsePackagingQuantity(raw, unit)
                      if (!parsed.ok) {
                        setConvErrors(prev => ({
                          ...prev,
                          [link.key]: parsed.reason === 'INCOMPATIBLE_UNIT'
                            ? 'Esta quantidade não combina com a unidade do artigo.'
                            : 'Formato inválido. ' + packagingHelperText(unit) + '.',
                        }))
                      }
                    }}
                    className="zesto-form-cell" style={cellInput}
                  />
                  {/* Erro inline tem prioridade sobre helper e mismatch. */}
                  {convErrors[link.key] ? (
                    <p style={{ fontSize: 11, color: 'var(--error)', margin: '4px 0 0', lineHeight: 1.4 }}>
                      {convErrors[link.key]}
                    </p>
                  ) : conversionMismatch ? (
                    <p style={{ fontSize: 10, color: 'var(--warning)', fontFamily: "'JetBrains Mono', monospace", margin: '4px 0 0' }}>
                      {conversionMismatch}
                    </p>
                  ) : (
                    <p style={{ fontSize: 10, color: 'var(--text-subtle)', margin: '4px 0 0' }}>
                      {packagingHelperText(unit)}
                    </p>
                  )}
                </div>

                {/* Toggle só para Referência — único campo opcional. */}
                <button
                  type="button"
                  onClick={() => setExpandedLinks(prev => {
                    const next = new Set(prev)
                    if (next.has(link.key)) next.delete(link.key); else next.add(link.key)
                    return next
                  })}
                  style={{ background: 'none', border: 'none', padding: 0, color: 'var(--text-subtle)', fontSize: 11, cursor: 'pointer', textAlign: 'left', letterSpacing: '0.04em' }}
                >
                  {expandedLinks.has(link.key) ? '▾ Ocultar referência' : '› Referência (opcional)'}
                </button>

                {expandedLinks.has(link.key) && (
                  <input
                    type="text"
                    placeholder="Ref. fornecedor (opcional)"
                    value={link.supplier_ref}
                    onChange={e => { updateLink(link.key, { supplier_ref: e.target.value }); setIsDirty(true) }}
                    className="zesto-form-cell" style={cellInput}
                  />
                )}
              </div>
              )
            })}
          </div>

          <button
            onClick={() => {
              const seed       = parsedSeedRef.current?.supplierSeed
              const link       = emptyLink()
              let msg          = ''

              const autoFields: string[] = []
              if (seed) {
                if (seed.order_unit) {
                  link.order_unit = seed.order_unit
                  autoFields.push(`orderUnit_${link.key}`)
                }
                if (seed.conversion_factor != null) {
                  // Seed do parser dá número raw em base_unit (ex: 1000 para
                  // "1kg"). Formatar para "linguagem de cozinha" antes de pôr
                  // no input — o chef vê "1 kg", não "1000".
                  link.conversion_factor = formatBaseQty(seed.conversion_factor, unit)
                  autoFields.push(`conv_${link.key}`)
                }

                const hasConversion = link.conversion_factor !== '1' && link.conversion_factor !== ''
                const hasPackaging  = !!link.order_unit
                if (hasPackaging && hasConversion) {
                  msg = `Auto: 1 ${link.order_unit} = ${fmtFactor(link.conversion_factor)}`
                } else if (hasPackaging) {
                  msg = `Auto: unidade de compra = ${link.order_unit}`
                } else if (hasConversion) {
                  msg = `Auto: ${fmtFactor(link.conversion_factor)}`
                }
              }

              setLinks(prev => [...prev, link])
              if (autoFields.length > 0) {
                setAutoFilled(prev => new Set([...prev, ...autoFields]))
              }
              if (msg) {
                setAutoFillMsg({ key: link.key, text: msg })
                if (autoFillTimerRef.current) clearTimeout(autoFillTimerRef.current)
                autoFillTimerRef.current = setTimeout(() => setAutoFillMsg(null), 2000)
              }
              setIsDirty(true)
            }}
            style={{
              width:        '100%',
              height:       44,
              marginTop:    10,
              borderRadius: 8,
              border:       '1px dashed var(--border)',
              background:   'var(--surface)',
              color:        'var(--text-muted)',
              fontSize:     13,
              fontWeight:   500,
              cursor:       'pointer',
            }}
          >
            + Adicionar Fornecedor
          </button>
        </div>

        {/* Desativar — render directo, sem header "Zona de risco" formal:
            é uma única acção destrutiva. Promovemos a secção quando houver
            mais (eliminar, exportar, etc.). */}
        {isEdit && (
          <div style={{ paddingTop: 16, borderTop: `1px solid var(--border)` }}>
            <button
              onClick={handleToggleActive}
              disabled={saving}
              style={{
                width:        '100%',
                height:       44,
                borderRadius: 8,
                border:       existing.is_active
                  ? `1px solid var(--error-border)`
                  : '1px solid var(--success-border)',
                background:   existing.is_active
                  ? 'var(--error-surface)'
                  : 'var(--success-surface)',
                color:        existing.is_active ? 'var(--error)' : 'var(--success)',
                fontSize:     13,
                fontWeight:   600,
                cursor:       'pointer',
              }}
            >
              {existing.is_active ? 'Desativar Artigo' : 'Reativar Artigo'}
            </button>
          </div>
        )}

        {error && (
          <div style={{ background: 'var(--error-surface)', border: `1px solid var(--error-border)`, borderRadius: 8, padding: '10px 14px', color: 'var(--error)', fontSize: 13 }}>
            {error}
          </div>
        )}
      </div>

      {/* Footer floating — sombra subtle em cima em vez de border duro,
          dá profundidade de toolbar elevada sem ruído visual. */}
      <div style={{
        padding:    '14px 28px 22px',
        background: 'var(--bg)',
        boxShadow:  '0 -10px 20px -12px rgba(28, 20, 10, 0.08)',
        flexShrink: 0,
      }}>
        <button
          onClick={handleSave}
          disabled={saving}
          className="zesto-save-cta"
          style={{
            width:         '100%',
            height:        56,
            borderRadius:  12,
            border:        'none',
            background:    'var(--action)',
            color:         'var(--text-on-primary)',
            fontSize:      15,
            fontWeight:    600,
            letterSpacing: '0.02em',
            cursor:        saving ? 'default' : 'pointer',
            opacity:       saving ? 0.7 : 1,
            transition:    'background 0.18s, transform 0.18s, box-shadow 0.18s, opacity 0.15s',
          }}
        >
          {saving ? 'A guardar…' : isEdit ? 'Guardar Alterações' : 'Guardar Artigo'}
        </button>
      </div>
    </div>
  )
}

// ── CategoryField ────────────────────────────────────────────────────────────
// Estado colapsado por defeito: chip único com a categoria actual + texto
// "→ outras" que abre popover com todas as opções. Razão: na maioria das
// edições a categoria já está correcta; mostrar 8 chips em scroll horizontal
// é ruído visual. Em criação, o parser preencheu uma sugestão; o chef
// confirma com 0 toques ou tem 1 atalho para a mudar.
//
// Popover ancora ao chip e contém: lista vertical de categorias standard +
// toggle "Personalizada" para input livre. Click outside / Escape fecha.

function CategoryField({
  value,
  onChange,
}: {
  value:    string
  onChange: (next: string) => void
}) {
  const isStandard = (ARTICLE_CATEGORIES as readonly string[]).includes(value)
  const isCustom   = !!value && !isStandard
  const [open,        setOpen]        = useState(false)
  const [showCustom,  setShowCustom]  = useState(isCustom)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointer = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', onPointer)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onPointer)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const display      = value || 'Escolher categoria'
  const hasValue     = !!value

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <label style={labelStyle}>CATEGORIA</label>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        {/* Chip da categoria actual — display-only (NÃO interactivo). Estado
            visual neutro (surface + texto), sem laranja. A acção de mudar
            vive exclusivamente no botão "→ outras" ao lado para evitar dois
            triggers visualmente indistintos a competir pelo mesmo input.
            Por isso é <span>, não <button> — afirma "isto é informação,
            não controlo". */}
        <span
          style={{
            minHeight:     'var(--touch-min)',
            display:       'inline-flex',
            alignItems:    'center',
            padding:       '0 16px',
            borderRadius:  24,
            border:        `1px solid var(--border)`,
            background:    'var(--surface)',
            color:         hasValue ? 'var(--text)' : 'var(--text-subtle)',
            fontSize:      13,
            fontWeight:    hasValue ? 600 : 500,
            fontStyle:     hasValue ? 'normal' : 'italic',
            whiteSpace:    'nowrap',
            fontFamily:    'inherit',
          }}
        >
          {display}
        </span>

        {/* Único trigger — abre o popover com todas as categorias. */}
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          aria-haspopup="listbox"
          aria-expanded={open}
          style={{
            background:    'transparent',
            border:        'none',
            padding:       '0 4px',
            color:         'var(--action)',
            fontSize:      12,
            fontWeight:    600,
            letterSpacing: '0.04em',
            cursor:        'pointer',
            touchAction:   'manipulation',
            fontFamily:    'inherit',
            minHeight:     32,
          }}
        >
          → outras
        </button>
      </div>

      {open && (
        <div
          role="listbox"
          style={{
            position:     'absolute',
            top:          'calc(100% + 8px)',
            left:         0,
            right:        0,
            background:   'var(--surface-2)',
            border:       '1px solid var(--border)',
            borderRadius: 12,
            boxShadow:    '0 12px 32px rgba(28, 20, 10, 0.16)',
            padding:      6,
            zIndex:       100,
            maxHeight:    340,
            overflowY:    'auto',
          }}
        >
          {ARTICLE_CATEGORIES.map(cat => {
            const isSelected = value === cat
            return (
              <button
                key={cat}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => {
                  onChange(cat)
                  setShowCustom(false)
                  setOpen(false)
                }}
                className="zesto-option"
                style={{
                  width:         '100%',
                  minHeight:     44,
                  padding:       '10px 14px',
                  textAlign:     'left',
                  border:        'none',
                  borderRadius:  8,
                  background:    isSelected ? 'var(--action-surface)' : 'transparent',
                  color:         isSelected ? 'var(--action)' : 'var(--text)',
                  fontSize:      14,
                  fontWeight:    isSelected ? 600 : 500,
                  cursor:        'pointer',
                  display:       'flex',
                  alignItems:    'center',
                  gap:           10,
                  fontFamily:    'inherit',
                  transition:    'background 0.12s',
                }}
              >
                <span aria-hidden style={{
                  width:      14,
                  display:    'inline-block',
                  textAlign:  'center',
                  color:      isSelected ? 'var(--action)' : 'transparent',
                  fontSize:   13,
                  fontWeight: 700,
                  flexShrink: 0,
                }}>
                  ✓
                </span>
                {cat}
              </button>
            )
          })}

          {/* Separator + toggle Personalizada */}
          <div style={{
            height:    1,
            background: 'var(--border)',
            margin:    '6px 12px',
          }} />

          <button
            type="button"
            onClick={() => {
              setShowCustom(true)
              setOpen(false)
            }}
            style={{
              width:         '100%',
              minHeight:     44,
              padding:       '10px 14px',
              textAlign:     'left',
              border:        'none',
              borderRadius:  8,
              background:    showCustom ? 'var(--action-surface)' : 'transparent',
              color:         showCustom ? 'var(--action)' : 'var(--text-muted)',
              fontSize:      13,
              fontWeight:    500,
              cursor:        'pointer',
              fontFamily:    'inherit',
              fontStyle:     'italic',
            }}
            className="zesto-option"
          >
            + Personalizada…
          </button>
        </div>
      )}

      {showCustom && (
        <input
          type="text"
          placeholder="Categoria personalizada…"
          value={isCustom ? value : ''}
          onChange={e => onChange(e.target.value)}
          autoFocus
          className="zesto-form-input"
          style={{
            marginTop:    10,
            width:        '100%',
            height:       44,
            background:   'var(--surface)',
            border:       '1px solid var(--border)',
            borderRadius: 8,
            padding:      '0 14px',
            color:        'var(--text)',
            fontSize:     14,
            outline:      'none',
            transition:   'border-color 0.15s, box-shadow 0.15s',
          }}
        />
      )}
    </div>
  )
}

// ── SupplierSelect ───────────────────────────────────────────────────────────
// Custom select para escolha de fornecedor. Substitui o <select> nativo que
// usava UA styling do sistema (highlight azul, font do OS, dropdown genérico).
// Pop-over editorial em --surface-2 com items 40px tall, hover suave e check
// laranja no item activo.

function SupplierSelect({
  value,
  onChange,
  suppliers,
  placeholder = 'Selecionar fornecedor…',
}: {
  value:        string
  onChange:     (id: string) => void
  suppliers:    Supplier[]
  placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const selected = suppliers.find(s => s.id === value)

  useEffect(() => {
    if (!open) return
    const onPointer = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', onPointer)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onPointer)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={ref} style={{ position: 'relative', flex: 1, minWidth: 0 }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        style={{
          width:          '100%',
          height:         44,
          padding:        '0 12px',
          background:     'var(--surface)',
          border:         `1px solid ${open ? 'var(--action)' : 'var(--border)'}`,
          borderRadius:   8,
          color:          selected ? 'var(--text)' : 'var(--text-subtle)',
          fontSize:       14,
          textAlign:      'left',
          cursor:         'pointer',
          display:        'flex',
          alignItems:     'center',
          justifyContent: 'space-between',
          gap:            8,
          fontFamily:     'inherit',
          touchAction:    'manipulation',
          boxShadow:      open ? '0 0 0 4px var(--action-glow)' : 'none',
          transition:     'border-color 0.15s, box-shadow 0.15s',
        }}
      >
        <span style={{
          flex:         1,
          overflow:     'hidden',
          textOverflow: 'ellipsis',
          whiteSpace:   'nowrap',
        }}>
          {selected?.name ?? placeholder}
        </span>
        <span aria-hidden style={{
          fontSize:   10,
          color:      'var(--text-subtle)',
          flexShrink: 0,
          transition: 'transform 0.18s',
          transform:  open ? 'rotate(180deg)' : 'rotate(0deg)',
        }}>▾</span>
      </button>

      {open && (
        <div
          role="listbox"
          style={{
            position:     'absolute',
            top:          'calc(100% + 6px)',
            left:         0,
            right:        0,
            background:   'var(--surface-2)',
            border:       '1px solid var(--border)',
            borderRadius: 10,
            boxShadow:    '0 10px 28px rgba(28, 20, 10, 0.14)',
            padding:      4,
            zIndex:       100,
            maxHeight:    280,
            overflowY:    'auto',
          }}
        >
          {suppliers.length === 0 ? (
            <p style={{
              padding:    '12px 14px',
              fontSize:   13,
              color:      'var(--text-subtle)',
              margin:     0,
              fontStyle:  'italic',
            }}>
              Nenhum fornecedor disponível.
            </p>
          ) : suppliers.map(s => {
            const active = s.id === value
            return (
              <button
                key={s.id}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => { onChange(s.id); setOpen(false) }}
                className="zesto-option"
                style={{
                  width:         '100%',
                  minHeight:     40,
                  padding:       '8px 12px',
                  textAlign:     'left',
                  border:        'none',
                  borderRadius:  6,
                  background:    active ? 'var(--action-surface)' : 'transparent',
                  color:         active ? 'var(--action)' : 'var(--text)',
                  fontSize:      14,
                  fontWeight:    active ? 600 : 500,
                  cursor:        'pointer',
                  display:       'flex',
                  alignItems:    'center',
                  gap:           10,
                  fontFamily:    'inherit',
                  transition:    'background 0.12s',
                }}
              >
                <span aria-hidden style={{
                  width:      14,
                  display:    'inline-block',
                  textAlign:  'center',
                  color:      active ? 'var(--action)' : 'transparent',
                  fontSize:   13,
                  fontWeight: 700,
                  flexShrink: 0,
                }}>
                  ✓
                </span>
                <span style={{
                  flex:         1,
                  overflow:     'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace:   'nowrap',
                }}>
                  {s.name}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── UnitCombo ────────────────────────────────────────────────────────────────
// Combobox para "Compra em": input livre que aceita custom + popover com
// sugestões pré-definidas (caixa, saco, frasco…). Substitui o <input list=…>
// que usava o datalist do macOS (com edit pencils e estilo Contacts).

function UnitCombo({
  value,
  onChange,
  onBlur,
  options,
  placeholder,
}: {
  value:        string
  onChange:     (v: string) => void
  onBlur?:      () => void
  options:      readonly string[]
  placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  const [focused, setFocused] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointer = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', onPointer)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onPointer)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const q = value.trim().toLowerCase()
  const filtered = q
    ? options.filter(o => o.toLowerCase().includes(q))
    : options

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <input
        type="text"
        value={value}
        onChange={e => { onChange(e.target.value); setOpen(true) }}
        onFocus={() => { setOpen(true); setFocused(true) }}
        onBlur={() => {
          // Delay para permitir clique no item antes de fechar.
          setTimeout(() => {
            setFocused(false)
            onBlur?.()
          }, 120)
        }}
        placeholder={placeholder}
        className="zesto-form-cell"
        style={{
          width:        '100%',
          height:       44,
          background:   'var(--surface)',
          border:       `1px solid ${focused ? 'var(--action)' : 'var(--border)'}`,
          borderRadius: 6,
          padding:      '0 10px',
          color:        'var(--text)',
          fontSize:     14,
          outline:      'none',
          fontFamily:   'inherit',
          transition:   'border-color 0.15s, box-shadow 0.15s',
          boxShadow:    focused ? '0 0 0 4px var(--action-glow)' : 'none',
        }}
      />
      {open && filtered.length > 0 && (
        <div
          role="listbox"
          style={{
            position:     'absolute',
            top:          'calc(100% + 4px)',
            left:         0,
            right:        0,
            background:   'var(--surface-2)',
            border:       '1px solid var(--border)',
            borderRadius: 10,
            boxShadow:    '0 10px 28px rgba(28, 20, 10, 0.14)',
            padding:      4,
            zIndex:       100,
            maxHeight:    240,
            overflowY:    'auto',
          }}
        >
          {filtered.map(opt => {
            const active = opt.toLowerCase() === value.trim().toLowerCase()
            return (
              <button
                key={opt}
                type="button"
                role="option"
                aria-selected={active}
                onMouseDown={(e) => { e.preventDefault(); onChange(opt); setOpen(false) }}
                style={{
                  width:         '100%',
                  minHeight:     38,
                  padding:       '6px 12px',
                  textAlign:     'left',
                  border:        'none',
                  borderRadius:  6,
                  background:    active ? 'var(--action-surface)' : 'transparent',
                  color:         active ? 'var(--action)' : 'var(--text)',
                  fontSize:      14,
                  fontWeight:    active ? 600 : 500,
                  cursor:        'pointer',
                  fontFamily:    'inherit',
                  transition:    'background 0.12s',
                }}
              >
                {opt}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

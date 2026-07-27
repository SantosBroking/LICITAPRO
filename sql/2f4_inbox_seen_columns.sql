-- ============================================================
-- Fase 2F4 — Badge de notificaciones + no leído (ALTER TABLE)
-- ============================================================
-- IMPORTANTE: este archivo es SOLO PROPUESTA. Claude NO ejecutó nada de
-- esto contra Supabase. Santiago debe correrlo él mismo en el SQL Editor
-- si lo aprueba. La tabla public.inbox_items ya existe (Fase 2F3) -- este
-- SQL solo AGREGA columnas e índices, no toca RLS ni las 3 policies
-- existentes (siguen siendo admin-only a nivel Postgres, sin cambio).
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. ALTER TABLE — agregar columnas de no-leído
-- ────────────────────────────────────────────────────────────
alter table public.inbox_items add column if not exists seen_by_admin_at timestamptz;
alter table public.inbox_items add column if not exists seen_by_creator_at timestamptz;

comment on column public.inbox_items.seen_by_admin_at is 'Fase 2F4 — última vez que un admin vio este pendiente. NULL = no leído por admin.';
comment on column public.inbox_items.seen_by_creator_at is 'Fase 2F4 — última vez que el empleado creador vio la respuesta de este pendiente. NULL = no leído por el creador.';

-- ────────────────────────────────────────────────────────────
-- 2. INDEXES
-- ────────────────────────────────────────────────────────────
create index if not exists idx_inbox_items_seen_by_admin_at   on public.inbox_items(seen_by_admin_at);
create index if not exists idx_inbox_items_seen_by_creator_at on public.inbox_items(seen_by_creator_at);

-- ============================================================
-- 3. ROLLBACK SQL EXACTO
-- ============================================================
-- drop index if exists idx_inbox_items_seen_by_admin_at;
-- drop index if exists idx_inbox_items_seen_by_creator_at;
-- alter table public.inbox_items drop column if exists seen_by_admin_at;
-- alter table public.inbox_items drop column if exists seen_by_creator_at;
-- Nota: este rollback NO borra la tabla ni sus policies -- solo revierte
-- lo agregado en esta fase. Para revertir la tabla completa, usar
-- sql/2f3_inbox_items.sql (bloque de rollback de esa fase).

-- ============================================================
-- Fase 2F3 — Tabla inbox_items (Centro de aprobaciones)
-- ============================================================
-- IMPORTANTE: este archivo es SOLO PROPUESTA. Claude NO ejecutó nada de
-- esto contra Supabase. Santiago debe revisarlo y correrlo él mismo en el
-- SQL Editor de Supabase si lo aprueba.
--
-- Mismo criterio de seguridad que Fase 2E4 (RLS ya cerrado en projects/
-- vehicles/companies/config): SELECT/INSERT/UPDATE a nivel Postgres quedan
-- admin-only. El acceso real para AMBOS roles (incluida la creación de
-- pendientes por parte de empleado) pasa siempre por los endpoints
-- server-side (api/inbox-list.js, api/inbox-create.js, api/inbox-update.js),
-- que usan SUPABASE_SERVICE_ROLE_KEY y nunca dependen de que RLS le abra la
-- puerta a empleado -- exactamente el mismo patrón que ya usan
-- api/save-project.js, api/save-vehicle.js, etc.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. CREATE TABLE
-- ────────────────────────────────────────────────────────────
create table if not exists public.inbox_items (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,                     -- workspace id fijo (mismo criterio que projects/vehicles/companies/config)
  project_id text,                           -- referencia informativa, nullable -- sin FK dura, mismo criterio que el resto del esquema
  type text not null,                        -- 'proyecto_nuevo' | 'cotizacion_revision' | 'documento_cargado' | 'cambios_solicitados'
  status text not null default 'pendiente',  -- 'pendiente' | 'en_revision' | 'aprobado' | 'rechazado' | 'cambios_solicitados' | 'revisado'
  title text not null,
  message text,
  created_by text,                           -- email real de quien creó el pendiente (siempre del servidor, nunca del body)
  assigned_to text,                          -- nullable -- hoy siempre implícitamente "admin", se deja abierto para el futuro
  data jsonb default '{}'::jsonb,             -- SOLO referencia liviana (ids/folio/nombre) -- NUNCA snapshot completo de un proyecto (misma lección de firmas[].proyecto)
  history jsonb default '[]'::jsonb,          -- [{accion, por, fecha, comentario}]
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.inbox_items is 'Fase 2F3 — Centro de aprobaciones. Acceso real solo vía endpoints server-side, RLS admin-only a nivel Postgres.';

-- ────────────────────────────────────────────────────────────
-- 2. ENABLE RLS
-- ────────────────────────────────────────────────────────────
alter table public.inbox_items enable row level security;

-- ────────────────────────────────────────────────────────────
-- 3. POLICIES
-- ────────────────────────────────────────────────────────────
drop policy if exists "solo admin lee inbox_items" on public.inbox_items;
create policy "solo admin lee inbox_items"
  on public.inbox_items for select
  to authenticated
  using (public.is_admin());

drop policy if exists "solo admin inserta inbox_items" on public.inbox_items;
create policy "solo admin inserta inbox_items"
  on public.inbox_items for insert
  to authenticated
  with check (public.is_admin());

drop policy if exists "solo admin actualiza inbox_items" on public.inbox_items;
create policy "solo admin actualiza inbox_items"
  on public.inbox_items for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Sin política de DELETE a propósito -- no hay borrado físico de pendientes
-- por diseño (el historial se conserva siempre; "revisado" es un estatus,
-- no un borrado).

-- ────────────────────────────────────────────────────────────
-- 4. INDEXES
-- ────────────────────────────────────────────────────────────
create index if not exists idx_inbox_items_user_id    on public.inbox_items(user_id);
create index if not exists idx_inbox_items_project_id  on public.inbox_items(project_id);
create index if not exists idx_inbox_items_status      on public.inbox_items(status);
create index if not exists idx_inbox_items_type        on public.inbox_items(type);
create index if not exists idx_inbox_items_created_at  on public.inbox_items(created_at desc);
create index if not exists idx_inbox_items_created_by  on public.inbox_items(created_by);

-- ============================================================
-- 5. ROLLBACK SQL EXACTO
-- ============================================================
-- drop policy if exists "solo admin lee inbox_items" on public.inbox_items;
-- drop policy if exists "solo admin inserta inbox_items" on public.inbox_items;
-- drop policy if exists "solo admin actualiza inbox_items" on public.inbox_items;
-- drop index if exists idx_inbox_items_user_id;
-- drop index if exists idx_inbox_items_project_id;
-- drop index if exists idx_inbox_items_status;
-- drop index if exists idx_inbox_items_type;
-- drop index if exists idx_inbox_items_created_at;
-- drop index if exists idx_inbox_items_created_by;
-- drop table if exists public.inbox_items;

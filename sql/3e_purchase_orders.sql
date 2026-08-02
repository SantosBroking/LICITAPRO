-- ============================================================
-- Fase 3E — Tabla purchase_orders (Órdenes de Compra como módulo propio)
-- ============================================================
-- IMPORTANTE: este archivo es SOLO PROPUESTA. Claude NO ejecutó nada de
-- esto contra Supabase. Santiago debe revisarlo y correrlo él mismo en el
-- SQL Editor de Supabase si lo aprueba.
--
-- POR QUÉ es indispensable una tabla nueva (diagnóstico completo en la
-- entrega de esta fase): hoy TODA orden de compra vive exclusivamente
-- dentro de project.ordenesCompra[] -- no existe ningún contenedor real
-- en el sistema para un documento que no pertenezca a un proyecto. No hay
-- forma de tener una "OC independiente" sin inventar un almacenamiento
-- temporal frágil (config/JSON/proyecto falso), exactamente lo que se
-- pidió evitar explícitamente.
--
-- Mismo patrón de seguridad ya establecido desde Fase 2E4/2F3: RLS
-- admin-only a nivel Postgres, acceso real para AMBOS roles vía un
-- endpoint con service_role (api/purchase-orders.js, a implementar
-- DESPUÉS de que este SQL se ejecute y se confirme).
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. CREATE TABLE
-- ────────────────────────────────────────────────────────────
create table if not exists public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,                    -- workspace id fijo (mismo criterio que projects/vehicles/companies/config/inbox_items)
  project_id text,                          -- NULL = OC independiente; string = ligada a un proyecto (mismo id que projects.id, sin FK dura -- mismo criterio que el resto del esquema)
  company_id text,                          -- empresa operadora (para el prefijo de folio) -- nullable, informativo
  folio text not null,                      -- BRO-2026-LIC-001-OC-01 (ligada) o BRO-2026-OC-001 (independiente)
  tipo text not null default 'orden_compra',
  status text not null default 'borrador',  -- borrador | en_aprobacion | en_firma | cerrada | cancelada (ver nota abajo)
  proveedor_nombre text,
  proveedor_email text,
  proveedor_rfc text,
  fecha date,
  moneda text not null default 'MXN',
  subtotal numeric,
  iva numeric,
  total numeric,
  -- Partidas (line items) y condiciones comerciales -- mismo criterio de
  -- sensibilidad YA EXISTENTE en sanitizeOrdenCompraForRole: partidas[].
  -- precioUnit (costo interno) y condiciones son admin-only, el resto de
  -- cada partida (tipo/cantidad/vehiculo) es visible a empleado. Esto se
  -- sanea en el ENDPOINT (api/purchase-orders.js), igual que hoy se sanea
  -- en sanitizeOrdenCompraForRole -- la tabla en sí no impone esa regla,
  -- la aplica el código server-side, mismo patrón que projects/vehicles.
  partidas jsonb not null default '[]'::jsonb,
  condiciones jsonb not null default '[]'::jsonb,
  data jsonb not null default '{}'::jsonb,  -- extras livianos (nunca snapshot de proyecto)
  created_by text,
  assigned_to text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.purchase_orders is 'Fase 3E — Órdenes de Compra como módulo propio (ligadas a proyecto o independientes). Acceso real solo vía api/purchase-orders.js, RLS admin-only a nivel Postgres.';

-- ────────────────────────────────────────────────────────────
-- 2. ENABLE RLS
-- ────────────────────────────────────────────────────────────
alter table public.purchase_orders enable row level security;

-- ────────────────────────────────────────────────────────────
-- 3. POLICIES -- mismo patrón que 2E4/2F3: admin-only a nivel Postgres,
-- el acceso real para AMBOS roles pasa por api/purchase-orders.js con
-- service_role, nunca por RLS directo.
-- ────────────────────────────────────────────────────────────
drop policy if exists "solo admin lee purchase_orders" on public.purchase_orders;
create policy "solo admin lee purchase_orders"
  on public.purchase_orders for select
  to authenticated
  using (public.is_admin());

drop policy if exists "solo admin inserta purchase_orders" on public.purchase_orders;
create policy "solo admin inserta purchase_orders"
  on public.purchase_orders for insert
  to authenticated
  with check (public.is_admin());

drop policy if exists "solo admin actualiza purchase_orders" on public.purchase_orders;
create policy "solo admin actualiza purchase_orders"
  on public.purchase_orders for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Sin política de DELETE a propósito -- cancelar una OC es un cambio de
-- `status` a 'cancelada', no un borrado físico (mismo criterio que
-- inbox_items: se conserva el historial).

-- ────────────────────────────────────────────────────────────
-- 4. INDEXES
-- ────────────────────────────────────────────────────────────
create index if not exists idx_purchase_orders_user_id     on public.purchase_orders(user_id);
create index if not exists idx_purchase_orders_project_id  on public.purchase_orders(project_id);
create index if not exists idx_purchase_orders_status      on public.purchase_orders(status);
create index if not exists idx_purchase_orders_folio       on public.purchase_orders(folio);
create index if not exists idx_purchase_orders_created_at  on public.purchase_orders(created_at desc);
create index if not exists idx_purchase_orders_created_by  on public.purchase_orders(created_by);

-- ============================================================
-- 5. SQL DE VERIFICACIÓN (para correr después de aplicar, solo lectura)
-- ============================================================
-- select column_name, data_type, is_nullable, column_default
-- from information_schema.columns
-- where table_schema='public' and table_name='purchase_orders'
-- order by ordinal_position;
--
-- select relrowsecurity from pg_class
-- where relname='purchase_orders' and relnamespace='public'::regnamespace;
--
-- select policyname, cmd from pg_policies
-- where schemaname='public' and tablename='purchase_orders' order by cmd;
--
-- select indexname from pg_indexes
-- where schemaname='public' and tablename='purchase_orders' order by indexname;
--
-- select count(*) as total_filas from public.purchase_orders; -- debe ser 0 recién creada

-- ============================================================
-- 6. ROLLBACK SQL EXACTO
-- ============================================================
-- drop policy if exists "solo admin lee purchase_orders" on public.purchase_orders;
-- drop policy if exists "solo admin inserta purchase_orders" on public.purchase_orders;
-- drop policy if exists "solo admin actualiza purchase_orders" on public.purchase_orders;
-- drop index if exists idx_purchase_orders_user_id;
-- drop index if exists idx_purchase_orders_project_id;
-- drop index if exists idx_purchase_orders_status;
-- drop index if exists idx_purchase_orders_folio;
-- drop index if exists idx_purchase_orders_created_at;
-- drop index if exists idx_purchase_orders_created_by;
-- drop table if exists public.purchase_orders;

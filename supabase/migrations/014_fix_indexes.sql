-- Actualizar índices para soportar desempate por created_at
-- cuando hay múltiples costos/precios con la misma fecha_vigencia

drop index if exists idx_costos_lookup;
create index idx_costos_lookup
  on public.ingredientes_costos(ingrediente_id, fecha_vigencia desc, created_at desc);

drop index if exists idx_precios_lookup;
create index idx_precios_lookup
  on public.productos_precios(producto_id, fecha_vigencia desc, created_at desc);

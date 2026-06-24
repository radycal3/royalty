-- 031_conteo_unidad_receta.sql
-- Permite contar stock en unidad_receta en vez de unidad_compra, ingrediente
-- por ingrediente. Caso de uso: Carne se compra en kg pero el equipo cuenta
-- bandejas de medallones — contar en "Medallon" es más preciso y natural
-- para ellos que estimar kilos a ojo.
--
-- Esto NO afecta compras_ingredientes (las compras de Lucas siempre quedan
-- en la unidad de compra real, kg para Carne). Solo afecta cómo se pide y
-- se interpreta la cantidad en conteos_stock (inicio_semana / fin_noche).

ALTER TABLE ingredientes
  ADD COLUMN IF NOT EXISTS conteo_en_unidad_receta BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN ingredientes.conteo_en_unidad_receta IS
  'Si es true, el conteo de stock (conteos_stock) se pide y se guarda en unidad_receta en vez de unidad_compra. Compras (compras_ingredientes) no se ven afectadas.';

UPDATE ingredientes SET conteo_en_unidad_receta = true WHERE nombre = 'Carne';

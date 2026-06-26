-- costo_por_resultado_usd y ctr_enlace pueden tener más decimales de los
-- que permiten NUMERIC(10,4) y NUMERIC(8,6) según el CSV real de Meta Ads.
-- Se cambian a NUMERIC sin restricción para evitar numeric field overflow.

ALTER TABLE meta_ads_detalle
  ALTER COLUMN costo_por_resultado_usd TYPE NUMERIC,
  ALTER COLUMN ctr_enlace              TYPE NUMERIC;

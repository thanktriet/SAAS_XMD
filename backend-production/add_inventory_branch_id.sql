-- Add branch_id to inventory_vehicles
ALTER TABLE inventory_vehicles
  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES acc_branches(id);

-- Set existing vehicles to default branch (HQ)
UPDATE inventory_vehicles
SET branch_id = '00000000-0000-0000-0000-000000000002'
WHERE branch_id IS NULL;

-- Index for branch filtering
CREATE INDEX IF NOT EXISTS idx_inv_vehicles_branch ON inventory_vehicles(branch_id);

-- Recreate view with branch_id
DROP VIEW IF EXISTS v_vehicle_stock_summary;
CREATE VIEW v_vehicle_stock_summary AS
SELECT
  vm.id            AS model_id,
  vm.brand,
  vm.model_name,
  vm.category,
  vm.price_sell,
  vm.image_url,
  iv.branch_id,
  COUNT(iv.id)                                               AS total,
  COUNT(CASE WHEN iv.status = 'in_stock'        THEN 1 END) AS in_stock,
  COUNT(CASE WHEN iv.status = 'sold'            THEN 1 END) AS sold,
  COUNT(CASE WHEN iv.status = 'reserved'        THEN 1 END) AS reserved,
  COUNT(CASE WHEN iv.status = 'warranty_repair' THEN 1 END) AS warranty_repair
FROM vehicle_models vm
LEFT JOIN inventory_vehicles iv ON iv.vehicle_model_id = vm.id
GROUP BY vm.id, vm.brand, vm.model_name, vm.category, vm.price_sell, vm.image_url, iv.branch_id;

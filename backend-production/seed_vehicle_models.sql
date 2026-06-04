-- ============================================
-- SEED: vehicle_models + vehicle_model_colors
-- Chạy SAU khi đã chạy schema.sql
-- An toàn chạy lại nhiều lần (ON CONFLICT DO NOTHING)
-- ============================================
-- LƯU Ý: brand đang để 'VinFast' cho toàn bộ. Nếu đại lý
-- bán đa thương hiệu, hãy UPDATE brand cho phù hợp, ví dụ:
--   UPDATE vehicle_models SET brand = 'Yadea' WHERE model_name IN ('Amio', 'Amio S');
--   UPDATE vehicle_models SET brand = 'DK Bike' WHERE model_name = 'ZGO';
-- ============================================

-- 1) Insert dòng xe
INSERT INTO vehicle_models (brand, model_name, category) VALUES
  ('VinFast', 'Klara Neo',          'xe_may'),
  ('VinFast', 'Feliz 2025',         'xe_may'),
  ('VinFast', 'Evo Grand',          'xe_may'),
  ('VinFast', 'Evo Grand +1',       'xe_may'),
  ('VinFast', 'Evo Grand Lite',     'xe_may'),
  ('VinFast', 'Evo Grand Lite +1',  'xe_may'),
  ('VinFast', 'ZGO',                'xe_may'),
  ('VinFast', 'Flash',              'xe_may'),
  ('VinFast', 'Flash Max',          'xe_may'),
  ('VinFast', 'Verox 2025',         'xe_may'),
  ('VinFast', 'Amio',               'xe_may'),
  ('VinFast', 'Amio S',             'xe_may'),
  ('VinFast', 'Evo Lite (Max)',     'xe_may'),
  ('VinFast', 'Evo (Max)',          'xe_may'),
  ('VinFast', 'Feliz II',           'xe_may'),
  ('VinFast', 'Viper',              'xe_may')
ON CONFLICT (brand, model_name) DO NOTHING;

-- 2) Insert màu cho từng dòng xe
WITH model_colors(model_name, color_name, sort_order) AS (
  VALUES
    -- Klara Neo
    ('Klara Neo',          'Đỏ tươi',           1),
    ('Klara Neo',          'Đen nhám',          2),
    ('Klara Neo',          'Trắng ngọc',        3),
    -- Feliz 2025
    ('Feliz 2025',         'Đen bóng',          1),
    ('Feliz 2025',         'Xanh Oliu',         2),
    ('Feliz 2025',         'Xanh rêu',          3),
    ('Feliz 2025',         'Trắng',             4),
    ('Feliz 2025',         'Vàng cát',          5),
    -- Evo Grand
    ('Evo Grand',          'Đen',               1),
    ('Evo Grand',          'Xanh Oliu',         2),
    ('Evo Grand',          'Đỏ',                3),
    ('Evo Grand',          'Trắng',             4),
    ('Evo Grand',          'Vàng cát',          5),
    -- Evo Grand +1
    ('Evo Grand +1',       'Đen',               1),
    ('Evo Grand +1',       'Xanh Oliu',         2),
    ('Evo Grand +1',       'Đỏ',                3),
    ('Evo Grand +1',       'Trắng',             4),
    ('Evo Grand +1',       'Vàng cát',          5),
    -- Evo Grand Lite
    ('Evo Grand Lite',     'Đen',               1),
    ('Evo Grand Lite',     'Tím',               2),
    ('Evo Grand Lite',     'Trắng',             3),
    ('Evo Grand Lite',     'Vàng cát',          4),
    -- Evo Grand Lite +1
    ('Evo Grand Lite +1',  'Đen',               1),
    ('Evo Grand Lite +1',  'Tím',               2),
    ('Evo Grand Lite +1',  'Trắng',             3),
    ('Evo Grand Lite +1',  'Vàng cát',          4),
    -- ZGO
    ('ZGO',                'Xanh Oliu',         1),
    ('ZGO',                'Đen',               2),
    ('ZGO',                'Đỏ',                3),
    ('ZGO',                'Trắng',             4),
    -- Flash
    ('Flash',              'Đen',               1),
    ('Flash',              'Đỏ',                2),
    ('Flash',              'Xanh Oliu',         3),
    ('Flash',              'Trắng',             4),
    -- Flash Max
    ('Flash Max',          'Đỏ đen',            1),
    ('Flash Max',          'Đen',               2),
    ('Flash Max',          'Xanh',              3),
    ('Flash Max',          'Trắng',             4),
    ('Flash Max',          'Cam',               5),
    -- Verox 2025
    ('Verox 2025',         'Đen bóng',          1),
    ('Verox 2025',         'Xanh rêu',          2),
    ('Verox 2025',         'Xanh Oliu',         3),
    ('Verox 2025',         'Trắng',             4),
    -- Amio
    ('Amio',               'Đen bóng',          1),
    ('Amio',               'Đỏ',                2),
    ('Amio',               'Trắng Ngọc Trai',   3),
    ('Amio',               'Xanh Ngọc',         4),
    ('Amio',               'Xám Xi Măng',       5),
    -- Amio S
    ('Amio S',             'Đen bóng',          1),
    ('Amio S',             'Đỏ',                2),
    ('Amio S',             'Trắng Ngọc Trai',   3),
    ('Amio S',             'Xanh Ngọc',         4),
    ('Amio S',             'Xám Xi Măng',       5),
    -- Evo Lite (Max)
    ('Evo Lite (Max)',     'Đen',               1),
    ('Evo Lite (Max)',     'Đỏ',                2),
    ('Evo Lite (Max)',     'Xanh Oliu',         3),
    ('Evo Lite (Max)',     'Trắng',             4),
    -- Evo (Max)
    ('Evo (Max)',          'Đỏ',                1),
    ('Evo (Max)',          'Trắng',             2),
    ('Evo (Max)',          'Xanh Oliu',         3),
    ('Evo (Max)',          'Đen',               4),
    -- Feliz II
    ('Feliz II',           'Đen',               1),
    ('Feliz II',           'Xanh Oliu',         2),
    ('Feliz II',           'Đỏ',                3),
    ('Feliz II',           'Trắng',             4),
    -- Viper
    ('Viper',              'Đen',               1),
    ('Viper',              'Xám',               2),
    ('Viper',              'Đỏ',                3),
    ('Viper',              'Trắng',             4),
    ('Viper',              'Vàng',              5)
)
INSERT INTO vehicle_model_colors (vehicle_model_id, color_name, sort_order)
SELECT vm.id, mc.color_name, mc.sort_order
FROM model_colors mc
JOIN vehicle_models vm
  ON vm.model_name = mc.model_name
 AND vm.brand = 'VinFast'
ON CONFLICT (vehicle_model_id, color_name) DO NOTHING;

-- 3) Kiểm tra nhanh
-- SELECT vm.brand, vm.model_name, COUNT(c.id) AS so_mau
-- FROM vehicle_models vm
-- LEFT JOIN vehicle_model_colors c ON c.vehicle_model_id = vm.id
-- GROUP BY vm.brand, vm.model_name
-- ORDER BY vm.model_name;

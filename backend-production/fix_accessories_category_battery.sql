-- =============================================================================
-- Fix: cho phép category = 'battery' trong bảng accessories
--   Trên DB hiện có CHECK constraint cũ chỉ cho phép 6 loại
--   → Drop constraint cũ, thêm constraint mới có 'battery'
-- =============================================================================

-- Drop constraint cũ (tên có thể là accessories_category_check)
ALTER TABLE accessories
  DROP CONSTRAINT IF EXISTS accessories_category_check;

-- Thêm constraint mới với 'battery'
ALTER TABLE accessories
  ADD CONSTRAINT accessories_category_check
  CHECK (category IS NULL OR category IN (
    'battery',   -- Pin xe (mới)
    'safety',    -- Bảo hộ
    'luggage',   -- Hành lý
    'comfort',   -- Tiện nghi
    'weather',   -- Thời tiết
    'decor',     -- Trang trí
    'other'      -- Khác
  ));

COMMENT ON COLUMN accessories.category IS
  'Phân loại phụ kiện. battery = pin xe (có serial, có thể mua hoặc thuê)';

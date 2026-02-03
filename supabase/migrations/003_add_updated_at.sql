-- Migration: Add updated_at column to places table
-- Run this in Supabase SQL Editor

-- ============================================
-- 1. Add updated_at column to places table
-- ============================================
ALTER TABLE places ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

-- ============================================
-- 2. Create trigger to auto-update updated_at
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_places_updated_at ON places;

CREATE TRIGGER update_places_updated_at
    BEFORE UPDATE ON places
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- 3. Update places_with_profiles view to include updated_at
-- ============================================
DROP VIEW IF EXISTS places_with_profiles;

CREATE VIEW places_with_profiles AS
SELECT
  p.id,
  p.user_id,
  p.title,
  p.raw_text,
  p.notes,
  p.latitude,
  p.longitude,
  p.created_at,
  p.updated_at,
  p.street_line1,
  p.street_line2,
  p.city,
  p.state,
  p.postal_code,
  p.country,
  p.phone,
  p.website,
  p.category,
  p.links,
  pr.first_name,
  pr.last_name,
  pr.username,
  COALESCE(
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', ph.id,
          'storage_path', ph.storage_path,
          'thumbnail_path', ph.thumbnail_path,
          'description', ph.description,
          'display_order', ph.display_order
        ) ORDER BY ph.display_order, ph.created_at
      )
      FROM place_photos ph
      WHERE ph.place_id = p.id
    ),
    '[]'::jsonb
  ) AS photos
FROM places p
LEFT JOIN profiles pr ON p.user_id = pr.id;

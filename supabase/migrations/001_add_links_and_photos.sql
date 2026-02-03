-- Migration: Add links column to places table and create place_photos table
-- Run this in Supabase SQL Editor

-- ============================================
-- 1. Add links column to places table
-- ============================================
ALTER TABLE places ADD COLUMN IF NOT EXISTS links JSONB DEFAULT '[]'::jsonb;

-- Constraint to limit links to max 3 entries
ALTER TABLE places ADD CONSTRAINT links_max_three
  CHECK (jsonb_array_length(COALESCE(links, '[]'::jsonb)) <= 3);

-- ============================================
-- 2. Create place_photos table
-- ============================================
CREATE TABLE IF NOT EXISTS place_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  place_id UUID NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  thumbnail_path TEXT,
  description TEXT,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Index for efficient queries by place_id
CREATE INDEX IF NOT EXISTS idx_place_photos_place_id ON place_photos(place_id);

-- ============================================
-- 3. Enable Row Level Security on place_photos
-- ============================================
ALTER TABLE place_photos ENABLE ROW LEVEL SECURITY;

-- Allow anyone to view photos
CREATE POLICY "Anyone can view photos" ON place_photos
  FOR SELECT USING (true);

-- Allow users to manage their own photos
CREATE POLICY "Users can manage own photos" ON place_photos
  FOR ALL USING (place_id IN (SELECT id FROM places WHERE user_id = auth.uid()));

-- ============================================
-- 4. Update places_with_profiles view
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

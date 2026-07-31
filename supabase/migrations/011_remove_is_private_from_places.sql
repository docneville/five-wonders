-- Migration: Remove is_private from places, update view and RLS

-- Drop the old anon policy that used is_private
DROP POLICY IF EXISTS "Public places readable by anyone" ON places;

-- New policy: owners see their own places; Wonders are visible to all
-- (share links go through service-role Edge Functions and bypass RLS)
CREATE POLICY "Places readable by owner or if wonder" ON places
  FOR SELECT USING (auth.uid() = user_id OR is_wonder = true);

-- Drop the column
ALTER TABLE places DROP COLUMN IF EXISTS is_private;

-- Rebuild the view without is_private
DROP VIEW IF EXISTS places_with_profiles;

CREATE VIEW places_with_profiles
  WITH (security_invoker = true)
AS
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
  p.is_wonder,
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

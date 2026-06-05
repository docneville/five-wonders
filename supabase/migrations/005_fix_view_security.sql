-- Migration: Fix SECURITY DEFINER on places_with_profiles view
-- Supabase Advisor flagged this as a CRITICAL security issue.
-- The view was implicitly created with SECURITY DEFINER, meaning it ran with
-- the privileges of the view creator (bypassing RLS). Recreating it with
-- SECURITY INVOKER ensures queries run as the calling user, so RLS policies
-- on the underlying places and profiles tables apply correctly.

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

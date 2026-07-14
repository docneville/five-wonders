-- Allow unauthenticated (anon) users to read public places.
-- This lets share links work even if the frontend queries Supabase directly
-- instead of going through the Edge Function.
-- Private places (is_private = true) remain hidden from anonymous users.
-- Owners can always read their own places regardless of is_private.

DO $$
BEGIN
  -- Only create if it doesn't already exist
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'places'
      AND policyname = 'Public places readable by anyone'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY "Public places readable by anyone" ON places
        FOR SELECT
        USING (is_private = false OR auth.uid() = user_id);
    $policy$;
  END IF;
END
$$;

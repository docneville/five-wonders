-- 014_merge_profile_on_oauth.sql
-- Called on first Google sign-in to carry over an existing manually-created
-- profile (same email) instead of starting a fresh pending account.

CREATE OR REPLACE FUNCTION public.upsert_oauth_profile(
  p_id          UUID,
  p_email       TEXT,
  p_first_name  TEXT,
  p_last_name   TEXT,
  p_avatar_url  TEXT DEFAULT NULL
)
RETURNS TABLE (approval_status TEXT, first_name TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_id     UUID;
  v_approval_status TEXT;
  v_first_name      TEXT;
BEGIN
  -- Already have a profile for this OAuth user id — nothing to do
  IF EXISTS (SELECT 1 FROM profiles WHERE id = p_id) THEN
    SELECT pr.approval_status, pr.first_name
      INTO v_approval_status, v_first_name
      FROM profiles pr WHERE pr.id = p_id;
    RETURN QUERY SELECT v_approval_status, v_first_name;
    RETURN;
  END IF;

  -- Look for an existing profile with the same email (trim whitespace)
  SELECT pr.id, pr.approval_status, pr.first_name
    INTO v_existing_id, v_approval_status, v_first_name
    FROM profiles pr
   WHERE trim(lower(pr.email)) = trim(lower(p_email))
     AND pr.id <> p_id
   LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    -- Inherit approval status from the old account; migrate its places + friendships
    INSERT INTO profiles (id, first_name, last_name, email, approval_status, is_admin)
      SELECT p_id, pr.first_name, pr.last_name, p_email, pr.approval_status, pr.is_admin
        FROM profiles pr WHERE pr.id = v_existing_id;

    UPDATE places     SET user_id   = p_id WHERE user_id   = v_existing_id;
    UPDATE friendships SET user_id  = p_id WHERE user_id   = v_existing_id;
    UPDATE friendships SET friend_id = p_id WHERE friend_id = v_existing_id;

    DELETE FROM profiles WHERE id = v_existing_id;

    SELECT pr.approval_status, pr.first_name
      INTO v_approval_status, v_first_name
      FROM profiles pr WHERE pr.id = p_id;
  ELSE
    -- Brand-new user — create pending profile
    INSERT INTO profiles (id, first_name, last_name, email, approval_status, is_admin)
    VALUES (p_id, p_first_name, p_last_name, p_email, 'pending', false);
    v_approval_status := 'pending';
    v_first_name      := p_first_name;
  END IF;

  RETURN QUERY SELECT v_approval_status, v_first_name;
END;
$$;

-- Only the authenticated user calling with their own id can invoke this
REVOKE ALL ON FUNCTION public.upsert_oauth_profile FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_oauth_profile TO authenticated;

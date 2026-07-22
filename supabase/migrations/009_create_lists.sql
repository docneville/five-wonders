-- Migration: Create lists and list_places tables

CREATE TABLE lists (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  description TEXT,
  is_private  BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE lists ENABLE ROW LEVEL SECURITY;

-- Owners can do everything on their own lists
CREATE POLICY "Users manage own lists" ON lists
  FOR ALL USING (user_id = auth.uid());

-- Anyone can read public lists
CREATE POLICY "Public lists readable by anyone" ON lists
  FOR SELECT USING (is_private = false);

-- -------------------------------------------------------

CREATE TABLE list_places (
  list_id   UUID NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  place_id  UUID NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  added_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (list_id, place_id)
);

ALTER TABLE list_places ENABLE ROW LEVEL SECURITY;

-- Visibility follows the parent list
CREATE POLICY "list_places follow list visibility" ON list_places
  FOR SELECT USING (
    list_id IN (SELECT id FROM lists WHERE is_private = false)
    OR list_id IN (SELECT id FROM lists WHERE user_id = auth.uid())
  );

CREATE POLICY "Users manage own list_places" ON list_places
  FOR ALL USING (
    list_id IN (SELECT id FROM lists WHERE user_id = auth.uid())
  );

-- Keep updated_at current
CREATE OR REPLACE FUNCTION touch_list_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE lists SET updated_at = NOW() WHERE id = NEW.list_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER list_places_touch_list
  AFTER INSERT OR DELETE ON list_places
  FOR EACH ROW EXECUTE FUNCTION touch_list_updated_at();

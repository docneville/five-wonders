-- 013_add_friendships.sql
-- Bidirectional friendship rows: each accepted connection is two rows,
-- one per direction. Makes "get my friends" a simple WHERE user_id = me.

CREATE TABLE IF NOT EXISTS friendships (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  friend_id  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status     TEXT NOT NULL DEFAULT 'accepted'
               CHECK (status IN ('pending', 'accepted', 'rejected', 'blocked')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, friend_id),
  CHECK (user_id <> friend_id)
);

ALTER TABLE friendships ENABLE ROW LEVEL SECURITY;

-- Each user can only see their own outgoing rows
CREATE POLICY "users_read_own_friendships" ON friendships
  FOR SELECT USING (user_id = auth.uid());

-- Users can manage their own rows (insert/delete done via edge function with service role)

-- Seed: make all currently-approved users mutual friends
INSERT INTO friendships (user_id, friend_id, status)
SELECT a.id, b.id, 'accepted'
FROM profiles a
CROSS JOIN profiles b
WHERE a.id <> b.id
  AND a.approval_status = 'approved'
  AND b.approval_status = 'approved'
ON CONFLICT (user_id, friend_id) DO NOTHING;

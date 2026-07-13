-- Migration: Add is_private column to places table
-- Default false = public. Owner can mark a place private to prevent sharing.
ALTER TABLE places ADD COLUMN IF NOT EXISTS is_private BOOLEAN NOT NULL DEFAULT false;

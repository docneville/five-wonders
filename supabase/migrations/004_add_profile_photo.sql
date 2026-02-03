-- Migration: Add profile_photo_path column to profiles table
-- Run this in Supabase SQL Editor

-- ============================================
-- 1. Add profile_photo_path column to profiles table
-- ============================================
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS profile_photo_path TEXT;

-- Add a comment to document the column
COMMENT ON COLUMN profiles.profile_photo_path IS 'Storage path for the user profile photo in place-photos bucket';

-- Storage Bucket Setup for place-photos
-- Run this in Supabase SQL Editor

-- ============================================
-- Create the place-photos storage bucket
-- ============================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'place-photos',
  'place-photos',
  true,
  10485760, -- 10MB limit
  ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = true,
  file_size_limit = 10485760,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

-- ============================================
-- Storage policies for place-photos bucket
-- ============================================

-- Allow anyone to view photos (public bucket)
CREATE POLICY "Public photo access" ON storage.objects
  FOR SELECT USING (bucket_id = 'place-photos');

-- Allow authenticated users to upload photos
CREATE POLICY "Authenticated users can upload photos" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'place-photos'
    AND auth.role() = 'authenticated'
  );

-- Allow users to delete their own photos
CREATE POLICY "Users can delete own photos" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'place-photos'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

// ============================================
// Edge Function Updates for manage-places
// Add these cases to your existing manage-places function
// ============================================

// Add to imports at top:
// import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Add these cases inside your main switch/if statement for actions:

// ============================================
// ACTION: update_links
// Updates the links array for a place
// ============================================
/*
if (action === 'update_links') {
  const { place_id, links } = body;

  if (!place_id) {
    return new Response(JSON.stringify({ error: 'place_id required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }

  // Validate links array (max 3 links)
  if (!Array.isArray(links) || links.length > 3) {
    return new Response(JSON.stringify({ error: 'links must be an array with max 3 items' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }

  // Validate each link has required fields
  for (const link of links) {
    if (!link.url || typeof link.url !== 'string') {
      return new Response(JSON.stringify({ error: 'Each link must have a url' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }
  }

  const { error } = await supabase
    .from('places')
    .update({ links })
    .eq('id', place_id)
    .eq('user_id', profile.id);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }

  return new Response(JSON.stringify({ status: 'ok' }), {
    headers: { 'Content-Type': 'application/json', ...corsHeaders }
  });
}
*/

// ============================================
// ACTION: upload_photo
// Uploads a photo to storage and creates DB record
// ============================================
/*
if (action === 'upload_photo') {
  const { place_id, file_base64, file_name, file_type, thumbnail_base64, description } = body;

  if (!place_id || !file_base64 || !file_name) {
    return new Response(JSON.stringify({ error: 'place_id, file_base64, and file_name required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }

  // Verify user owns this place
  const { data: place, error: placeError } = await supabase
    .from('places')
    .select('id')
    .eq('id', place_id)
    .eq('user_id', profile.id)
    .single();

  if (placeError || !place) {
    return new Response(JSON.stringify({ error: 'Place not found or access denied' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }

  // Check photo count (max 5)
  const { count } = await supabase
    .from('place_photos')
    .select('*', { count: 'exact', head: true })
    .eq('place_id', place_id);

  if (count >= 5) {
    return new Response(JSON.stringify({ error: 'Maximum 5 photos per place' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }

  // Decode base64 and upload to storage
  const fileBuffer = Uint8Array.from(atob(file_base64), c => c.charCodeAt(0));
  const storagePath = `${profile.id}/${place_id}/${Date.now()}_${file_name}`;

  const { error: uploadError } = await supabase.storage
    .from('place-photos')
    .upload(storagePath, fileBuffer, {
      contentType: file_type || 'image/jpeg',
      upsert: false
    });

  if (uploadError) {
    return new Response(JSON.stringify({ error: 'Upload failed: ' + uploadError.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }

  // Upload thumbnail if provided
  let thumbnailPath = null;
  if (thumbnail_base64) {
    const thumbBuffer = Uint8Array.from(atob(thumbnail_base64), c => c.charCodeAt(0));
    const thumbStoragePath = `${profile.id}/${place_id}/thumb_${Date.now()}_${file_name}`;

    const { error: thumbError } = await supabase.storage
      .from('place-photos')
      .upload(thumbStoragePath, thumbBuffer, {
        contentType: file_type || 'image/jpeg',
        upsert: false
      });

    if (!thumbError) {
      thumbnailPath = thumbStoragePath;
    }
  }

  // Create database record
  const { data: photo, error: dbError } = await supabase
    .from('place_photos')
    .insert({
      place_id,
      storage_path: storagePath,
      thumbnail_path: thumbnailPath,
      description: description || null,
      display_order: count || 0
    })
    .select()
    .single();

  if (dbError) {
    // Clean up uploaded files if DB insert fails
    await supabase.storage.from('place-photos').remove([storagePath]);
    if (thumbnailPath) {
      await supabase.storage.from('place-photos').remove([thumbnailPath]);
    }
    return new Response(JSON.stringify({ error: 'Database error: ' + dbError.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }

  // Get public URLs
  const { data: { publicUrl } } = supabase.storage.from('place-photos').getPublicUrl(storagePath);
  const thumbUrl = thumbnailPath
    ? supabase.storage.from('place-photos').getPublicUrl(thumbnailPath).data.publicUrl
    : null;

  return new Response(JSON.stringify({
    status: 'ok',
    photo: {
      ...photo,
      url: publicUrl,
      thumbnail_url: thumbUrl
    }
  }), {
    headers: { 'Content-Type': 'application/json', ...corsHeaders }
  });
}
*/

// ============================================
// ACTION: delete_photo
// Deletes a photo from storage and DB
// ============================================
/*
if (action === 'delete_photo') {
  const { photo_id, place_id } = body;

  if (!photo_id || !place_id) {
    return new Response(JSON.stringify({ error: 'photo_id and place_id required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }

  // Verify user owns this place
  const { data: place } = await supabase
    .from('places')
    .select('id')
    .eq('id', place_id)
    .eq('user_id', profile.id)
    .single();

  if (!place) {
    return new Response(JSON.stringify({ error: 'Access denied' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }

  // Get photo record
  const { data: photo } = await supabase
    .from('place_photos')
    .select('*')
    .eq('id', photo_id)
    .eq('place_id', place_id)
    .single();

  if (!photo) {
    return new Response(JSON.stringify({ error: 'Photo not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }

  // Delete from storage
  const filesToDelete = [photo.storage_path];
  if (photo.thumbnail_path) {
    filesToDelete.push(photo.thumbnail_path);
  }
  await supabase.storage.from('place-photos').remove(filesToDelete);

  // Delete from database
  await supabase
    .from('place_photos')
    .delete()
    .eq('id', photo_id);

  return new Response(JSON.stringify({ status: 'ok' }), {
    headers: { 'Content-Type': 'application/json', ...corsHeaders }
  });
}
*/

// ============================================
// ACTION: update_photo
// Updates photo description
// ============================================
/*
if (action === 'update_photo') {
  const { photo_id, place_id, description } = body;

  if (!photo_id || !place_id) {
    return new Response(JSON.stringify({ error: 'photo_id and place_id required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }

  // Verify user owns this place
  const { data: place } = await supabase
    .from('places')
    .select('id')
    .eq('id', place_id)
    .eq('user_id', profile.id)
    .single();

  if (!place) {
    return new Response(JSON.stringify({ error: 'Access denied' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }

  const { error } = await supabase
    .from('place_photos')
    .update({ description })
    .eq('id', photo_id)
    .eq('place_id', place_id);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }

  return new Response(JSON.stringify({ status: 'ok' }), {
    headers: { 'Content-Type': 'application/json', ...corsHeaders }
  });
}
*/

// ============================================
// Update the 'list' action to include links and photos
// ============================================
/*
// In your existing 'list' action, update the select to include links and photos:

const { data: places, error } = await supabase
  .from('places_with_profiles')
  .select(`
    id,
    user_id,
    title,
    raw_text,
    notes,
    latitude,
    longitude,
    created_at,
    street_line1,
    street_line2,
    city,
    state,
    postal_code,
    country,
    phone,
    website,
    category,
    links,
    photos
  `)
  .eq('user_id', profile.id)
  .order('created_at', { ascending: false });
*/

export {};

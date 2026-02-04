// supabase/functions/manage-places/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders: Record<string, string> = {
  // You can restrict this later to your real origin:
  // "Access-Control-Allow-Origin": "https://docneville.github.io",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// Look up profile from invite-code / user_token
async function getProfileFromToken(userToken: string) {
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("id, is_active")
    .eq("api_key", userToken)
    .single();

  if (error || !data) {
    console.error("Profile lookup error:", error);
    return null;
  }

  if (data.is_active === false) {
    console.warn("Profile is inactive for token");
    return null;
  }

  return data;
}

serve(async (req: Request): Promise<Response> => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", {
      status: 405,
      headers: corsHeaders,
    });
  }

  let payload: any;
  try {
    payload = await req.json();
  } catch (err) {
    console.error("JSON parse error", err);
    return new Response("Invalid JSON body", {
      status: 400,
      headers: corsHeaders,
    });
  }

  const { action, user_token } = payload ?? {};
  console.log("manage-places payload:", JSON.stringify(payload));

  if (!user_token) {
    return new Response("Missing user_token", {
      status: 401,
      headers: corsHeaders,
    });
  }

  const profile = await getProfileFromToken(user_token);
  if (!profile) {
    return new Response("Invalid or inactive user_token", {
      status: 401,
      headers: corsHeaders,
    });
  }

  const userId = profile.id as string;

  // ---- ACTION: list ----
  if (action === "list") {
    // Use the view to get links and photos aggregated
    const { data, error } = await supabaseAdmin
      .from("places_with_profiles")
      .select(`
        id,
        title,
        notes,
        raw_text,
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
        photos,
        created_at,
        updated_at
      `)
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error listing places:", error);
      return new Response("Error listing places", {
        status: 500,
        headers: corsHeaders,
      });
    }

    return new Response(
      JSON.stringify({ status: "ok", places: data ?? [] }),
      {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      },
    );
  }

  // ---- ACTION: update ----
  if (action === "update") {
    const {
      place_id,
      title,
      notes,
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
    } = payload ?? {};

    if (!place_id) {
      return new Response("Missing place_id for update", {
        status: 400,
        headers: corsHeaders,
      });
    }

    // Ensure the place belongs to this user
    const { data: existing, error: existingError } = await supabaseAdmin
      .from("places")
      .select("id, user_id")
      .eq("id", place_id)
      .single();

    if (existingError || !existing) {
      console.error("Place not found for update:", existingError);
      return new Response("Place not found", {
        status: 404,
        headers: corsHeaders,
      });
    }

    if (existing.user_id !== userId) {
      console.warn("Update forbidden: place does not belong to this user");
      return new Response("Forbidden", {
        status: 403,
        headers: corsHeaders,
      });
    }

    // Validate links if provided
    if (links !== undefined) {
      if (!Array.isArray(links)) {
        return new Response("links must be an array", {
          status: 400,
          headers: corsHeaders,
        });
      }
      if (links.length > 3) {
        return new Response("Maximum 3 links allowed", {
          status: 400,
          headers: corsHeaders,
        });
      }
      for (const link of links) {
        if (!link.url || typeof link.url !== "string") {
          return new Response("Each link must have a url", {
            status: 400,
            headers: corsHeaders,
          });
        }
      }
    }

    const updatePayload: Record<string, any> = {
      title: title ?? null,
      notes: notes ?? null,
      street_line1: street_line1 ?? null,
      street_line2: street_line2 ?? null,
      city: city ?? null,
      state: state ?? null,
      postal_code: postal_code ?? null,
      country: country ?? null,
      phone: phone ?? null,
      website: website ?? null,
      category: category ?? null,
    };

    // Only include links if provided
    if (links !== undefined) {
      updatePayload.links = links;
    }

    const { error: updateError } = await supabaseAdmin
      .from("places")
      .update(updatePayload)
      .eq("id", place_id)
      .eq("user_id", userId);

    if (updateError) {
      console.error("Update error:", updateError);
      return new Response("Error updating place", {
        status: 500,
        headers: corsHeaders,
      });
    }

    return new Response(JSON.stringify({ status: "ok" }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }

  // ---- ACTION: delete ----
  if (action === "delete") {
    const { place_id } = payload ?? {};

    if (!place_id) {
      return new Response("Missing place_id for delete", {
        status: 400,
        headers: corsHeaders,
      });
    }

    // Ensure the place belongs to this user
    const { data: existing, error: existingError } = await supabaseAdmin
      .from("places")
      .select("id, user_id")
      .eq("id", place_id)
      .single();

    if (existingError || !existing) {
      console.error("Place not found for delete:", existingError);
      return new Response("Place not found", {
        status: 404,
        headers: corsHeaders,
      });
    }

    if (existing.user_id !== userId) {
      console.warn("Delete forbidden: place does not belong to this user");
      return new Response("Forbidden", {
        status: 403,
        headers: corsHeaders,
      });
    }

    const { error: deleteError } = await supabaseAdmin
      .from("places")
      .delete()
      .eq("id", place_id)
      .eq("user_id", userId);

    if (deleteError) {
      console.error("Delete error:", deleteError);
      return new Response("Error deleting place", {
        status: 500,
        headers: corsHeaders,
      });
    }

    return new Response(JSON.stringify({ status: "ok" }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }

  // ---- ACTION: upload_photo ----
  if (action === "upload_photo") {
    const { place_id, file_base64, file_name, file_type, thumbnail_base64, description } = payload ?? {};

    if (!place_id || !file_base64 || !file_name) {
      return new Response("Missing place_id, file_base64, or file_name", {
        status: 400,
        headers: corsHeaders,
      });
    }

    // Verify user owns this place
    const { data: place, error: placeError } = await supabaseAdmin
      .from("places")
      .select("id, user_id")
      .eq("id", place_id)
      .single();

    if (placeError || !place) {
      console.error("Place not found for photo upload:", placeError);
      return new Response("Place not found", {
        status: 404,
        headers: corsHeaders,
      });
    }

    if (place.user_id !== userId) {
      return new Response("Forbidden", {
        status: 403,
        headers: corsHeaders,
      });
    }

    // Check photo count (max 5)
    const { count, error: countError } = await supabaseAdmin
      .from("place_photos")
      .select("*", { count: "exact", head: true })
      .eq("place_id", place_id);

    if (countError) {
      console.error("Error counting photos:", countError);
      return new Response("Error checking photo count", {
        status: 500,
        headers: corsHeaders,
      });
    }

    if ((count ?? 0) >= 5) {
      return new Response("Maximum 5 photos per place", {
        status: 400,
        headers: corsHeaders,
      });
    }

    // Decode base64 and upload to storage
    const fileBuffer = Uint8Array.from(atob(file_base64), (c) => c.charCodeAt(0));
    const timestamp = Date.now();
    const sanitizedFileName = file_name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const storagePath = `${userId}/${place_id}/${timestamp}_${sanitizedFileName}`;

    const { error: uploadError } = await supabaseAdmin.storage
      .from("place-photos")
      .upload(storagePath, fileBuffer, {
        contentType: file_type || "image/jpeg",
        upsert: false,
      });

    if (uploadError) {
      console.error("Storage upload error:", uploadError);
      return new Response("Upload failed: " + uploadError.message, {
        status: 500,
        headers: corsHeaders,
      });
    }

    // Upload thumbnail if provided
    let thumbnailPath: string | null = null;
    if (thumbnail_base64) {
      const thumbBuffer = Uint8Array.from(atob(thumbnail_base64), (c) => c.charCodeAt(0));
      const thumbStoragePath = `${userId}/${place_id}/thumb_${timestamp}_${sanitizedFileName}`;

      const { error: thumbError } = await supabaseAdmin.storage
        .from("place-photos")
        .upload(thumbStoragePath, thumbBuffer, {
          contentType: file_type || "image/jpeg",
          upsert: false,
        });

      if (!thumbError) {
        thumbnailPath = thumbStoragePath;
      } else {
        console.warn("Thumbnail upload failed:", thumbError);
      }
    }

    // Create database record
    const { data: photo, error: dbError } = await supabaseAdmin
      .from("place_photos")
      .insert({
        place_id,
        storage_path: storagePath,
        thumbnail_path: thumbnailPath,
        description: description || null,
        display_order: count ?? 0,
      })
      .select()
      .single();

    if (dbError) {
      console.error("Database insert error:", dbError);
      // Clean up uploaded files
      await supabaseAdmin.storage.from("place-photos").remove([storagePath]);
      if (thumbnailPath) {
        await supabaseAdmin.storage.from("place-photos").remove([thumbnailPath]);
      }
      return new Response("Database error: " + dbError.message, {
        status: 500,
        headers: corsHeaders,
      });
    }

    // Get public URLs
    const { data: urlData } = supabaseAdmin.storage.from("place-photos").getPublicUrl(storagePath);
    const publicUrl = urlData?.publicUrl || null;

    let thumbUrl: string | null = null;
    if (thumbnailPath) {
      const { data: thumbUrlData } = supabaseAdmin.storage.from("place-photos").getPublicUrl(thumbnailPath);
      thumbUrl = thumbUrlData?.publicUrl || null;
    }

    return new Response(
      JSON.stringify({
        status: "ok",
        photo: {
          ...photo,
          url: publicUrl,
          thumbnail_url: thumbUrl,
        },
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      },
    );
  }

  // ---- ACTION: delete_photo ----
  if (action === "delete_photo") {
    const { photo_id, place_id } = payload ?? {};

    if (!photo_id || !place_id) {
      return new Response("Missing photo_id or place_id", {
        status: 400,
        headers: corsHeaders,
      });
    }

    // Verify user owns this place
    const { data: place, error: placeError } = await supabaseAdmin
      .from("places")
      .select("id, user_id")
      .eq("id", place_id)
      .single();

    if (placeError || !place) {
      return new Response("Place not found", {
        status: 404,
        headers: corsHeaders,
      });
    }

    if (place.user_id !== userId) {
      return new Response("Forbidden", {
        status: 403,
        headers: corsHeaders,
      });
    }

    // Get photo record
    const { data: photo, error: photoError } = await supabaseAdmin
      .from("place_photos")
      .select("*")
      .eq("id", photo_id)
      .eq("place_id", place_id)
      .single();

    if (photoError || !photo) {
      return new Response("Photo not found", {
        status: 404,
        headers: corsHeaders,
      });
    }

    // Delete from storage
    const filesToDelete = [photo.storage_path];
    if (photo.thumbnail_path) {
      filesToDelete.push(photo.thumbnail_path);
    }

    const { error: storageError } = await supabaseAdmin.storage
      .from("place-photos")
      .remove(filesToDelete);

    if (storageError) {
      console.warn("Storage delete warning:", storageError);
      // Continue anyway to delete DB record
    }

    // Delete from database
    const { error: deleteError } = await supabaseAdmin
      .from("place_photos")
      .delete()
      .eq("id", photo_id);

    if (deleteError) {
      console.error("Photo delete error:", deleteError);
      return new Response("Error deleting photo", {
        status: 500,
        headers: corsHeaders,
      });
    }

    return new Response(JSON.stringify({ status: "ok" }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }

  // ---- ACTION: update_photo ----
  if (action === "update_photo") {
    const { photo_id, place_id, description } = payload ?? {};

    if (!photo_id || !place_id) {
      return new Response("Missing photo_id or place_id", {
        status: 400,
        headers: corsHeaders,
      });
    }

    // Verify user owns this place
    const { data: place, error: placeError } = await supabaseAdmin
      .from("places")
      .select("id, user_id")
      .eq("id", place_id)
      .single();

    if (placeError || !place) {
      return new Response("Place not found", {
        status: 404,
        headers: corsHeaders,
      });
    }

    if (place.user_id !== userId) {
      return new Response("Forbidden", {
        status: 403,
        headers: corsHeaders,
      });
    }

    // Update photo description
    const { error: updateError } = await supabaseAdmin
      .from("place_photos")
      .update({ description: description ?? null })
      .eq("id", photo_id)
      .eq("place_id", place_id);

    if (updateError) {
      console.error("Photo update error:", updateError);
      return new Response("Error updating photo", {
        status: 500,
        headers: corsHeaders,
      });
    }

    return new Response(JSON.stringify({ status: "ok" }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }

  // ---- ACTION: upload_profile_photo ----
  if (action === "upload_profile_photo") {
    const { file_base64, file_name, file_type } = payload ?? {};

    if (!file_base64 || !file_name) {
      return new Response(
        JSON.stringify({ error: "Missing file_base64 or file_name" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        }
      );
    }

    // Check file size (max 5MB for profile photos)
    const fileSizeBytes = Math.ceil((file_base64.length * 3) / 4);
    const maxSize = 5 * 1024 * 1024; // 5MB
    if (fileSizeBytes > maxSize) {
      return new Response(
        JSON.stringify({ error: "File too large. Maximum size is 5MB." }),
        {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        }
      );
    }

    // Delete old profile photo if exists
    const { data: currentProfile } = await supabaseAdmin
      .from("profiles")
      .select("profile_photo_path")
      .eq("id", userId)
      .single();

    if (currentProfile?.profile_photo_path) {
      await supabaseAdmin.storage
        .from("place-photos")
        .remove([currentProfile.profile_photo_path]);
    }

    // Decode base64 and upload to storage
    const fileBuffer = Uint8Array.from(atob(file_base64), (c) => c.charCodeAt(0));
    const timestamp = Date.now();
    const sanitizedFileName = file_name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const storagePath = `profiles/${userId}/${timestamp}_${sanitizedFileName}`;

    const { error: uploadError } = await supabaseAdmin.storage
      .from("place-photos")
      .upload(storagePath, fileBuffer, {
        contentType: file_type || "image/jpeg",
        upsert: false,
      });

    if (uploadError) {
      console.error("Profile photo upload error:", uploadError);
      return new Response(
        JSON.stringify({ error: "Upload failed: " + uploadError.message }),
        {
          status: 500,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        }
      );
    }

    // Update profile with photo path
    const { error: updateError } = await supabaseAdmin
      .from("profiles")
      .update({ profile_photo_path: storagePath })
      .eq("id", userId);

    if (updateError) {
      console.error("Profile update error:", updateError);
      // Clean up uploaded file
      await supabaseAdmin.storage.from("place-photos").remove([storagePath]);
      return new Response(
        JSON.stringify({ error: "Failed to update profile" }),
        {
          status: 500,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        }
      );
    }

    // Get public URL
    const { data: urlData } = supabaseAdmin.storage
      .from("place-photos")
      .getPublicUrl(storagePath);

    return new Response(
      JSON.stringify({
        status: "ok",
        profile_photo_path: storagePath,
        profile_photo_url: urlData?.publicUrl || null,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  }

  // ---- Unknown action ----
  return new Response("Unknown action", {
    status: 400,
    headers: corsHeaders,
  });
});

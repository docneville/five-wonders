// supabase/functions/ingest-shortcut/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// -------- CORS headers so GitHub Pages can call this function --------
const corsHeaders: Record<string, string> = {
  // You can tighten this later to just your domain:
  // "Access-Control-Allow-Origin": "https://docneville.github.io",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
};

// -------- Supabase admin client --------
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

function decodeJWTPayload(token: string): { sub: string; exp?: number } | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = JSON.parse(
      new TextDecoder().decode(
        Uint8Array.from(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)),
      ),
    );
    if (!payload?.sub) return null;
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

// -------- Helper: normalize OSM address into columns --------
function extractAddressParts(address: any = {}) {
  const streetLine1 =
    [address.house_number, address.road].filter(Boolean).join(" ") || null;

  const streetLine2 =
    [
      address.neighbourhood,
      address.suburb,
      address.city_district,
    ]
      .filter(Boolean)
      .join(", ") || null;

  const city =
    address.city ||
    address.town ||
    address.village ||
    address.hamlet ||
    address.municipality ||
    null;

  const stateRegion =
    address.state ||
    address.state_district ||
    address.region ||
    address.province ||
    null;

  const postalCode = address.postcode || null;
  const country = address.country || null;
  const countryCode = address.country_code || null;

  return {
    streetLine1,
    streetLine2,
    city,
    stateRegion,
    postalCode,
    country,
    countryCode,
  };
}

// -------- Helper: extract contact-ish info from extratags --------
function extractContactInfo(extratags: any = {}) {
  const phone =
    extratags.phone ??
    extratags["contact:phone"] ??
    null;

  const website =
    extratags.website ??
    extratags["contact:website"] ??
    null;

  const openingHours = extratags.opening_hours ?? null;

  return { phone, website, openingHours };
}

// -------- Main handler --------
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

  // Parse JSON body
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

  console.log("Parsed payload:", JSON.stringify(payload));

  const {
    place_name,
    place_address,
    latitude,
    longitude,
    user_note,
    wonder_reason,
    osm_address,
    osm_extratags,
    category,
    is_wonder,
  } = payload ?? {};

  // Verify JWT from Authorization header
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response("Unauthorized", { status: 401, headers: corsHeaders });
  }
  const jwtPayload = decodeJWTPayload(authHeader.slice(7));
  const userId = jwtPayload?.sub ?? null;
  if (!userId) {
    return new Response("Unauthorized", { status: 401, headers: corsHeaders });
  }
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("approval_status")
    .eq("id", userId)
    .single();
  if (!profile || profile.approval_status !== "approved") {
    return new Response("Forbidden", { status: 403, headers: corsHeaders });
  }

  // Parse latitude / longitude
  const latNum =
    typeof latitude === "number" ? latitude : Number.parseFloat(latitude);
  const lonNum =
    typeof longitude === "number" ? longitude : Number.parseFloat(longitude);

  // Derive normalized address + contact info from OSM data (if provided)
  const addressParts = extractAddressParts(osm_address || {});
  const contact = extractContactInfo(osm_extratags || {});

  // Build insert payload
  const insertPayload: Record<string, unknown> = {
    user_id: userId,
    title: place_name || null,
    raw_text: place_address || null,
    notes: user_note || null,
    wonder_reason: wonder_reason || null,
    category: category || "Other",
    is_wonder: is_wonder === true,

    // OSM raw blobs
    osm_address: osm_address ?? null,
    osm_extratags: osm_extratags ?? null,

    // Normalized address components
    street_line1: addressParts.streetLine1,
    street_line2: addressParts.streetLine2,
    city: addressParts.city,
    state: addressParts.stateRegion,        // reuses existing "state" column
    postal_code: addressParts.postalCode,
    country: addressParts.country,
    country_code: addressParts.countryCode,

    // Contact-ish fields
    phone: contact.phone,
    website: contact.website,
    opening_hours: contact.openingHours,
  };

  if (!Number.isNaN(latNum) && !Number.isNaN(lonNum)) {
    insertPayload.latitude = latNum;
    insertPayload.longitude = lonNum;
    insertPayload.location = `SRID=4326;POINT(${lonNum} ${latNum})`;
  }

  console.log("Insert payload:", insertPayload);

  const { data: inserted, error: insertError } = await supabaseAdmin
    .from("places")
    .insert(insertPayload)
    .select("id")
    .single();

  if (insertError) {
    console.error("Insert place error:", insertError);
    return new Response("Error inserting place", {
      status: 500,
      headers: corsHeaders,
    });
  }

  const body = JSON.stringify({
    status: "ok",
    place_id: inserted?.id ?? null,
  });

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
    },
  });
});

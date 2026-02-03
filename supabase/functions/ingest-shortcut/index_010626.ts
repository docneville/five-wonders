import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(supabaseUrl, serviceRoleKey);

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Only POST allowed", { status: 405 });
  }

  const contentType = req.headers.get("content-type") || "";
  console.log("Content-Type:", contentType);

  const rawBody = await req.text();
  console.log("Raw body:", rawBody);

  if (!contentType.includes("application/json")) {
    console.log("Bad content-type, returning 400");
    return new Response("Expected application/json", { status: 400 });
  }

  if (!rawBody) {
    console.log("Empty body, refusing to insert");
    return new Response("Empty body", { status: 400 });
  }

  let parsed: any;
  try {
    parsed = JSON.parse(rawBody);
    console.log("Parsed JSON payload:", parsed);
  } catch (e) {
    console.error("JSON parse error", e);
    return new Response("Bad JSON", { status: 400 });
  }

  // Handle the case where Shortcuts wraps the real payload like:
  // { "": { place_name: "...", ... } }
  let payload = parsed;
  if (
    payload &&
    typeof payload === "object" &&
    !("place_name" in payload) &&
    Object.keys(payload).length === 1
  ) {
    const onlyKey = Object.keys(payload)[0];
    const inner = payload[onlyKey];
    if (inner && typeof inner === "object") {
      console.log("Detected nested payload under key:", onlyKey);
      payload = inner;
    }
  }

  const {
    place_name,
    place_address,
    latitude,
    longitude,
    user_note,
  } = payload as {
    place_name?: string;
    place_address?: string;
    latitude?: number;
    longitude?: number;
    user_note?: string;
  };

  if (!place_name && !place_address && !user_note) {
    console.log("No meaningful fields in payload, refusing to insert");
    return new Response("Missing fields", { status: 400 });
  }

  const title =
    (place_name && String(place_name).trim()) ||
    (place_address && String(place_address).trim()) ||
    null;

  const raw_text_parts = [
    place_name,
    place_address,
    user_note,
  ].filter(Boolean) as string[];

  const insertPayload: Record<string, unknown> = {
    from_phone: null,
    raw_text: raw_text_parts.join("\n\n"),
    maps_url: null,
    notes: user_note ?? null,
    hashtags: [],
    title,
  };

  if (typeof latitude === "number" && typeof longitude === "number") {
    insertPayload.latitude = latitude;
    insertPayload.longitude = longitude;
    insertPayload.location = `SRID=4326;POINT(${longitude} ${latitude})`;
  }

  console.log("Insert payload:", insertPayload);

  const { data, error } = await supabase
    .from("places")
    .insert(insertPayload)
    .select("id, title, raw_text, latitude, longitude, notes")
    .single();

  if (error) {
    console.error("Insert place error", error);
    return new Response("Error saving place", { status: 500 });
  }

  console.log("Insert success:", data);

  return new Response(
    JSON.stringify({
      ok: true,
      id: data?.id ?? null,
      title: data?.title ?? null,
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }
  );
});




// supabase/functions/ingest-sms/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";


const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

console.log("SUPABASE_URL:", supabaseUrl);
console.log("SERVICE_ROLE_KEY present:", !!serviceRoleKey);

const supabase = createClient(supabaseUrl, serviceRoleKey);

// Helpers to parse Apple Maps link from SMS body
function extractAppleMapsUrl(text: string): string | null {
  const urlRegex = /(https?:\/\/maps\.apple\/[^\s]+)/;
  const match = text.match(urlRegex);
  return match ? match[1] : null;
}

function getQueryParam(url: string, key: string): string | null {
  try {
    const u = new URL(url);
    return u.searchParams.get(key);
  } catch {
    return null;
  }
}

// Example: https://maps.apple.com/?ll=39.0997,-94.5786&q=Joe%27s%20BBQ
function parseAppleMaps(url: string) {
  const ll = getQueryParam(url, "ll"); // "lat,lon"
  const q = getQueryParam(url, "q");   // title

  let latitude: number | null = null;
  let longitude: number | null = null;

  if (ll) {
    const [latStr, lonStr] = ll.split(",");
    latitude = parseFloat(latStr);
    longitude = parseFloat(lonStr);
  }

  const title = q ? decodeURIComponent(q) : null;

  return { latitude, longitude, title };
}

// Counld be temporary?
async function expandAppleShortLink(url: string): Promise<string> {
  const resp = await fetch(url, { redirect: "follow" });
  return resp.url; // final URL after redirects
}

// Very simple hashtag generator for now
function generateHashtags(args: {
  title?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  notes?: string | null;
}): string[] {
  const tags = new Set<string>();

  const makeTag = (s: string) =>
    "#" +
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "") // remove non-alphanum
      .trim();

  if (args.title) tags.add(makeTag(args.title));
  if (args.city) tags.add(makeTag(args.city));
  if (args.state) tags.add(makeTag(args.state));
  if (args.country) tags.add(makeTag(args.country));

  // Notes-driven custom tags: anything like #foo in notes
  if (args.notes) {
    const re = /#(\w+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(args.notes)) !== null) {
      tags.add("#" + m[1].toLowerCase());
    }
  }

  // Filter out dumb empty tags
  return Array.from(tags).filter((t) => t.length > 1);
}

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Only POST allowed", { status: 405 });
  }

  // Twilio sends application/x-www-form-urlencoded
  const formData = await req.formData();
  const from = (formData.get("From") as string | null) ?? "";
  const body = (formData.get("Body") as string | null) ?? "";

  // v0: no auth yet — store sender phone directly on the place
  const fromPhone = from;

  let mapsUrl = extractAppleMapsUrl(body);

  // QUICK STEP: expand Apple Maps short links like https://maps.apple/p/...
  if (mapsUrl?.startsWith("https://maps.apple/p/")) {
    const expanded = await expandAppleShortLink(mapsUrl);
    console.log("Expanded Apple short link to:", expanded);
    mapsUrl = expanded;
  }

  let latitude: number | null = null;
  let longitude: number | null = null;
  let title: string | null = null;

  if (mapsUrl) {
    const parsed = parseAppleMaps(mapsUrl);
    latitude = parsed.latitude;
    longitude = parsed.longitude;
    title = parsed.title;
  }

  // For now, treat any non-URL text in the body as notes
  const notes = body.replace(mapsUrl ?? "", "").trim();


  // TODO: reverse geocode lat/long to city/state/country via external API
  const city = null;
  const state = null;
  const country = null;

  const hashtags = generateHashtags({
    title,
    city,
    state,
    country,
    notes,
  });

  const insertPayload: Record<string, unknown> = {
    from_phone: fromPhone,
    raw_text: body,
    maps_url: mapsUrl,
    notes,
    hashtags,
    title,
  };

  if (latitude != null && longitude != null) {
    insertPayload.latitude = latitude;
    insertPayload.longitude = longitude;
    // PostGIS point: ST_SetSRID(ST_MakePoint(lon, lat), 4326)
    insertPayload.location = `SRID=4326;POINT(${longitude} ${latitude})`;
  }

  const { error: insertPlaceError } = await supabase
    .from("places")
    .insert(insertPayload);

  if (insertPlaceError) {
    console.error("Insert place error", insertPlaceError);
    return new Response("Error saving place", { status: 500 });
  }

  // Twilio expects some kind of response; we'll send a simple SMS back
  // via TwiML
  const twiml = `
    <Response>
      <Message>Saved${title ? ` (${title})` : ""}</Message>
    </Response>
  `.trim();

  return new Response(twiml, {
    status: 200,
    headers: { "Content-Type": "application/xml" },
  });
});


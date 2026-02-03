// supabase/functions/ingest-sms/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SignJWT, importPKCS8 } from "https://esm.sh/jose@5.9.6";

// --- Supabase ---
const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

console.log("SUPABASE_URL present:", !!supabaseUrl);
console.log("SERVICE_ROLE_KEY present:", !!serviceRoleKey);

const supabase = createClient(supabaseUrl, serviceRoleKey);

// --- Apple Maps Server API Secrets (stored in Supabase Vault) ---
const appleTeamId = Deno.env.get("APPLE_MAPS_TEAM_ID")!;
const appleKeyId = Deno.env.get("APPLE_MAPS_KEY_ID")!;
let applePrivateKey = Deno.env.get("APPLE_MAPS_PRIVATE_KEY")!;

// If you pasted the .p8 into Vault and it got stored with literal "\n", fix it:
applePrivateKey = applePrivateKey.replace(/\\n/g, "\n");

// ---- Helpers: Apple Maps URL extraction & parsing ----
function extractAppleMapsUrl(text: string): string | null {
  // Matches:
  // - https://maps.apple/p/<id>
  // - https://maps.apple.com/?ll=...&q=...
  // - https://maps.apple.com/...
  const urlRegex = /(https?:\/\/maps\.apple(?:\.com)?\/[^\s]+)/;
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
  const q = getQueryParam(url, "q"); // title

  let latitude: number | null = null;
  let longitude: number | null = null;

  if (ll) {
    const [latStr, lonStr] = ll.split(",");
    latitude = Number.isFinite(parseFloat(latStr)) ? parseFloat(latStr) : null;
    longitude = Number.isFinite(parseFloat(lonStr)) ? parseFloat(lonStr) : null;
  }

  const title = q ? decodeURIComponent(q) : null;

  return { latitude, longitude, title };
}

// Extract place id from short link: https://maps.apple/p/<PLACE_ID>
function extractApplePlaceIdFromShortLink(url: string): string | null {
  const m = url.match(/^https?:\/\/maps\.apple\/p\/([^/?#\s]+)/);
  return m ? m[1] : null;
}

// ---- Apple Maps Server API: token + place lookup ----
// Cache access token while the edge function instance stays warm
let cachedAppleAccessToken: { token: string; expMs: number } | null = null;

async function getAppleMapsAccessToken(): Promise<string> {
  const now = Date.now();
  if (cachedAppleAccessToken && now < cachedAppleAccessToken.expMs - 60_000) {
    return cachedAppleAccessToken.token; // reuse until ~1 minute before expiry
  }

  // Create a signed "maps auth token" (JWT)
  const privateKey = await importPKCS8(applePrivateKey, "ES256");

  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + 20 * 60; // 20 minutes

const mapsAuthToken = await new SignJWT({})
  .setProtectedHeader({ alg: "ES256", kid: APPLE_MAPS_KEY_ID, typ: "JWT" })
  .setIssuer(APPLE_TEAM_ID)
  .setSubject(APPLE_MAPS_ID) // <-- THIS is the big one for you
  .setIssuedAt()
  .setExpirationTime("30m")
  .sign(privateKey);

  // Exchange the auth token for a short-lived access token
  const resp = await fetch("https://maps-api.apple.com/v1/token", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${mapsAuthToken}`,
    },
  });

  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`Apple token exchange failed: ${resp.status} ${t}`);
  }

  // Apple’s response shape may differ slightly; handle common variants
  const data = (await resp.json()) as Record<string, unknown>;

  const token =
    (data["accessToken"] as string | undefined) ??
    (data["access_token"] as string | undefined);

  const expiresInSeconds =
    (data["expiresInSeconds"] as number | undefined) ??
    (data["expires_in"] as number | undefined);

  if (!token || !expiresInSeconds) {
    throw new Error(`Apple token exchange returned unexpected payload: ${JSON.stringify(data)}`);
  }

  cachedAppleAccessToken = {
    token,
    expMs: Date.now() + expiresInSeconds * 1000,
  };

  return token;
}

type ApplePlaceResult = {
  name: string | null;
  lat: number | null;
  lon: number | null;
};

async function lookupApplePlace(placeId: string): Promise<ApplePlaceResult> {
  const accessToken = await getAppleMapsAccessToken();

  const resp = await fetch(
    `https://maps-api.apple.com/v1/place/${encodeURIComponent(placeId)}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );

  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`Apple place lookup failed: ${resp.status} ${t}`);
  }

  const data = (await resp.json()) as any;

  // Be defensive about shape
  const name: string | null =
    typeof data?.name === "string"
      ? data.name
      : typeof data?.place?.name === "string"
        ? data.place.name
        : null;

  const coord = data?.coordinate ?? data?.place?.coordinate ?? null;

  const latRaw = coord?.latitude ?? coord?.lat ?? null;
  const lonRaw = coord?.longitude ?? coord?.lon ?? null;

  const lat = typeof latRaw === "number" ? latRaw : latRaw ? parseFloat(String(latRaw)) : null;
  const lon = typeof lonRaw === "number" ? lonRaw : lonRaw ? parseFloat(String(lonRaw)) : null;

  return {
    name,
    lat: Number.isFinite(lat as number) ? (lat as number) : null,
    lon: Number.isFinite(lon as number) ? (lon as number) : null,
  };
}

// ---- Very simple hashtag generator for now ----
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
      .replace(/[^a-z0-9]+/g, "")
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

  return Array.from(tags).filter((t) => t.length > 1);
}

// ---- Handler ----
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

  // IMPORTANT: keep the original URL for stripping notes
  const extractedUrl = extractAppleMapsUrl(body);
  let mapsUrl = extractedUrl;

  let latitude: number | null = null;
  let longitude: number | null = null;
  let title: string | null = null;

  try {
    if (mapsUrl) {
      const placeId = extractApplePlaceIdFromShortLink(mapsUrl);

      if (placeId) {
        // Short link -> Apple Maps Server API place lookup
        const place = await lookupApplePlace(placeId);
        title = place.name;
        latitude = place.lat;
        longitude = place.lon;

        console.log("Apple place lookup:", {
          placeId,
          title,
          latitude,
          longitude,
        });
      } else {
        // Normal maps URL with ll/q params
        const parsed = parseAppleMaps(mapsUrl);
        latitude = parsed.latitude;
        longitude = parsed.longitude;
        title = parsed.title;
      }
    }
  } catch (e) {
    // Don’t fail the whole ingestion if enrichment fails;
    // keep raw mapsUrl + notes and still insert.
    console.error("Apple enrichment error:", e?.message ?? e);
  }

  // For now, treat any non-URL text in the body as notes
  const notes = body.replace(extractedUrl ?? "", "").trim();

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

  // Twilio expects TwiML response
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

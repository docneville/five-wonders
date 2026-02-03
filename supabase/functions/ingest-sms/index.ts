// supabase/functions/ingest-sms/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// -------------------- Supabase --------------------
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

console.log("SUPABASE_URL present:", !!SUPABASE_URL);
console.log("SERVICE_ROLE_KEY present:", !!SUPABASE_SERVICE_ROLE_KEY);

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// -------------------- Apple Maps Auth (Portal token -> /v1/token -> access token) --------------------
const APPLE_MAPS_AUTH_TOKEN = Deno.env.get("APPLE_MAPS_AUTH_TOKEN") ?? "";
const APPLE_MAPS_ID = Deno.env.get("APPLE_MAPS_ID") ?? ""; // e.g. maps.com.fivewonders

console.log("APPLE_MAPS_AUTH_TOKEN present:", !!APPLE_MAPS_AUTH_TOKEN);
console.log("APPLE_MAPS_ID present:", !!APPLE_MAPS_ID);

// Cache access token in-memory between invocations (best effort)
let cachedAppleAccessToken: { token: string; expiresAtMs: number } | null = null;

/**
 * Exchanges the Apple "Maps Auth Token" (created in Apple Dev portal) for a short-lived Maps Access Token.
 */
async function getAppleMapsAccessToken(): Promise<string> {
  const now = Date.now();

  if (cachedAppleAccessToken && cachedAppleAccessToken.expiresAtMs > now + 30_000) {
    return cachedAppleAccessToken.token;
  }

  if (!APPLE_MAPS_AUTH_TOKEN) {
    throw new Error("APPLE_MAPS_AUTH_TOKEN is not defined (Supabase Vault)");
  }

  const resp = await fetch("https://maps-api.apple.com/v1/token", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${APPLE_MAPS_AUTH_TOKEN}`,
    },
  });

  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(`Apple token exchange failed: ${resp.status} ${text}`);
  }

  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Apple token exchange returned non-JSON: ${text}`);
  }

  const token =
    data?.accessToken ??
    data?.access_token ??
    data?.token ??
    data?.value;

  if (!token || typeof token !== "string") {
    throw new Error(`Unexpected /v1/token response: ${JSON.stringify(data)}`);
  }

  // Apple access tokens are short-lived (~30 min). If response contains expiresIn, use it; else assume 25 min.
  const expiresInSec =
    typeof data?.expiresIn === "number"
      ? data.expiresIn
      : typeof data?.expires_in === "number"
        ? data.expires_in
        : 25 * 60;

  cachedAppleAccessToken = {
    token,
    expiresAtMs: now + expiresInSec * 1000,
  };

  console.log("Apple access token refreshed; expiresInSec:", expiresInSec);
  return token;
}

type ApplePlaceResult = {
  name: string | null;
  lat: number | null;
  lon: number | null;
  address: string | null;
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

  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(`Apple place lookup failed: ${resp.status} ${text}`);
  }

  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Apple place lookup returned non-JSON: ${text}`);
  }

  const name =
    typeof data?.name === "string"
      ? data.name
      : typeof data?.place?.name === "string"
        ? data.place.name
        : null;

  const coord = data?.coordinate ?? data?.place?.coordinate ?? null;

  const latRaw = coord?.latitude ?? coord?.lat ?? null;
  const lonRaw = coord?.longitude ?? coord?.lon ?? null;

  const lat =
    typeof latRaw === "number" ? latRaw : latRaw ? parseFloat(String(latRaw)) : null;
  const lon =
    typeof lonRaw === "number" ? lonRaw : lonRaw ? parseFloat(String(lonRaw)) : null;

  // Address varies by response shape; keep best-effort
  const address =
    typeof data?.formattedAddress === "string"
      ? data.formattedAddress
      : typeof data?.address?.formattedAddress === "string"
        ? data.address.formattedAddress
        : typeof data?.place?.formattedAddress === "string"
          ? data.place.formattedAddress
          : null;

  return {
    name,
    lat: Number.isFinite(lat as number) ? (lat as number) : null,
    lon: Number.isFinite(lon as number) ? (lon as number) : null,
    address,
  };
}

// -------------------- URL parsing helpers --------------------
function extractAppleMapsUrl(text: string): string | null {
  // Matches:
  // - https://maps.apple/p/<id>
  // - https://maps.apple.com/...
  // - https://maps.apple.com/?ll=...&q=...
  const urlRegex = /(https?:\/\/maps\.apple(?:\.com)?\/[^\s]+)/i;
  const match = text.match(urlRegex);
  return match ? match[1] : null;
}

function extractApplePlaceIdFromShortLink(url: string): string | null {
  // https://maps.apple/p/<placeId>
  const m = url.match(/^https?:\/\/maps\.apple\/p\/([^/?#\s]+)/i);
  return m ? m[1] : null;
}

function getQueryParam(url: string, key: string): string | null {
  try {
    const u = new URL(url);
    return u.searchParams.get(key);
  } catch {
    return null;
  }
}

function parseAppleMaps(url: string) {
  // Example: https://maps.apple.com/?ll=39.0997,-94.5786&q=Joes%20BBQ
  const ll = getQueryParam(url, "ll");
  const q = getQueryParam(url, "q");

  let latitude: number | null = null;
  let longitude: number | null = null;

  if (ll) {
    const [latStr, lonStr] = ll.split(",");
    const lat = parseFloat(latStr);
    const lon = parseFloat(lonStr);
    latitude = Number.isFinite(lat) ? lat : null;
    longitude = Number.isFinite(lon) ? lon : null;
  }

  const title = q ? safeDecode(q) : null;
  return { latitude, longitude, title };
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

// -------------------- Hashtags --------------------
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

  // Notes-driven: preserve any explicit #tags the user typed
  if (args.notes) {
    const re = /#(\w+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(args.notes)) !== null) {
      tags.add("#" + m[1].toLowerCase());
    }
  }

  return Array.from(tags).filter((t) => t.length > 1);
}

// -------------------- Main handler --------------------
serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Only POST allowed", { status: 405 });
  }

  // Twilio sends application/x-www-form-urlencoded
  const formData = await req.formData();
  const from = (formData.get("From") as string | null) ?? "";
  const body = (formData.get("Body") as string | null) ?? "";

  const fromPhone = from;

  const extractedUrl = extractAppleMapsUrl(body);
  const mapsUrl = extractedUrl;

  let latitude: number | null = null;
  let longitude: number | null = null;
  let title: string | null = null;
  let address: string | null = null;

  try {
    if (mapsUrl) {
      const placeId = extractApplePlaceIdFromShortLink(mapsUrl);

      if (placeId) {
        // ✅ Apple short link place id: call Apple Server API via access token
        const place = await lookupApplePlace(placeId);
        title = place.name;
        latitude = place.lat;
        longitude = place.lon;
        address = place.address;

        console.log("Apple place lookup:", {
          placeId,
          title,
          latitude,
          longitude,
          address,
        });
      } else {
        // Regular Apple Maps URL with ll/q
        const parsed = parseAppleMaps(mapsUrl);
        latitude = parsed.latitude;
        longitude = parsed.longitude;
        title = parsed.title;
      }
    }
  } catch (e) {
    // Don’t fail ingestion if enrichment fails; still store raw text/url.
    console.error("Apple enrichment error:", (e as any)?.message ?? e);
  }

  // Everything besides the URL becomes notes
  const notes = body.replace(extractedUrl ?? "", "").trim();

  // TODO: reverse geocode to city/state/country if desired
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
    address,
  };

  if (latitude != null && longitude != null) {
    insertPayload.latitude = latitude;
    insertPayload.longitude = longitude;
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

// supabase/functions/share-place/index.ts
// Returns a tiny HTML page with Open Graph meta tags so iMessage / WhatsApp /
// Slack etc. can render a rich link preview.  The user's browser is then
// immediately redirected to the real view.html page.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const STORAGE_URL = `${SUPABASE_URL}/storage/v1/object/public/place-photos`;

// The live app URL — where users end up after the redirect
const APP_BASE = "https://docneville.github.io/five-wonders";
const DEFAULT_OG_IMAGE = `${APP_BASE}/icon-192.png`;
const SITE_NAME = "Five Wonders";

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

function escapeHtml(str: string): string {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildAddress(p: Record<string, string>): string {
  return [p.city, p.state, p.country].filter(Boolean).join(", ");
}

serve(async (req: Request): Promise<Response> => {
  const url = new URL(req.url);
  const placeId = url.searchParams.get("id");

  // Redirect bare function URL to the app
  if (!placeId) {
    return Response.redirect(APP_BASE + "/view.html", 302);
  }

  const viewUrl = `${APP_BASE}/view.html?place=${encodeURIComponent(placeId)}`;

  // Fetch place — service role bypasses RLS
  const { data, error } = await supabaseAdmin
    .from("places_with_profiles")
    .select(
      "id, title, category, city, state, country, notes, is_private, photos"
    )
    .eq("id", placeId)
    .single();

  // Private or not found → redirect straight to the app (which handles the error state)
  if (error || !data || data.is_private) {
    return Response.redirect(viewUrl, 302);
  }

  const title = escapeHtml(data.title || "A Wonder");
  const location = escapeHtml(buildAddress(data));
  const category = escapeHtml(data.category || "");

  const descParts = [category, location].filter(Boolean);
  const description = escapeHtml(
    descParts.length
      ? descParts.join(" · ")
      : data.notes
      ? String(data.notes).slice(0, 120)
      : "Shared via Five Wonders"
  );

  // Pick the first photo thumbnail, fall back to default logo
  let ogImage = DEFAULT_OG_IMAGE;
  const photos = Array.isArray(data.photos) ? data.photos : [];
  if (photos.length > 0) {
    const first = photos[0];
    const path = first.thumbnail_path || first.storage_path;
    if (path) ogImage = `${STORAGE_URL}/${path}`;
  }

  const ogTitle = escapeHtml(data.title || "A Wonder");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${ogTitle} — ${SITE_NAME}</title>

  <!-- Open Graph (iMessage, WhatsApp, Slack, Facebook) -->
  <meta property="og:type"        content="website" />
  <meta property="og:site_name"   content="${SITE_NAME}" />
  <meta property="og:url"         content="${escapeHtml(req.url)}" />
  <meta property="og:title"       content="${ogTitle}" />
  <meta property="og:description" content="${description}" />
  <meta property="og:image"       content="${escapeHtml(ogImage)}" />
  <meta property="og:image:width"  content="600" />
  <meta property="og:image:height" content="400" />

  <!-- Twitter / X card -->
  <meta name="twitter:card"        content="summary_large_image" />
  <meta name="twitter:title"       content="${ogTitle}" />
  <meta name="twitter:description" content="${description}" />
  <meta name="twitter:image"       content="${escapeHtml(ogImage)}" />

  <!-- Instant redirect for real browsers -->
  <meta http-equiv="refresh" content="0;url=${escapeHtml(viewUrl)}" />
  <script>window.location.replace(${JSON.stringify(viewUrl)});</script>
</head>
<body style="font-family:sans-serif;padding:32px;text-align:center;">
  <p>Opening <strong>${title}</strong>&hellip;</p>
  <p><a href="${escapeHtml(viewUrl)}">Click here if you are not redirected</a></p>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // No caching — place details (title, photo) can change
      "Cache-Control": "no-store",
    },
  });
});

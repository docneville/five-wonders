// supabase/functions/admin-users/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
};

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

async function getAdminUserId(req: Request): Promise<string | null> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  const payload = decodeJWTPayload(authHeader.slice(7));
  if (!payload) return null;
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("is_admin, approval_status")
    .eq("id", payload.sub)
    .single();
  if (!profile || !profile.is_admin || profile.approval_status !== "approved") return null;
  return payload.sub;
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: corsHeaders });

  const adminId = await getAdminUserId(req);
  if (!adminId) return new Response("Forbidden", { status: 403, headers: corsHeaders });

  let body: any;
  try { body = await req.json(); } catch { return new Response("Invalid JSON", { status: 400, headers: corsHeaders }); }

  const { action } = body ?? {};

  // ---- list: return all profiles grouped by status ----
  if (action === "list") {
    const { data, error } = await supabaseAdmin
      .from("profiles")
      .select("id, first_name, last_name, email, avatar_url, approval_status, is_admin, created_at")
      .order("created_at", { ascending: false });
    if (error) return json({ error: error.message }, 500);
    return json({ users: data });
  }

  // ---- update_status: approve / reject / suspend / reinstate ----
  if (action === "update_status") {
    const { user_id, status } = body;
    const allowed = ["approved", "rejected", "suspended", "pending"];
    if (!user_id || !allowed.includes(status)) {
      return json({ error: "Invalid user_id or status" }, 400);
    }
    // Prevent admin from demoting themselves
    if (user_id === adminId) return json({ error: "Cannot change your own status" }, 400);

    const { error } = await supabaseAdmin
      .from("profiles")
      .update({ approval_status: status })
      .eq("id", user_id);
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true });
  }

  return json({ error: "Unknown action" }, 400);
});

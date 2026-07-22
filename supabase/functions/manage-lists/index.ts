// supabase/functions/manage-lists/index.ts
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

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

function err(msg: string, status = 400) {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

async function getUserId(userToken: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("id, is_active")
    .eq("api_key", userToken)
    .single();
  if (error || !data || data.is_active === false) return null;
  return data.id as string;
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: corsHeaders });

  let payload: any;
  try { payload = await req.json(); }
  catch { return err("Invalid JSON body"); }

  const { action, user_token } = payload ?? {};

  // ---- ACTION: get_public_list (no auth) ----
  if (action === "get_public_list") {
    const { list_id } = payload;
    if (!list_id) return err("missing list_id");

    const { data: list, error: listErr } = await supabaseAdmin
      .from("lists")
      .select("id, title, description, is_private, user_id")
      .eq("id", list_id)
      .single();

    if (listErr || !list) return err("not_found", 404);
    if (list.is_private) return err("private", 403);

    const { data: listPlaces } = await supabaseAdmin
      .from("list_places")
      .select(`place_id, places ( id, title, latitude, longitude, category, city, state, country, is_private )`)
      .eq("list_id", list_id);

    const places = (listPlaces ?? [])
      .map((r: any) => r.places)
      .filter((p: any) => p && !p.is_private);

    return json({ status: "ok", list: { ...list, places } });
  }

  if (!user_token) return new Response("Missing user_token", { status: 401, headers: corsHeaders });
  const userId = await getUserId(user_token);
  if (!userId) return new Response("Invalid or inactive user_token", { status: 401, headers: corsHeaders });

  // ---- ACTION: list_lists ----
  if (action === "list_lists") {
    const { data, error } = await supabaseAdmin
      .from("lists")
      .select(`
        id, title, description, is_private, created_at, updated_at,
        list_places ( count )
      `)
      .eq("user_id", userId)
      .order("updated_at", { ascending: false });

    if (error) return err("Failed to load lists", 500);

    const lists = (data ?? []).map((l: any) => ({
      ...l,
      place_count: l.list_places?.[0]?.count ?? 0,
      list_places: undefined,
    }));

    return json({ status: "ok", lists });
  }

  // ---- ACTION: create_list ----
  if (action === "create_list") {
    const { title, description, is_private } = payload;
    if (!title?.trim()) return err("title is required");

    const { data, error } = await supabaseAdmin
      .from("lists")
      .insert({ user_id: userId, title: title.trim(), description: description?.trim() ?? null, is_private: !!is_private })
      .select("id, title, description, is_private, created_at, updated_at")
      .single();

    if (error) return err("Failed to create list", 500);
    return json({ status: "ok", list: { ...data, place_count: 0 } });
  }

  // ---- ACTION: update_list ----
  if (action === "update_list") {
    const { list_id, title, description, is_private } = payload;
    if (!list_id) return err("list_id is required");

    const { data: existing } = await supabaseAdmin
      .from("lists").select("user_id").eq("id", list_id).single();
    if (!existing || existing.user_id !== userId) return err("not found or forbidden", 403);

    const updates: any = { updated_at: new Date().toISOString() };
    if (title !== undefined) updates.title = title.trim();
    if (description !== undefined) updates.description = description?.trim() ?? null;
    if (is_private !== undefined) updates.is_private = !!is_private;

    const { data, error } = await supabaseAdmin
      .from("lists").update(updates).eq("id", list_id)
      .select("id, title, description, is_private, created_at, updated_at").single();

    if (error) return err("Failed to update list", 500);
    return json({ status: "ok", list: data });
  }

  // ---- ACTION: delete_list ----
  if (action === "delete_list") {
    const { list_id } = payload;
    if (!list_id) return err("list_id is required");

    const { data: existing } = await supabaseAdmin
      .from("lists").select("user_id").eq("id", list_id).single();
    if (!existing || existing.user_id !== userId) return err("not found or forbidden", 403);

    const { error } = await supabaseAdmin.from("lists").delete().eq("id", list_id);
    if (error) return err("Failed to delete list", 500);
    return json({ status: "ok" });
  }

  // ---- ACTION: get_list_places ----
  if (action === "get_list_places") {
    const { list_id } = payload;
    if (!list_id) return err("list_id is required");

    const { data: existing } = await supabaseAdmin
      .from("lists").select("user_id").eq("id", list_id).single();
    if (!existing || existing.user_id !== userId) return err("not found or forbidden", 403);

    const { data, error } = await supabaseAdmin
      .from("list_places")
      .select(`place_id, added_at, places ( id, title, category, city, state, country, latitude, longitude, is_private )`)
      .eq("list_id", list_id)
      .order("added_at", { ascending: false });

    if (error) return err("Failed to load list places", 500);
    const places = (data ?? []).map((r: any) => ({ ...r.places, added_at: r.added_at }));
    return json({ status: "ok", places });
  }

  // ---- ACTION: add_place_to_list ----
  if (action === "add_place_to_list") {
    const { list_id, place_id } = payload;
    if (!list_id || !place_id) return err("list_id and place_id are required");

    const { data: existing } = await supabaseAdmin
      .from("lists").select("user_id").eq("id", list_id).single();
    if (!existing || existing.user_id !== userId) return err("not found or forbidden", 403);

    const { error } = await supabaseAdmin
      .from("list_places")
      .upsert({ list_id, place_id }, { onConflict: "list_id,place_id" });

    if (error) return err("Failed to add place to list", 500);
    return json({ status: "ok" });
  }

  // ---- ACTION: remove_place_from_list ----
  if (action === "remove_place_from_list") {
    const { list_id, place_id } = payload;
    if (!list_id || !place_id) return err("list_id and place_id are required");

    const { data: existing } = await supabaseAdmin
      .from("lists").select("user_id").eq("id", list_id).single();
    if (!existing || existing.user_id !== userId) return err("not found or forbidden", 403);

    const { error } = await supabaseAdmin
      .from("list_places").delete().eq("list_id", list_id).eq("place_id", place_id);

    if (error) return err("Failed to remove place from list", 500);
    return json({ status: "ok" });
  }

  // ---- ACTION: get_place_lists ----
  // Returns all lists containing a place: public ones + owner's private ones
  if (action === "get_place_lists") {
    const { place_id } = payload;
    if (!place_id) return err("place_id is required");

    const { data, error } = await supabaseAdmin
      .from("list_places")
      .select(`list_id, lists ( id, title, is_private, user_id )`)
      .eq("place_id", place_id);

    if (error) return err("Failed to load place lists", 500);

    const lists = (data ?? [])
      .map((r: any) => r.lists)
      .filter((l: any) => l && (!l.is_private || l.user_id === userId));

    return json({ status: "ok", lists });
  }

  return err("Unknown action", 400);
});

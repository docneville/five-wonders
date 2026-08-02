// fw-auth.js — shared Supabase auth utilities
// Requires @supabase/supabase-js to be loaded before this script.

const FW_SUPABASE_URL = "https://ekpssonwtztubqfihlqm.supabase.co";
const FW_SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVrcHNzb253dHp0dWJxZmlobHFtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM1Njg2MjAsImV4cCI6MjA3OTE0NDYyMH0.R1_-ctf-6NsVUJEApf4N591lA9TPRCJQFzhrDVRbr_4";

// Single shared client instance
const _fwSb = window.supabase.createClient(FW_SUPABASE_URL, FW_SUPABASE_ANON_KEY);

window.fwAuth = {
  sb: _fwSb,

  // Returns the current session, or null if not signed in.
  async getSession() {
    const { data: { session } } = await _fwSb.auth.getSession();
    return session;
  },

  // Returns the JWT access token for authenticated API calls.
  async getJWT() {
    const { data: { session } } = await _fwSb.auth.getSession();
    return session?.access_token ?? null;
  },

  // Returns Authorization header object, or empty object if not signed in.
  async authHeaders() {
    const jwt = await this.getJWT();
    if (!jwt) return {};
    return { "Authorization": `Bearer ${jwt}` };
  },

  // Checks for a valid session; redirects to index.html if not signed in.
  // Returns the session if valid, null otherwise (after redirect).
  async requireAuth() {
    const session = await this.getSession();
    if (!session) {
      window.location.replace("index.html");
      return null;
    }
    return session;
  },

  // Signs out and redirects to index.html.
  async signOut() {
    await _fwSb.auth.signOut();
    window.location.replace("index.html");
  },
};

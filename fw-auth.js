// fw-auth.js — shared Supabase auth utilities
// Requires @supabase/supabase-js to be loaded before this script.

const FW_SUPABASE_URL = "https://ekpssonwtztubqfihlqm.supabase.co";
const FW_SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVrcHNzb253dHp0dWJxZmlobHFtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM1Njg2MjAsImV4cCI6MjA3OTE0NDYyMH0.R1_-ctf-6NsVUJEApf4N591lA9TPRCJQFzhrDVRbr_4";

const _fwSb = window.supabase.createClient(FW_SUPABASE_URL, FW_SUPABASE_ANON_KEY);

// onAuthStateChange fires INITIAL_SESSION immediately from localStorage —
// no network call, no blocking wait for a token refresh.
let _session = null;
let _ready = false;
let _waiters = [];

function _settle(session) {
  _session = session;
  if (!_ready) {
    _ready = true;
    const w = _waiters.splice(0);
    w.forEach(fn => fn(session));
  }
}

_fwSb.auth.onAuthStateChange((_event, session) => {
  _session = session; // keep current after background refreshes
  _settle(session);   // no-op once already settled
});

// Safety: if the client never fires (e.g. script load race), unblock after 4 s.
setTimeout(() => _settle(null), 4000);

function _get() {
  if (_ready) return Promise.resolve(_session);
  return new Promise(r => _waiters.push(r));
}

window.fwAuth = {
  sb: _fwSb,

  async getSession() { return _get(); },

  async getJWT() {
    const s = await _get();
    return s?.access_token ?? null;
  },

  // Auth headers for raw fetch() calls to Edge Functions.
  async authHeaders() {
    const jwt = await this.getJWT();
    return {
      "apikey": FW_SUPABASE_ANON_KEY,
      "Authorization": `Bearer ${jwt ?? FW_SUPABASE_ANON_KEY}`,
    };
  },

  async requireAuth() {
    const s = await _get();
    if (!s) { window.location.replace("index.html"); return null; }
    return s;
  },

  async signOut() {
    await _fwSb.auth.signOut();
    window.location.replace("index.html");
  },
};

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
let _awaitingRefresh = false;

function _settle(session) {
  _session = session;
  if (!_ready) {
    _ready = true;
    const w = _waiters.splice(0);
    w.forEach(fn => fn(session));
  }
}

function _isExpired(session) {
  if (!session?.expires_at) return false;
  return session.expires_at < Math.floor(Date.now() / 1000) + 10;
}

_fwSb.auth.onAuthStateChange((_event, session) => {
  _session = session;
  if (_event === 'INITIAL_SESSION' && _isExpired(session)) {
    // Access token is expired; Supabase will auto-refresh — wait for TOKEN_REFRESHED.
    // The 4 s fallback below handles the case where the refresh network call fails.
    _awaitingRefresh = true;
    return;
  }
  _awaitingRefresh = false;
  _settle(session);
});

// Safety fallback: unblock waiters if refresh never arrives.
setTimeout(() => _settle(_session), 4000);

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

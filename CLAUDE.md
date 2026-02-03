# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Five Wonders is an invite-only web application for sharing curated place recommendations with friends via an interactive map. Users save places (restaurants, cafes, landmarks, etc.) and view them on a shared map with clustering.

## Tech Stack

- **Frontend:** Vanilla JavaScript (ES6+), HTML5, CSS3 - no build step required
- **Backend:** Supabase (PostgreSQL + Edge Functions)
- **Mapping:** Leaflet.js 1.9.4 with MarkerCluster plugin
- **APIs:** OpenStreetMap Nominatim (address lookup), Apple Maps API (SMS ingestion)
- **Deployment:** GitHub Pages (frontend), Supabase (backend)

## Development

**Local Development:**
- Open HTML files directly in browser, or use any static file server
- No npm/yarn dependencies in the frontend

**Supabase Edge Functions:**
- Runtime: Deno (TypeScript)
- Location: `supabase/functions/*/index.ts`
- Deploy via Supabase CLI: `supabase functions deploy <function-name>`

**Database Migrations:**
- Located in `supabase/migrations/`
- Apply via Supabase CLI or dashboard

## Architecture

### Frontend Pages

| File | Purpose |
|------|---------|
| `index.html` | Landing page with invite code gate |
| `add-place.html` | Add new places with map search |
| `edit-places.html` | Edit/delete saved places (complex form handling) |
| `view.html` | View all places on interactive map |

### Supabase Edge Functions

| Function | Purpose |
|----------|---------|
| `manage-places` | CRUD operations: list, update, delete, photo upload/delete/reorder |
| `ingest-shortcut` | Accept places from iOS Shortcuts via OpenStreetMap lookup |
| `ingest-sms` | SMS-based place ingestion via Apple Maps API |

### Database Schema

**Core Tables:**
- `profiles` - Users with invite codes (`api_key` field) and metadata
- `places` - Place records with coordinates, address components, category, links (JSONB, max 3)
- `place_photos` - Photo metadata with storage paths and display order
- `places_with_profiles` - View joining places with user info and photos

**Key Fields in `places`:**
- Coordinates stored as `latitude`/`longitude` (numeric) and `location` (PostGIS geography)
- Full address components: `street_number`, `street_name`, `city`, `state`, `postal_code`, `country`
- `links` is JSONB array for external URLs

### Authentication

Token-based using invite codes:
- Invite code stored as `api_key` (UUID) in `profiles` table
- Frontend stores token in localStorage
- Edge functions validate token on every request
- Row Level Security (RLS) restricts data access by `user_id`

### Storage

- Bucket: `place-photos`
- Max file size: 10MB
- Allowed types: image/jpeg, image/png, image/gif, image/webp
- Public read access, authenticated upload

## Code Patterns

**Frontend:**
- CSS classes use `fw-` prefix (e.g., `fw-card`, `fw-header`)
- DOM IDs follow camelCase or hyphenated conventions
- Single-page behavior using CSS `display` toggling
- localStorage for client-side token persistence

**Edge Functions:**
- CORS preflight handling (OPTIONS method) required
- First operation: validate user token
- Permission checks: verify `user_id` matches for updates/deletes
- Response format: JSON with appropriate HTTP status codes

## Important Notes

- Supabase anon key is intentionally public (RLS handles security)
- Edge functions require `SERVICE_ROLE_KEY` from environment
- All user data is scoped by `user_id` - maintain this in any new queries

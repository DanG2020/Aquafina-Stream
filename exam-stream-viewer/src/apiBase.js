// exam-stream-viewer/src/apiBase.js
// Priority: Vercel env -> window override -> same-origin (Render bundle)
const envBase = process.env.REACT_APP_API_BASE;        // set on Vercel
const winBase = typeof window !== 'undefined' ? window.__API_BASE__ : undefined;

// same-origin when UI is served by the backend (Render)
const sameOrigin = `${window?.location?.origin ?? ''}`;

// If same-origin is empty (e.g., unit tests), fall back to localhost
const fallback = 'http://localhost:3000';

export function apiBase() {
  return envBase || winBase || sameOrigin || fallback;
}

export function wsBase() {
  // turn http(s) -> ws(s)
  return apiBase().replace(/^http/i, 'ws');
}

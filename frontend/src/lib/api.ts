// src/lib/api.ts
const BASE_URL = import.meta.env.VITE_API_URL || "";

let csrfToken: string | null = null;

// Auth token stored in localStorage so mobile browsers don't lose it across
// cross-origin requests (iOS Safari blocks cross-site session cookies via ITP).
const TOKEN_KEY = "anms_auth_token";

export function setAuthToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

function getAuthToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export async function ensureCsrf() {
  const res = await fetch(`${BASE_URL}/api/csrf/`, { credentials: "include" });
  const data = await res.json();
  if (data.csrfToken) csrfToken = data.csrfToken;
}

export async function apiFetch(path: string, options: RequestInit = {}) {
  const method = (options.method || "GET").toUpperCase();
  const headers = new Headers(options.headers || {});

  // Attach token if available — works cross-origin on all browsers including iOS Safari
  const token = getAuthToken();
  if (token) headers.set("Authorization", `Token ${token}`);

  if (method !== "GET") {
    if (!csrfToken) await ensureCsrf();
    if (csrfToken) headers.set("X-CSRFToken", csrfToken);
    if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers,
    credentials: "include",
  });

  const contentType = res.headers.get("content-type") || "";
  const text = await res.text();

  let data: any = null;
  if (text) {
    if (contentType.includes("application/json")) {
      data = JSON.parse(text);
    } else {
      data = { detail: text };
    }
  }

  if (!res.ok) {
    throw data || { detail: "Request failed" };
  }
  return data;
}

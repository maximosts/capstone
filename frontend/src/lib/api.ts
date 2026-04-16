// src/lib/api.ts
const BASE_URL = import.meta.env.VITE_API_URL || "";

let csrfToken: string | null = null;

export async function ensureCsrf() {
  const res = await fetch(`${BASE_URL}/api/csrf/`, { credentials: "include" });
  const data = await res.json();
  if (data.csrfToken) csrfToken = data.csrfToken;
}

export async function apiFetch(path: string, options: RequestInit = {}) {
  const method = (options.method || "GET").toUpperCase();
  const headers = new Headers(options.headers || {});

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
// src/lib/api.ts
const BASE_URL = import.meta.env.VITE_API_URL || "";

function getCookie(name: string) {
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) return parts.pop()!.split(";").shift();
  return undefined;
}

export async function ensureCsrf() {
  await fetch(`${BASE_URL}/api/csrf/`, { credentials: "include" });
}

export async function apiFetch(path: string, options: RequestInit = {}) {
  const method = (options.method || "GET").toUpperCase();
  const headers = new Headers(options.headers || {});

  if (method !== "GET") {
    const csrf = getCookie("csrftoken");
    if (csrf) headers.set("X-CSRFToken", csrf);
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
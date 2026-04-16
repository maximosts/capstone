// core/static/core/app.js
window.Nutri = (function () {
  function getToken() {
    return localStorage.getItem("nutri_token") || "";
  }

  function saveToken() {
    const el = document.getElementById("tokenInput");
    if (!el) return;
    localStorage.setItem("nutri_token", el.value.trim());
    toast("Saved", "Token stored successfully.");
  }
  function getCookie(name) {
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) return parts.pop().split(";").shift();
  return null;
    }

    async function postJSON(url, data) {
  const csrftoken = getCookie("csrftoken");

  const res = await fetch(url, {
    method: "POST",
    credentials: "same-origin", // ✅ sends session cookie
    headers: {
      "Content-Type": "application/json",
      "X-CSRFToken": csrftoken, // ✅ CSRF header
    },
    body: JSON.stringify(data),
    });

  const text = await res.text();
  try { return { ok: res.ok, data: JSON.parse(text) }; }
  catch { return { ok: res.ok, data: text }; }
}

  async function apiPost(url, payload) {
    const token = getToken();
    const headers = {
      "Content-Type": "application/json",
    };

    // DRF token auth expects: Authorization: Token <token>
    if (token) headers["Authorization"] = "Token " + token;

    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });

    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }

    if (!res.ok) {
      const msg = data?.detail || data?.error || "Request failed";
      throw new Error(msg);
    }
    return data;
  }

  function toast(title, msg) {
    let t = document.getElementById("toast");
    if (!t) {
      t = document.createElement("div");
      t.id = "toast";
      t.className = "toast";
      t.innerHTML = `<div class="toast__title"></div><div class="toast__msg"></div>`;
      document.body.appendChild(t);
    }
    t.querySelector(".toast__title").textContent = title;
    t.querySelector(".toast__msg").textContent = msg;
    t.classList.add("show");
    setTimeout(() => t.classList.remove("show"), 2500);
  }

  return { getToken, saveToken, apiPost, toast };
})();

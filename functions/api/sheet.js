// Cloudflare Pages Function: proxies Google Apps Script
// Handles both GET (fetch last record) and POST (submit new record)
// so the SCRIPT_URL is never exposed to the browser.

export async function onRequest(context) {
  const { request, env } = context;
  const scriptUrl = env.SCRIPT_URL;

  if (!scriptUrl) {
    return jsonResponse({ error: "SCRIPT_URL not configured" }, 500);
  }

  try {
    if (request.method === "GET") {
      // Forward query string (?month=...&vehicle=...&LR=1) to Apps Script
      const incomingUrl = new URL(request.url);
      const targetUrl =
        scriptUrl +
        (scriptUrl.includes("?") ? "&" : "?") +
        incomingUrl.searchParams.toString();

      const res = await fetch(targetUrl, { method: "GET" });
      const text = await res.text();
      return new Response(text, {
        status: res.status,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (request.method === "POST") {
      // Apps Script expects multipart/form-data, so just stream the body through
      const formData = await request.formData();
      const res = await fetch(scriptUrl, {
        method: "POST",
        body: formData,
      });
      const text = await res.text();
      return new Response(text, {
        status: res.status,
        headers: { "Content-Type": "application/json" },
      });
    }

    return jsonResponse({ error: "Method not allowed" }, 405);
  } catch (err) {
    return jsonResponse({ error: err.message || "Proxy error" }, 500);
  }
}

function jsonResponse(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

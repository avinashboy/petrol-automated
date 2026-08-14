// Cloudflare Pages Function: proxies Google Apps Script
// Handles both GET (fetch last record) and POST (submit new record)
// so the SCRIPT_URL is never exposed to the browser.
//
// Apps Script web apps always 302 to script.googleusercontent.com, and that
// URL must be fetched with GET. Browsers convert 302+POST into GET; Workers
// keep POST, Google returns HTTP 400 HTML, and the UI errors — even though
// doPost already saved the row. Follow the redirect with GET to get the JSON.

export async function onRequest(context) {
  const { request, env } = context;
  const scriptUrl = env.SCRIPT_URL;

  if (!scriptUrl) {
    return jsonResponse({ error: "SCRIPT_URL not configured" }, 500);
  }

  try {
    if (request.method === "GET") {
      const incomingUrl = new URL(request.url);
      const qs = incomingUrl.searchParams.toString();
      const targetUrl =
        qs.length === 0
          ? scriptUrl
          : scriptUrl + (scriptUrl.includes("?") ? "&" : "?") + qs;

      const { status, text } = await fetchAppsScript(targetUrl, { method: "GET" });
      return appsScriptResponse(status, text);
    }

    if (request.method === "POST") {
      const formData = await request.formData();
      const { status, text } = await fetchAppsScript(scriptUrl, {
        method: "POST",
        body: formData,
      });
      return appsScriptResponse(status, text);
    }

    return jsonResponse({ error: "Method not allowed" }, 405);
  } catch (err) {
    return jsonResponse({ error: err.message || "Proxy error" }, 500);
  }
}

async function fetchAppsScript(url, init) {
  const res = await fetch(url, { ...init, redirect: "manual" });

  if (res.status >= 300 && res.status < 400) {
    const location = res.headers.get("Location");
    if (res.body) {
      try {
        await res.body.cancel();
      } catch (_) {
        // ignore
      }
    }
    if (!location) {
      return {
        status: 502,
        text: JSON.stringify({
          error: "Google Apps Script redirected without a Location header",
        }),
      };
    }
    let redirectUrl;
    try {
      redirectUrl = new URL(location, url);
    } catch (_) {
      return {
        status: 502,
        text: JSON.stringify({ error: "Google Apps Script returned an invalid redirect URL" }),
      };
    }
    if (!isAllowedAppsScriptRedirect(redirectUrl)) {
      return {
        status: 502,
        text: JSON.stringify({
          error: "Blocked unexpected redirect from Google Apps Script",
          host: redirectUrl.hostname,
        }),
      };
    }
    const followed = await fetch(redirectUrl.href, {
      method: "GET",
      redirect: "follow",
    });
    return { status: followed.status, text: await followed.text() };
  }

  return { status: res.status, text: await res.text() };
}

function isAllowedAppsScriptRedirect(target) {
  if (target.protocol !== "https:") return false;
  const host = target.hostname.toLowerCase();
  return (
    host === "script.google.com" ||
    host === "script.googleusercontent.com" ||
    host.endsWith(".googleusercontent.com")
  );
}

function appsScriptResponse(status, text) {
  const trimmed = (text || "").trim();
  const looksLikeJson = trimmed.startsWith("{") || trimmed.startsWith("[");
  if (!looksLikeJson) {
    return jsonResponse(
      {
        error: "Google Apps Script returned a non-JSON response",
        status,
        detail: trimmed.slice(0, 300),
      },
      status >= 400 ? status : 502
    );
  }
  return new Response(text, {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function jsonResponse(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

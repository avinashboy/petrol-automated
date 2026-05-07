// Cloudflare Pages Function: proxies OpenRouter API
// The browser POSTs to /api/ocr, this function adds the secret key
// and forwards the request to OpenRouter.

export async function onRequestPost(context) {
  try {
    // Read the body sent from the browser
    const body = await context.request.json();

    // Get the domain the browser is on (e.g., "https://petrol-record.pages.dev")
    const origin = context.request.headers.get("origin") 
                || context.request.headers.get("referer") 
                || "https://your-app.pages.dev";

    // Forward the request to OpenRouter with the secret key
    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          // Secret key comes from Cloudflare environment, never sent to browser
          Authorization: `Bearer ${context.env.OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
          "HTTP-Referer": origin,
          "X-Title": "Petrol Record - AI OCR",
        },
        body: JSON.stringify(body),
      }
    );

    // Pass the response back to the browser as-is
    const data = await response.text();
    return new Response(data, {
      status: response.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: { message: err.message || "Proxy error" } }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

// Site settings.
// - Run locally (`npm start`, see README): the local server fetches all data itself, so nothing
//   else is needed.
// - Hosted (GitHub Pages): data goes through a Cloudflare relay (relay/worker.js) and,
//   optionally, a Google Apps Script relay for Google News (relay/google-news.gs).
(() => {
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  window.MACRO_CONFIG = local
    ? { local: true, relay: `${location.origin}/relay`, news: "" }
    : {
        relay: "https://macro-relay.arhamsaraogi.workers.dev",
        // Google Apps Script web-app URL running relay/google-news.gs (reliable Google News).
        news: "",
      };
})();

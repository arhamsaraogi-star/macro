/**
 * macro — Google News relay (Google Apps Script).
 *
 * Google News blocks Cloudflare's servers, but Apps Script runs on Google's own, so it can
 * search Google News reliably, including date-ranged searches years back.
 *
 * Setup (about 2 minutes, free):
 *   1. Open https://script.google.com → New project. Delete the sample code, paste this file.
 *   2. Deploy → New deployment → type "Web app".
 *      Execute as: Me.  Who has access: Anyone.  → Deploy (approve the permissions prompt).
 *   3. Copy the Web app URL (https://script.google.com/macros/s/…/exec) into the site's
 *      Settings → "Google News relay".
 *
 * Request:  ?q=<search terms>&from=YYYY-MM-DD&to=YYYY-MM-DD
 * Response: JSON { items: [{ title, url, source, date }] }
 */
function doGet(e) {
  var p = (e && e.parameter) || {};
  var q = String(p.q || "").slice(0, 300);
  if (!q) return json_({ relay: "macro-google-news", version: 1 });
  var from = /^\d{4}-\d{2}-\d{2}$/.test(p.from || "") ? p.from : "";
  var to = /^\d{4}-\d{2}-\d{2}$/.test(p.to || "") ? p.to : "";
  var query = q + (from ? " after:" + from : "") + (to ? " before:" + to : "");
  var key = "gn:" + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, query));
  var cache = CacheService.getScriptCache();
  var hit = cache.get(key);
  if (hit) return ContentService.createTextOutput(hit).setMimeType(ContentService.MimeType.JSON);

  var url = "https://news.google.com/rss/search?q=" + encodeURIComponent(query) + "&hl=en-IN&gl=IN&ceid=IN:en";
  var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
  if (res.getResponseCode() !== 200) return json_({ error: "Google News HTTP " + res.getResponseCode(), items: [] });

  var items = [];
  try {
    var channel = XmlService.parse(res.getContentText()).getRootElement().getChild("channel");
    var entries = channel ? channel.getChildren("item") : [];
    for (var i = 0; i < entries.length && i < 60; i++) {
      var it = entries[i];
      var source = it.getChildText("source") || "";
      var title = it.getChildText("title") || "";
      if (source && title.slice(-(source.length + 3)) === " - " + source) title = title.slice(0, -(source.length + 3));
      var d = new Date(it.getChildText("pubDate"));
      items.push({ title: title, url: it.getChildText("link"), source: source, date: isNaN(d) ? null : Utilities.formatDate(d, "UTC", "yyyy-MM-dd") });
    }
  } catch (err) {
    return json_({ error: "parse: " + err, items: [] });
  }
  var body = JSON.stringify({ items: items });
  try { cache.put(key, body, 21600); } catch (err) { /* value too large to cache */ }
  return ContentService.createTextOutput(body).setMimeType(ContentService.MimeType.JSON);
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

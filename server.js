#!/usr/bin/env node
/* =====================================================================
   A2 İngilizce — site + sohbet sunucusu
   Harici paket YOK; yalnızca Node'un kendi modülleri kullanılır.

   ÇALIŞTIRMA:   node server.js
   Port değiştir: set PORT=9000 && node server.js
   Giriş kodu:    set CHAT_CODE=gizli && node server.js

   Sohbet, tarayıcıdan sunucuya POST, sunucudan tarayıcıya SSE
   (Server-Sent Events) ile çalışır. WebSocket'e gerek yok; SSE
   kopan bağlantıyı kendiliğinden yeniden kurar.
   ===================================================================== */
"use strict";
const http = require("http");
const fs   = require("fs");
const path = require("path");
const os   = require("os");
const crypto = require("crypto");

const PORT        = Number(process.env.PORT || 8765);
const CODE        = String(process.env.CHAT_CODE || "").trim();   // boşsa kod sorulmaz
const ROOT        = __dirname;
const MAX_CLIENTS = 20;      // aynı anda en fazla kişi
const MAX_LEN     = 500;     // bir mesajın en fazla karakteri
const HISTORY     = 200;     // saklanan mesaj sayısı
const MIN_GAP     = 400;     // aynı kişinin iki mesajı arası en az ms
const NAME_MAX    = 20;
const LOGFILE     = path.join(ROOT, "chat-log.json");

const CHANNELS = [
  { id: "genel",  name: "Genel" },
  { id: "soru",   name: "Soru-Cevap" },
  { id: "pratik", name: "Pratik" }
];
const CH_IDS = CHANNELS.map(c => c.id);

const CTRL = /[\u0000-\u001F\u007F]/g;   /* görünmez kontrol karakterleri */
const COLORS = ["#4f46e5","#0d9488","#e11d48","#d97706","#7c3aed",
                "#0891b2","#16a34a","#db2777","#ea580c","#2563eb"];

/* ---------- durum ---------- */
const clients = new Map();        // id -> {id,name,color,res,last,ip}
let messages = [];
/* Yoklama (polling) için son olaylar. SSE bazı vekil sunuculardan geçmez
   (örneğin Cloudflare hızlı tünelleri akışı tamponlar), o yüzden istemci
   gerekirse bu listeyi sıra numarasıyla çekerek aynı işlevi görür. */
let events = [];
let seq = 0;
const EVENTS_MAX = 400;
const IDLE_MS = 25000;   /* bu süre yoklamayan kişi ayrılmış sayılır */
try {
  messages = JSON.parse(fs.readFileSync(LOGFILE, "utf8"));
  if (!Array.isArray(messages)) messages = [];
  messages = messages.slice(-HISTORY);
} catch (e) { messages = []; }

let saveTimer = null;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.writeFile(LOGFILE, JSON.stringify(messages.slice(-HISTORY)), () => {});
  }, 800);
}

function colorFor(name) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
}
function cleanName(raw) {
  let n = String(raw || "").replace(CTRL, "").replace(/\s+/g, " ").trim();
  return n.slice(0, NAME_MAX);
}
function uniqueName(n) {
  const taken = new Set([...clients.values()].map(c => c.name.toLowerCase()));
  if (!taken.has(n.toLowerCase())) return n;
  for (let i = 2; i < 100; i++) {
    const cand = (n + " " + i).slice(0, NAME_MAX + 3);
    if (!taken.has(cand.toLowerCase())) return cand;
  }
  return n + " " + Math.floor(Math.random() * 999);
}
function userList() {
  return [...clients.values()].map(c => ({ name: c.name, color: c.color }));
}
function sse(res, ev, data) {
  try { res.write("event: " + ev + "\ndata: " + JSON.stringify(data) + "\n\n"); }
  catch (e) { /* kopmuş bağlantı */ }
}
function broadcast(ev, data) {
  for (const c of clients.values()) sse(c.res, ev, data);
}
/* Katıldı/ayrıldı satırları anlık bilgidir: yayınlanır ama geçmişe yazılmaz.
   Yoksa sonradan giren herkes bir duvar dolusu giriş-çıkış satırı görür. */
function pushEvent(m) {
  m.seq = ++seq;
  events.push(m);
  if (events.length > EVENTS_MAX) events = events.slice(-EVENTS_MAX);
  broadcast("msg", m);
  return m;
}
function pushSys(text) {
  pushEvent({ id: crypto.randomUUID(), kind: "sys", ch: "*", text: text, ts: Date.now() });
}
function pushMessage(msg) {
  pushEvent(msg);
  messages.push(msg);
  if (messages.length > HISTORY) messages = messages.slice(-HISTORY);
  persist();
}

/* ---------- yardımcılar ---------- */
function readBody(req, limit = 8 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on("data", d => {
      size += d.length;
      if (size > limit) { reject(new Error("too large")); req.destroy(); return; }
      chunks.push(d);
    });
    req.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); }
      catch (e) { reject(e); }
    });
    req.on("error", reject);
  });
}
function json(res, code, obj) {
  const b = Buffer.from(JSON.stringify(obj), "utf8");
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8",
                        "Content-Length": b.length, "Cache-Control": "no-store" });
  res.end(b);
}

const MIME = { ".html":"text/html; charset=utf-8", ".js":"text/javascript; charset=utf-8",
  ".css":"text/css; charset=utf-8", ".json":"application/json; charset=utf-8",
  ".svg":"image/svg+xml", ".png":"image/png", ".jpg":"image/jpeg", ".jpeg":"image/jpeg",
  ".gif":"image/gif", ".ico":"image/x-icon", ".webp":"image/webp", ".mp3":"audio/mpeg",
  ".m4a":"audio/mp4", ".wav":"audio/wav", ".pdf":"application/pdf", ".txt":"text/plain; charset=utf-8" };

/* Sunucu internete açıldığında bu klasörün tamamı dışarıya açılmış olur.
   O yüzden sadece siteye ait dosyalar servis edilir: gizli dosyalar (.git),
   sunucunun kendi kaynağı ve sohbet kaydı dışarıda kalır. */
const DENY = new Set(["server.js", "chat-log.json", "package.json", "package-lock.json"]);
function allowed(rel) {
  const parts = rel.split(/[\/]+/).filter(Boolean);
  if (parts.some(x => x.startsWith("."))) return false;          /* .git, .claude, .env ... */
  const f = parts[parts.length - 1] || "";
  if (DENY.has(f.toLowerCase())) return false;
  return Object.prototype.hasOwnProperty.call(MIME, path.extname(f).toLowerCase());
}

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === "/" || rel === "") rel = "/index.html";
  const file = path.resolve(ROOT, path.normalize(rel).replace(/^([/\\])+/, ""));
  /* dizin dışına çıkmayı engelle. Sadece startsWith(ROOT) yetmez:
     ".../site" öneki ".../siteX" klasörünü de geçirirdi. */
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) { res.writeHead(403).end("Forbidden"); return; }
  if (!allowed(path.relative(ROOT, file))) {
    res.writeHead(404, {"Content-Type":"text/plain; charset=utf-8"}).end("Bulunamadı"); return;
  }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, {"Content-Type":"text/plain; charset=utf-8"}).end("Bulunamadı"); return; }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream",
                         "Content-Length": st.size, "Cache-Control": "no-cache" });
    fs.createReadStream(file).pipe(res);
  });
}

/* ---------- sunucu ---------- */
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  const p = u.pathname;

  if (p === "/api/chat/info") {
    return json(res, 200, { ok: true, channels: CHANNELS, needCode: !!CODE,
                            online: clients.size, max: MAX_CLIENTS, maxLen: MAX_LEN });
  }

  if (p === "/api/chat/join" && req.method === "POST") {
    let body;
    try { body = await readBody(req); } catch (e) { return json(res, 400, { error: "Geçersiz istek" }); }
    if (CODE && String(body.code || "").trim() !== CODE)
      return json(res, 403, { error: "Giriş kodu hatalı" });
    const name = cleanName(body.name);
    if (name.length < 2) return json(res, 400, { error: "İsim en az 2 karakter olmalı" });
    if (clients.size >= MAX_CLIENTS) return json(res, 503, { error: "Sohbet dolu (" + MAX_CLIENTS + " kişi)" });
    const id = crypto.randomUUID();
    const final = uniqueName(name);
    /* akış bağlanana kadar geçici kayıt */
    clients.set(id, { id, name: final, color: colorFor(final), res: null, last: 0, seen: Date.now(), pending: true });
    setTimeout(() => { const c = clients.get(id); if (c && c.pending) clients.delete(id); }, 20000);
    return json(res, 200, { id, name: final, color: colorFor(final), channels: CHANNELS, maxLen: MAX_LEN, seq });
  }

  if (p === "/api/chat/stream") {
    const id = u.searchParams.get("id") || "";
    const c = clients.get(id);
    if (!c) { res.writeHead(401, {"Content-Type":"text/plain; charset=utf-8"}).end("Önce katılmalısın"); return; }
    res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8",
                         "Cache-Control": "no-cache, no-transform", "Connection": "keep-alive",
                         "X-Accel-Buffering": "no" });
    res.write("retry: 2000\n\n");
    c.res = res; c.pending = false; c.seen = Date.now();
    sse(res, "hello", { you: { name: c.name, color: c.color },
                        history: messages, users: userList(), channels: CHANNELS });
    broadcast("users", userList());
    pushSys(c.name + " katıldı");

    const ping = setInterval(() => { try { res.write(": ping\n\n"); } catch (e) {} }, 25000);
    const bye = () => {
      clearInterval(ping);
      if (clients.get(id) === c) {
        clients.delete(id);
        broadcast("users", userList());
        pushSys(c.name + " ayrıldı");
      }
    };
    req.on("close", bye); req.on("error", bye);
    return;
  }

  /* SSE geçmeyen ağlar için aynı bilgiyi veren yoklama ucu.
     since verilmezse geçmişin tamamı, verilirse yalnızca yeni olaylar döner. */
  if (p === "/api/chat/poll") {
    const c = clients.get(u.searchParams.get("id") || "");
    if (!c) return json(res, 401, { error: "Oturum yok, sayfayı yenile" });
    c.seen = Date.now();
    if (c.pending) {                      /* yoklama da akış yerine geçer */
      c.pending = false;
      broadcast("users", userList());
      pushSys(c.name + " katıldı");
    }
    const sinceRaw = u.searchParams.get("since");
    if (sinceRaw === null || sinceRaw === "") {
      return json(res, 200, { full: true, you: { name: c.name, color: c.color },
                              history: messages, users: userList(), channels: CHANNELS, seq });
    }
    const since = Number(sinceRaw) || 0;
    return json(res, 200, { full: false, events: events.filter(e => e.seq > since),
                            users: userList(), seq });
  }

  if (p === "/api/chat/send" && req.method === "POST") {
    let body;
    try { body = await readBody(req); } catch (e) { return json(res, 400, { error: "Geçersiz istek" }); }
    const c = clients.get(String(body.id || ""));
    if (!c) return json(res, 401, { error: "Oturum yok, sayfayı yenile" });
    const now = Date.now();
    if (now - c.last < MIN_GAP) return json(res, 429, { error: "Çok hızlı yazıyorsun" });
    let text = String(body.text || "").replace(CTRL, "").trim();
    if (!text) return json(res, 400, { error: "Boş mesaj" });
    if (text.length > MAX_LEN) text = text.slice(0, MAX_LEN);
    const ch = CH_IDS.includes(body.ch) ? body.ch : CH_IDS[0];
    c.last = now; c.seen = now;
    pushMessage({ id: crypto.randomUUID(), kind: "msg", ch, name: c.name, color: c.color, text, ts: now });
    return json(res, 200, { ok: true });
  }

  if (p.startsWith("/api/")) return json(res, 404, { error: "Bilinmeyen uç" });
  return serveStatic(req, res, p);
});

/* Yoklamayla bağlanan biri sekmeyi kapatınca sunucuya haber gitmez;
   belirli süre yoklamayanları listeden düşür. */
setInterval(() => {
  const now = Date.now();
  let degisti = false;
  for (const [id, c] of clients) {
    if (c.res || c.pending) continue;          /* akışı açık olan ya da yeni katılan */
    if (now - c.seen > IDLE_MS) {
      clients.delete(id); degisti = true;
      pushSys(c.name + " ayrıldı");
    }
  }
  if (degisti) broadcast("users", userList());
}, 5000);

server.listen(PORT, () => {
  const nets = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(nets))
    for (const n of nets[name]) if (n.family === "IPv4" && !n.internal) ips.push(n.address);
  console.log("\n  A2 İngilizce — sunucu çalışıyor\n");
  console.log("  Bu bilgisayarda : http://localhost:" + PORT);
  ips.forEach(ip => console.log("  Aynı ağdakiler  : http://" + ip + ":" + PORT));
  console.log("\n  Sohbet: en fazla " + MAX_CLIENTS + " kişi" + (CODE ? "  ·  giriş kodu AÇIK" : "  ·  giriş kodu yok"));
  console.log("  Kapatmak için Ctrl+C\n");
});

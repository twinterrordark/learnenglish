#!/usr/bin/env node
/* =====================================================================
   A2 İngilizce — tek tıkla yayına alma

   Ne yapar:
     1. server.js'i başlatır (site + sohbet)
     2. cloudflared ile bir tünel açar ve internete açık bir
        https adresi alır
     3. Adresi ekrana yazar ve link.txt dosyasına kaydeder

   Arkadaşların hiçbir şey kurmaz, sadece o linke girer.
   Sen pencereyi kapatınca link ölür, kimse giremez.

   ÇALIŞTIRMA:  baslat.cmd  (ya da: node baslat.js)
   ===================================================================== */
"use strict";
const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const readline = require("readline");

const PORT = Number(process.env.PORT || 8765);
const ROOT = __dirname;
const LINKFILE = path.join(ROOT, "link.txt");

/* ---------- cloudflared'i bul ---------- */
function findCloudflared() {
  const local = path.join(ROOT, process.platform === "win32" ? "cloudflared.exe" : "cloudflared");
  if (fs.existsSync(local)) return local;
  const probe = spawnSync(process.platform === "win32" ? "where" : "which", ["cloudflared"], { encoding: "utf8" });
  if (probe.status === 0) {
    const first = String(probe.stdout).split(/\r?\n/).find(Boolean);
    if (first && fs.existsSync(first.trim())) return first.trim();
  }
  return null;
}

function kurulumAnlat() {
  console.log("\n  ────────────────────────────────────────────────────────");
  console.log("  Tünel aracı (cloudflared) kurulu değil.");
  console.log("  Site şu an SADECE bu bilgisayarda ve aynı Wi-Fi'da açık.");
  console.log("");
  console.log("  Dışarıdan girilebilmesi için bir kereliğine kur:");
  console.log("");
  console.log("      winget install --id Cloudflare.cloudflared");
  console.log("");
  console.log("  Kurduktan sonra bu pencereyi kapatıp baslat.cmd'yi");
  console.log("  yeniden çalıştır. Bir daha kurmana gerek kalmayacak.");
  console.log("  ────────────────────────────────────────────────────────\n");
}

/* ---------- giriş kodu sor ---------- */
function kodSor() {
  return new Promise(resolve => {
    if (process.env.CHAT_CODE !== undefined) return resolve(process.env.CHAT_CODE);
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question("  Sohbet giriş kodu (boş bırakırsan herkes girebilir): ", a => {
      rl.close();
      resolve(String(a || "").trim());
    });
  });
}

/* ---------- ana akış ---------- */
(async function main() {
  console.log("\n  A2 İngilizce — yayına alınıyor\n");
  const code = await kodSor();

  const srv = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: Object.assign({}, process.env, { PORT: String(PORT), CHAT_CODE: code }),
    stdio: ["ignore", "inherit", "inherit"]
  });
  srv.on("exit", c => { console.log("\n  Sunucu durdu (kod " + c + ")."); process.exit(c || 0); });

  await new Promise(r => setTimeout(r, 1200));

  const cf = findCloudflared();
  if (!cf) { kurulumAnlat(); return; }

  let link = null, kapaniyor = false, denemeler = 0;

  function tuneliBaslat() {
    if (kapaniyor) return;
    denemeler++;
    const t = spawn(cf, ["tunnel", "--url", "http://localhost:" + PORT, "--no-autoupdate"],
                    { cwd: ROOT });

    /* cloudflared adresi stderr'e yazar */
    function tara(chunk) {
      const m = String(chunk).match(/https:\/\/[-a-z0-9]+\.trycloudflare\.com/i);
      if (m && m[0] !== link) {
        link = m[0];
        denemeler = 0;
        try { fs.writeFileSync(LINKFILE, link + "\n"); } catch (e) {}
        linkiYaz(link, code);
      }
    }
    t.stdout.on("data", tara);
    t.stderr.on("data", tara);

    t.on("exit", () => {
      if (kapaniyor) return;
      const bekle = Math.min(2000 * denemeler, 15000);
      console.log("  Tünel koptu, " + Math.round(bekle / 1000) + " sn sonra yeniden denenecek…");
      setTimeout(tuneliBaslat, bekle);
    });

    process.on("SIGINT", () => { kapaniyor = true; try { t.kill(); } catch (e) {} srv.kill(); process.exit(0); });
  }

  tuneliBaslat();
})();

function linkiYaz(link, code) {
  const cizgi = "  " + "═".repeat(58);
  console.log("\n" + cizgi);
  console.log("  SİTE YAYINDA — bu linki paylaş:");
  console.log("");
  console.log("      " + link);
  console.log("");
  if (code) console.log("  Giriş kodu: " + code + "   (arkadaşlarına ayrıca söyle)");
  console.log("  Link link.txt dosyasına da yazıldı.");
  console.log("  Bu pencereyi kapatınca link ölür, kimse giremez.");
  console.log(cizgi + "\n");
}

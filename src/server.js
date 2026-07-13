// Kick Moderasyon Botu - ana sunucu
import "dotenv/config";
import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import * as kick from "./kickApi.js";
import * as store from "./store.js";
import * as mod from "./moderation.js";
import * as cmd from "./commands.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_YOLU = path.join(__dirname, "..", "config.json");

let config = JSON.parse(fs.readFileSync(CONFIG_YOLU, "utf8"));
store.yukle();

const app = express();
const PORT = process.env.PORT || 3000;

// Kanal bilgisi (ilk girişte doldurulur)
let kanal = null; // { broadcaster_user_id, slug }
let yayinAcik = false;

// ---------------- Yardimci ----------------

async function kanalHazirla() {
  if (kanal) return kanal;
  const slug = config.kanal.slug;
  const bilgi = await kick.kanalBilgisi(slug);
  if (!bilgi) throw new Error(`Kanal bulunamadi: ${slug}`);
  kanal = { broadcaster_user_id: bilgi.broadcaster_user_id, slug: bilgi.slug };
  console.log(`[bot] Kanal hazir: ${kanal.slug} (id: ${kanal.broadcaster_user_id})`);
  return kanal;
}

// ---------------- OAuth ----------------

app.get("/", (req, res) => {
  const girisVar = kick.girisYapildiMi();
  res.send(`
    <html><head><meta charset="utf-8"><title>Kick Mod Bot</title>
    <style>body{font-family:system-ui;background:#0b0e11;color:#eee;padding:40px;line-height:1.6}
    a{color:#53fc18} .kutu{background:#161b22;padding:20px;border-radius:12px;max-width:600px}</style></head>
    <body><div class="kutu">
      <h1>🤖 Kick Moderasyon Botu</h1>
      <p>Durum: <b style="color:${girisVar ? "#53fc18" : "#ff5555"}">${girisVar ? "Giriş yapıldı" : "Giriş yapılmadı"}</b></p>
      <p>Kanal: <b>${config.kanal.slug}</b></p>
      ${girisVar ? "" : '<p><a href="/auth">👉 Kick ile giriş yap (bot hesabıyla)</a></p>'}
      <p><a href="/panel?key=${process.env.PANEL_KEY || ""}">📊 Moderasyon paneli</a></p>
    </div></body></html>
  `);
});

app.get("/auth", (req, res) => {
  res.redirect(kick.authUrlOlustur());
});

app.get("/auth/callback", async (req, res) => {
  try {
    const { code, state, error } = req.query;
    if (error) throw new Error(String(error));
    await kick.kodDegistir(String(code), String(state));

    const ben = await kick.benKimim();
    const k = await kanalHazirla();

    // Webhook olaylarina abone ol
    let aboneSonuc = "OK";
    try {
      await kick.olaylaraAbone(k.broadcaster_user_id);
    } catch (e) {
      aboneSonuc = e.message;
    }

    res.send(`
      <html><head><meta charset="utf-8"></head><body style="font-family:system-ui;background:#0b0e11;color:#eee;padding:40px">
      <h2>✅ Giriş başarılı!</h2>
      <p>Bot hesabı: <b>${ben?.name || "?"}</b></p>
      <p>Kanal: <b>${k.slug}</b> (id: ${k.broadcaster_user_id})</p>
      <p>Olay aboneliği: <b>${aboneSonuc}</b></p>
      <p>Artık bu sekmeyi kapatabilirsin. Bot çalışıyor.</p>
      </body></html>
    `);
    console.log("[bot] Giris tamamlandi, bot aktif.");
  } catch (e) {
    console.error("[auth]", e);
    res.status(500).send(`<pre>Hata: ${e.message}</pre>`);
  }
});

// ---------------- Webhook ----------------
// ONEMLI: imza dogrulamasi icin HAM govde gerekiyor -> express.raw
app.post("/webhook", express.raw({ type: "*/*" }), async (req, res) => {
  const h = req.headers;

  if (!kick.imzaDogrula(h, req.body)) {
    console.warn("[webhook] Gecersiz imza, istek reddedildi.");
    return res.status(403).send("invalid signature");
  }

  // Kick 3 kez tekrar dener; once 200 don, sonra isle.
  res.status(200).send("ok");

  let olay;
  try {
    olay = JSON.parse(req.body.toString("utf8"));
  } catch {
    return;
  }

  const tip = h["kick-event-type"];
  try {
    if (tip === "chat.message.sent") await sohbetMesaji(olay);
    else if (tip === "channel.followed") await yeniTakipci(olay);
    else if (tip === "channel.subscription.new" || tip === "channel.subscription.renewal") await yeniAbone(olay);
    else if (tip === "livestream.status.updated") {
      yayinAcik = Boolean(olay.is_live);
      console.log(`[bot] Yayin durumu: ${yayinAcik ? "AÇIK" : "KAPALI"}`);
    }
  } catch (e) {
    console.error(`[webhook:${tip}]`, e.message);
  }
});

// ---------------- Olay isleyiciler ----------------

async function sohbetMesaji(olay) {
  const sender = olay.sender;
  const broadcaster = olay.broadcaster;
  const icerik = olay.content || "";
  const messageId = olay.message_id;
  if (!sender?.username) return;

  const k = await kanalHazirla();
  const broadcasterUserId = broadcaster?.user_id || k.broadcaster_user_id;

  // Botun kendi mesajlarini isleme
  cmd.kullaniciKaydet(sender);

  // 1) Komutlar (moderasyon filtrelerinden once)
  const komutMuydu = await cmd.komutIsle({
    icerik,
    sender,
    broadcaster,
    broadcasterUserId,
    messageId,
    config,
  });
  if (komutMuydu) return;

  // 2) Puan
  cmd.puanEkle(sender.username, config);

  // 3) Moderasyon
  if (mod.yetkiliMi(sender, broadcaster, config)) return; // mod/yayinci/muaf -> dokunma

  const ihlal = mod.filtreleriCalistir(icerik, sender, config);
  if (ihlal) {
    await mod.cezalandir({ ihlal, sender, messageId, broadcasterUserId, config });
  }
}

async function yeniTakipci(olay) {
  if (!config.hosgeldin?.yeni_takipci_mesaji_acik) return;
  const k = await kanalHazirla();
  const isim = olay.follower?.username || "dostum";
  await kick.mesajGonder(
    k.broadcaster_user_id,
    config.hosgeldin.yeni_takipci_mesaji.replace("{kullanici}", "@" + isim),
    config.bot.mesaj_tipi
  );
}

async function yeniAbone(olay) {
  if (!config.hosgeldin?.yeni_abone_mesaji_acik) return;
  const k = await kanalHazirla();
  const isim = olay.subscriber?.username || "dostum";
  await kick.mesajGonder(
    k.broadcaster_user_id,
    config.hosgeldin.yeni_abone_mesaji.replace("{kullanici}", "@" + isim),
    config.bot.mesaj_tipi
  );
}

// ---------------- Zamanli mesajlar ----------------

let otoIndex = 0;
setInterval(async () => {
  try {
    const o = config.otomatik_mesajlar;
    if (!o?.aktif || !kick.girisYapildiMi()) return;
    if (o.sadece_yayin_acikken && !yayinAcik) return;
    if (!o.mesajlar?.length) return;

    const k = await kanalHazirla();
    const mesaj = o.mesajlar[otoIndex % o.mesajlar.length];
    otoIndex++;
    await kick.mesajGonder(k.broadcaster_user_id, mesaj, config.bot.mesaj_tipi);
    console.log("[oto] Mesaj gonderildi.");
  } catch (e) {
    console.error("[oto]", e.message);
  }
}, Math.max(1, config.otomatik_mesajlar?.dakika || 20) * 60 * 1000);

// ---------------- Panel ----------------

app.get("/panel", (req, res) => {
  if (process.env.PANEL_KEY && req.query.key !== process.env.PANEL_KEY) {
    return res.status(403).send("Yetkisiz. URL'ye ?key=... ekle.");
  }
  const db = store.get();
  const satirlar = db.ban_gecmisi
    .slice(0, 50)
    .map(
      (l) =>
        `<tr><td>${new Date(l.zaman).toLocaleString("tr-TR")}</td><td>${l.kullanici}</td><td>${l.sebep}</td><td>${l.islem}${
          l.sure ? " (" + l.sure + " dk)" : ""
        }</td><td>${l.yetkili || "bot"}</td></tr>`
    )
    .join("");
  const top = Object.entries(db.puanlar)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([k, v]) => `<li>${k} — ${v}</li>`)
    .join("");

  res.send(`
  <html><head><meta charset="utf-8"><title>Panel</title>
  <style>
    body{font-family:system-ui;background:#0b0e11;color:#e6e6e6;padding:30px}
    h1{color:#53fc18} table{width:100%;border-collapse:collapse;margin-top:12px}
    td,th{padding:8px;border-bottom:1px solid #222;text-align:left;font-size:14px}
    .kart{background:#161b22;padding:20px;border-radius:12px;margin-bottom:20px}
  </style></head><body>
    <h1>🤖 Moderasyon Paneli</h1>
    <div class="kart">
      <b>Kanal:</b> ${config.kanal.slug} &nbsp;|&nbsp;
      <b>Giriş:</b> ${kick.girisYapildiMi() ? "✅" : "❌"} &nbsp;|&nbsp;
      <b>Yayın:</b> ${yayinAcik ? "🔴 Açık" : "⚫ Kapalı"} &nbsp;|&nbsp;
      <b>Çekiliş:</b> ${cmd.cekilisDurum().aktif ? `açık (${cmd.cekilisKatilimciSayisi()} kişi)` : "kapalı"}
    </div>
    <div class="kart">
      <h3>Son moderasyon işlemleri</h3>
      <table><tr><th>Zaman</th><th>Kullanıcı</th><th>Sebep</th><th>İşlem</th><th>Yetkili</th></tr>${satirlar || "<tr><td colspan=5>Henüz kayıt yok</td></tr>"}</table>
    </div>
    <div class="kart"><h3>Puan sıralaması</h3><ol>${top || "<li>Yok</li>"}</ol></div>
  </body></html>`);
});

// ---------------- Baslat ----------------

app.listen(PORT, () => {
  console.log(`\n[bot] Sunucu calisiyor: http://localhost:${PORT}`);
  console.log(`[bot] Giris icin: http://localhost:${PORT}/auth`);
  if (!process.env.KICK_CLIENT_ID) console.warn("[bot] UYARI: .env dosyasinda KICK_CLIENT_ID yok!");
});

// Kick Moderasyon Botu - ana sunucu
import "dotenv/config";
import express from "express";

import * as kick from "./kickApi.js";
import * as store from "./store.js";
import * as ayar from "./config.js";
import * as mod from "./moderation.js";
import * as cmd from "./commands.js";
import * as games from "./games.js";
import * as chatlog from "./chatlog.js";
import * as stats from "./stats.js";
import * as queue from "./queue.js";
import * as reactions from "./reactions.js";
import * as links from "./links.js";
import { panelRouter } from "./panel.js";

store.yukle();
ayar.yukle();

const app = express();
const PORT = process.env.PORT || 3000;

let kanal = null; // { broadcaster_user_id, slug }
let yayinAcik = false;

async function kanalHazirla() {
  if (kanal) return kanal;
  const slug = ayar.get().kanal.slug;
  const bilgi = await kick.kanalBilgisi(slug);
  if (!bilgi) throw new Error(`Kanal bulunamadi: ${slug}`);
  kanal = { broadcaster_user_id: bilgi.broadcaster_user_id, slug: bilgi.slug };
  console.log(`[bot] Kanal hazir: ${kanal.slug} (id: ${kanal.broadcaster_user_id})`);
  return kanal;
}

// ---------------- Webhook (HAM govde gerekiyor -> en once tanimlanmali) ----------------

app.post("/webhook", express.raw({ type: "*/*" }), async (req, res) => {
  if (!kick.imzaDogrula(req.headers, req.body)) {
    console.warn("[webhook] Gecersiz imza, reddedildi.");
    return res.status(403).send("invalid signature");
  }
  res.status(200).send("ok"); // Kick tekrar denemesin diye once cevap ver

  let olay;
  try {
    olay = JSON.parse(req.body.toString("utf8"));
  } catch {
    return;
  }

  const tip = req.headers["kick-event-type"];
  try {
    if (tip === "chat.message.sent") await sohbetMesaji(olay);
    else if (tip === "channel.followed") await yeniTakipci(olay);
    else if (tip === "channel.subscription.new" || tip === "channel.subscription.renewal") await yeniAbone(olay);
    else if (tip === "livestream.status.updated") {
      yayinAcik = Boolean(olay.is_live);
      console.log(`[bot] Yayin durumu: ${yayinAcik ? "ACIK" : "KAPALI"}`);
    }
  } catch (e) {
    console.error(`[webhook:${tip}]`, e.message);
  }
});

// ---------------- Panel ----------------

// Sohbete yazma - HEPSI kuyruktan gecer (Kick mesaj limitine takilmamak icin)
// oncelik: 2 = moderasyon, 1 = oyun/etkinlik, 0 = komut cevabi
async function duyur(metin, oncelik = 1) {
  const config = ayar.get();
  if (!config.bot.sohbete_yazsin) return;
  const k = await kanalHazirla();
  return queue.kuyrugaAl(
    (m) => kick.mesajGonder(k.broadcaster_user_id, m, config.bot.mesaj_tipi),
    metin,
    oncelik
  );
}

app.use(
  panelRouter({
    kanalHazirla,
    duyur,
    kuyrukDurumu: () => queue.durum(),
    // Mod panelden bir linki "goruldu" isaretleyince sohbete duyuru at
    linkDuyur: async (kayit) => {
      const config = ayar.get();
      const sablon = config.link_kuyrugu?.goruldu_mesaji || "👁️ Bu linki gördük, teşekkürler {kullanici}!";
      await duyur(sablon.replace("{kullanici}", "@" + kayit.kullanici), 1);
    },
    yayinDurumu: () => yayinAcik,
    // Panelden kanal adi degistirilirse onbellegi sifirla, yeniden cozulsun
    kanalSifirla: () => {
      kanal = null;
    },
  })
);

// ---------------- OAuth ----------------

app.get("/", (_req, res) => {
  const girisVar = kick.girisYapildiMi();
  res.send(`<html><head><meta charset="utf-8"><title>Kick Mod Bot</title>
  <style>body{font-family:system-ui;background:#0a0d0b;color:#e8ede4;padding:40px;line-height:1.7}
  a{color:#53fc18} .k{background:#11150f;border:1px solid #20261c;padding:24px;border-radius:4px;max-width:520px}</style>
  </head><body><div class="k">
  <h1>Kick Moderasyon Botu</h1>
  <p>Durum: <b style="color:${girisVar ? "#53fc18" : "#ff4d4d"}">${girisVar ? "Bagli" : "Baglanmadi"}</b><br>
  Kanal: <b>${ayar.get().kanal.slug}</b></p>
  ${girisVar ? "" : '<p><a href="/auth">Kick ile giris yap (bot hesabiyla)</a></p>'}
  <p><a href="/panel">Mod konsolunu ac</a></p>
  </div></body></html>`);
});

app.get("/auth", (_req, res) => res.redirect(kick.authUrlOlustur()));

app.get("/auth/callback", async (req, res) => {
  try {
    const { code, state, error } = req.query;
    if (error) throw new Error(String(error));
    await kick.kodDegistir(String(code), String(state));

    const ben = await kick.benKimim();
    const k = await kanalHazirla();

    let aboneSonuc = "OK";
    try {
      await kick.olaylaraAbone(k.broadcaster_user_id);
    } catch (e) {
      aboneSonuc = e.message;
    }

    res.send(`<html><head><meta charset="utf-8"></head>
    <body style="font-family:system-ui;background:#0a0d0b;color:#e8ede4;padding:40px;line-height:1.7">
    <h2 style="color:#53fc18">Giris basarili</h2>
    <p>Bot hesabi: <b>${ben?.name || "?"}</b><br>
    Kanal: <b>${k.slug}</b> (id: ${k.broadcaster_user_id})<br>
    Olay aboneligi: <b>${aboneSonuc}</b></p>
    <p><a style="color:#53fc18" href="/panel">Mod konsoluna git</a></p>
    </body></html>`);
    console.log("[bot] Giris tamamlandi, bot aktif.");
  } catch (e) {
    console.error("[auth]", e);
    res.status(500).send(`<pre>Hata: ${e.message}</pre>`);
  }
});

// ---------------- Olay isleyiciler ----------------

async function sohbetMesaji(olay) {
  const sender = olay.sender;
  const broadcaster = olay.broadcaster;
  const icerik = olay.content || "";
  const messageId = olay.message_id;
  if (!sender?.username) return;

  const config = ayar.get();
  const k = await kanalHazirla();
  const broadcasterUserId = broadcaster?.user_id || k.broadcaster_user_id;

  cmd.kullaniciKaydet(sender);

  // 0) Panelde canli izlenebilmesi icin tampona at + istatistik
  chatlog.ekle({ messageId, sender, icerik, rozetler: mod.rozetleri(sender) });
  stats.mesajKaydet(sender, icerik);

  // 1) Komutlar
  const komutMuydu = await cmd.komutIsle({ icerik, sender, broadcaster, broadcasterUserId, messageId, config });
  if (komutMuydu) return;

  // 2) Moderasyon (oyun cevabi olsa bile kufurse ceza alir)
  // Oyun/anket acikken flood esigi gevsetilir - yoksa hizli tahmin yapanlar ceza alir
  const oyunAktif = Boolean(games.oyunDurumu() || games.anketDurumu());

  if (!mod.yetkiliMi(sender, broadcaster, config)) {
    const ihlal = mod.filtreleriCalistir(icerik, sender, config, oyunAktif);
    if (ihlal) {
      chatlog.silindiIsaretle(messageId, ihlal.sebep);
      stats.ihlalKaydet(sender, ihlal.sebep);

      // Raid tespit edildiyse sohbete uyari dus
      if (ihlal.raid) {
        console.warn(`[raid] Saldiri tespit edildi: ${ihlal.raid.kisi} hesap ayni mesaji yazdi.`);
        await duyur(
          `🛡️ Saldırı tespit edildi (${ihlal.raid.kisi} hesap). SIKI MOD açıldı — link yasak, spam eşikleri sertleşti.`,
          2
        ).catch(() => {});
      }

      await mod.cezalandir({ ihlal, sender, messageId, broadcasterUserId, config, duyur });
      return; // ihlalli mesaj oyuna sayilmaz
    }
  }

  // 2.5) Link kuyrugu — sohbetteki tum linkleri topla (mod incelemesi icin)
  const lk = config.link_kuyrugu;
  if (lk?.aktif) {
    const sonuc = links.mesajiIsle(sender, messageId, icerik);
    if (sonuc) {
      // Ayni link tekrar atildiysa "zaten gorulduk" de
      if (sonuc.tekrar.length && lk.tekrar_uyarisi) {
        const mesaj = (lk.tekrar_mesaji || "Bu link zaten paylaşıldı {kullanici}.").replace("{kullanici}", "@" + sender.username);
        await duyur(mesaj, 0).catch(() => {});
      }
    }
  }

  // 3) Oyun cevabi mi?
  const kazanan = games.oyunKontrol(icerik, sender);
  if (kazanan) {
    cmd.puanVer(kazanan.kullanici, kazanan.odul);
    await duyur(kazanan.duyuru, 1).catch((e) => console.error("[oyun]", e.message));
    return;
  }

  // 4) Anket oyu mu?
  if (games.anketOy(icerik, sender)) return;

  // 5) Otomatik tepki (sa -> as gibi)
  const tepki = reactions.tepkiKontrol(icerik, config);
  if (tepki) {
    await duyur(tepki, 0).catch((e) => console.error("[tepki]", e.message));
    // tepki verilse de sohbet puani yine islensin, return yok
  }

  // 6) Sohbet puani
  cmd.puanEkle(sender.username, config);
}

async function yeniTakipci(olay) {
  const config = ayar.get();
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
  const config = ayar.get();
  if (!config.hosgeldin?.yeni_abone_mesaji_acik) return;
  const k = await kanalHazirla();
  const isim = olay.subscriber?.username || "dostum";
  await kick.mesajGonder(
    k.broadcaster_user_id,
    config.hosgeldin.yeni_abone_mesaji.replace("{kullanici}", "@" + isim),
    config.bot.mesaj_tipi
  );
}

// ---------------- Otomatik duyurular ----------------
// Her dakika kontrol eder; boylece panelden araligi degistirince
// botu yeniden baslatmaya gerek kalmaz.

let sonDuyuru = 0;
let duyuruIndex = 0;

setInterval(async () => {
  try {
    const config = ayar.get();
    const o = config.otomatik_mesajlar;
    if (!o?.aktif || !kick.girisYapildiMi() || !o.mesajlar?.length) return;
    if (o.sadece_yayin_acikken && !yayinAcik) return;

    const aralik = Math.max(1, o.dakika || 20) * 60000;
    if (Date.now() - sonDuyuru < aralik) return;
    sonDuyuru = Date.now();

    const k = await kanalHazirla();
    await kick.mesajGonder(k.broadcaster_user_id, o.mesajlar[duyuruIndex % o.mesajlar.length], config.bot.mesaj_tipi);
    duyuruIndex++;
    console.log("[oto] Duyuru gonderildi.");
  } catch (e) {
    console.error("[oto]", e.message);
  }
}, 60000);

// ---------------- Oyun / anket zaman kontrolu ----------------

setInterval(async () => {
  try {
    const bitti = games.oyunSureKontrol();
    if (bitti) await duyur(bitti);

    const anketBitti = games.anketSureKontrol();
    if (anketBitti) await duyur(anketBitti);
  } catch (e) {
    console.error("[oyun]", e.message);
  }
}, 5000);

// ---------------- Otomatik oyun ----------------

let sonOyun = Date.now();

setInterval(async () => {
  try {
    const config = ayar.get();
    const o = config.oyunlar?.otomatik;
    if (!o?.aktif || !config.oyunlar?.aktif || !kick.girisYapildiMi()) return;
    if (o.sadece_yayin_acikken && !yayinAcik) return;
    if (games.oyunDurumu()) return; // zaten oyun var

    const aralik = Math.max(2, o.dakika || 30) * 60000;
    if (Date.now() - sonOyun < aralik) return;
    sonOyun = Date.now();

    const r = games.oyunBaslat("rastgele", config);
    if (r.ok) {
      await duyur(r.duyuru);
      console.log("[oyun] Otomatik oyun basladi:", r.tip);
    }
  } catch (e) {
    console.error("[oyun]", e.message);
  }
}, 30000);

// ---------------- Baslat ----------------

app.listen(PORT, () => {
  console.log(`[bot] Sunucu calisiyor: port ${PORT}`);
  if (!process.env.KICK_CLIENT_ID) console.warn("[bot] UYARI: KICK_CLIENT_ID tanimli degil!");
  if (!process.env.PANEL_KEY) console.warn("[bot] UYARI: PANEL_KEY tanimli degil, panel acilmaz!");
});

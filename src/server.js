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
import * as kickws from "./kickws.js";
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

let sonWebhookZamani = null;

app.post("/webhook", express.raw({ type: "*/*" }), async (req, res) => {
  sonWebhookZamani = Date.now(); // imza gecersiz olsa bile "Kick bize ulasiyor" demektir
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
    sonWebhookZamani: () => sonWebhookZamani,
    wsDurum: () => kickws.durum(),
    wsSonMesaj: () => kickws.sonMesajZamaniGetir(),
    wsYenidenBaslat,
    chatroomIdKaydet: (id) => {
      const c = ayar.get();
      c.kanal.chatroom_id = Number(id);
      ayar.kaydet(c);
      wsYenidenBaslat();
    },
    // Panelden manuel tetiklenebilir bakim islemleri
    abonelikYenile: async () => {
      const k = await kanalHazirla();
      await kick.abonelikleriYenile(k.broadcaster_user_id);
      return true;
    },
    yayinKontrol: async () => {
      await yayinDurumuGuncelle();
      return yayinAcik;
    },
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
      const c = ayar.get();
      c.kanal.chatroom_id = null; // yeni kanal -> chatroom yeniden cozulecek
      ayar.kaydet(c);
      wsYenidenBaslat();
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

// Yayin durumunu DOGRUDAN Kick'e sorarak guncelle (webhook'a guvenme).
// Boylece "yayin acik ama bot kapali saniyor" sorunu olmaz.
async function yayinDurumuGuncelle() {
  if (!kick.girisYapildiMi()) return;
  try {
    const slug = ayar.get().kanal.slug;
    if (!slug || slug === "kanal-adi-buraya") return;
    const d = await kick.yayinDurumuGetir(slug);
    if (d.canli !== yayinAcik) {
      yayinAcik = d.canli;
      console.log(`[bot] Yayin durumu (Kick'ten): ${yayinAcik ? "ACIK" : "KAPALI"}${d.canli ? ` — ${d.izleyici} izleyici` : ""}`);
    }
  } catch (e) {
    console.error("[bot] Yayin durumu alinamadi:", e.message);
  }
}

// Webhook aboneligi sagligini kontrol et; dusmusse otomatik yeniden kur.
// Railway duraklamalarindan sonra abonelik dusebiliyor - bu onu tamir eder.
let abonelikHataSayisi = 0;

async function abonelikKontrol() {
  if (!kick.girisYapildiMi()) return;

  // Ust uste 3 kez basarisiz olduysa 30 dk ara ver (sil-kur dongusune girme)
  if (abonelikHataSayisi >= 3) return;

  try {
    const slug = ayar.get().kanal.slug;
    if (!slug || slug === "kanal-adi-buraya") return;
    const k = await kanalHazirla();

    const mevcut = await kick.abonelikleriListele();
    const abonelikler = mevcut?.data || [];
    // Hem event hem name alanina bak, hem de kanala ait olmasina dikkat et
    const chatVar = abonelikler.some(
      (a) =>
        (a.event === "chat.message.sent" || a.name === "chat.message.sent") &&
        (!a.broadcaster_user_id || a.broadcaster_user_id === k.broadcaster_user_id)
    );

    if (!chatVar) {
      console.warn("[bot] Bu kanal icin chat aboneligi yok! Yeniden kuruluyor...");
      await kick.abonelikleriYenile(k.broadcaster_user_id);
      console.log("[bot] Abonelik yeniden kuruldu.");
    }
    abonelikHataSayisi = 0; // basarili kontrol -> sayaci sifirla
  } catch (e) {
    abonelikHataSayisi++;
    console.error(`[bot] Abonelik kontrolu basarisiz (${abonelikHataSayisi}/3):`, e.message);
    if (abonelikHataSayisi >= 3) {
      console.error("[bot] Abonelik 3 kez kurulamadi. 30 dk sonra tekrar denenecek. Muhtemel sebepler: Kick Developer sayfasinda Webhook URL eksik/yanlis, ya da Kick tarafinda gecici sorun.");
      setTimeout(() => (abonelikHataSayisi = 0), 30 * 60000);
    }
  }
}

// ---------------- WebSocket sohbet dinleyici ----------------
// Resmi webhook, bot hesabinin baska kanali dinlemesine izin vermiyor.
// Bu yuzden sohbet WebSocket'ten okunur; moderasyon resmi API'den devam eder.

async function wsBaslat() {
  const c = ayar.get();
  const slug = c.kanal.slug;
  if (!slug || slug === "kanal-adi-buraya") return;

  // Chatroom ID: once ayarda kayitli mi bak, yoksa cozmeyi dene
  let chatroomId = c.kanal.chatroom_id || null;
  if (!chatroomId) {
    console.log("[ws] Chatroom ID cozuluyor:", slug);
    chatroomId = await kickws.chatroomIdCoz(slug);
    if (chatroomId) {
      c.kanal.chatroom_id = chatroomId;
      ayar.kaydet(c);
      console.log("[ws] Chatroom ID bulundu ve kaydedildi:", chatroomId);
    } else {
      console.warn("[ws] Chatroom ID cozulemedi (Cloudflare engellemis olabilir). Panelden elle girilebilir: tarayicida kick.com/api/v2/channels/" + slug + " ac, \"chatroom\":{\"id\": degerini bul.");
      return;
    }
  }

  kickws.baglan(chatroomId, sohbetMesaji);
}

// Kanal degistiginde ws'yi yeniden baslat
function wsYenidenBaslat() {
  kickws.kapat();
  setTimeout(wsBaslat, 1000);
}

setTimeout(wsBaslat, 3000);

// Acilistan 5 sn sonra ilk kontrol, sonra her 60 sn'de bir
setTimeout(() => {
  yayinDurumuGuncelle();
  abonelikKontrol();
}, 5000);
setInterval(yayinDurumuGuncelle, 60000);
setInterval(abonelikKontrol, 120000);

app.listen(PORT, () => {
  console.log(`[bot] Sunucu calisiyor: port ${PORT}`);
  if (!process.env.KICK_CLIENT_ID) console.warn("[bot] UYARI: KICK_CLIENT_ID tanimli degil!");
  if (!process.env.PANEL_KEY) console.warn("[bot] UYARI: PANEL_KEY tanimli degil, panel acilmaz!");
});

// Moderasyon motoru: filtreler + kademeli ceza sistemi
import * as kick from "./kickApi.js";
import * as store from "./store.js";

// Kullanici basina gecici hafiza (sunucu yeniden baslayinca sifirlanir)
const cezaPuanlari = new Map(); // username -> { puan, sonIhlal }
const mesajGecmisi = new Map(); // username -> [{ zaman, metin }]

// ---------- Yardimcilar ----------

export function rozetleri(sender) {
  const badges = sender?.identity?.badges || [];
  return badges.map((b) => b.type);
}

export function yetkiliMi(sender, broadcaster, config) {
  const kul = (sender.username || "").toLowerCase();
  const muaf = (config.bagisiklik.muaf_kullanicilar || []).map((u) => u.toLowerCase());
  if (muaf.includes(kul)) return true;

  const rozet = rozetleri(sender);
  if (config.bagisiklik.yayinci && (rozet.includes("broadcaster") || sender.user_id === broadcaster?.user_id)) return true;
  if (config.bagisiklik.moderatorler && rozet.includes("moderator")) return true;
  if (config.bagisiklik.vipler && rozet.includes("vip")) return true;
  if (config.bagisiklik.aboneler && rozet.includes("subscriber")) return true;
  return false;
}

export function moderatorMu(sender, broadcaster) {
  const rozet = rozetleri(sender);
  return rozet.includes("moderator") || rozet.includes("broadcaster") || sender.user_id === broadcaster?.user_id;
}

export function aboneMi(sender) {
  return rozetleri(sender).includes("subscriber");
}

// Emote etiketlerini ([emote:123:LOL]) mesajdan temizler
function emoteleriTemizle(metin) {
  return metin.replace(/\[emote:\d+:[^\]]*\]/g, " ");
}

function emoteSayisi(metin) {
  return (metin.match(/\[emote:\d+:[^\]]*\]/g) || []).length;
}

// "a.m.k", "4mk", "aaaammmk" gibi kacamaklari yakalamak icin metni sadelestirir
function sadelestir(metin) {
  const leet = { "4": "a", "@": "a", "3": "e", "1": "i", "!": "i", "0": "o", "5": "s", "$": "s", "7": "t" };
  let t = metin.toLocaleLowerCase("tr-TR");
  t = t.replace(/[4@310!5$7]/g, (c) => leet[c] || c);
  t = t
    .replace(/ı/g, "i").replace(/ğ/g, "g").replace(/ü/g, "u")
    .replace(/ş/g, "s").replace(/ö/g, "o").replace(/ç/g, "c");
  return t;
}

function normalMetin(metin) {
  // Bosluklu, sadece harf/rakam kalan hali (kelime siniri kontrolu icin)
  return sadelestir(metin).replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function sikistirilmisMetin(metin) {
  // Butun bosluk/noktalama silinir, tekrar eden harfler teke duser: "a a a m m k" -> "amk"
  return sadelestir(metin)
    .replace(/[^a-z0-9]/g, "")
    .replace(/(.)\1+/g, "$1");
}

function sikistir(kelime) {
  // "aaaammmkkk" -> "amk"  |  tekrar eden harfleri teke dusurur
  return kelime.replace(/(.)\1+/g, "$1");
}

// Noktalama silinmis ama bosluklar duran hali: "a.m.k ne" -> "amk ne"
function yapistirilmisMetin(metin) {
  return sadelestir(metin).replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
}

function kelimeVarMi(metin, kelime) {
  const ham = sadelestir(kelime).replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
  if (!ham) return false;

  // --- Cok kelimeli ifadeler ("bedava takipci") ---
  if (ham.includes(" ")) {
    const kacis = ham.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`(^|\\s)${kacis}(\\s|$)`).test(normalMetin(metin))) return true;
    const kSik = sikistir(ham.replace(/\s/g, ""));
    if (kSik.length >= 6 && sikistirilmisMetin(metin).includes(kSik)) return true;
    return false;
  }

  // --- Tek kelime ---
  const kSik = sikistir(ham.replace(/\s/g, ""));
  const tokenlar = new Set([
    ...normalMetin(metin).split(" "),
    ...yapistirilmisMetin(metin).split(" "),
  ]);

  for (const token of tokenlar) {
    if (!token) continue;
    const tSik = sikistir(token);
    // Tam eslesme: "amk", "aaammmkkk", "a.m.k" -> hepsi "amk"
    if (tSik === kSik) return true;
    // Uzun kelimeler icin parca eslesmesi: "orospucocugu" icinde "orospu"
    // (5 harften kisa kelimelerde YAPILMAZ, yoksa "normal" icinde "mal" yakalanir)
    if (kSik.length >= 5 && tSik.includes(kSik)) return true;
  }

  return false;
}

function linkleriBul(metin) {
  const re = /((https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,}(\/[^\s]*)?)/gi;
  return (metin.match(re) || []).filter((m) => /[a-z]{2,}\.[a-z]{2,}/i.test(m));
}

// ---------- Filtreler ----------
// Her filtre { sebep, agirlik } dondurur veya null

export function filtreleriCalistir(icerik, sender, config) {
  const f = config.filtreler;
  const temiz = emoteleriTemizle(icerik).trim();
  const kul = (sender.username || "").toLowerCase();
  const simdi = Date.now();

  // --- Kufur ---
  if (f.kufur?.aktif) {
    const liste = [...(f.kufur.kelimeler || []), ...store.get().yasakli_ek];
    for (const kelime of liste) {
      if (kelimeVarMi(temiz, kelime)) {
        return { sebep: "Küfür / hakaret", agirlik: f.kufur.ceza_agirligi ?? 2 };
      }
    }
  }

  // --- Yasakli kelimeler / reklam ---
  if (f.yasakli_kelimeler?.aktif) {
    for (const kelime of f.yasakli_kelimeler.kelimeler || []) {
      if (kelimeVarMi(temiz, kelime)) {
        return { sebep: "Yasaklı kelime", agirlik: f.yasakli_kelimeler.ceza_agirligi ?? 2 };
      }
    }
  }

  // --- Link ---
  if (f.link?.aktif) {
    if (!(f.link.aboneler_link_atabilir && aboneMi(sender))) {
      const linkler = linkleriBul(temiz);
      const izinli = (f.link.izinli_alan_adlari || []).map((d) => d.toLowerCase());
      const kotu = linkler.filter((l) => {
        const alan = l.replace(/^https?:\/\//i, "").split("/")[0].toLowerCase().replace(/^www\./, "");
        return !izinli.some((d) => alan === d || alan.endsWith("." + d));
      });
      if (kotu.length > 0) {
        return { sebep: "İzinsiz link", agirlik: f.link.ceza_agirligi ?? 1 };
      }
    }
  }

  // --- Buyuk harf ---
  if (f.buyuk_harf?.aktif && temiz.length >= (f.buyuk_harf.min_uzunluk ?? 12)) {
    const harfler = temiz.replace(/[^a-zA-ZçğıöşüÇĞİÖŞÜ]/g, "");
    if (harfler.length >= 8) {
      const buyuk = harfler.split("").filter((c) => c === c.toLocaleUpperCase("tr-TR")).length;
      if (buyuk / harfler.length > (f.buyuk_harf.max_oran ?? 0.7)) {
        return { sebep: "Aşırı büyük harf", agirlik: f.buyuk_harf.ceza_agirligi ?? 1 };
      }
    }
  }

  // --- Emote spam ---
  if (f.emote_spam?.aktif && emoteSayisi(icerik) > (f.emote_spam.max_emote ?? 8)) {
    return { sebep: "Emote spam", agirlik: f.emote_spam.ceza_agirligi ?? 1 };
  }

  // --- Karakter spam ---
  if (f.karakter_spam?.aktif) {
    const max = f.karakter_spam.max_tekrar ?? 8;
    if (new RegExp(`(.)\\1{${max},}`).test(temiz)) {
      return { sebep: "Karakter spam", agirlik: f.karakter_spam.ceza_agirligi ?? 1 };
    }
  }

  // --- Uzun mesaj ---
  if (f.uzun_mesaj?.aktif && temiz.length > (f.uzun_mesaj.max_karakter ?? 300)) {
    return { sebep: "Çok uzun mesaj", agirlik: f.uzun_mesaj.ceza_agirligi ?? 1 };
  }

  // --- Gecmis tabanli filtreler (flood + ayni mesaj) ---
  const gecmis = (mesajGecmisi.get(kul) || []).filter((m) => simdi - m.zaman < 120000);
  gecmis.push({ zaman: simdi, metin: normalMetin(temiz) });
  mesajGecmisi.set(kul, gecmis);

  if (f.flood?.aktif) {
    const pencere = (f.flood.saniye ?? 10) * 1000;
    const sayi = gecmis.filter((m) => simdi - m.zaman <= pencere).length;
    if (sayi > (f.flood.max_mesaj ?? 5)) {
      return { sebep: "Flood (çok hızlı mesaj)", agirlik: f.flood.ceza_agirligi ?? 1 };
    }
  }

  if (f.ayni_mesaj?.aktif) {
    const pencere = (f.ayni_mesaj.saniye ?? 60) * 1000;
    const bu = normalMetin(temiz);
    if (bu.length > 2) {
      const ayni = gecmis.filter((m) => simdi - m.zaman <= pencere && m.metin === bu).length;
      if (ayni > (f.ayni_mesaj.max_tekrar ?? 3)) {
        return { sebep: "Aynı mesaj tekrarı", agirlik: f.ayni_mesaj.ceza_agirligi ?? 1 };
      }
    }
  }

  return null;
}

// ---------- Ceza uygulama ----------

function cezaPuaniEkle(kul, agirlik, sifirlamaDk) {
  const simdi = Date.now();
  const kayit = cezaPuanlari.get(kul);
  if (kayit && simdi - kayit.sonIhlal > sifirlamaDk * 60000) {
    cezaPuanlari.delete(kul);
  }
  const yeni = cezaPuanlari.get(kul) || { puan: 0, sonIhlal: 0 };
  yeni.puan += agirlik;
  yeni.sonIhlal = simdi;
  cezaPuanlari.set(kul, yeni);
  return yeni.puan;
}

export function cezaPuaniSifirla(kul) {
  cezaPuanlari.delete(kul.toLowerCase());
}

export async function cezalandir({ ihlal, sender, messageId, broadcasterUserId, config }) {
  const kul = sender.username;
  const puan = cezaPuaniEkle(kul.toLowerCase(), ihlal.agirlik, config.cezalar.puan_sifirlama_dakika ?? 60);

  const adimlar = config.cezalar.adimlar || [];
  const adim = adimlar[Math.min(puan, adimlar.length) - 1] || adimlar[adimlar.length - 1];

  // 1) Mesaji her durumda sil
  try {
    if (messageId) await kick.mesajSil(messageId);
  } catch (e) {
    console.error("[mod] Mesaj silinemedi:", e.message);
  }

  let aciklama = "";
  try {
    if (adim.islem === "timeout") {
      await kick.banla(broadcasterUserId, sender.user_id, adim.sure, ihlal.sebep);
      aciklama = `${adim.sure} dakika susturuldu`;
    } else if (adim.islem === "ban") {
      await kick.banla(broadcasterUserId, sender.user_id, null, ihlal.sebep);
      aciklama = "kalıcı olarak banlandı";
    } else {
      aciklama = "uyarıldı";
    }
  } catch (e) {
    console.error("[mod] Ceza uygulanamadi:", e.message);
    aciklama = "ceza uygulanamadı (bot moderatör mü?)";
  }

  // 2) Sohbete uyari yaz
  if (config.bot.sohbete_yazsin && config.bot.uyari_mesajlari_acik) {
    try {
      await kick.mesajGonder(
        broadcasterUserId,
        `@${kul} → ${ihlal.sebep}. ${aciklama}. (Ceza puanı: ${puan})`,
        config.bot.mesaj_tipi
      );
    } catch (e) {
      console.error("[mod] Uyari mesaji gonderilemedi:", e.message);
    }
  }

  store.logEkle({
    kullanici: kul,
    sebep: ihlal.sebep,
    islem: adim.islem,
    sure: adim.sure,
    puan,
  });

  console.log(`[mod] ${kul} → ${ihlal.sebep} → ${adim.islem} (${aciklama})`);
}

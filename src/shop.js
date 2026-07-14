// Puan dukkani
// Izleyiciler topladiklari puani harcar. Bazi urunler mod onayi ister.
import * as store from "./store.js";

// Urun tipleri:
//  "istek"    -> mod onay kuyruguna duser (sarki istegi, VIP talebi...)
//  "bilet"    -> aktif cekiliste ekstra sans kazandirir
//  "duyuru"   -> kullanicinin yazdigi not sohbete duyuru olarak dusulur (mod onayli)

export function urunler(config) {
  return (config.dukkan?.urunler || []).filter((u) => u.aktif !== false);
}

export function urunBul(config, kod) {
  const k = String(kod || "").toLocaleLowerCase("tr-TR");
  return urunler(config).find((u) => u.kod.toLocaleLowerCase("tr-TR") === k) || null;
}

function talepler() {
  const db = store.get();
  if (!db.talepler) db.talepler = [];
  return db.talepler;
}

export function talepListesi(durum = null) {
  const t = talepler();
  return durum ? t.filter((x) => x.durum === durum) : t;
}

// Satin alma. Donen: { ok, mesaj } veya { ok:false, hata }
export function satinAl({ config, sender, kod, not, cekilis, puanDus, puanEkle }) {
  if (!config.dukkan?.aktif) return { ok: false, hata: "Dükkân kapalı." };

  const urun = urunBul(config, kod);
  if (!urun) {
    const liste = urunler(config).map((u) => `${u.kod} (${u.fiyat})`).join(", ");
    return { ok: false, hata: `Böyle bir ürün yok. Ürünler: ${liste || "yok"}` };
  }

  const kul = sender.username.toLowerCase();
  const mevcut = store.get().puanlar[kul] || 0;
  if (mevcut < urun.fiyat) {
    return { ok: false, hata: `@${sender.username} yetersiz puan. ${urun.ad} için ${urun.fiyat} puan gerekli, sende ${mevcut} var.` };
  }

  // Not zorunlu mu?
  if (urun.not_zorunlu && !not?.trim()) {
    return { ok: false, hata: `@${sender.username} bu ürün için bir not yazmalısın. Örnek: !al ${urun.kod} yazacağın şey` };
  }

  // --- Bilet: aktif cekilis sart ---
  if (urun.tip === "bilet") {
    if (!cekilis?.aktif) return { ok: false, hata: "Şu an aktif çekiliş yok." };
    if (!cekilis.katilimcilar[kul]) {
      return { ok: false, hata: `@${sender.username} önce çekilişe katıl ("${cekilis.anahtar}" yaz), sonra bilet al.` };
    }
    if (!cekilis.biletler) cekilis.biletler = {};
    const simdiki = cekilis.biletler[kul] || 1;
    const limit = urun.max_adet || 5;
    if (simdiki >= limit) {
      return { ok: false, hata: `@${sender.username} en fazla ${limit} bilet alabilirsin.` };
    }
    puanDus(kul, urun.fiyat);
    cekilis.biletler[kul] = simdiki + 1;
    store.kaydet();
    return {
      ok: true,
      mesaj: `🎟️ @${sender.username} ekstra çekiliş bileti aldı! Toplam ${simdiki + 1} bilet. (-${urun.fiyat} puan)`,
    };
  }

  // --- Istek / duyuru: mod onay kuyruguna dusuyor ---
  puanDus(kul, urun.fiyat);
  const talep = {
    id: Date.now() + "-" + Math.random().toString(36).slice(2, 7),
    kullanici: sender.username,
    urunKod: urun.kod,
    urunAd: urun.ad,
    fiyat: urun.fiyat,
    tip: urun.tip,
    not: (not || "").slice(0, 200),
    zaman: Date.now(),
    durum: "bekliyor",
  };
  talepler().unshift(talep);
  if (talepler().length > 200) talepler().length = 200;
  store.kaydet();

  return {
    ok: true,
    mesaj: `✅ @${sender.username} → ${urun.ad} (-${urun.fiyat} puan). Talebin moderatör onayına düştü.`,
    talep,
  };
}

// Mod talebi onaylar / reddeder. Reddedilirse puan iade edilir.
export function talepKarar(id, karar, puanEkle) {
  const t = talepler().find((x) => x.id === id);
  if (!t) return { ok: false, hata: "Talep bulunamadı." };
  if (t.durum !== "bekliyor") return { ok: false, hata: "Bu talep zaten sonuçlanmış." };

  t.durum = karar === "onay" ? "onaylandi" : "reddedildi";
  t.karar_zamani = Date.now();

  let iade = 0;
  if (karar !== "onay") {
    puanEkle(t.kullanici.toLowerCase(), t.fiyat);
    iade = t.fiyat;
  }
  store.kaydet();

  return { ok: true, talep: t, iade };
}

export function talepTemizle() {
  const db = store.get();
  db.talepler = talepler().filter((t) => t.durum === "bekliyor");
  store.kaydet();
}

// Sohbete yazilacak dukkan listesi
export function dukkanMetni(config, prefix = "!") {
  const u = urunler(config);
  if (!u.length) return "Dükkânda ürün yok.";
  return (
    "🛒 DÜKKÂN → " +
    u.map((x) => `${x.ad} = ${x.fiyat} puan (${prefix}al ${x.kod})`).join(" | ")
  ).slice(0, 490);
}

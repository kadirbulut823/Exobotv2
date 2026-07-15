// Link kuyrugu
// Sohbette gecen tum linkler buraya dusuyor. Mod panelden "gordum" isaretler,
// bot sohbete "gorduk @kullanici" yazar. Ayni link tekrar atilirsa kuyruga
// eklenmez, bunun yerine "zaten gorulduye" bilgisi doner.
import * as store from "./store.js";

const LINK_RE = /((https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,}(\/[^\s]*)?)/gi;

function kuyruk() {
  const db = store.get();
  if (!db.linkler) db.linkler = [];
  return db.linkler;
}

// Linkleri normallestirir (ayni link farkli yazilsa da eslesir)
function normalize(link) {
  return String(link)
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/+$/, "")
    .trim();
}

// Mesajdaki tum linkleri cikarir
export function linkleriBul(metin) {
  const bulunan = (String(metin).match(LINK_RE) || []).filter((m) => /[a-z]{2,}\.[a-z]{2,}/i.test(m));
  // Tekrarlari temizle
  return [...new Set(bulunan.map((l) => l.trim()))];
}

// Mesaji isle. Donen: { yeni:[...], tekrar:[...] }
//  yeni   -> ilk kez gorulen linkler (kuyruga eklendi)
//  tekrar -> daha once gorulmus linkler
export function mesajiIsle(sender, messageId, metin) {
  const linkler = linkleriBul(metin);
  if (!linkler.length) return null;

  const q = kuyruk();
  const yeni = [];
  const tekrar = [];

  for (const link of linkler) {
    const norm = normalize(link);
    const eski = q.find((x) => x.norm === norm);

    if (eski) {
      eski.tekrarSayisi = (eski.tekrarSayisi || 1) + 1;
      eski.sonAtan = sender.username;
      eski.sonZaman = Date.now();
      tekrar.push({ link, kayit: eski });
    } else {
      const kayit = {
        id: Date.now() + "-" + Math.random().toString(36).slice(2, 7),
        link,
        norm,
        kullanici: sender.username,
        messageId,
        zaman: Date.now(),
        durum: "bekliyor", // bekliyor | goruldu
        gorulduZaman: null,
        gorulduYetkili: null,
        tekrarSayisi: 1,
        sonAtan: sender.username,
        sonZaman: Date.now(),
      };
      q.unshift(kayit);
      yeni.push({ link, kayit });
    }
  }

  if (q.length > 300) q.length = 300;
  store.kaydet();
  return { yeni, tekrar };
}

export function liste(durum = null) {
  const q = kuyruk();
  return durum ? q.filter((x) => x.durum === durum) : q;
}

// Mod bir linki "goruldu" isaretler
export function gorulduIsaretle(id, yetkili) {
  const kayit = kuyruk().find((x) => x.id === id);
  if (!kayit) return null;
  kayit.durum = "goruldu";
  kayit.gorulduZaman = Date.now();
  kayit.gorulduYetkili = yetkili || "panel";
  store.kaydet();
  return kayit;
}

// Bekliyor'a geri al
export function geriAl(id) {
  const kayit = kuyruk().find((x) => x.id === id);
  if (!kayit) return null;
  kayit.durum = "bekliyor";
  kayit.gorulduZaman = null;
  kayit.gorulduYetkili = null;
  store.kaydet();
  return kayit;
}

export function sil(id) {
  const db = store.get();
  db.linkler = kuyruk().filter((x) => x.id !== id);
  store.kaydet();
}

export function gorulenleriTemizle() {
  const db = store.get();
  db.linkler = kuyruk().filter((x) => x.durum === "bekliyor");
  store.kaydet();
}

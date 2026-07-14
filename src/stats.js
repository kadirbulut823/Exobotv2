// Istatistikler ve kullanici profilleri
import * as store from "./store.js";

function ist() {
  const db = store.get();
  if (!db.istatistik) {
    db.istatistik = {
      toplamMesaj: 0,
      filtreler: {}, // { "Küfür / hakaret": 12, ... }
      saatlik: {}, // { "0": 34, "1": 12, ... } -> gunun saatine gore mesaj sayisi
      gunluk: {}, // { "2026-07-14": { mesaj: 1200, ihlal: 30 } }
    };
  }
  return db.istatistik;
}

function kullanicilar() {
  const db = store.get();
  if (!db.kullanicilar) db.kullanicilar = {};
  return db.kullanicilar;
}

const bugun = () => new Date().toISOString().slice(0, 10);

export function mesajKaydet(sender, icerik) {
  const i = ist();
  const k = kullanicilar();
  const kul = sender.username.toLowerCase();
  const simdi = Date.now();

  i.toplamMesaj++;

  const saat = String(new Date().getHours());
  i.saatlik[saat] = (i.saatlik[saat] || 0) + 1;

  const g = bugun();
  if (!i.gunluk[g]) i.gunluk[g] = { mesaj: 0, ihlal: 0 };
  i.gunluk[g].mesaj++;

  // Son 30 gunu tut
  const gunler = Object.keys(i.gunluk).sort();
  while (gunler.length > 30) delete i.gunluk[gunler.shift()];

  if (!k[kul]) {
    k[kul] = { ad: sender.username, mesaj: 0, ihlal: 0, ilk: simdi, son: simdi, sonMesaj: "" };
  }
  k[kul].mesaj++;
  k[kul].son = simdi;
  k[kul].ad = sender.username;
  k[kul].sonMesaj = String(icerik).slice(0, 120);

  store.kaydet();
}

export function ihlalKaydet(sender, sebep) {
  const i = ist();
  const k = kullanicilar();
  const kul = sender.username.toLowerCase();

  i.filtreler[sebep] = (i.filtreler[sebep] || 0) + 1;

  const g = bugun();
  if (!i.gunluk[g]) i.gunluk[g] = { mesaj: 0, ihlal: 0 };
  i.gunluk[g].ihlal++;

  if (k[kul]) k[kul].ihlal++;
  store.kaydet();
}

export function ozet() {
  const i = ist();
  const k = kullanicilar();
  const db = store.get();

  const filtreler = Object.entries(i.filtreler)
    .map(([sebep, sayi]) => ({ sebep, sayi }))
    .sort((a, b) => b.sayi - a.sayi);

  const saatlik = Array.from({ length: 24 }, (_, s) => ({ saat: s, sayi: i.saatlik[String(s)] || 0 }));

  const gunluk = Object.entries(i.gunluk)
    .map(([gun, v]) => ({ gun, ...v }))
    .sort((a, b) => a.gun.localeCompare(b.gun))
    .slice(-14);

  const enAktif = Object.entries(k)
    .map(([kul, v]) => ({ kullanici: v.ad || kul, mesaj: v.mesaj, ihlal: v.ihlal }))
    .sort((a, b) => b.mesaj - a.mesaj)
    .slice(0, 10);

  return {
    toplamMesaj: i.toplamMesaj,
    toplamIhlal: Object.values(i.filtreler).reduce((a, b) => a + b, 0),
    kisiSayisi: Object.keys(k).length,
    toplamIslem: (db.ban_gecmisi || []).length,
    filtreler,
    saatlik,
    gunluk,
    enAktif,
  };
}

export function profil(kullaniciAdi) {
  const kul = String(kullaniciAdi).toLowerCase();
  const k = kullanicilar()[kul];
  if (!k) return null;

  const db = store.get();
  const gecmis = (db.ban_gecmisi || []).filter((x) => String(x.kullanici).toLowerCase() === kul).slice(0, 20);

  return {
    kullanici: k.ad || kul,
    mesaj: k.mesaj,
    ihlal: k.ihlal,
    ilk: k.ilk,
    son: k.son,
    sonMesaj: k.sonMesaj,
    puan: db.puanlar?.[kul] || 0,
    cezaPuani: db.cezalar?.[kul]?.puan || 0,
    gecmis,
  };
}

export function ara(sorgu) {
  const q = String(sorgu || "").toLowerCase();
  if (!q) return [];
  return Object.entries(kullanicilar())
    .filter(([kul]) => kul.includes(q))
    .slice(0, 15)
    .map(([kul, v]) => ({ kullanici: v.ad || kul, mesaj: v.mesaj, ihlal: v.ihlal }));
}

export function sifirla() {
  const db = store.get();
  db.istatistik = null;
  db.kullanicilar = {};
  store.kaydet();
}

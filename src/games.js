// Sohbet oyunlari ve anket motoru
// Bu modul sadece MANTIGI tutar; mesaj gonderme isini cagiran taraf yapar.

// ---------- Aktif oyun ----------
let oyun = null;
// { tip, cevap, gorunen, baslangic, bitis, odul, ipucuSayaci, veri }

let anket = null;
// { soru, secenekler:[...], oylar:{ kullanici: index }, bitis }

export function oyunDurumu() {
  if (!oyun) return null;
  return {
    tip: oyun.tip,
    gorunen: oyun.gorunen,
    kalanSaniye: Math.max(0, Math.round((oyun.bitis - Date.now()) / 1000)),
    odul: oyun.odul,
    cevap: oyun.cevap, // sadece panelde gosterilir
  };
}

export function anketDurumu() {
  if (!anket) return null;
  const sayim = anket.secenekler.map((_, i) => Object.values(anket.oylar).filter((o) => o === i).length);
  return {
    soru: anket.soru,
    secenekler: anket.secenekler,
    sayim,
    toplam: Object.keys(anket.oylar).length,
    kalanSaniye: Math.max(0, Math.round((anket.bitis - Date.now()) / 1000)),
  };
}

// ---------- Yardimcilar ----------

function karistir(kelime) {
  const h = kelime.split("");
  let denemeler = 0;
  let sonuc;
  do {
    for (let i = h.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [h[i], h[j]] = [h[j], h[i]];
    }
    sonuc = h.join("");
  } while (sonuc === kelime && ++denemeler < 8); // ayni cikmasin
  return sonuc.toLocaleUpperCase("tr-TR");
}

function sadelestir(s) {
  return String(s)
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i").replace(/ğ/g, "g").replace(/ü/g, "u")
    .replace(/ş/g, "s").replace(/ö/g, "o").replace(/ç/g, "c")
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

function rastgele(dizi) {
  return dizi[Math.floor(Math.random() * dizi.length)];
}

export const OYUN_TIPLERI = {
  kelime: "Karışık kelime",
  quiz: "Bilgi yarışması",
  sayi: "Sayı tahmini",
  hizli: "Hızlı yazma",
  matematik: "Matematik",
};

// ---------- Oyun baslat ----------
// Donen: { ok, duyuru } veya { ok:false, hata }

export function oyunBaslat(tip, config) {
  const o = config.oyunlar || {};
  if (!o.aktif) return { ok: false, hata: "Oyunlar kapalı. Panelden aç." };
  if (oyun) return { ok: false, hata: "Zaten devam eden bir oyun var." };

  if (tip === "rastgele") tip = rastgele(Object.keys(OYUN_TIPLERI));
  if (!OYUN_TIPLERI[tip]) return { ok: false, hata: "Bilinmeyen oyun türü." };

  const sure = Math.max(20, o.sure_saniye || 120) * 1000;
  const odul = (o.oduller && o.oduller[tip]) || 25;
  let cevap, gorunen, veri = {};

  if (tip === "kelime") {
    const havuz = (o.kelime_havuzu || []).filter((k) => k && k.length >= 4);
    if (!havuz.length) return { ok: false, hata: "Kelime havuzu boş." };
    cevap = rastgele(havuz);
    gorunen = karistir(cevap);
  } else if (tip === "quiz") {
    const havuz = (o.quiz_sorulari || []).filter((s) => s.includes("|"));
    if (!havuz.length) return { ok: false, hata: "Quiz soru havuzu boş." };
    const [soru, cvp] = rastgele(havuz).split("|");
    cevap = cvp.trim();
    gorunen = soru.trim();
  } else if (tip === "sayi") {
    const max = 100;
    cevap = String(1 + Math.floor(Math.random() * max));
    gorunen = `1 ile ${max} arasında bir sayı tuttum`;
    veri = { max, alt: 1, ust: max };
  } else if (tip === "hizli") {
    const havuz = (o.hizli_kelimeler || []).length ? o.hizli_kelimeler : o.kelime_havuzu || [];
    if (!havuz.length) return { ok: false, hata: "Kelime havuzu boş." };
    cevap = rastgele(havuz);
    gorunen = cevap;
  } else if (tip === "matematik") {
    const a = 2 + Math.floor(Math.random() * 30);
    const b = 2 + Math.floor(Math.random() * 30);
    const c = 2 + Math.floor(Math.random() * 9);
    const islemler = [
      [`${a} + ${b} × ${c}`, a + b * c],
      [`(${a} + ${b}) × ${c}`, (a + b) * c],
      [`${a * c} ÷ ${c} + ${b}`, a + b],
      [`${a} × ${c} - ${b}`, a * c - b],
    ];
    const [metin, sonuc] = rastgele(islemler);
    cevap = String(sonuc);
    gorunen = metin;
  }

  oyun = { tip, cevap, gorunen, baslangic: Date.now(), bitis: Date.now() + sure, odul, ipucuSayaci: 0, veri };

  const saniye = Math.round(sure / 1000);
  const duyurular = {
    kelime: `🔤 KARIŞIK KELİME: "${gorunen}" — Doğru kelimeyi ilk yazan ${odul} puan kazanır! (${saniye} sn)`,
    quiz: `🧠 SORU: ${gorunen} — İlk doğru cevap ${odul} puan! (${saniye} sn)`,
    sayi: `🔢 SAYI TAHMİNİ: ${gorunen}. Tutturan ${odul} puan alır! (${saniye} sn)`,
    hizli: `⚡ HIZLI YAZMA: "${gorunen}" — Bunu ilk yazan ${odul} puan! (${saniye} sn)`,
    matematik: `➗ İŞLEM: ${gorunen} = ? — İlk doğru cevap ${odul} puan! (${saniye} sn)`,
  };

  return { ok: true, duyuru: duyurular[tip], tip };
}

// ---------- Mesaj kontrolu ----------
// Her sohbet mesaji buradan gecer. Kazanan varsa dondurur.

export function oyunKontrol(icerik, sender) {
  if (!oyun) return null;

  const tahmin = sadelestir(icerik);
  if (!tahmin) return null;

  const dogru = sadelestir(oyun.cevap);
  if (tahmin !== dogru) {
    // Sayi oyununda yaklasma ipucu (chat'i bogmamak icin sessiz)
    if (oyun.tip === "sayi" && /^\d+$/.test(icerik.trim())) {
      const t = Number(icerik.trim());
      const c = Number(oyun.cevap);
      if (t < c && t > oyun.veri.alt) oyun.veri.alt = t;
      if (t > c && t < oyun.veri.ust) oyun.veri.ust = t;
    }
    return null;
  }

  const kazanan = { kullanici: sender.username, odul: oyun.odul, tip: oyun.tip, cevap: oyun.cevap };
  const gecen = ((Date.now() - oyun.baslangic) / 1000).toFixed(1);
  kazanan.duyuru = `🏅 @${sender.username} bildi! Cevap: ${oyun.cevap} — ${oyun.odul} puan kazandı. (${gecen} sn)`;
  oyun = null;
  return kazanan;
}

// Suresi dolan oyunu kapatir. Kapandiysa duyuru dondurur.
export function oyunSureKontrol() {
  if (!oyun || Date.now() < oyun.bitis) return null;
  const cevap = oyun.cevap;
  const ipucu =
    oyun.tip === "sayi" ? ` (Aralık: ${oyun.veri.alt}-${oyun.veri.ust})` : "";
  oyun = null;
  return `⏰ Süre doldu! Kimse bilemedi. Doğru cevap: ${cevap}${ipucu}`;
}

export function oyunBitir() {
  if (!oyun) return null;
  const cevap = oyun.cevap;
  oyun = null;
  return `Oyun iptal edildi. Cevap: ${cevap}`;
}

// ---------- Anket ----------

export function anketBaslat(soru, secenekler, config) {
  if (anket) return { ok: false, hata: "Zaten devam eden bir anket var." };
  if (!soru?.trim()) return { ok: false, hata: "Soru boş olamaz." };

  const temiz = (secenekler || []).map((s) => s.trim()).filter(Boolean).slice(0, 5);
  if (temiz.length < 2) return { ok: false, hata: "En az 2 seçenek gerekli." };

  const sure = Math.max(15, config.anket?.sure_saniye || 60) * 1000;
  anket = { soru: soru.trim(), secenekler: temiz, oylar: {}, bitis: Date.now() + sure };

  const liste = temiz.map((s, i) => `${i + 1}) ${s}`).join("  ");
  return {
    ok: true,
    duyuru: `📊 ANKET: ${soru.trim()} — ${liste} — Oy vermek için sohbete sadece numarayı yaz! (${Math.round(sure / 1000)} sn)`,
  };
}

// Anket acikken kullanicinin yazdigi sayiyi oy olarak sayar
export function anketOy(icerik, sender) {
  if (!anket) return false;
  const m = icerik.trim().match(/^([1-5])$/);
  if (!m) return false;
  const index = Number(m[1]) - 1;
  if (index >= anket.secenekler.length) return false;
  anket.oylar[sender.username.toLowerCase()] = index;
  return true;
}

export function anketSureKontrol() {
  if (!anket || Date.now() < anket.bitis) return null;
  return anketBitir();
}

export function anketBitir() {
  if (!anket) return null;
  const d = anketDurumu();
  anket = null;

  if (d.toplam === 0) return "📊 Anket bitti — hiç oy gelmedi.";

  const enYuksek = Math.max(...d.sayim);
  const kazananlar = d.secenekler.filter((_, i) => d.sayim[i] === enYuksek);
  const dokum = d.secenekler
    .map((s, i) => `${s}: ${d.sayim[i]} (%${Math.round((d.sayim[i] / d.toplam) * 100)})`)
    .join(" | ");

  return `📊 ANKET SONUCU — ${dokum} — Kazanan: ${kazananlar.join(" & ")} (${d.toplam} oy)`;
}

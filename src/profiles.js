// Kanal profilleri
//
// SORUN: Bot tek bir veri deposu kullaniyordu. Kanal degistirince ya da
// guncelleme sirasinda veriler karisiyor/sifirlaniyor gibi hissediliyordu.
//
// COZUM: Her kanalin verisi data/profiller/<slug>.json dosyasinda saklanir.
// Kanala baglaninca profili varsa YUKLENIR, ayrilirken KAYDEDILIR.
// Ayrica aktif profil her 5 dakikada bir otomatik kaydedilir.
//
// Profile giren veriler: ayarlar (komutlar, filtreler, oyunlar...) +
// puanlar, cezalar, kullanici gecmisi, istatistik, yasakli kelimeler,
// moderasyon logu, talepler, linkler, cekilis.
// Token profile GIRMEZ (bot hesabina ait, kanaldan bagimsiz).

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import * as store from "./store.js";
import * as ayar from "./config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROFIL_DIR = path.join(__dirname, "..", "data", "profiller");

function dosyaYolu(slug) {
  const temiz = String(slug).toLowerCase().replace(/[^a-z0-9_-]/g, "");
  return path.join(PROFIL_DIR, temiz + ".json");
}

// db'den profile girecek alanlar (tokens HARIC)
const DB_ALANLARI = [
  "puanlar",
  "cezalar",
  "kullanicilar",
  "istatistik",
  "ban_gecmisi",
  "yasakli_ek",
  "talepler",
  "linkler",
  "cekilis",
];

export function kaydet(slug) {
  if (!slug || slug === "kanal-adi-buraya") return false;
  try {
    if (!fs.existsSync(PROFIL_DIR)) fs.mkdirSync(PROFIL_DIR, { recursive: true });

    const db = store.get();
    const veriler = {};
    for (const alan of DB_ALANLARI) veriler[alan] = db[alan];

    const profil = {
      slug,
      kayitZamani: Date.now(),
      ayarlar: ayar.get(),
      veriler,
    };

    fs.writeFileSync(dosyaYolu(slug), JSON.stringify(profil, null, 2));
    return true;
  } catch (e) {
    console.error("[profil] Kaydedilemedi:", e.message);
    return false;
  }
}

export function varMi(slug) {
  return fs.existsSync(dosyaYolu(slug));
}

// Profili yukler. Basarili olursa true doner.
export function yukle(slug) {
  try {
    const yol = dosyaYolu(slug);
    if (!fs.existsSync(yol)) return false;

    const profil = JSON.parse(fs.readFileSync(yol, "utf8"));

    // Ayarlar: kanal slug/chatroom haric her seyi profilden al
    // (slug'i cagiran taraf zaten ayarliyor)
    if (profil.ayarlar) {
      const simdiki = ayar.get();
      const yeniAyar = { ...profil.ayarlar };
      yeniAyar.kanal = simdiki.kanal; // aktif kanal bilgisi korunur
      ayar.kaydet(yeniAyar);
    }

    // Veriler
    if (profil.veriler) {
      const db = store.get();
      for (const alan of DB_ALANLARI) {
        if (profil.veriler[alan] !== undefined) db[alan] = profil.veriler[alan];
      }
      store.kaydet();
    }

    console.log(`[profil] "${slug}" profili yüklendi (kayıt: ${new Date(profil.kayitZamani).toLocaleString("tr-TR")}).`);
    return true;
  } catch (e) {
    console.error("[profil] Yuklenemedi:", e.message);
    return false;
  }
}

export function listele() {
  try {
    if (!fs.existsSync(PROFIL_DIR)) return [];
    return fs
      .readdirSync(PROFIL_DIR)
      .filter((f) => f.endsWith(".json"))
      .map((f) => {
        try {
          const p = JSON.parse(fs.readFileSync(path.join(PROFIL_DIR, f), "utf8"));
          return {
            slug: p.slug || f.replace(".json", ""),
            kayitZamani: p.kayitZamani || null,
            komutSayisi: Object.keys(p.ayarlar?.komutlar || {}).length,
            puanliKisi: Object.keys(p.veriler?.puanlar || {}).length,
          };
        } catch {
          return { slug: f.replace(".json", ""), kayitZamani: null };
        }
      })
      .sort((a, b) => (b.kayitZamani || 0) - (a.kayitZamani || 0));
  } catch {
    return [];
  }
}

export function sil(slug) {
  try {
    const yol = dosyaYolu(slug);
    if (fs.existsSync(yol)) fs.unlinkSync(yol);
    return true;
  } catch {
    return false;
  }
}

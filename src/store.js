// Basit dosya tabanli veri deposu. Veritabanina gerek yok.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");
const DB_FILE = path.join(DATA_DIR, "db.json");

const varsayilan = {
  tokens: null, // { access_token, refresh_token, expires_at }
  puanlar: {}, // { "username": 120 }
  ban_gecmisi: [], // moderasyon logu
  yasakli_ek: [], // sohbetten eklenen yasakli kelimeler
};

let db = { ...varsayilan };

export function yukle() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(DB_FILE)) {
      db = { ...varsayilan, ...JSON.parse(fs.readFileSync(DB_FILE, "utf8")) };
    }
  } catch (e) {
    console.error("[store] Veri okunamadi, sifirdan baslaniyor:", e.message);
    db = { ...varsayilan };
  }
  return db;
}

let kaydetTimer = null;
export function kaydet() {
  // Cok sik yazmamak icin 2 saniye bekletip toplu yaz
  clearTimeout(kaydetTimer);
  kaydetTimer = setTimeout(() => {
    try {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
    } catch (e) {
      console.error("[store] Kaydedilemedi:", e.message);
    }
  }, 2000);
}

export function get() {
  return db;
}

export function logEkle(kayit) {
  db.ban_gecmisi.unshift({ ...kayit, zaman: new Date().toISOString() });
  if (db.ban_gecmisi.length > 200) db.ban_gecmisi.length = 200;
  kaydet();
}

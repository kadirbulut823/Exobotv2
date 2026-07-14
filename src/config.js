// Ayar yoneticisi
//
// config.json (repo icinde)  = VARSAYILAN ayarlar
// data/config.json (volume)  = CANLI ayarlar (panelden degistirilenler)
//
// Bot acilista once data/config.json'a bakar. Yoksa varsayilani kopyalar.
// Boylece panelden yapilan degisiklikler yeni deploy'da SILINMEZ.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VARSAYILAN_YOL = path.join(__dirname, "..", "config.json");
const DATA_DIR = path.join(__dirname, "..", "data");
const CANLI_YOL = path.join(DATA_DIR, "config.json");

let config = null;

// Varsayilan ayarlarda olup canli ayarlarda olmayan yeni alanlari ekler
// (yeni surum ciktiginda ayarlar bozulmasin diye)
function birlestir(varsayilan, canli) {
  if (Array.isArray(varsayilan) || typeof varsayilan !== "object" || varsayilan === null) {
    return canli === undefined ? varsayilan : canli;
  }
  const sonuc = { ...varsayilan };
  for (const anahtar of Object.keys(canli || {})) {
    sonuc[anahtar] =
      anahtar in varsayilan ? birlestir(varsayilan[anahtar], canli[anahtar]) : canli[anahtar];
  }
  return sonuc;
}

export function yukle() {
  const varsayilan = JSON.parse(fs.readFileSync(VARSAYILAN_YOL, "utf8"));
  try {
    if (fs.existsSync(CANLI_YOL)) {
      const canli = JSON.parse(fs.readFileSync(CANLI_YOL, "utf8"));
      config = birlestir(varsayilan, canli);
      console.log("[config] Canli ayarlar yuklendi (data/config.json)");
    } else {
      config = varsayilan;
      kaydet(config);
      console.log("[config] Varsayilan ayarlar kopyalandi.");
    }
  } catch (e) {
    console.error("[config] Canli ayarlar okunamadi, varsayilan kullaniliyor:", e.message);
    config = varsayilan;
  }
  return config;
}

export function get() {
  if (!config) yukle();
  return config;
}

export function kaydet(yeni) {
  config = yeni;
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(CANLI_YOL, JSON.stringify(config, null, 2));
    return true;
  } catch (e) {
    console.error("[config] Kaydedilemedi:", e.message);
    return false;
  }
}

// Varsayilan ayarlara geri don
export function sifirla() {
  const varsayilan = JSON.parse(fs.readFileSync(VARSAYILAN_YOL, "utf8"));
  kaydet(varsayilan);
  return varsayilan;
}

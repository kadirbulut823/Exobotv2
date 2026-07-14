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

// Koda gomulu varsayilanlar.
// config.json eksik ya da eski surumse bot yine de calisir; eksik alanlar buradan tamamlanir.
const GOMULU = {
  oyunlar: {
    aktif: true,
    sure_saniye: 120,
    oduller: { kelime: 50, quiz: 50, sayi: 75, hizli: 30, matematik: 40 },
    otomatik: { aktif: false, dakika: 30, sadece_yayin_acikken: true },
    kelime_havuzu: [
      "yayin","sohbet","moderator","klavye","bilgisayar","kahve","muzik","futbol","basketbol","kitap",
      "sinema","telefon","internet","oyuncu","kamera","mikrofon","ekran","kulaklik","masa","sandalye",
      "pencere","anahtar","kalem","defter","canta","ayakkabi","gozluk","saat","takvim","harita",
      "deniz","dagci","orman","yildiz","gunes","bulut","yagmur","kar","ruzgar","toprak",
      "elma","karpuz","cilek","muz","portakal","domates","patates","peynir","ekmek","corba",
      "kaplan","kartal","balina","kelebek","yunus","tavsan","sincap","penguen","zurafa","timsah"
    ],
    hizli_kelimeler: ["hizli","kazandim","buradayim","yakala","simsek","roket","firtina","atesle","kaptan","zafer"],
    quiz_sorulari: [
      "Turkiye'nin baskenti neresidir?|Ankara",
      "Bir futbol takiminda sahada kac oyuncu bulunur?|11",
      "Gunes sistemindeki en buyuk gezegen hangisidir?|Jupiter",
      "Bir yilda kac ay vardir?|12",
      "Dunyanin en uzun nehri hangisidir?|Nil",
      "Satrancta tahtada kac kare vardir?|64",
      "Insan vucudundaki en buyuk organ hangisidir?|Deri",
      "Bir haftada kac saat vardir?|168",
      "Su formulu nedir?|H2O",
      "Turkiye'nin en yuksek dagi hangisidir?|Agri",
      "Bir zarda kac yuz vardir?|6",
      "Kirmizi ile mavi karisirsa hangi renk olur?|Mor",
      "Piyanoda kac tus vardir?|88",
      "Olimpiyat halkalari kac tanedir?|5",
      "Dunyanin uydusu nedir?|Ay",
      "Bir dakikada kac saniye vardir?|60",
      "En kucuk asal sayi nedir?|2",
      "Mona Lisa tablosunu kim yapmistir?|Leonardo da Vinci",
      "Turkiye kac bolgeye ayrilir?|7",
      "Bir ucgenin ic acilari toplami kactir?|180"
    ]
  },
  anket: { aktif: true, sure_saniye: 60 },
};

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
  // Gomulu varsayilanlar + repodaki config.json
  const varsayilan = birlestir(GOMULU, JSON.parse(fs.readFileSync(VARSAYILAN_YOL, "utf8")));
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
  const varsayilan = birlestir(GOMULU, JSON.parse(fs.readFileSync(VARSAYILAN_YOL, "utf8")));
  kaydet(varsayilan);
  return varsayilan;
}

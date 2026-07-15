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
    flood_carpani: 3, // oyun sirasinda flood esigi bu kadar gevser (izleyiciler ceza almasin)
    oduller: { kelime: 50, quiz: 50, sayi: 75, hizli: 30, matematik: 40 },
    otomatik: { aktif: false, dakika: 30, sadece_yayin_acikken: true },
    // Bicim: "kelime"  ya da  "kelime|anlami"
    // Anlam yazarsan, kelime bilindiginde bot sohbete anlamini da yazar.
    kelime_havuzu: [
      // --- Zor kelimeler (anlamli ornekler) ---
      "muteakip|Arkasindan gelen, sonraki",
      "mustesna|Ayricalikli, benzerlerinden ustun",
      "tahakkum|Baskı kurma, zorbalık",
      "muphem|Belirsiz, anlasilmasi guc",
      "izafi|Goreceli, bakis acisina gore degisen",
      "mutabakat|Anlasma, uzlasma",
      "tevazu|Alcakgonulluluk",
      "sarih|Acik, net, anlasilir",
      "muzmin|Kronik, surekli tekrarlayan",
      "hercai|Kararsiz, bir seye baglanmayan",
      "lakayt|Ilgisiz, umursamaz",
      "mahcup|Utangac, sikilgan",
      "muteessir|Uzulmus, etkilenmis",
      "sadakat|Baglilik, vefa",
      "ihtiras|Asiri istek, tutku",
      // --- Kolay kelimeler ---
      "yayin","sohbet","moderator","klavye","bilgisayar","kahve","muzik","futbol","basketbol","kitap",
      "sinema","telefon","internet","oyuncu","kamera","mikrofon","ekran","kulaklik","masa","sandalye",
      "deniz","orman","yildiz","gunes","bulut","yagmur","ruzgar","toprak","kelebek","penguen",
      "elma","karpuz","cilek","portakal","domates","peynir","ekmek","corba","kaplan","kartal"
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

  // Link kuyrugu: sohbetteki tum linkler moderator gozden gecirsin diye toplanir
  link_kuyrugu: {
    aktif: true,
    tekrar_uyarisi: true, // ayni link tekrar atilinca "zaten gorulduk" mesaji
    goruldu_mesaji: "👁️ Bu linki gördük, teşekkürler {kullanici}!",
    tekrar_mesaji: "Bu link zaten paylaşıldı {kullanici}, moderatörler görecek.",
  },

  // Otomatik tepkiler: prefix (!) gerekmez. Biri "sa" yazinca bot "as" yazar.
  otomatik_tepkiler: {
    aktif: true,
    bekleme_saniye: 30, // ayni tepki en fazla bu kadar sik verilir (spam olmasin)
    kurallar: [
      { tetik: "sa", cevap: "as", tam_kelime: true },
      { tetik: "selam", cevap: "Aleyküm selam! 👋", tam_kelime: true },
    ],
    _not: "tam_kelime true ise sadece tam eslesmede tepki verir (sa -> evet, salak -> hayir). false ise mesajin icinde gecmesi yeter."
  },

  // Komut spam korumasi
  komut_bekleme: {
    komut_saniye: 10,      // ayni komut en fazla 10 sn'de bir cevaplanir
    kullanici_saniye: 20,  // bir kullanici en fazla 20 sn'de bir komut kullanabilir
  },

  // Panik butonu: raid/bot saldirisinda esikleri sertlestirir
  siki_mod: {
    link_agirligi: 3,
    flood_max_mesaj: 3,
  },

  // Otomatik raid tespiti: kisa surede cok sayida FARKLI kullanicidan AYNI mesaj
  raid_korumasi: {
    aktif: true,
    saniye: 15,
    farkli_kullanici: 5,
    ceza_agirligi: 5,      // dogrudan en agir cezaya gider
    siki_mod_dakika: 10,   // tespit edilirse siki mod bu kadar sure acik kalir
  },

  // Puan dukkani
  dukkan: {
    aktif: true,
    urunler: [
      { kod: "sarki", ad: "Şarkı isteği", fiyat: 200, tip: "istek", not_zorunlu: true, aktif: true },
      { kod: "bilet", ad: "Ekstra çekiliş bileti", fiyat: 150, tip: "bilet", max_adet: 5, aktif: true },
      { kod: "duyuru", ad: "Sohbete duyuru", fiyat: 300, tip: "duyuru", not_zorunlu: true, aktif: true },
      { kod: "vip", ad: "VIP talebi", fiyat: 1000, tip: "istek", not_zorunlu: false, aktif: true },
    ],
  },
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

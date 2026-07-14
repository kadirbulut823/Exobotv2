// Sohbete mesaj gonderim kuyrugu.
//
// Neden gerekli: Kick'in mesaj gonderme limiti var. Bot kalabalik anlarda
// (oyun kazanani + moderasyon uyarilari + komut cevaplari ayni anda) limite
// takilirsa BUTUN mesajlari duser - moderasyon uyarilari dahil.
//
// Bu kuyruk mesajlari sirayla ve araliklarla gonderir; tasma olursa
// onemsiz mesajlari atar, onemlileri (moderasyon) korur.

const ARALIK_MS = 1200; // iki mesaj arasi en az bekleme
const MAX_KUYRUK = 25; // kuyrukta en fazla bu kadar mesaj bekler

let kuyruk = [];
let calisiyor = false;
let dusen = 0;

// oncelik: 2 = moderasyon (asla atilmaz), 1 = oyun/etkinlik, 0 = komut cevabi
export function kuyrugaAl(gonderFn, metin, oncelik = 0) {
  if (kuyruk.length >= MAX_KUYRUK) {
    // Kuyruk dolu: en dusuk oncelikli bekleyen mesaji at
    const enDusukIndex = kuyruk.reduce(
      (min, m, i, a) => (m.oncelik < a[min].oncelik ? i : min),
      0
    );
    if (kuyruk[enDusukIndex].oncelik < oncelik) {
      kuyruk.splice(enDusukIndex, 1);
      dusen++;
    } else {
      dusen++;
      return Promise.resolve({ atlandi: true });
    }
  }

  return new Promise((cozumle) => {
    kuyruk.push({ gonderFn, metin, oncelik, cozumle });
    isle();
  });
}

async function isle() {
  if (calisiyor) return;
  calisiyor = true;

  while (kuyruk.length) {
    // Once yuksek oncelikliler
    kuyruk.sort((a, b) => b.oncelik - a.oncelik);
    const is = kuyruk.shift();

    try {
      const sonuc = await is.gonderFn(is.metin);
      is.cozumle(sonuc);
    } catch (e) {
      console.error("[kuyruk] Mesaj gonderilemedi:", e.message);
      is.cozumle({ hata: e.message });
    }

    if (kuyruk.length) await bekle(ARALIK_MS);
  }

  calisiyor = false;
}

const bekle = (ms) => new Promise((r) => setTimeout(r, ms));

export function durum() {
  return { bekleyen: kuyruk.length, dusen };
}

// Canli sohbet akisi icin bellekte tutulan mesaj tamponu.
// Diske yazilmaz - panelde anlik izleme icindir.

const MAX = 250;
let tampon = [];
let sayac = 0;

export function ekle({ messageId, sender, icerik, rozetler }) {
  sayac++;
  tampon.push({
    no: sayac,
    id: messageId,
    kullanici: sender.username,
    userId: sender.user_id,
    renk: sender.identity?.username_color || null,
    rozetler: rozetler || [],
    icerik,
    zaman: Date.now(),
    silindi: false,
    ihlal: null,
  });
  if (tampon.length > MAX) tampon = tampon.slice(-MAX);
}

// Bir mesaji silinmis olarak isaretle (panelde ustu cizili gorunur)
export function silindiIsaretle(messageId, sebep = null) {
  const m = tampon.find((x) => x.id === messageId);
  if (m) {
    m.silindi = true;
    m.ihlal = sebep;
  }
}

// no > sonNo olan mesajlari dondurur (panel sadece yenileri ceker)
export function getir(sonNo = 0) {
  return { sonNo: sayac, mesajlar: tampon.filter((m) => m.no > sonNo) };
}

// Panel ilk acildiginda tum tamponu ister
export function hepsi() {
  return { sonNo: sayac, mesajlar: tampon };
}

export function temizle() {
  tampon = [];
}

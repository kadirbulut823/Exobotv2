// Otomatik tepkiler: prefix (!) gerektirmeyen anahtar-kelime yanitlari.
// Ornek: biri "sa" yazinca bot "as" yazar.

const sonTepki = new Map(); // "tetik" -> zaman (spam onleme)

function sadelestir(s) {
  return String(s)
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i").replace(/ğ/g, "g").replace(/ü/g, "u")
    .replace(/ş/g, "s").replace(/ö/g, "o").replace(/ç/g, "c")
    .trim();
}

// Mesaji kontrol eder. Tepki gerekiyorsa cevap metnini dondurur, yoksa null.
export function tepkiKontrol(icerik, config) {
  const t = config.otomatik_tepkiler;
  if (!t?.aktif || !t.kurallar?.length) return null;

  const mesaj = sadelestir(icerik);
  if (!mesaj) return null;

  const simdi = Date.now();
  const bekleme = (t.bekleme_saniye ?? 30) * 1000;

  for (const kural of t.kurallar) {
    if (!kural.tetik || !kural.cevap) continue;
    const tetik = sadelestir(kural.tetik);
    if (!tetik) continue;

    let eslesti = false;
    if (kural.tam_kelime) {
      // Tam kelime: "sa" eslesir ama "salak", "sabah" eslesmez
      const kacis = tetik.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      eslesti = new RegExp(`(^|\\s)${kacis}(\\s|$)`).test(mesaj);
    } else {
      // Icinde gecmesi yeter
      eslesti = mesaj.includes(tetik);
    }
    if (!eslesti) continue;

    // Spam onleme: ayni tepkiyi cok sik verme
    if (simdi - (sonTepki.get(tetik) || 0) < bekleme) return null;
    sonTepki.set(tetik, simdi);

    return String(kural.cevap).slice(0, 490);
  }

  return null;
}

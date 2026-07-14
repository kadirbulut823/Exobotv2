// Komutlar: genel komutlar, moderator komutlari, cekilis ve puan sistemi
import * as kick from "./kickApi.js";
import * as store from "./store.js";
import { moderatorMu, cezaPuaniSifirla, cezaPuaniGetir } from "./moderation.js";
import * as games from "./games.js";

// Kullanici adi -> user_id (ban/timeout komutlari icin gerekli)
export const kullaniciCache = new Map();

export function kullaniciKaydet(sender) {
  if (sender?.username && sender?.user_id) {
    kullaniciCache.set(sender.username.toLowerCase(), sender.user_id);
  }
}

// ---------- Cekilis ----------
// Cekilis durumu kalici olarak db.json icinde tutulur.
// (Bot yeniden baslasa bile cekilis kaybolmaz.)
export function cekilisDurum() {
  const db = store.get();
  if (!db.cekilis) db.cekilis = { aktif: false, anahtar: "", katilimcilar: {}, kazanan: null };
  return db.cekilis;
}

export function cekilisKatilimciSayisi() {
  return Object.keys(cekilisDurum().katilimcilar || {}).length;
}

// ---------- Puan ----------
const puanCooldown = new Map();

export function puanEkle(username, config) {
  if (!config.puan_sistemi?.aktif) return;
  const kul = username.toLowerCase();
  const simdi = Date.now();
  const bekle = (config.puan_sistemi.cooldown_saniye ?? 60) * 1000;
  if (simdi - (puanCooldown.get(kul) || 0) < bekle) return;
  puanCooldown.set(kul, simdi);

  const db = store.get();
  db.puanlar[kul] = (db.puanlar[kul] || 0) + (config.puan_sistemi.mesaj_basina ?? 1);
  store.kaydet();
}

// Oyun odulu gibi durumlarda cooldown'a takilmadan dogrudan puan verir
export function puanVer(username, miktar) {
  const db = store.get();
  const kul = username.toLowerCase();
  db.puanlar[kul] = (db.puanlar[kul] || 0) + Number(miktar || 0);
  store.kaydet();
  return db.puanlar[kul];
}

// ---------- Komut isleme ----------

export async function komutIsle({ icerik, sender, broadcaster, broadcasterUserId, messageId, config }) {
  const yaz = (metin) =>
    config.bot.sohbete_yazsin
      ? kick.mesajGonder(broadcasterUserId, metin, config.bot.mesaj_tipi).catch((e) => console.error("[cmd]", e.message))
      : null;

  const metin = icerik.trim();

  // --- Cekilise katilim (komut degil, anahtar kelime) ---
  const ck = cekilisDurum();
  if (ck.aktif && metin.toLocaleLowerCase("tr-TR") === ck.anahtar) {
    const kul = sender.username.toLowerCase();
    if (!ck.katilimcilar[kul]) {
      ck.katilimcilar[kul] = sender.user_id;
      store.kaydet();
    }
    return true; // mesaji filtrelerden gecirmeye gerek yok
  }

  const prefix = config.bot.prefix || "!";
  if (!metin.startsWith(prefix)) return false;

  const parcalar = metin.slice(prefix.length).trim().split(/\s+/);
  const komut = (parcalar.shift() || "").toLocaleLowerCase("tr-TR");
  const arg = parcalar;
  const mod = moderatorMu(sender, broadcaster);

  // ================= GENEL KOMUTLAR =================

  if (komut === "komutlar" || komut === "yardim") {
    const ozel = Object.keys(config.komutlar || {}).filter((k) => !k.startsWith("_")).map((k) => prefix + k);
    const sabit = [prefix + "puan", prefix + "top"];
    let cevap = `Komutlar: ${[...sabit, ...ozel].join(" | ")}`;
    if (moderatorMu(sender, broadcaster)) {
      cevap += ` || MOD: ${prefix}to ${prefix}ban ${prefix}unban ${prefix}af ${prefix}ceza ${prefix}duyuru ${prefix}yasakekle ${prefix}yasakcikar ${prefix}yasaklilar ${prefix}cekilis ${prefix}oyun ${prefix}anket`;
    }
    await yaz(cevap.slice(0, 490));
    return true;
  }

  if (["oyunlar", "aktifoyun", "ipucu"].includes(komut)) {
    const d = games.oyunDurumu();
    if (!d) {
      const a = games.anketDurumu();
      await yaz(a ? `📊 Anket açık: ${a.soru} — Oy vermek için numarayı yaz. (${a.kalanSaniye} sn)` : "Şu an aktif oyun yok.");
      return true;
    }
    const metin = {
      kelime: `🔤 Karışık kelime: "${d.gorunen}"`,
      quiz: `🧠 Soru: ${d.gorunen}`,
      sayi: `🔢 ${d.gorunen}`,
      hizli: `⚡ Yaz: "${d.gorunen}"`,
      matematik: `➗ ${d.gorunen} = ?`,
    }[d.tip];
    await yaz(`${metin} — ${d.odul} puan, ${d.kalanSaniye} saniye kaldı.`);
    return true;
  }

  if (komut === "puan" || komut === "puanim") {
    if (!config.puan_sistemi?.aktif) return true;
    const p = store.get().puanlar[sender.username.toLowerCase()] || 0;
    await yaz(`@${sender.username} → ${p} ${config.puan_sistemi.isim}`);
    return true;
  }

  if (komut === "top" || komut === "siralama") {
    if (!config.puan_sistemi?.aktif) return true;
    const liste = Object.entries(store.get().puanlar)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([k, v], i) => `${i + 1}. ${k} (${v})`);
    await yaz(liste.length ? `Sıralama → ${liste.join(" | ")}` : "Henüz puan toplayan yok.");
    return true;
  }

  // Config'deki ozel komutlar (!discord, !sosyal ...)
  if (config.komutlar && !komut.startsWith("_") && config.komutlar[komut]) {
    await yaz(config.komutlar[komut]);
    return true;
  }

  // ================= MODERATOR KOMUTLARI =================

  if (!mod) return false;

  // !to <kullanici> <dakika> [sebep]
  if (komut === "to" || komut === "sustur" || komut === "timeout") {
    const hedef = (arg[0] || "").replace("@", "").toLowerCase();
    const dakika = parseInt(arg[1], 10) || 5;
    const sebep = arg.slice(2).join(" ") || "Moderatör kararı";
    const id = kullaniciCache.get(hedef);
    if (!id) return await yaz(`"${hedef}" bulunamadı. (Kullanıcı bu yayında hiç yazmamış olabilir.)`), true;
    try {
      await kick.banla(broadcasterUserId, id, dakika, sebep);
      store.logEkle({ kullanici: hedef, sebep, islem: "timeout", sure: dakika, yetkili: sender.username });
      await yaz(`@${hedef} ${dakika} dakika susturuldu. Sebep: ${sebep}`);
    } catch (e) {
      await yaz(`Susturma başarısız: ${e.message.slice(0, 100)}`);
    }
    return true;
  }

  // !ban <kullanici> [sebep]
  if (komut === "ban") {
    const hedef = (arg[0] || "").replace("@", "").toLowerCase();
    const sebep = arg.slice(1).join(" ") || "Moderatör kararı";
    const id = kullaniciCache.get(hedef);
    if (!id) return await yaz(`"${hedef}" bulunamadı.`), true;
    try {
      await kick.banla(broadcasterUserId, id, null, sebep);
      store.logEkle({ kullanici: hedef, sebep, islem: "ban", yetkili: sender.username });
      await yaz(`@${hedef} kalıcı olarak banlandı. Sebep: ${sebep}`);
    } catch (e) {
      await yaz(`Ban başarısız: ${e.message.slice(0, 100)}`);
    }
    return true;
  }

  // !unban <kullanici>
  if (komut === "unban" || komut === "banac") {
    const hedef = (arg[0] || "").replace("@", "").toLowerCase();
    const id = kullaniciCache.get(hedef);
    if (!id) return await yaz(`"${hedef}" bulunamadı.`), true;
    try {
      await kick.banKaldir(broadcasterUserId, id);
      await yaz(`@${hedef} banı kaldırıldı.`);
    } catch (e) {
      await yaz(`Ban kaldırılamadı: ${e.message.slice(0, 100)}`);
    }
    return true;
  }

  // !oyun <tip> | !oyun bitir
  if (["oyun", "etkinlik"].includes(komut)) {
    const alt = (arg[0] || "rastgele").toLocaleLowerCase("tr-TR");

    if (["bitir", "iptal", "dur"].includes(alt)) {
      const m = games.oyunBitir();
      await yaz(m || "Devam eden oyun yok.");
      return true;
    }

    const eslesme = { kelime: "kelime", karisik: "kelime", quiz: "quiz", soru: "quiz", sayi: "sayi", sayı: "sayi", hizli: "hizli", hızlı: "hizli", matematik: "matematik", islem: "matematik", rastgele: "rastgele" };
    const tip = eslesme[alt];
    if (!tip) {
      await yaz(`Oyun türleri: kelime, quiz, sayi, hizli, matematik, rastgele — Örnek: ${prefix}oyun kelime`);
      return true;
    }

    const r = games.oyunBaslat(tip, config);
    await yaz(r.ok ? r.duyuru : r.hata);
    return true;
  }

  // !anket Soru? | secenek1 | secenek2
  if (["anket", "oylama"].includes(komut)) {
    if (!config.anket?.aktif) return true;
    const ham = arg.join(" ");

    if (["bitir", "sonuc", "sonuç"].includes((arg[0] || "").toLocaleLowerCase("tr-TR"))) {
      const m = games.anketBitir();
      await yaz(m || "Devam eden anket yok.");
      return true;
    }

    const parca = ham.split("|").map((s) => s.trim()).filter(Boolean);
    if (parca.length < 3) {
      await yaz(`Kullanım: ${prefix}anket Soru? | seçenek 1 | seçenek 2`);
      return true;
    }
    const r = games.anketBaslat(parca[0], parca.slice(1), config);
    await yaz(r.ok ? r.duyuru : r.hata);
    return true;
  }

  // !af <kullanici>  -> ceza puanlarini sifirla + varsa bani/susturmayi kaldir
  if (["af", "cezasil", "cezakaldir", "temizle"].includes(komut)) {
    const hedef = (arg[0] || "").replace("@", "").toLowerCase();
    if (!hedef) {
      await yaz(`Kullanım: ${prefix}af <kullanıcı>`);
      return true;
    }

    const vardi = cezaPuaniSifirla(hedef);

    // Susturma/ban da varsa kaldirmayi dene (yoksa sessizce gec)
    let banNotu = "";
    const id = kullaniciCache.get(hedef);
    if (id) {
      try {
        await kick.banKaldir(broadcasterUserId, id);
        banNotu = " Susturma/ban da kaldırıldı.";
      } catch {
        // kullanici zaten banli degilse hata verir, onemsiz
      }
    }

    store.logEkle({ kullanici: hedef, sebep: "Af", islem: "af", yetkili: sender.username });
    await yaz(
      vardi
        ? `✅ @${hedef} ceza puanları sıfırlandı.${banNotu}`
        : `@${hedef} zaten temizdi (ceza puanı yoktu).${banNotu}`
    );
    return true;
  }

  // !ceza <kullanici>  -> mevcut ceza puanini goster
  if (["ceza", "cezapuan", "cezapuani"].includes(komut)) {
    const hedef = (arg[0] || "").replace("@", "").toLowerCase();
    if (!hedef) {
      await yaz(`Kullanım: ${prefix}ceza <kullanıcı>`);
      return true;
    }
    const sifirlamaDk = config.cezalar?.puan_sifirlama_dakika ?? 60;
    const puan = cezaPuaniGetir(hedef, sifirlamaDk);
    const adimlar = config.cezalar?.adimlar || [];
    const sonraki = adimlar[Math.min(puan, adimlar.length - 1)];
    const sonrakiMetin = sonraki
      ? sonraki.islem === "ban"
        ? "kalıcı ban"
        : sonraki.islem === "timeout"
        ? `${sonraki.sure} dk susturma`
        : "uyarı"
      : "kalıcı ban";

    await yaz(
      puan === 0
        ? `@${hedef} temiz — ceza puanı yok.`
        : `@${hedef} → ceza puanı: ${puan}. Bir sonraki ihlalde: ${sonrakiMetin}. (Temiz kalırsa ${sifirlamaDk} dk sonra sıfırlanır.)`
    );
    return true;
  }

  // !duyuru <mesaj>
  if (komut === "duyuru") {
    const m = arg.join(" ");
    if (m) await yaz(`📢 ${m}`);
    return true;
  }

  // !yasakekle <kelime> / !yasakcikar <kelime> / !yasaklilar
  if (["yasakekle", "yasakla", "yasak", "kelimeekle"].includes(komut)) {
    const kelime = arg.join(" ").toLocaleLowerCase("tr-TR").trim();
    if (!kelime) {
      await yaz(`Kullanım: ${prefix}yasakekle <kelime>`);
      return true;
    }
    const db = store.get();
    if (db.yasakli_ek.includes(kelime)) {
      await yaz(`"${kelime}" zaten yasaklı listesinde.`);
      return true;
    }
    db.yasakli_ek.push(kelime);
    store.kaydet();
    store.logEkle({ kullanici: "-", sebep: `Yasaklı kelime eklendi: ${kelime}`, islem: "yasakekle", yetkili: sender.username });
    await yaz(`✅ "${kelime}" yasaklı kelimelere eklendi. (Toplam: ${db.yasakli_ek.length})`);
    return true;
  }

  if (["yasakcikar", "yasakkaldir", "kelimecikar"].includes(komut)) {
    const kelime = arg.join(" ").toLocaleLowerCase("tr-TR").trim();
    if (!kelime) {
      await yaz(`Kullanım: ${prefix}yasakcikar <kelime>`);
      return true;
    }
    const db = store.get();
    if (!db.yasakli_ek.includes(kelime)) {
      await yaz(`"${kelime}" listede yok. (Not: config.json'daki sabit kelimeler bu komutla silinemez.)`);
      return true;
    }
    db.yasakli_ek = db.yasakli_ek.filter((k) => k !== kelime);
    store.kaydet();
    store.logEkle({ kullanici: "-", sebep: `Yasaklı kelime çıkarıldı: ${kelime}`, islem: "yasakcikar", yetkili: sender.username });
    await yaz(`✅ "${kelime}" yasaklı kelimelerden çıkarıldı.`);
    return true;
  }

  if (["yasaklilar", "yasakliste", "yasaklar"].includes(komut)) {
    const liste = store.get().yasakli_ek;
    await yaz(
      liste.length
        ? `Sohbetten eklenen yasaklı kelimeler (${liste.length}): ${liste.join(", ")}`.slice(0, 490)
        : "Sohbetten eklenmiş yasaklı kelime yok."
    );
    return true;
  }

  // !cekilis basla <anahtar> | cek | iptal | durum
  if (["cekilis", "çekiliş", "cekilis", "çekilis", "cekiliş"].includes(komut)) {
    if (!config.cekilis?.aktif) return true;
    const c = cekilisDurum();
    const alt = (arg[0] || "durum").toLocaleLowerCase("tr-TR");

    if (["basla", "başla", "baslat", "başlat", "ac", "aç"].includes(alt)) {
      const anahtar = (arg[1] || "!katil").toLocaleLowerCase("tr-TR");
      c.aktif = true;
      c.anahtar = anahtar;
      c.katilimcilar = {};
      c.kazanan = null;
      store.kaydet();
      await yaz(`🎉 ÇEKİLİŞ BAŞLADI! Katılmak için sohbete "${anahtar}" yaz.`);
      return true;
    }

    if (["cek", "çek", "bitir", "sonuc", "sonuç", "kazanan"].includes(alt)) {
      const isimler = Object.keys(c.katilimcilar || {});
      if (isimler.length === 0) {
        await yaz(
          c.aktif
            ? `Henüz kimse katılmadı. Katılmak için: "${c.anahtar}"`
            : "Aktif çekiliş yok. Başlatmak için: !cekilis basla <kelime>"
        );
        return true;
      }
      const kazanan = isimler[Math.floor(Math.random() * isimler.length)];
      c.kazanan = kazanan;
      c.aktif = false;
      store.kaydet();
      await yaz(`🏆 KAZANAN: @${kazanan}! (${isimler.length} katılımcı arasından) Tebrikler!`);
      return true;
    }

    if (["iptal", "kapat", "sil"].includes(alt)) {
      c.aktif = false;
      c.katilimcilar = {};
      store.kaydet();
      await yaz("Çekiliş iptal edildi.");
      return true;
    }

    await yaz(
      c.aktif
        ? `Çekiliş aktif. Katılmak için: "${c.anahtar}" — Katılımcı: ${cekilisKatilimciSayisi()}`
        : "Şu an aktif çekiliş yok. Başlatmak için: !cekilis basla <kelime>"
    );
    return true;
  }

  return false;
}

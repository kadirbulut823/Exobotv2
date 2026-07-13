// Komutlar: genel komutlar, moderator komutlari, cekilis ve puan sistemi
import * as kick from "./kickApi.js";
import * as store from "./store.js";
import { moderatorMu, cezaPuaniSifirla } from "./moderation.js";

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
    const ozel = Object.keys(config.komutlar || {}).map((k) => prefix + k);
    const sabit = [prefix + "puan", prefix + "top"];
    let cevap = `Komutlar: ${[...sabit, ...ozel].join(" | ")}`;
    if (moderatorMu(sender, broadcaster)) {
      cevap += ` || MOD: ${prefix}to ${prefix}ban ${prefix}unban ${prefix}af ${prefix}duyuru ${prefix}yasakekle ${prefix}yasakcikar ${prefix}yasaklilar ${prefix}cekilis`;
    }
    await yaz(cevap.slice(0, 490));
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
  if (config.komutlar && config.komutlar[komut]) {
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

  // !af <kullanici>  -> ceza puanlarini sifirla
  if (komut === "af") {
    const hedef = (arg[0] || "").replace("@", "").toLowerCase();
    cezaPuaniSifirla(hedef);
    await yaz(`@${hedef} ceza puanları sıfırlandı.`);
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

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
export const cekilis = {
  aktif: false,
  anahtar: "",
  katilimcilar: new Map(), // username -> user_id
  kazanan: null,
};

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
  if (cekilis.aktif && metin.toLocaleLowerCase("tr-TR") === cekilis.anahtar) {
    if (!cekilis.katilimcilar.has(sender.username.toLowerCase())) {
      cekilis.katilimcilar.set(sender.username.toLowerCase(), sender.user_id);
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
    await yaz(`Komutlar: ${[...sabit, ...ozel].join(" | ")}`);
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

  // !yasakla <kelime> / !yasakkaldir <kelime>
  if (komut === "yasakla") {
    const kelime = arg.join(" ").toLowerCase();
    if (!kelime) return true;
    const db = store.get();
    if (!db.yasakli_ek.includes(kelime)) db.yasakli_ek.push(kelime);
    store.kaydet();
    await yaz(`"${kelime}" yasaklı kelimelere eklendi.`);
    return true;
  }

  if (komut === "yasakkaldir") {
    const kelime = arg.join(" ").toLowerCase();
    const db = store.get();
    db.yasakli_ek = db.yasakli_ek.filter((k) => k !== kelime);
    store.kaydet();
    await yaz(`"${kelime}" yasaklı kelimelerden çıkarıldı.`);
    return true;
  }

  // !cekilis basla <anahtar> | cek | iptal | durum
  if (komut === "cekilis" || komut === "çekiliş") {
    if (!config.cekilis?.aktif) return true;
    const alt = (arg[0] || "durum").toLocaleLowerCase("tr-TR");

    if (alt === "basla" || alt === "başla") {
      const anahtar = (arg[1] || "!katil").toLocaleLowerCase("tr-TR");
      cekilis.aktif = true;
      cekilis.anahtar = anahtar;
      cekilis.katilimcilar = new Map();
      cekilis.kazanan = null;
      await yaz(`🎉 ÇEKİLİŞ BAŞLADI! Katılmak için sohbete "${anahtar}" yaz.`);
      return true;
    }

    if (alt === "cek" || alt === "çek") {
      if (!cekilis.aktif || cekilis.katilimcilar.size === 0) {
        await yaz("Aktif çekiliş yok veya hiç katılımcı yok.");
        return true;
      }
      const isimler = [...cekilis.katilimcilar.keys()];
      const kazanan = isimler[Math.floor(Math.random() * isimler.length)];
      cekilis.kazanan = kazanan;
      cekilis.aktif = false;
      await yaz(`🏆 KAZANAN: @${kazanan}! (${isimler.length} katılımcı arasından) Tebrikler!`);
      return true;
    }

    if (alt === "iptal") {
      cekilis.aktif = false;
      cekilis.katilimcilar = new Map();
      await yaz("Çekiliş iptal edildi.");
      return true;
    }

    await yaz(
      cekilis.aktif
        ? `Çekiliş aktif. Katılmak için: "${cekilis.anahtar}" — Katılımcı: ${cekilis.katilimcilar.size}`
        : "Şu an aktif çekiliş yok."
    );
    return true;
  }

  return false;
}

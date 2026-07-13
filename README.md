# 🤖 Kick Moderasyon Botu

Kick'in **resmî Public API'siyle** çalışan moderasyon + etkinlik botu.

**Yapabildikleri**
- Küfür, hakaret, yasaklı kelime yakalama (a.m.k, 4mk, aaaammkkk gibi kaçamak yazımları da yakalar)
- İzinsiz link/reklam silme (izinli site listesi var)
- Büyük harf spam, emote spam, karakter spam, flood, aynı mesaj tekrarı
- **Kademeli ceza**: 1. ihlal → mesaj sil + uyar, 2. → 5 dk susturma, 3. → 1 saat, 4. → 1 gün, 5. → kalıcı ban
- Yayıncı/moderatör/VIP/abone muafiyeti
- Mod komutları: `!to`, `!ban`, `!unban`, `!af`, `!duyuru`, `!yasakla`
- **Çekiliş sistemi**: `!cekilis basla <kelime>` → `!cekilis cek`
- Otomatik zamanlı mesajlar (her X dakikada bir duyuru)
- Yeni takipçi / abone karşılama mesajı
- Puan sistemi + `!top` sıralaması
- Web paneli: son moderasyon işlemleri + puan tablosu

---

## ⚠️ Önce bunu bil

Kick'te moderasyon yapabilmek için botun kanalda **moderatör olması** gerekiyor. Yani:

1. Kick'te bota özel yeni bir hesap aç (örn. `kanaladi_bot`) — kendi hesabınla da yapabilirsin ama önerilmez.
2. **Yayıncıdan** o hesabı kanala moderatör yapmasını iste (`dashboard.kick.com` → Community → Moderators).
3. Botu o hesapla yetkilendireceksin (aşağıdaki 4. adım).

Ayrıca sohbeti dinlemek için Kick **webhook** kullanıyor — yani botun **internetten erişilebilir bir adresi** olmalı. Bu yüzden bilgisayarında değil, ücretsiz bir sunucuda (Railway) çalıştıracağız.

---

## 1) Kick Developer uygulaması oluştur

1. Bot hesabınla Kick'e gir → `kick.com/settings/developer`
2. **Create App** de. İsim ver.
3. **Redirect URL** kısmına şimdilik şunu yaz: `http://localhost:3000/auth/callback` (sunucuya taşıyınca güncelleyeceğiz)
4. **Client ID** ve **Client Secret**'ı bir yere kopyala. Secret'ı kimseyle paylaşma, ekran görüntüsüne alma.

---

## 2) Dosyaları hazırla

Bilgisayarında bir klasör aç, bu dosyaları içine koy. Sonra:

1. [nodejs.org](https://nodejs.org) → **LTS** sürümünü indir, kur.
2. Klasörde terminal aç (klasöre sağ tık → "Terminalde aç") ve şunu yaz:

```bash
npm install
```

3. `.env.example` dosyasının adını **`.env`** yap ve içini doldur:

```
KICK_CLIENT_ID=uygulamadan_aldigin_id
KICK_CLIENT_SECRET=uygulamadan_aldigin_secret
KICK_REDIRECT_URI=http://localhost:3000/auth/callback
PANEL_KEY=kendine-gizli-bir-sifre
PORT=3000
```

4. `config.json` dosyasını aç, en üstteki **`"slug"`** kısmına kanal adını yaz:
```json
"kanal": { "slug": "moderatoru-oldugun-kanal" }
```
(`kick.com/xqc` → slug `xqc`)

---

## 3) Sunucuya yükle (Railway — ücretsiz başlangıç)

Bot 7/24 çalışmalı ve Kick'in ona ulaşabileceği bir adresi olmalı.

1. Kodu GitHub'a yükle (yeni repo → dosyaları sürükle-bırak). **`.env` dosyasını yükleme!**
2. [railway.app](https://railway.app) → GitHub ile giriş → **New Project → Deploy from GitHub repo**
3. Proje açılınca **Variables** sekmesine `.env` içindeki 4 değeri tek tek ekle.
4. **Settings → Networking → Generate Domain** de. Sana şuna benzer bir adres verir:
   `https://kickbot-production-xxxx.up.railway.app`
5. Bu adresi iki yere yaz:
   - Railway → Variables → `KICK_REDIRECT_URI` = `https://SENIN-ADRESIN/auth/callback`
   - Kick Developer sayfası → uygulamanın **Redirect URL**'i = aynı adres
   - Kick Developer sayfası → **Webhook URL** = `https://SENIN-ADRESIN/webhook`  ← bunu unutma!

---

## 4) Botu yetkilendir (tek seferlik)

Tarayıcıdan `https://SENIN-ADRESIN/` adresine git → **"Kick ile giriş yap"** butonuna bas.
**Bot hesabıyla giriş yapmayı unutma.** İzinleri onayla.

"✅ Giriş başarılı" görüyorsan bot çalışıyor demektir. Sohbete `!komutlar` yaz, cevap veriyorsa tamam.

Panel: `https://SENIN-ADRESIN/panel?key=PANEL_KEY_ne_yazdıysan`

---

## 5) Botu kendine göre ayarla

Her şey **`config.json`** içinde, kod bilmene gerek yok:

| Ne | Nerede |
|---|---|
| Küfür listesi | `filtreler.kufur.kelimeler` |
| Reklam/yasaklı kelime | `filtreler.yasakli_kelimeler.kelimeler` |
| İzinli linkler | `filtreler.link.izinli_alan_adlari` |
| Ceza sırası ve süreleri | `cezalar.adimlar` |
| Kimlere dokunmasın | `bagisiklik` |
| `!discord` gibi komutlar | `komutlar` |
| Otomatik duyurular | `otomatik_mesajlar` |

Değiştirdikten sonra GitHub'a push et → Railway otomatik yeniden başlatır.

---

## Komutlar

**Herkes:** `!komutlar` `!puan` `!top` + config'e eklediklerin (`!discord`, `!kurallar`…)

**Sadece moderatörler:**
| Komut | Ne yapar |
|---|---|
| `!to kullanici 10 sebep` | 10 dakika susturur |
| `!ban kullanici sebep` | Kalıcı ban |
| `!unban kullanici` | Banı kaldırır |
| `!af kullanici` | Ceza puanlarını sıfırlar |
| `!duyuru mesaj` | Sohbete duyuru yazar |
| `!yasakla kelime` | Anında yasaklı kelime ekler |
| `!cekilis basla katil` | Çekiliş başlatır, herkes "katil" yazarak katılır |
| `!cekilis cek` | Kazananı çeker |
| `!cekilis iptal` | İptal eder |

> `!ban` / `!to` sadece o yayında **en az bir kez yazmış** kullanıcılarda çalışır (Kick API kullanıcı adından ID vermiyor, ID'yi sohbetten öğreniyoruz).

---

## Sorun giderme

| Sorun | Sebep |
|---|---|
| Mesajlar silinmiyor / ban atılamıyor | Bot hesabı kanalda **moderatör değil** |
| Sohbet olayı hiç gelmiyor | Kick Developer sayfasında **Webhook URL** ayarlanmamış, ya da adres yanlış |
| `invalid signature` logu | Webhook URL doğru ama gövde bozulmuş — Railway'de proxy ayarı bozuksa olur, nadirdir |
| 401 hatası | Token süresi dolmuş; bot otomatik yeniler, olmazsa `/auth`'tan tekrar giriş yap |
| 403 "Request blocked by security policy" | Kick tarafında Cloudflare kaynaklı bilinen bir sorun; birkaç dakika sonra tekrar dene |

**Not:** Railway'in dosya sistemi kalıcı değil. Puanlar ve token, yeniden dağıtımda sıfırlanabilir. Kalıcı olsun istersen Railway'de **Volume** ekleyip `/app/data` klasörüne bağla.

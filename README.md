# WC2026 Predictor - varianta online cu Supabase

Această versiune păstrează designul ultimei variante, dar poate salva online:
- useri;
- emailuri;
- pronosticuri;
- scoruri introduse de admin;
- clasament comun pentru toți participanții.

## 1. Creează proiectul Supabase

1. Intră pe https://supabase.com
2. Creează un proiect nou.
3. Intră în SQL Editor.
4. Deschide fișierul `supabase-schema.sql` din acest pachet.
5. Înlocuiește textul `ADMIN_PIN_DEFAULT` cu un PIN ales de tine, de exemplu `123456`.
6. Rulează tot scriptul.

## 2. Configurează cheile în aplicație

În Supabase mergi la:
Project Settings → API

Copiază:
- Project URL
- anon public key

Apoi deschide fișierul `config.js` și completează:

```js
window.SUPABASE_CONFIG = {
  url: 'https://proiectul-tau.supabase.co',
  anonKey: 'cheia-ta-anon-publica'
};
```

## 3. Publică pe Netlify

Urcă toate fișierele din arhivă pe Netlify.

Dacă `config.js` nu este completat, aplicația merge în continuare în mod local, exact ca înainte.
Dacă `config.js` este completat corect, aplicația trece în mod online.

## 4. Login admin

Admin:
- Nume: `admin`
- Email: `admin@gmail.com`
- PIN: PIN-ul pus în `supabase-schema.sql`

Adminul poate:
- introduce scoruri reale;
- șterge useri;
- vedea emailurile userilor în clasament.

Adminul nu apare în clasament.

## Observație de securitate

Această variantă este potrivită pentru MVP / prieteni / colegi. Pentru securitate completă, următorul pas este Supabase Auth cu login real pe email/parolă.

## Emailuri zilnice prin Resend + Netlify Functions

Această versiune include o secțiune nouă vizibilă doar adminului: **Admin emailuri**.

Pași necesari pentru trimitere reală:

1. În Supabase → SQL Editor rulează fișierul `supabase-email-schema.sql`.
2. În Resend creează un API key.
3. În Netlify → Site configuration / Environment variables adaugă variabilele:
   - `RESEND_API_KEY` = cheia Resend
   - `RESEND_FROM` = expeditorul, de exemplu `Cupa Mondială Predictor <onboarding@resend.dev>` sau un email de pe domeniul tău verificat
   - `SUPABASE_URL` = URL-ul proiectului Supabase, fără `/rest/v1`
   - `SUPABASE_ANON_KEY` = cheia `sb_publishable_...`
4. Fă redeploy după ce setezi variabilele.
5. Intră ca admin → **Admin emailuri** → previzualizează → trimite.

Notă: pentru producție, Resend recomandă domeniu verificat pentru expeditor.

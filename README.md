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

## Emailuri zilnice prin Brevo + Netlify Functions

Această versiune include o secțiune nouă vizibilă doar adminului: **Admin emailuri**.

Pași necesari pentru trimitere reală:

1. În Supabase → SQL Editor rulează fișierul `supabase-email-schema.sql`.
2. În Brevo creează un API key de tip v3.
3. În Netlify → Site configuration / Environment variables adaugă variabilele:
   - `BREVO_API_KEY` = cheia Brevo
   - `BREVO_FROM_EMAIL` = emailul expeditor verificat în Brevo
   - `BREVO_FROM_NAME` = numele expeditorului, de exemplu `Cupa Mondială Predictor`
   - `SUPABASE_URL` = URL-ul proiectului Supabase, fără `/rest/v1`
   - `SUPABASE_ANON_KEY` = cheia `sb_publishable_...`
4. Elimină sau ignoră variabilele vechi `RESEND_API_KEY` și `RESEND_FROM`.
5. Fă redeploy după ce setezi variabilele.
6. Intră ca admin → **Admin emailuri** → previzualizează → trimite.

Notă: dacă Brevo cere verificarea expeditorului, verifică emailul sau domeniul din dashboard-ul Brevo înainte de test.

## Emailuri automate zilnice

Această versiune include funcția Netlify programată `scheduled-daily-emails`.

- Netlify rulează cron-ul în UTC.
- Cron-ul este setat la `0 1 * * *`, adică 01:00 UTC.
- În iunie/iulie 2026, România este UTC+3, deci funcția rulează la 04:00 ora României.
- Funcția trimite raportul pentru ziua competițională anterioară, pe baza câmpului `romaniaDate` din `matches.js`.
- De exemplu, pe 15.06.2026 la 04:00 trimite emailuri pentru meciurile cu `romaniaDate = 2026-06-14`, chiar dacă un meci început pe 14.06 se termină după miezul nopții.
- Funcția trimite rapoarte utile pentru datele de meci 2026-06-11 până la 2026-07-19. Asta înseamnă rulări utile între 2026-06-12 și 2026-07-20, pentru a include și finala din 19 iulie.

Înainte de deploy, rulează în Supabase fișierul:

`supabase-email-scheduled-schema.sql`

Acesta adaugă protecție anti-dublare pentru emailurile zilnice.

## Test manual pentru automatizarea emailurilor

Am adăugat în secțiunea **Admin emailuri** un buton:

`Testează automatizarea pentru data selectată`

Acesta apelează funcția `scheduled-daily-emails` cu data aleasă în interfață și trimite emailuri reale către userii eligibili. Logurile sunt salvate cu `report_type = daily-test`, astfel încât testul nu blochează trimiterea automată oficială (`report_type = daily`).

Flux recomandat:
1. Setează scoruri reale pentru una sau mai multe meciuri.
2. Alege data meciurilor în Admin emailuri.
3. Apasă `Testează automatizarea pentru data selectată`.
4. Verifică inboxurile și tabela `wc2026_email_logs` din Supabase.


## Hotfix test scheduler
Funcția scheduled-email-test-runner verifică testele one-time la fiecare minut (`* * * * *`), pentru ca testele programate din Admin emailuri să pornească mai rapid. Netlify poate avea totuși o mică întârziere de execuție.


## Daily automation test window

The real scheduled function `scheduled-daily-emails` is configured to run daily at `01:00 UTC`, which is 04:00 in Romania during June/July 2026.

For testing, the allowed report window now starts with report date `2026-06-10`, so the automatic run on `2026-06-11 04:00 Romania time` can send the "no matches/results" informational email for `10.06.2026`.

The final useful automatic run remains `2026-07-20 04:00 Romania time`, which sends the report for `19.07.2026`.

## Lucky Strike

Pentru noua secțiune Lucky Strike, rulează în Supabase SQL Editor fișierul:

```text
supabase-lucky-strike-schema.sql
```

Fiecare user poate salva o singură echipă. Selecția se blochează cu 2 ore înainte de startul meciului #24. Dacă echipa aleasă câștigă finala, userul primește +25p și medalie Lucky Strike în clasament.

## API-Football test

Pentru testarea conexiunii cu API-Football, setează în Netlify Environment variables:

- `FOOTBALL_API_KEY` – cheia din API-Sports / API-Football

Apoi intră ca admin în aplicație → `Admin API` → `Testează API-Football`.

# xmas-gifts 🎄

Vánoční rozloučení: animovaný stromek s dárky, parolem, sněhem, hudbou a konfetami.
Každý kolega pod stromkem najde **svůj dárek s vlastním jménem a osobní zprávou**, plus 4 společné dárky
a skrytou zlatou hvězdu na špičce (odemkne se, když otevře všechno).

- **Hudba**: krátká "Jingle Bells" (public domain) syntetizovaná přímo v prohlížeči přes Web Audio API, žádné MP3 ani autorská práva. Spustí ji úvodní tlačítko (prohlížeče jinak autoplay blokují); vpravo nahoře je vypínač.
- **Personalizace**: server čte e-mail přihlášeného z hlavičky `X-Forwarded-Email`, kterou Databricks Apps přidávají každému požadavku. Osobní zpráva se vrací jen vlastníkovi, a až po otevření dárku (není v HTML ani v `/api/state`).
- **Dva režimy identifikace** (proměnná `AUTH_MODE`):
  - `header` (výchozí, Databricks): e-mail z SSO hlavičky, nejde podvrhnout.
  - `email` (Render a jiné běžné hostingy): člověk na první obrazovce zadá pracovní e-mail. Není to skutečné přihlášení, zprávu chrání jen znalost e-mailu. `ALLOWED_EMAIL_DOMAINS` omezí, kdo se smí ptát.
- **Expirace**: po `EXPIRES_AT` (výchozí `2027-01-01T00:00:00+08:00`, tedy konec 31. 12. 2026 v Manile) ukáže app závěrečnou hlášku místo stromku a `/api/gift` vrací 410.
- **Bez externích závislostí v prohlížeči** (žádné CDN, fonty ani obrázky), takže funguje i za VPN/firewallem.

## Úprava obsahu

Všechno je v `messages.json`:

| klíč | co to je |
|---|---|
| `people` | osobní zprávy, klíč = **pracovní e-mail malými písmeny** přesně tak, jak ho hlásí SSO |
| `default` | zpráva pro kohokoli, kdo v `people` není (`{name}` se doplní z e-mailu, `jana.nova@…` → "Jana") |
| `gifts` | 4 společné dárky (ikona, nadpis, text) |
| `star` | odměna za otevření všech dárků |
| `closing` | hláška po expiraci |

Zalomení řádků ve zprávách je `\n`. **Repo drž privátní**, zprávy jsou v něm jako prostý text.

## Spuštění lokálně

```bash
pip install -r requirements.txt
XMAS_DEV=1 python app.py          # http://localhost:8000/?as=maria.santos@example.com
python -m unittest discover -s tests
```

`?as=<e-mail>` funguje **jen** při `XMAS_DEV=1` (lokální testování). Na Databricks tuhle proměnnou nenastavuj.

## Nasazení na Databricks Apps

1. Vyplň `messages.json` skutečnými e-maily a zprávami.
2. Vytvoř app a nahraj kód (ověř si přesné příkazy v aktuální dokumentaci Databricks CLI):
   ```bash
   databricks apps create xmas-gifts
   databricks sync . /Workspace/Users/<ty>/xmas-gifts
   databricks apps deploy xmas-gifts --source-code-path /Workspace/Users/<ty>/xmas-gifts
   ```
   `app.yaml` spouští `python app.py`, `requirements.txt` se nainstaluje sám, port se bere z `DATABRICKS_APP_PORT`.
3. V nastavení app dej oprávnění **Can use** skupině (nebo lidem), kteří mají zprávu dostat.

## Nasazení na Render (mimo Databricks)

Web service z tohoto repa: runtime Python, region Singapore (nejblíž Manile), plán Starter ($7/měs, nespí).

| nastavení | hodnota |
|---|---|
| Build command | `pip install -r requirements.txt` |
| Start command | `python app.py` (port si vezme z `PORT`) |
| Health check path | `/healthz` |
| `AUTH_MODE` | `email` |
| `ALLOWED_EMAIL_DOMAINS` | doména firmy, např. `firma.com` (více domén čárkou) |
| `EXPIRES_AT` | volitelně, výchozí `2027-01-01T00:00:00+08:00` |
| `RATE_LIMIT_PER_MIN` | volitelně, výchozí 300 požadavků/min na IP |

Auto-deploy je zapnutý: každý push do `main` nasadí novou verzi, takže zprávy se upravují commitem `messages.json`.
Po 31. 12. službu na Renderu smaž nebo suspendni, ať se dál neplatí.

## Env proměnné (shrnutí)

`AUTH_MODE` (`header`/`email`), `ALLOWED_EMAIL_DOMAINS`, `EXPIRES_AT`, `RATE_LIMIT_PER_MIN`, `XMAS_DEV` (jen lokálně, **nikdy v produkci**).

## Checklist před odesláním (~10. 12.)

- [ ] Otevřít app z účtu někoho jiného než admina, jednou s VPN a jednou bez ní.
- [ ] Zkontrolovat, že se jméno a zpráva načtou podle e-mailu a nikdo nevidí zprávu někoho jiného.
- [ ] Zjistit u IT, jestli se ti účet nedeaktivuje dřív než 31. 12. (app by přestala fungovat); případně ji pustit pod service principal.
- [ ] Ověřit, že mají všichni příjemci přístup do workspace (jinak neotevřou).
- [ ] Schválit s adminem/šéfem použití firemního compute.
- [ ] Do mailu napsat, že dárky jsou k vyzvednutí do konce roku.

## Frontend (3D)

Scéna je Three.js (bloom, shadery pro sníh a světýlka), animace gsap, konfety canvas-confetti.
Zdroj je v `src/`, do `static/app.js` se bundluje příkazem `npm install && npm run build`
(`static/app.js` je commitnutý, takže Render nic stavět nemusí).

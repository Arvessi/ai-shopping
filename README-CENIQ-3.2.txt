CENIQ 3.2 — Query Catalog + Inline Offers

GALVENĀS IZMAIŅAS
- Search vairs negaida, lai background crawler iepriekš būtu aizpildījis CrawlPage tabulu.
- Konkrēts meklējums (piem. iPhone 16) pats mēģina atrast atbilstošas produktu lapas vairākos konfigurētajos LV veikalos.
- 26 veikalu registry paliek; K-Senukai nav dublēts ar 1a.lv.
- Store search lapas + sitemap fallback + robots.txt noteikumi.
- Crawler rezultāti tiek saglabāti CENIQ katalogā un nākamie meklējumi kļūst lētāki/ātrāki.
- Search vispirms izmanto CENIQ katalogu.
- DataForSEO ir tikai fallback, un no tā tiek pieņemti tikai konfigurētie merchant domēni.
- gsmarena.com un citi random review/spec domēni vairs netiek pieņemti kā veikalu piedāvājumi.
- Search cache ir versionēts (v32), tāpēc vecie sliktie cache rezultāti netiek atkārtoti lietoti.
- Produkta family kartītē uzreiz redzams Top 3 veikalu piedāvājums.
- Ja ir vairāk par 3: "Rādīt visus N piedāvājumus".
- Storage / color / RAM / connectivity / size / condition varianti ir pārslēdzami jau search lapā.
- Ja query satur 128GB / krāsu utt., CENIQ mēģina šo variantu izvēlēties pēc noklusējuma.
- Variantam mainoties, mainās cena, veikalu saraksts un bilde, ja konkrētajam variantam ir sava bilde.
- Impossible variant combo vairs nerāda citu variantu offerus kā fallback.
- CENIQ score tiek rādīts tikai tad, ja konkrētam variantam ir vismaz 2 salīdzināmi veikali.
- Monthly/installment/deposit teksta filtrs saglabāts.
- Papildus: ja vienas family cenas ir ekstrēmi nesaderīgas, aizdomīgi zemais offeris tiek atmests arī tad, ja sākotnējā SERP grupēšana to nepamanīja.
- Search relevance stiprāk prioritizē precīzu modeli un nomāc accessory / Pro / Plus / Ultra rezultātus, ja tie nav prasīti.
- CENIQ AI bez Gemini vairs nesūta pilnu cilvēka teikumu kā dead search query; tam ir lokāls planneris.
- Ja GEMINI_API_KEY ir pievienots, Gemini planneris paliek kā papildu uzlabojums.
- Drošības filtram pievienoti arī biežākie latviešu restricted-product termini.

LATENCY / COST
- Query crawler pēc noklusējuma mēģina līdz 10 veikaliem paralēli.
- Vienā veikalā paņem ne vairāk kā 3 query-relevant produktu lapas.
- Ja CENIQ katalogā jau ir Top 3 coverage, DataForSEO fallback vairs nav vajadzīgs šim searcham.
- Crawler rezultāti paliek katalogā.

INSTALL
Codespaces repo root:

unzip -o CENIQ-3.2-query-catalog.zip
rm CENIQ-3.2-query-catalog.zip

npm run build

Šai versijai nav Prisma schema izmaiņu, tāpēc db:push nav nepieciešams.

TIKAI JA BUILD IR CLEAN:

git add .
git commit -m "Upgrade CENIQ query crawler and inline offers"
git push

PĒC VERCEL READY TESTĒ ŠĀDĀ SECĪBĀ
1. iPhone 16
2. iPhone 16 128GB
3. Samsung Galaxy S25
4. kādu konkrētu laptop/monitor modeli

KO GAIDĪT
- Nav GSM Arena.
- Viena īstā product family, nevis katrs veikals kā atsevišķs produkts.
- TAČU veikali NAV paslēpti: Top 3 ir redzami uzreiz family kartītē.
- Ja vairāk: "Rādīt visus N".
- Ja katalogs atradis vairākas krāsas/storage, tās ir pogas uz pašas search kartītes.
- 128GB query pēc noklusējuma izvēlas 128GB, ja tas ir atrasts.
- Score nav, kamēr nav vismaz 2 veikalu vienam konkrētam variantam.
- /api/catalog/crawl/status pēc reāliem searchiem jāsāk rādīt non-zero pages/products/catalogOffers.

SVARĪGI
26 konfigurēti veikali nenozīmē, ka visi 26 vienmēr būs pieejami katram produktam. Daļa veikalu var bloķēt crawlerus, daļai var nebūt server-rendered structured product data, un daļa konkrēto produktu netirgo. CENIQ neapiet bloķēšanu. 3.2 mērķis ir izmantot publiski pieejamos veikalus automātiski un saglabāt to, ko var droši nolasīt.

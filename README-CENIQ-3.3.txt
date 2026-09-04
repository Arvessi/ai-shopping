CENIQ 3.3 — crawler hotfix + realistic score

GALVENĀ ATRASTĀ KĻŪDA
3.2 query crawler atlasīja tikai crawlSource ierakstus ar robotsAllowed != false.
PostgreSQL/Prisma gadījumā robotsAllowed = null šajā filtrā neiekļuva.
Rezultāts: no 26 veikaliem praktiski tika mēģināts tikai tas, kuram robots jau bija true (220.lv).
Tāpēc statusā bija:
- tikai 220 ar lastRunAt
- catalogFamilies / catalogVariants / catalogOffers = 0
- search atkal nokrita uz DataForSEO fallback (Bite/Tet)
- līdz ar to nebija normālu variantu filtru

3.3 IZMAIŅAS
1. Query crawler tagad mēģina arī robotsAllowed = null veikalus.
   robots.txt tiek pārbaudīts pašā crawl laikā.
2. Vienā search tiek mēģināti līdz 16 veikaliem (pool joprojām ir 26).
3. Līdz 4 kandidātu lapām uz veikalu.
4. Ja sākumā atrod category/search lapu, CENIQ tajā pašā requestā seko līdz 3 svaigi atrastām product lapām.
5. Plašāks product parser:
   - JSON-LD joprojām prioritāte
   - meta product price / og:type product
   - drošs HTML price fallback produktam līdzīgās URL
   - H1 fallback nosaukumam
   - data-price / data-sku / data-ean fallback
6. Category/search lapas netiek automātiski pārvērstas par fake produktu tikai tāpēc, ka tajās ir cena.
7. Crawler daily cycle tagad seed/crawl līdz 8 veikaliem, nevis 4.
8. Search cache bump uz v33, lai vecie 3.2 Bite/Tet rezultāti nepaliek.
9. CENIQ score formula pārtaisīta gan catalog, gan DataForSEO fallback:
   €879 pret €889 vairs nedrīkst būt 90 vs 55.
   Cenas tiek vērtētas pēc relatīvas novirzes no tirgus reference, nevis min/max skalas.
10. /api/catalog/crawl/status tagad katram veikalam rāda:
    pages, productPages, pending, done, blocked, errors
    + lastError kļūst daudz informatīvāks.

KĀ UZLIKT
Codespaces repo root:

unzip -o CENIQ-3.3-crawler-fix.zip
rm CENIQ-3.3-crawler-fix.zip

npm run build

Šajā update NAV Prisma schema izmaiņu, tāpēc db:push nav vajadzīgs.

JA BUILD CLEAN:

git add .
git commit -m "Fix CENIQ crawler coverage and scoring"
git push

PĒC VERCEL READY
1. Meklē: iPhone 16
2. Meklē: iPhone 16 128GB
3. Meklē: Samsung Galaxy S25
4. Meklē: ASUS TUF Gaming A15
5. Tad atver /api/catalog/crawl/status

KO SKATĪTIES STATUSĀ
Svarīgākais nav pending skaits.
Skaties:
- vairākiem veikaliem jāparādās lastRunAt
- robotsAllowed jāmainās no null uz true/false
- vismaz dažiem veikaliem productPages > 0
- catalogFamilies / catalogVariants / catalogOffers jāsāk augt

JA catalogFamilies joprojām ir 0:
atsūti visu /api/catalog/crawl/status JSON.
3.3 tagad katram veikalam iedos konkrētāku lastError, tāpēc nākamo store-specific adapteri varēs taisīt pēc fakta, nevis minēt.

SVARĪGI PAR FILTRIEM
Search kartītē storage/color/RAM filtri 3.2 UI jau bija.
Tie netika rādīti, jo catalogVariants bija 0.
3.3 galvenais uzdevums ir beidzot iebarot šiem filtriem īstus variantu datus.

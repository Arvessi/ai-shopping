CENIQ 2.1 PRODUCT ENGINE

Changes:
- generic product variants: storage / RAM / color / connectivity / size
- generic monthly-payment / installment / deposit filtering
- stronger same-product grouping
- CENIQ score is hidden until there are at least 2 comparable stores
- score changes strongly with relative price
- product page searches Merchant Products -> Sellers for more stores
- Top 3 offers + show all
- variant switching
- neutral availability text instead of fake shipping data
- image fallback from merchant og:image when DataForSEO has no image
- DataForSEO seller/product tasks use normal priority
- Gemini free-tier support
- without Gemini, CENIQ Verdict still works using local rules

INSTALL FROM CODESPACE ROOT:

unzip -o CENIQ-2.1-product-engine.zip
rm CENIQ-2.1-product-engine.zip

npm run db:push
npm run build

ONLY IF BUILD IS CLEAN:

git add .
git commit -m "Upgrade CENIQ product engine and variants"
git push

OPTIONAL GEMINI:
GEMINI_API_KEY=<your key>
GEMINI_MODEL=gemini-2.5-flash

Do not paste your API key into chat.

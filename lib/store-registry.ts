export type StoreSeed = {
  slug: string;
  name: string;
  origin: string;
  domain: string;
  priority: number;
  crawlDelayMs?: number;
  enabled?: boolean;
  notes?: string;
  searchTemplates?: string[];
};

function commonSearch(origin: string) {
  return [
    `${origin}/search?q={q}`,
    `${origin}/search?query={q}`,
    `${origin}/meklet?q={q}`,
  ];
}

// Canonical Latvia merchant allowlist used by CENIQ ingest/search.
// Keep this LV-native only. Baltic/EU candidates stay outside this list until
// delivery to Latvia and landed-price handling are explicitly verified.
export const LATVIA_ELECTRONICS_STORES: StoreSeed[] = [
  { slug: '220', name: '220.lv', origin: 'https://220.lv', domain: '220.lv', priority: 100, crawlDelayMs: 900, searchTemplates: ['https://220.lv/lv/search?q={q}'] },
  { slug: '1a', name: '1a.lv', origin: 'https://www.1a.lv', domain: '1a.lv', priority: 99, crawlDelayMs: 900, searchTemplates: commonSearch('https://www.1a.lv') },
  { slug: 'rd', name: 'RD Electronics', origin: 'https://www.rdveikals.lv', domain: 'rdveikals.lv', priority: 98, crawlDelayMs: 800, searchTemplates: ['https://www.rdveikals.lv/search/lv/word/{plus}/page/1/filters/0_0_0/'] },
  { slug: 'euronics', name: 'Euronics', origin: 'https://www.euronics.lv', domain: 'euronics.lv', priority: 97, crawlDelayMs: 850, searchTemplates: commonSearch('https://www.euronics.lv') },
  { slug: 'tet', name: 'Tet', origin: 'https://www.tet.lv', domain: 'tet.lv', priority: 96, crawlDelayMs: 950, searchTemplates: commonSearch('https://www.tet.lv') },
  { slug: 'dateks', name: 'Dateks', origin: 'https://www.dateks.lv', domain: 'dateks.lv', priority: 95, crawlDelayMs: 750, searchTemplates: commonSearch('https://www.dateks.lv') },
  { slug: 'm79', name: 'M79', origin: 'https://m79.lv', domain: 'm79.lv', priority: 94, crawlDelayMs: 850, searchTemplates: commonSearch('https://m79.lv') },
  { slug: 'aio', name: 'AiO', origin: 'https://aio.lv', domain: 'aio.lv', priority: 93, crawlDelayMs: 850, searchTemplates: commonSearch('https://aio.lv') },
  { slug: 'balticdata', name: 'Baltic Data', origin: 'https://www.balticdata.lv', domain: 'balticdata.lv', priority: 92, crawlDelayMs: 850, searchTemplates: commonSearch('https://www.balticdata.lv') },
  { slug: 'bite', name: 'Bite', origin: 'https://www.bite.lv', domain: 'bite.lv', priority: 91, crawlDelayMs: 950, searchTemplates: commonSearch('https://www.bite.lv') },
  { slug: 'tele2', name: 'Tele2', origin: 'https://www.tele2.lv', domain: 'tele2.lv', priority: 90, crawlDelayMs: 950, searchTemplates: commonSearch('https://www.tele2.lv') },
  { slug: 'lmt', name: 'LMT', origin: 'https://www.lmt.lv', domain: 'lmt.lv', priority: 89, crawlDelayMs: 950, searchTemplates: commonSearch('https://www.lmt.lv') },
  { slug: 'samsung', name: 'Samsung Latvija', origin: 'https://www.samsung.com/lv', domain: 'samsung.com', priority: 88, crawlDelayMs: 1100, searchTemplates: ['https://www.samsung.com/lv/search/?searchvalue={q}'] },
  { slug: 'ideal', name: 'iDeal', origin: 'https://www.ideal.lv', domain: 'ideal.lv', priority: 87, crawlDelayMs: 850, searchTemplates: commonSearch('https://www.ideal.lv') },
  { slug: '707', name: '707.lv', origin: 'https://707.lv', domain: '707.lv', priority: 86, crawlDelayMs: 850, searchTemplates: commonSearch('https://707.lv') },
  { slug: '24', name: '24.lv', origin: 'https://24.lv', domain: '24.lv', priority: 85, crawlDelayMs: 850, searchTemplates: commonSearch('https://24.lv') },
  { slug: 'discover', name: 'Discover.lv', origin: 'https://discover.lv', domain: 'discover.lv', priority: 84, crawlDelayMs: 850, searchTemplates: commonSearch('https://discover.lv') },
  { slug: 'bigbox', name: 'Bigbox.lv', origin: 'https://bigbox.lv', domain: 'bigbox.lv', priority: 83, crawlDelayMs: 850, searchTemplates: commonSearch('https://bigbox.lv') },
  { slug: 'signe', name: 'Signe.lv', origin: 'https://signe.lv', domain: 'signe.lv', priority: 82, crawlDelayMs: 850, searchTemplates: commonSearch('https://signe.lv') },
  { slug: 'dt24', name: 'DT24.lv', origin: 'https://dt24.lv', domain: 'dt24.lv', priority: 81, crawlDelayMs: 850, searchTemplates: commonSearch('https://dt24.lv') },
  { slug: 'zauers', name: 'Zauers.lv', origin: 'https://zauers.lv', domain: 'zauers.lv', priority: 80, crawlDelayMs: 850, searchTemplates: commonSearch('https://zauers.lv') },
  { slug: 'labsveikals', name: 'LabsVeikals.lv', origin: 'https://labsveikals.lv', domain: 'labsveikals.lv', priority: 79, crawlDelayMs: 850, searchTemplates: commonSearch('https://labsveikals.lv') },
  { slug: 'datorlietas', name: 'Datorlietas.lv', origin: 'https://datorlietas.lv', domain: 'datorlietas.lv', priority: 78, crawlDelayMs: 850, searchTemplates: commonSearch('https://datorlietas.lv') },
  { slug: 'semikom', name: 'Semikom.lv', origin: 'https://semikom.lv', domain: 'semikom.lv', priority: 77, crawlDelayMs: 850, searchTemplates: commonSearch('https://semikom.lv') },
  { slug: 'multicom', name: 'Multicom.lv', origin: 'https://multicom.lv', domain: 'multicom.lv', priority: 76, crawlDelayMs: 850, searchTemplates: commonSearch('https://multicom.lv') },
  { slug: 'tera', name: 'Tera.lv', origin: 'https://tera.lv', domain: 'tera.lv', priority: 75, crawlDelayMs: 850, searchTemplates: commonSearch('https://tera.lv') },

  // Broad LV catalogue merchants added for CENIQ v2 universal-shopping coverage.
  { slug: 'cenuklubs', name: 'Cenu Klubs', origin: 'https://www.cenuklubs.lv', domain: 'cenuklubs.lv', priority: 74, crawlDelayMs: 1000, searchTemplates: commonSearch('https://www.cenuklubs.lv') },
  { slug: 'ksenukai', name: 'K-Senukai', origin: 'https://www.ksenukai.lv', domain: 'ksenukai.lv', priority: 73, crawlDelayMs: 1000, searchTemplates: commonSearch('https://www.ksenukai.lv') },
  { slug: 'need', name: 'NEED.lv', origin: 'https://need.lv', domain: 'need.lv', priority: 72, crawlDelayMs: 900, searchTemplates: commonSearch('https://need.lv') },
  { slug: 'dato', name: 'Dato.lv', origin: 'https://dato.lv', domain: 'dato.lv', priority: 71, crawlDelayMs: 900, searchTemplates: commonSearch('https://dato.lv') },
  { slug: 'datorucentrs', name: 'Datoru Centrs', origin: 'https://datorucentrs.lv', domain: 'datorucentrs.lv', priority: 70, crawlDelayMs: 900, searchTemplates: commonSearch('https://datorucentrs.lv') },
  { slug: 'depo', name: 'DEPO Online', origin: 'https://online.depo.lv', domain: 'online.depo.lv', priority: 69, crawlDelayMs: 1100, searchTemplates: commonSearch('https://online.depo.lv') },
  { slug: 'douglas', name: 'Douglas', origin: 'https://www.douglas.lv', domain: 'douglas.lv', priority: 68, crawlDelayMs: 1000, searchTemplates: commonSearch('https://www.douglas.lv') },
  { slug: 'drogas', name: 'Drogas', origin: 'https://www.drogas.lv', domain: 'drogas.lv', priority: 67, crawlDelayMs: 1000, searchTemplates: commonSearch('https://www.drogas.lv') },
  { slug: 'eapavi', name: 'eapavi.lv', origin: 'https://www.eapavi.lv', domain: 'eapavi.lv', priority: 66, crawlDelayMs: 1000, searchTemplates: commonSearch('https://www.eapavi.lv') },
  { slug: 'evelatus', name: 'Evelatus', origin: 'https://evelatus.lv', domain: 'evelatus.lv', priority: 65, crawlDelayMs: 900, searchTemplates: commonSearch('https://evelatus.lv') },
  { slug: 'fans', name: 'Fans.lv', origin: 'https://fans.lv', domain: 'fans.lv', priority: 64, crawlDelayMs: 1000, searchTemplates: commonSearch('https://fans.lv') },
  { slug: 'gandrs', name: 'Gandrs', origin: 'https://gandrs.lv', domain: 'gandrs.lv', priority: 63, crawlDelayMs: 1000, searchTemplates: commonSearch('https://gandrs.lv') },
  { slug: 'inserv', name: 'InServ', origin: 'https://www.inserv.lv', domain: 'inserv.lv', priority: 62, crawlDelayMs: 1000, searchTemplates: commonSearch('https://www.inserv.lv') },
  { slug: 'janisroze', name: 'Jānis Roze', origin: 'https://www.janisroze.lv', domain: 'janisroze.lv', priority: 61, crawlDelayMs: 1000, searchTemplates: commonSearch('https://www.janisroze.lv') },
  { slug: 'jysk', name: 'JYSK', origin: 'https://www.jysk.lv', domain: 'jysk.lv', priority: 60, crawlDelayMs: 1000, searchTemplates: commonSearch('https://www.jysk.lv') },
  { slug: 'kruza', name: 'Kruza', origin: 'https://www.kruza.lv', domain: 'kruza.lv', priority: 59, crawlDelayMs: 1000, searchTemplates: commonSearch('https://www.kruza.lv') },
  { slug: 'sportland', name: 'Sportland', origin: 'https://sportland.lv', domain: 'sportland.lv', priority: 58, crawlDelayMs: 1000, searchTemplates: commonSearch('https://sportland.lv') },
  { slug: 'sportapunkts', name: 'SportaPunkts', origin: 'https://sportapunkts.lv', domain: 'sportapunkts.lv', priority: 57, crawlDelayMs: 1000, searchTemplates: commonSearch('https://sportapunkts.lv') },
  { slug: 'tehnoland', name: 'Tehnoland', origin: 'https://tehnoland.lv', domain: 'tehnoland.lv', priority: 56, crawlDelayMs: 900, searchTemplates: commonSearch('https://tehnoland.lv') },
  { slug: 'toysplanet', name: 'ToysPlanet', origin: 'https://toysplanet.lv', domain: 'toysplanet.lv', priority: 55, crawlDelayMs: 1000, searchTemplates: commonSearch('https://toysplanet.lv') },
  { slug: 'trodo', name: 'Trodo', origin: 'https://www.trodo.lv', domain: 'trodo.lv', priority: 54, crawlDelayMs: 1000, searchTemplates: commonSearch('https://www.trodo.lv') },
  { slug: 'upgreat', name: 'UPGREAT', origin: 'https://upgreat.lv', domain: 'upgreat.lv', priority: 53, crawlDelayMs: 900, searchTemplates: commonSearch('https://upgreat.lv') },
  { slug: 'veloprofs', name: 'Veloprofs', origin: 'https://veloprofs.lv', domain: 'veloprofs.lv', priority: 52, crawlDelayMs: 1000, searchTemplates: commonSearch('https://veloprofs.lv') },
  { slug: 'vde', name: 'Verners DE', origin: 'https://vde.lv', domain: 'vde.lv', priority: 51, crawlDelayMs: 1000, searchTemplates: commonSearch('https://vde.lv') },
  { slug: 'babycity', name: 'BabyCity', origin: 'https://www.babycity.lv', domain: 'babycity.lv', priority: 50, crawlDelayMs: 1000, searchTemplates: commonSearch('https://www.babycity.lv') },
  { slug: 'decathlon', name: 'Decathlon', origin: 'https://www.decathlon.lv', domain: 'decathlon.lv', priority: 49, crawlDelayMs: 1000, searchTemplates: commonSearch('https://www.decathlon.lv') },
  { slug: 'dinozoo', name: 'Dino Zoo', origin: 'https://www.dinozoo.lv', domain: 'dinozoo.lv', priority: 48, crawlDelayMs: 1000, searchTemplates: commonSearch('https://www.dinozoo.lv') },
  { slug: 'ikea', name: 'IKEA', origin: 'https://www.ikea.lv', domain: 'ikea.lv', priority: 47, crawlDelayMs: 1100, searchTemplates: commonSearch('https://www.ikea.lv') },
];

export const STORE_COUNT = LATVIA_ELECTRONICS_STORES.length;

export function getStoreSeed(slug: string) {
  return LATVIA_ELECTRONICS_STORES.find((store) => store.slug === slug);
}

export const ALLOWED_MERCHANT_DOMAINS = Array.from(
  new Set(LATVIA_ELECTRONICS_STORES.map((store) => store.domain.toLowerCase())),
);

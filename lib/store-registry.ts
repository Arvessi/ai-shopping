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

// CENIQ 3.2 Latvia electronics pool.
// K-Senukai is intentionally not duplicated: 1a represents that operator family for MVP.
export const LATVIA_ELECTRONICS_STORES: StoreSeed[] = [
  {
    slug: '220',
    name: '220.lv',
    origin: 'https://220.lv',
    domain: '220.lv',
    priority: 100,
    crawlDelayMs: 900,
    searchTemplates: ['https://220.lv/lv/search?q={q}'],
  },
  {
    slug: '1a',
    name: '1a.lv',
    origin: 'https://www.1a.lv',
    domain: '1a.lv',
    priority: 99,
    crawlDelayMs: 900,
    notes: 'Do not duplicate with K-Senukai in MVP.',
    searchTemplates: commonSearch('https://www.1a.lv'),
  },
  {
    slug: 'rd',
    name: 'RD Electronics',
    origin: 'https://www.rdveikals.lv',
    domain: 'rdveikals.lv',
    priority: 98,
    crawlDelayMs: 800,
    searchTemplates: [
      'https://www.rdveikals.lv/search/lv/word/{plus}/page/1/filters/0_0_0/',
    ],
  },
  {
    slug: 'euronics',
    name: 'Euronics',
    origin: 'https://www.euronics.lv',
    domain: 'euronics.lv',
    priority: 97,
    crawlDelayMs: 850,
    searchTemplates: commonSearch('https://www.euronics.lv'),
  },
  {
    slug: 'tet',
    name: 'Tet',
    origin: 'https://www.tet.lv',
    domain: 'tet.lv',
    priority: 96,
    crawlDelayMs: 950,
    searchTemplates: commonSearch('https://www.tet.lv'),
  },
  {
    slug: 'dateks',
    name: 'Dateks',
    origin: 'https://www.dateks.lv',
    domain: 'dateks.lv',
    priority: 95,
    crawlDelayMs: 750,
    searchTemplates: commonSearch('https://www.dateks.lv'),
  },
  {
    slug: 'm79',
    name: 'M79',
    origin: 'https://m79.lv',
    domain: 'm79.lv',
    priority: 94,
    crawlDelayMs: 850,
    searchTemplates: commonSearch('https://m79.lv'),
  },
  {
    slug: 'aio',
    name: 'AiO',
    origin: 'https://aio.lv',
    domain: 'aio.lv',
    priority: 93,
    crawlDelayMs: 850,
    searchTemplates: commonSearch('https://aio.lv'),
  },
  {
    slug: 'balticdata',
    name: 'Baltic Data',
    origin: 'https://www.balticdata.lv',
    domain: 'balticdata.lv',
    priority: 92,
    crawlDelayMs: 850,
    searchTemplates: commonSearch('https://www.balticdata.lv'),
  },
  {
    slug: 'bite',
    name: 'Bite',
    origin: 'https://www.bite.lv',
    domain: 'bite.lv',
    priority: 91,
    crawlDelayMs: 950,
    searchTemplates: commonSearch('https://www.bite.lv'),
  },
  {
    slug: 'tele2',
    name: 'Tele2',
    origin: 'https://www.tele2.lv',
    domain: 'tele2.lv',
    priority: 90,
    crawlDelayMs: 950,
    searchTemplates: commonSearch('https://www.tele2.lv'),
  },
  {
    slug: 'lmt',
    name: 'LMT',
    origin: 'https://www.lmt.lv',
    domain: 'lmt.lv',
    priority: 89,
    crawlDelayMs: 950,
    searchTemplates: commonSearch('https://www.lmt.lv'),
  },
  {
    slug: 'samsung',
    name: 'Samsung Latvija',
    origin: 'https://www.samsung.com/lv',
    domain: 'samsung.com',
    priority: 88,
    crawlDelayMs: 1100,
    searchTemplates: [
      'https://www.samsung.com/lv/search/?searchvalue={q}',
    ],
  },
  {
    slug: 'ideal',
    name: 'iDeal',
    origin: 'https://www.ideal.lv',
    domain: 'ideal.lv',
    priority: 87,
    crawlDelayMs: 850,
    searchTemplates: commonSearch('https://www.ideal.lv'),
  },
  {
    slug: '707',
    name: '707.lv',
    origin: 'https://707.lv',
    domain: '707.lv',
    priority: 86,
    crawlDelayMs: 850,
    searchTemplates: commonSearch('https://707.lv'),
  },
  {
    slug: '24',
    name: '24.lv',
    origin: 'https://24.lv',
    domain: '24.lv',
    priority: 85,
    crawlDelayMs: 850,
    searchTemplates: commonSearch('https://24.lv'),
  },
  {
    slug: 'discover',
    name: 'Discover.lv',
    origin: 'https://discover.lv',
    domain: 'discover.lv',
    priority: 84,
    crawlDelayMs: 850,
    searchTemplates: commonSearch('https://discover.lv'),
  },
  {
    slug: 'bigbox',
    name: 'Bigbox.lv',
    origin: 'https://bigbox.lv',
    domain: 'bigbox.lv',
    priority: 83,
    crawlDelayMs: 850,
    searchTemplates: commonSearch('https://bigbox.lv'),
  },
  {
    slug: 'signe',
    name: 'Signe.lv',
    origin: 'https://signe.lv',
    domain: 'signe.lv',
    priority: 82,
    crawlDelayMs: 850,
    searchTemplates: commonSearch('https://signe.lv'),
  },
  {
    slug: 'dt24',
    name: 'DT24.lv',
    origin: 'https://dt24.lv',
    domain: 'dt24.lv',
    priority: 81,
    crawlDelayMs: 850,
    searchTemplates: commonSearch('https://dt24.lv'),
  },
  {
    slug: 'zauers',
    name: 'Zauers.lv',
    origin: 'https://zauers.lv',
    domain: 'zauers.lv',
    priority: 80,
    crawlDelayMs: 850,
    searchTemplates: commonSearch('https://zauers.lv'),
  },
  {
    slug: 'labsveikals',
    name: 'LabsVeikals.lv',
    origin: 'https://labsveikals.lv',
    domain: 'labsveikals.lv',
    priority: 79,
    crawlDelayMs: 850,
    searchTemplates: commonSearch('https://labsveikals.lv'),
  },
  {
    slug: 'datorlietas',
    name: 'Datorlietas.lv',
    origin: 'https://datorlietas.lv',
    domain: 'datorlietas.lv',
    priority: 78,
    crawlDelayMs: 850,
    searchTemplates: commonSearch('https://datorlietas.lv'),
  },
  {
    slug: 'semikom',
    name: 'Semikom.lv',
    origin: 'https://semikom.lv',
    domain: 'semikom.lv',
    priority: 77,
    crawlDelayMs: 850,
    searchTemplates: commonSearch('https://semikom.lv'),
  },
  {
    slug: 'multicom',
    name: 'Multicom.lv',
    origin: 'https://multicom.lv',
    domain: 'multicom.lv',
    priority: 76,
    crawlDelayMs: 850,
    searchTemplates: commonSearch('https://multicom.lv'),
  },
  {
    slug: 'tera',
    name: 'Tera.lv',
    origin: 'https://tera.lv',
    domain: 'tera.lv',
    priority: 75,
    crawlDelayMs: 850,
    searchTemplates: commonSearch('https://tera.lv'),
  },
];

export const STORE_COUNT = LATVIA_ELECTRONICS_STORES.length;

export function getStoreSeed(slug: string) {
  return LATVIA_ELECTRONICS_STORES.find((store) => store.slug === slug);
}

export const ALLOWED_MERCHANT_DOMAINS = Array.from(
  new Set(LATVIA_ELECTRONICS_STORES.map((store) => store.domain.toLowerCase())),
);

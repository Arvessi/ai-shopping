export type StoreSeed = {
  slug: string;
  name: string;
  origin: string;
  domain: string;
  priority: number;
  crawlDelayMs?: number;
  enabled?: boolean;
  notes?: string;
};

// CENIQ 3.1 initial Latvia electronics pool.
// This is intentionally a practical merchant pool, not a claimed traffic ranking.
// K-Senukai is not added separately because CENIQ treats 1a/K-Senukai as one operator family for MVP dedupe.
export const LATVIA_ELECTRONICS_STORES: StoreSeed[] = [
  { slug: '220', name: '220.lv', origin: 'https://220.lv', domain: '220.lv', priority: 100, crawlDelayMs: 1200 },
  { slug: '1a', name: '1a.lv', origin: 'https://www.1a.lv', domain: '1a.lv', priority: 98, crawlDelayMs: 1200, notes: 'Do not duplicate with K-Senukai in MVP.' },
  { slug: 'rd', name: 'RD Electronics', origin: 'https://www.rdveikals.lv', domain: 'rdveikals.lv', priority: 97, crawlDelayMs: 1000 },
  { slug: 'euronics', name: 'Euronics', origin: 'https://www.euronics.lv', domain: 'euronics.lv', priority: 96, crawlDelayMs: 1000 },
  { slug: 'tet', name: 'Tet', origin: 'https://www.tet.lv', domain: 'tet.lv', priority: 95, crawlDelayMs: 1200 },
  { slug: 'dateks', name: 'Dateks', origin: 'https://www.dateks.lv', domain: 'dateks.lv', priority: 94, crawlDelayMs: 900 },
  { slug: 'm79', name: 'M79', origin: 'https://m79.lv', domain: 'm79.lv', priority: 93, crawlDelayMs: 1000 },
  { slug: 'aio', name: 'AiO', origin: 'https://aio.lv', domain: 'aio.lv', priority: 92, crawlDelayMs: 1000 },
  { slug: 'balticdata', name: 'Baltic Data', origin: 'https://www.balticdata.lv', domain: 'balticdata.lv', priority: 91, crawlDelayMs: 1000 },
  { slug: 'bite', name: 'Bite', origin: 'https://www.bite.lv', domain: 'bite.lv', priority: 90, crawlDelayMs: 1200 },
  { slug: 'tele2', name: 'Tele2', origin: 'https://www.tele2.lv', domain: 'tele2.lv', priority: 89, crawlDelayMs: 1200 },
  { slug: 'lmt', name: 'LMT', origin: 'https://www.lmt.lv', domain: 'lmt.lv', priority: 88, crawlDelayMs: 1200 },
  { slug: 'samsung', name: 'Samsung Latvija', origin: 'https://www.samsung.com/lv', domain: 'samsung.com', priority: 87, crawlDelayMs: 1400 },
  { slug: 'ideal', name: 'iDeal', origin: 'https://www.ideal.lv', domain: 'ideal.lv', priority: 86, crawlDelayMs: 1000 },
  { slug: '707', name: '707.lv', origin: 'https://707.lv', domain: '707.lv', priority: 85, crawlDelayMs: 1000 },
  { slug: '24', name: '24.lv', origin: 'https://24.lv', domain: '24.lv', priority: 84, crawlDelayMs: 1000 },
  { slug: 'discover', name: 'Discover.lv', origin: 'https://discover.lv', domain: 'discover.lv', priority: 83, crawlDelayMs: 1000 },
  { slug: 'bigbox', name: 'Bigbox.lv', origin: 'https://bigbox.lv', domain: 'bigbox.lv', priority: 82, crawlDelayMs: 1000 },
  { slug: 'signe', name: 'Signe.lv', origin: 'https://signe.lv', domain: 'signe.lv', priority: 81, crawlDelayMs: 1000 },
  { slug: 'dt24', name: 'DT24.lv', origin: 'https://dt24.lv', domain: 'dt24.lv', priority: 80, crawlDelayMs: 1000 },
  { slug: 'zauers', name: 'Zauers.lv', origin: 'https://zauers.lv', domain: 'zauers.lv', priority: 79, crawlDelayMs: 1000 },
  { slug: 'labsveikals', name: 'LabsVeikals.lv', origin: 'https://labsveikals.lv', domain: 'labsveikals.lv', priority: 78, crawlDelayMs: 1000 },
  { slug: 'datorlietas', name: 'Datorlietas.lv', origin: 'https://datorlietas.lv', domain: 'datorlietas.lv', priority: 77, crawlDelayMs: 1000 },
  { slug: 'semikom', name: 'Semikom.lv', origin: 'https://semikom.lv', domain: 'semikom.lv', priority: 76, crawlDelayMs: 1000 },
  { slug: 'multicom', name: 'Multicom.lv', origin: 'https://multicom.lv', domain: 'multicom.lv', priority: 75, crawlDelayMs: 1000 },
  { slug: 'tera', name: 'Tera.lv', origin: 'https://tera.lv', domain: 'tera.lv', priority: 74, crawlDelayMs: 1000 },
];

export const STORE_COUNT = LATVIA_ELECTRONICS_STORES.length;

const ACCESSORY = /\b(?:case|cover|screen protector|glass|charger|adapter|cable|maci[nņ]s|vaci[nņ]s|aizsargstikls)\b/i;

const KNOWN_BRANDS = [
  'Apple', 'Samsung', 'Xiaomi', 'Google', 'Sony', 'LG', 'Philips', 'Lenovo', 'ASUS', 'Acer', 'Dell', 'HP',
  'Huawei', 'OnePlus', 'Nothing', 'Motorola', 'MSI', 'Gigabyte', 'AOC', 'BenQ', 'Canon', 'Nikon', 'Fujifilm',
  'Panasonic', 'JBL', 'Bose', 'Logitech', 'Razer', 'Corsair',
];

const MERCHANT_SUFFIX = /\s+-\s+(?:Euronics|Dateks|AiO|Baltic Data|Bite|Tet|LMT|Tele2|220\.lv|1a\.lv|RD Electronics|Discover\.lv|Bigbox\.lv|M79|707\.lv|24\.lv)\b.*$/i;
const LOW_SIGNAL_WORDS = /\b(?:wireless|bluetooth|noise cancelling|noise canceling|anc|new|jauns|jauna|produkts?)\b/gi;
const COLOR_WORDS = /\b(?:black|midnight|obsidian|graphite|melns|melna|white|starlight|porcelain|balts|balta|navy|blue|ultramarine|zils|zila|green|mint|teal|zals|zala|gray|grey|silver|peleks|peleka|sudraba|pink|rose|roza|red|sarkans|sarkana|purple|violet|violets|violeta|gold|zelta)\b/gi;

const CATEGORY_RULES: Array<[RegExp, string]> = [
  [/\b(?:viedt[aā]lrunis|telefoni?|smartphone|mobile phone|mobilais telefons)\b/gi, 'phone'],
  [/\b(?:laptop|notebook|portat[iī]vais dators?)\b/gi, 'laptop'],
  [/\b(?:monitor|monitors)\b/gi, 'monitor'],
  [/\b(?:televizors?|television|tv)\b/gi, 'tv'],
  [/\b(?:headphones?|earbuds?|austi[nņ]as?)\b/gi, 'headphones'],
  [/\b(?:speaker|ska[lļ]runis)\b/gi, 'speaker'],
  [/\b(?:camera|kamera)\b/gi, 'camera'],
  [/\b(?:printer|printeris)\b/gi, 'printer'],
  [/\b(?:router|r[uū]teris)\b/gi, 'router'],
  [/\b(?:smartwatch|viedpulkstenis)\b/gi, 'smartwatch'],
];

function tidy(value: string) {
  return value.replace(/[|–—]+/g, ' - ').replace(/\s+/g, ' ').replace(/^[-\s]+|[-\s]+$/g, '').trim();
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function inferMerchantBrand(title: string, explicitBrand?: string) {
  if (explicitBrand?.trim()) return explicitBrand.trim();
  return KNOWN_BRANDS.find((brand) => new RegExp(`\\b${escapeRegex(brand)}\\b`, 'i').test(title));
}

function normalizeKnownPhones(title: string) {
  const iphone = title.match(/\b(?:Apple\s+)?iPhone\s+(\d{1,2})(?:\s*(e)\b|\s+(Pro\s+Max|Pro|Plus|Air|Mini|SE)\b)?/i);
  if (iphone) {
    const rawModifier = iphone[2] ? 'e' : iphone[3];
    const modifier = rawModifier
      ? rawModifier.replace(/\s+/g, ' ').replace(/\bpro\b/i, 'Pro').replace(/\bmax\b/i, 'Max').replace(/\bplus\b/i, 'Plus').replace(/\bair\b/i, 'Air').replace(/\bmini\b/i, 'Mini').replace(/\bse\b/i, 'SE')
      : '';
    return { title: `Apple iPhone ${iphone[1]}${modifier === 'e' ? 'e' : modifier ? ` ${modifier}` : ''}`, brand: 'Apple' };
  }

  const galaxy = title.match(/\b(?:Samsung\s+)?Galaxy\s+([A-Z]\d{1,3})(?:\s+(Ultra|Plus|FE))?\b/i);
  if (galaxy) {
    const model = galaxy[1].toUpperCase();
    const modifier = galaxy[2]
      ? galaxy[2].replace(/\bplus\b/i, 'Plus').replace(/\bultra\b/i, 'Ultra').replace(/\bfe\b/i, 'FE')
      : '';
    return { title: `Samsung Galaxy ${model}${modifier ? ` ${modifier}` : ''}`, brand: 'Samsung' };
  }
  return null;
}

function normalizeCategoryWords(value: string) {
  let result = value;
  for (const [pattern, replacement] of CATEGORY_RULES) result = result.replace(pattern, ` ${replacement} `);
  return result;
}

function cleanGenericTitle(title: string) {
  let value = title
    .replace(MERCHANT_SUFFIX, ' ')
    .replace(/\([^)]*[A-Z0-9]{5,}[\/-][A-Z0-9/-]*[^)]*\)/gi, ' ')
    .replace(/\b(?:64|128|256|512|1024|2048)\s*GB\b/gi, ' ')
    .replace(/\b\d+(?:[.,]\d+)?\s*TB\b/gi, ' ')
    .replace(/\b\d{1,3}\s*GB\s*(?:RAM|memory|operativ\w*)\b/gi, ' ')
    .replace(/\b\d{1,3}(?:[.,]\d)?\s*(?:inch(?:es)?|\")\b/gi, ' ')
    .replace(/\b(?:8K|5K|4K|QHD|WQHD|UHD|FHD|Full\s*HD|\d{3,4}\s*[x×]\s*\d{3,4})\b/gi, ' ')
    .replace(/\b\d{2,3}\s*Hz\b/gi, ' ')
    .replace(COLOR_WORDS, ' ')
    .replace(LOW_SIGNAL_WORDS, ' ');

  value = normalizeCategoryWords(value);
  return value
    .replace(/\b(?:phone|laptop|monitor|tv|headphones|speaker|camera|printer|router|smartwatch)(?:\s+\1)+\b/gi, '$1')
    .replace(/\s*[,;|]+\s*/g, ' ')
    .replace(/\s+-\s*$/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[-\s]+|[-\s]+$/g, '')
    .trim();
}

export function canonicalizeMerchantProductTitle(rawTitle: string, explicitBrand?: string) {
  const title = tidy(rawTitle);
  const brand = inferMerchantBrand(title, explicitBrand);

  if (!ACCESSORY.test(title)) {
    const phone = normalizeKnownPhones(title);
    if (phone) return phone;
  }

  let cleaned = cleanGenericTitle(title);
  if (brand && !new RegExp(`^${escapeRegex(brand)}\\b`, 'i').test(cleaned)) cleaned = `${brand} ${cleaned}`.trim();
  return { title: cleaned || title, brand };
}

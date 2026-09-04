const ACCESSORY = /\b(?:case|cover|screen protector|glass|charger|adapter|cable|maci[nņ]s|vaci[nņ]s|aizsargstikls)\b/i;

const KNOWN_BRANDS = [
  'Apple',
  'Samsung',
  'Xiaomi',
  'Google',
  'Sony',
  'LG',
  'Philips',
  'Lenovo',
  'ASUS',
  'Acer',
  'Dell',
  'HP',
  'Huawei',
  'OnePlus',
  'Nothing',
  'Motorola',
];

function tidy(value: string) {
  return value
    .replace(/[|–—]+/g, ' - ')
    .replace(/\s+/g, ' ')
    .replace(/^[-\s]+|[-\s]+$/g, '')
    .trim();
}

export function inferMerchantBrand(title: string, explicitBrand?: string) {
  if (explicitBrand?.trim()) return explicitBrand.trim();
  return KNOWN_BRANDS.find((brand) => new RegExp(`\\b${brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(title));
}

export function canonicalizeMerchantProductTitle(rawTitle: string, explicitBrand?: string) {
  const title = tidy(rawTitle);
  const brand = inferMerchantBrand(title, explicitBrand);

  // Do not collapse accessories into their parent device family.
  if (!ACCESSORY.test(title)) {
    const iphone = title.match(/\b(?:Apple\s+)?iPhone\s+(\d{1,2})(?:\s*(e)\b|\s+(Pro\s+Max|Pro|Plus|Air|Mini|SE)\b)?/i);
    if (iphone) {
      const rawModifier = iphone[2] ? 'e' : iphone[3];
      const modifier = rawModifier
        ? rawModifier
            .replace(/\s+/g, ' ')
            .replace(/\bpro\b/i, 'Pro')
            .replace(/\bmax\b/i, 'Max')
            .replace(/\bplus\b/i, 'Plus')
            .replace(/\bair\b/i, 'Air')
            .replace(/\bmini\b/i, 'Mini')
            .replace(/\bse\b/i, 'SE')
        : '';
      return {
        title: `Apple iPhone ${iphone[1]}${modifier === 'e' ? 'e' : modifier ? ` ${modifier}` : ''}`,
        brand: 'Apple',
      };
    }

    const galaxy = title.match(/\b(?:Samsung\s+)?Galaxy\s+([A-Z]\d{1,3})(?:\s+(Ultra|Plus|FE))?\b/i);
    if (galaxy) {
      const model = galaxy[1].toUpperCase();
      const modifier = galaxy[2]
        ? galaxy[2].replace(/\bplus\b/i, 'Plus').replace(/\bultra\b/i, 'Ultra').replace(/\bfe\b/i, 'FE')
        : '';
      return {
        title: `Samsung Galaxy ${model}${modifier ? ` ${modifier}` : ''}`,
        brand: 'Samsung',
      };
    }
  }

  let cleaned = title
    .replace(/\([^)]*[A-Z0-9]{5,}[\/-][A-Z0-9/-]*[^)]*\)/gi, ' ')
    .replace(/\b[A-Z0-9]{5,}[\/-][A-Z0-9/-]{1,}\b/g, ' ')
    .replace(/\b(?:viedt[aā]lrunis|telefoni|telefons|smartphone|mobile phone|mobilais telefons|produkts)\b/gi, ' ')
    .replace(/\s+-\s+(?:Euronics|Dateks|AiO|Baltic Data|Bite|Tet|LMT|Tele2|220\.lv|1a\.lv)\b.*$/i, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[-\s]+|[-\s]+$/g, '')
    .trim();

  if (brand && !new RegExp(`^${brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(cleaned)) {
    cleaned = `${brand} ${cleaned}`.trim();
  }

  return { title: cleaned || title, brand };
}

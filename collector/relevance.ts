import { canonicalizeMerchantProductTitle } from '../lib/canonical/title-normalization.ts';
import { isRestrictedShoppingQuery } from '../lib/safety.ts';
const normalize = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const accessory = /\b(case|cover|glass|protector|charger|adapter|cable|holder|macin\w*|vacin\w*|apvalk\w*|aizsargstikl\w*)\b/;
function condition(s: string) { return /refurb|renewed|atjaunot/.test(s) ? 'refurbished' : /open box|izpakot|demo/.test(s) ? 'open-box' : /used|lietot/.test(s) ? 'used' : 'new'; }
function phone(s: string) { const m = s.match(/\b(iphone\s+\d{1,2}e?|galaxy\s+[a-z]\d{1,3}|honor\s+\d{2,3})(?:\s+(pro max|pro|plus|ultra|fe|lite))?\b/); return m ? `${m[1]} ${m[2] || 'base'}` : ''; }
/** Conservative acquisition gate. Never drop numeric model tokens or condition. */
export function sameProduct(title: string, query: string) {
    const t = normalize(title.replace(/(S\d+)\+/gi, '$1 Plus')), q = normalize(query.replace(/(S\d+)\+/gi, '$1 Plus'));
    if (isRestrictedShoppingQuery(title) || accessory.test(t) !== accessory.test(q) || condition(t) !== condition(q))
        return false;
    if (phone(q))
        return phone(t) === phone(q);
    const wanted = normalize(canonicalizeMerchantProductTitle(query).title).split(' ').filter(x => x.length > 1);
    const actual = new Set(normalize(canonicalizeMerchantProductTitle(title).title).split(' '));
    return wanted.length >= 2 && wanted.every(token => actual.has(token));
}

import Link from 'next/link';
import type { Recommendation } from '@/lib/shopping-intent';
const labels: Record<string, string> = { storage: 'Atmiņa', ram: 'RAM', color: 'Krāsa', condition: 'Stāvoklis', size: 'Izmērs', refreshRate: 'Frekvence', panelType: 'Panelis', connectivity: 'Savienojums', cpu: 'Procesors', gpu: 'Grafika', resolution: 'Izšķirtspēja', kit: 'Komplekts' };
export default function AiShortlist({ items, comparison = false }: {
    items: Recommendation[];
    comparison?: boolean;
}) {
    return <div className={comparison ? "ai-shortlist comparison" : "ai-shortlist"}>{items.map((item, index) => {
            const p = item.product;
            const href = `/product/${encodeURIComponent(p.id)}${p.selectedVariantId ? `?variantId=${encodeURIComponent(p.selectedVariantId)}` : ''}`;
            return <article className="ai-recommendation" key={p.id}>
      <div className="recommendation-index"><span>{comparison ? 'SALĪDZINĀJUMS' : index === 0 ? 'PIRMĀ IZVĒLE' : 'ALTERNATĪVA'}</span><b>0{index + 1}</b></div>
      <Link href={href} className="shortlist-identity">{p.image && <img src={p.image} alt={p.title} loading="lazy"/>}<h3>{p.title}</h3></Link>
      <strong className="shortlist-price">{new Intl.NumberFormat('lv-LV', { style: 'currency', currency: p.currency }).format(p.bestPrice)}</strong>
      <p>{item.advantage}</p>
      <dl>{Object.entries(p.catalogVariants?.find(v => v.id === p.selectedVariantId)?.attributes || {}).map(([key, value]) => <div key={key}><dt>{labels[key] || key}</dt><dd>{value === 'New' ? 'Jauns' : value}</dd></div>)}</dl>
      {!!item.matched.length && <p className="positive">Atbilst: {item.matched.join(' · ')}</p>}
      {!!item.unknown.length && <details><summary>Kas vēl jāpārbauda ({item.unknown.length})</summary><ul>{item.unknown.map(value => <li key={value}>{value}</li>)}</ul></details>}
      <p className="shortlist-tradeoff">{item.tradeoff}</p><Link className="primary" href={href}>Pārbaudīt piedāvājumus ↗</Link>
    </article>;
        })}</div>;
}

'use client';

type Point = { price: number; recordedAt: string };

export default function PriceChart({ points, currency = 'EUR' }: { points: Point[]; currency?: string }) {
  const data = points.length ? points.slice(-90) : [];
  if (data.length < 2) return <div className="chartempty">Cenu vēsture sāks veidoties pēc nākamajiem cenu atjauninājumiem.</div>;
  const values = data.map((p) => p.price);
  const min = Math.min(...values), max = Math.max(...values), span = Math.max(1, max - min);
  const poly = data.map((p, i) => `${(i / Math.max(1, data.length - 1)) * 100},${92 - ((p.price - min) / span) * 72}`).join(' ');
  const fmt = (v: number) => new Intl.NumberFormat('lv-LV', { style: 'currency', currency }).format(v);
  return <div className="pricechart"><div className="chartstats"><div><span>Zemākā</span><b>{fmt(min)}</b></div><div><span>Augstākā</span><b>{fmt(max)}</b></div><div><span>Pašlaik</span><b>{fmt(values.at(-1) || min)}</b></div></div><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="Cenu vēstures grafiks"><defs><linearGradient id="fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="currentColor" stopOpacity=".22"/><stop offset="1" stopColor="currentColor" stopOpacity="0"/></linearGradient></defs><polygon points={`0,100 ${poly} 100,100`} fill="url(#fill)"/><polyline points={poly} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke"/></svg></div>;
}

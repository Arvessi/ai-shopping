import ProductDetail from '@/components/ProductDetail';
export default async function ProductPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ variantId?: string }> }) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  return <ProductDetail id={decodeURIComponent(id)} variantId={query.variantId}/>;
}

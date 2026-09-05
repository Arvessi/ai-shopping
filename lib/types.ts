export type VariantAttributes = {
  color?: string;
  storage?: string;
  ram?: string;
  connectivity?: string;
  size?: string;
  condition?: string;
  cpu?: string;
  gpu?: string;
  resolution?: string;
  panelType?: string;
  refreshRate?: string;
  kit?: string;
};

export type OfferView = {
  id?: string;
  variantId?: string;
  merchant: string;
  merchantDomain?: string;
  variantLabel?: string;
  variantData?: VariantAttributes;
  image?: string;
  price: number;
  shipping: number;
  shippingKnown?: boolean;
  totalPrice: number;
  currency: string;
  dealScore: number;
  sellerRating?: number;
  sellerVotes?: number;
  deliveryMessage?: string;
  url?: string;
  isCheapest: boolean;
  isBestOverall: boolean;
};

export type CatalogVariantView = {
  id: string;
  variantKey: string;
  image?: string;
  attributes: VariantAttributes;
  offerCount: number;
  bestPrice?: number;
};

export type ProductResult = {
  id: string;
  externalId: string;
  sourceProductId?: string;
  gid?: string;
  dataDocId?: string;
  title: string;
  normalizedTitle: string;
  brand?: string;
  category?: string;
  description?: string;
  image?: string;
  familyImage?: string;
  bestPrice: number;
  currency: string;
  dealScore: number;
  offers: OfferView[];
  storesCount?: number;
  variants?: string[];
  variantOptions?: Record<string, string[]>;
  catalogVariants?: CatalogVariantView[];
  selectedVariantId?: string;
};

export type AiShoppingPlan = {
  searchQuery: string;
  summary: string;
  constraints: string[];
  category: string;
  maxPrice?: number;
};

export type VariantAttributes = {
  color?: string;
  storage?: string;
  ram?: string;
  connectivity?: string;
  size?: string;
  condition?: string;
};

export type OfferView = {
  id?: string;
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
  bestPrice: number;
  currency: string;
  dealScore: number;
  offers: OfferView[];
  storesCount?: number;
  variants?: string[];
  variantOptions?: Record<string, string[]>;
};

export type AiShoppingPlan = {
  searchQuery: string;
  summary: string;
  constraints: string[];
  category: string;
};

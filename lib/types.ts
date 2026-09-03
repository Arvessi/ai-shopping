export type OfferView = {
  id?: string;
  merchant: string;
  merchantDomain?: string;
  price: number;
  shipping: number;
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
};

export type AiShoppingPlan = {
  searchQuery: string;
  summary: string;
  constraints: string[];
  category: string;
};

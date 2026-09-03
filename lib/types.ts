export type Offer = {
  merchant: string;
  price: number;
  shipping: number;
  currency: string;
  dealScore: number;
  productTitle: string;
  image?: string;
  url: string;
  affiliate: boolean;
  updatedAt: string;
};

export type ProductResult = {
  id: string;
  title: string;
  brand: string;
  category: string;
  bestPrice: number;
  currency: string;
  dealScore: number;
  offers: Offer[];
  image?: string;
};

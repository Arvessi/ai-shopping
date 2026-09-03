import type { ProductResult } from './types';

export const products: ProductResult[] = [
  {
    id: 'iphone-17-256',
    title: 'Apple iPhone 17 256GB',
    brand: 'Apple',
    category: 'Phones',
    bestPrice: 899,
    currency: 'EUR',
    dealScore: 91,
    offers: [
      { merchant: 'Demo Store EU', price: 899, shipping: 0, currency: 'EUR', dealScore: 91, productTitle: 'Apple iPhone 17 256GB', url: '#', affiliate: true, updatedAt: new Date().toISOString() },
      { merchant: 'Demo Mobile', price: 919, shipping: 0, currency: 'EUR', dealScore: 86, productTitle: 'Apple iPhone 17 256GB', url: '#', affiliate: true, updatedAt: new Date().toISOString() },
      { merchant: 'Demo Tech', price: 949, shipping: 9.9, currency: 'EUR', dealScore: 75, productTitle: 'Apple iPhone 17 256GB', url: '#', affiliate: false, updatedAt: new Date().toISOString() }
    ]
  },
  {
    id: 'oled-monitor-27',
    title: '27" QHD 240Hz OLED Gaming Monitor',
    brand: 'DemoBrand',
    category: 'Monitors',
    bestPrice: 549,
    currency: 'EUR',
    dealScore: 88,
    offers: [
      { merchant: 'Demo Display', price: 549, shipping: 0, currency: 'EUR', dealScore: 88, productTitle: '27" QHD 240Hz OLED Gaming Monitor', url: '#', affiliate: true, updatedAt: new Date().toISOString() },
      { merchant: 'Demo Electronics', price: 579, shipping: 0, currency: 'EUR', dealScore: 82, productTitle: '27" QHD 240Hz OLED Gaming Monitor', url: '#', affiliate: true, updatedAt: new Date().toISOString() }
    ]
  },
  {
    id: 'tv-55-oled',
    title: '55" 4K OLED 120Hz Smart TV',
    brand: 'DemoVision',
    category: 'TVs',
    bestPrice: 999,
    currency: 'EUR',
    dealScore: 94,
    offers: [
      { merchant: 'Demo Home', price: 999, shipping: 0, currency: 'EUR', dealScore: 94, productTitle: '55" 4K OLED 120Hz Smart TV', url: '#', affiliate: true, updatedAt: new Date().toISOString() },
      { merchant: 'Demo AV', price: 1049, shipping: 0, currency: 'EUR', dealScore: 86, productTitle: '55" 4K OLED 120Hz Smart TV', url: '#', affiliate: false, updatedAt: new Date().toISOString() }
    ]
  }
];

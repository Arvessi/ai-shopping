export type DiscoveryMerchant = {
  slug: string;
  name: string;
  origin: string;
  market: "LV" | "LT" | "EE" | "EU";
  categories: string[];
  deliveryToLatvia: "native" | "verify";
};

// Discovery universe is intentionally broader than the fully implemented
// collector-adapter registry. A merchant can be discovered before it has a
// dedicated bulk adapter. Foreign merchants remain deliveryToLatvia=verify
// until shipping/landed-price logic confirms that a Latvian buyer can order it.
export const discoveryMerchants: DiscoveryMerchant[] = [
  { slug: "220", name: "220.lv", origin: "https://220.lv", market: "LV", categories: ["general"], deliveryToLatvia: "native" },
  { slug: "1a", name: "1a.lv", origin: "https://www.1a.lv", market: "LV", categories: ["general"], deliveryToLatvia: "native" },
  { slug: "rd", name: "RD Electronics", origin: "https://www.rdveikals.lv", market: "LV", categories: ["electronics", "home-appliances"], deliveryToLatvia: "native" },
  { slug: "euronics", name: "Euronics", origin: "https://www.euronics.lv", market: "LV", categories: ["electronics", "home-appliances"], deliveryToLatvia: "native" },
  { slug: "dateks", name: "Dateks", origin: "https://www.dateks.lv", market: "LV", categories: ["computers", "electronics"], deliveryToLatvia: "native" },
  { slug: "aio", name: "AiO", origin: "https://aio.lv", market: "LV", categories: ["general", "electronics"], deliveryToLatvia: "native" },
  { slug: "m79", name: "M79", origin: "https://m79.lv", market: "LV", categories: ["general", "electronics"], deliveryToLatvia: "native" },
  { slug: "balticdata", name: "Baltic Data", origin: "https://www.balticdata.lv", market: "LV", categories: ["computers", "electronics"], deliveryToLatvia: "native" },
  { slug: "cenuklubs", name: "Cenu Klubs", origin: "https://www.cenuklubs.lv", market: "LV", categories: ["general", "home"], deliveryToLatvia: "native" },
  { slug: "tet", name: "Tet", origin: "https://www.tet.lv", market: "LV", categories: ["electronics", "home-appliances"], deliveryToLatvia: "native" },
  { slug: "bite", name: "Bite", origin: "https://www.bite.lv", market: "LV", categories: ["phones", "electronics"], deliveryToLatvia: "native" },
  { slug: "lmt", name: "LMT", origin: "https://www.lmt.lv", market: "LV", categories: ["phones", "electronics"], deliveryToLatvia: "native" },
  { slug: "tele2", name: "Tele2", origin: "https://www.tele2.lv", market: "LV", categories: ["phones", "electronics"], deliveryToLatvia: "native" },
  { slug: "ksenukai", name: "K-Senukai", origin: "https://www.ksenukai.lv", market: "LV", categories: ["general", "home", "garden", "electronics", "sports"], deliveryToLatvia: "native" },
  { slug: "24lv", name: "24.lv", origin: "https://www.24.lv", market: "LV", categories: ["general", "electronics", "home", "sports", "kids"], deliveryToLatvia: "native" },
  { slug: "need", name: "NEED.lv", origin: "https://need.lv", market: "LV", categories: ["general", "electronics", "home", "sports", "automotive"], deliveryToLatvia: "native" },
  { slug: "707", name: "707.lv", origin: "https://707.lv", market: "LV", categories: ["general", "electronics", "home", "automotive"], deliveryToLatvia: "native" },
  { slug: "dato", name: "Dato.lv", origin: "https://dato.lv", market: "LV", categories: ["computers", "electronics"], deliveryToLatvia: "native" },
  { slug: "datorucentrs", name: "Datoru Centrs", origin: "https://datorucentrs.lv", market: "LV", categories: ["computers", "electronics"], deliveryToLatvia: "native" },
  { slug: "depo", name: "DEPO Online", origin: "https://online.depo.lv", market: "LV", categories: ["home", "garden", "building"], deliveryToLatvia: "native" },
  { slug: "douglas", name: "Douglas", origin: "https://www.douglas.lv", market: "LV", categories: ["beauty"], deliveryToLatvia: "native" },
  { slug: "drogas", name: "Drogas", origin: "https://www.drogas.lv", market: "LV", categories: ["beauty", "home"], deliveryToLatvia: "native" },
  { slug: "eapavi", name: "eapavi.lv", origin: "https://www.eapavi.lv", market: "LV", categories: ["fashion", "shoes"], deliveryToLatvia: "native" },
  { slug: "evelatus", name: "Evelatus", origin: "https://evelatus.lv", market: "LV", categories: ["phones", "electronics"], deliveryToLatvia: "native" },
  { slug: "fans", name: "Fans.lv", origin: "https://fans.lv", market: "LV", categories: ["sports", "fashion"], deliveryToLatvia: "native" },
  { slug: "gandrs", name: "Gandrs", origin: "https://gandrs.lv", market: "LV", categories: ["sports", "outdoor", "bikes"], deliveryToLatvia: "native" },
  { slug: "inserv", name: "InServ", origin: "https://www.inserv.lv", market: "LV", categories: ["home", "garden", "tools"], deliveryToLatvia: "native" },
  { slug: "janisroze", name: "Jānis Roze", origin: "https://www.janisroze.lv", market: "LV", categories: ["books", "stationery", "toys"], deliveryToLatvia: "native" },
  { slug: "jysk", name: "JYSK", origin: "https://www.jysk.lv", market: "LV", categories: ["home", "furniture"], deliveryToLatvia: "native" },
  { slug: "kruza", name: "Kruza", origin: "https://www.kruza.lv", market: "LV", categories: ["home", "building", "garden"], deliveryToLatvia: "native" },
  { slug: "sportland", name: "Sportland", origin: "https://sportland.lv", market: "LV", categories: ["sports", "fashion", "shoes"], deliveryToLatvia: "native" },
  { slug: "sportapunkts", name: "SportaPunkts", origin: "https://sportapunkts.lv", market: "LV", categories: ["sports", "fashion", "shoes"], deliveryToLatvia: "native" },
  { slug: "tehnoland", name: "Tehnoland", origin: "https://tehnoland.lv", market: "LV", categories: ["electronics", "home-appliances"], deliveryToLatvia: "native" },
  { slug: "toysplanet", name: "ToysPlanet", origin: "https://toysplanet.lv", market: "LV", categories: ["toys", "kids"], deliveryToLatvia: "native" },
  { slug: "trodo", name: "Trodo", origin: "https://www.trodo.lv", market: "LV", categories: ["automotive"], deliveryToLatvia: "native" },
  { slug: "upgreat", name: "UPGREAT", origin: "https://upgreat.lv", market: "LV", categories: ["electronics", "refurbished"], deliveryToLatvia: "native" },
  { slug: "veloprofs", name: "Veloprofs", origin: "https://veloprofs.lv", market: "LV", categories: ["bikes", "sports"], deliveryToLatvia: "native" },
  { slug: "vde", name: "Verners DE", origin: "https://vde.lv", market: "LV", categories: ["home-appliances"], deliveryToLatvia: "native" },
  { slug: "babycity", name: "BabyCity", origin: "https://www.babycity.lv", market: "LV", categories: ["kids", "toys"], deliveryToLatvia: "native" },
  { slug: "decathlon", name: "Decathlon", origin: "https://www.decathlon.lv", market: "LV", categories: ["sports", "outdoor"], deliveryToLatvia: "native" },
  { slug: "dinozoo", name: "Dino Zoo", origin: "https://www.dinozoo.lv", market: "LV", categories: ["pets"], deliveryToLatvia: "native" },
  { slug: "ikea", name: "IKEA", origin: "https://www.ikea.lv", market: "LV", categories: ["home", "furniture"], deliveryToLatvia: "native" },

  // Baltic discovery candidates. Offers from these markets are not surfaced as
  // Latvia-buyable until shipping and landed price are verified.
  { slug: "pigu-lt", name: "Pigu.lt", origin: "https://pigu.lt", market: "LT", categories: ["general"], deliveryToLatvia: "verify" },
  { slug: "kaup24-ee", name: "Kaup24.ee", origin: "https://kaup24.ee", market: "EE", categories: ["general"], deliveryToLatvia: "verify" },
  { slug: "varle-lt", name: "Varle.lt", origin: "https://www.varle.lt", market: "LT", categories: ["general", "electronics"], deliveryToLatvia: "verify" },
  { slug: "euronics-ee", name: "Euronics Estonia", origin: "https://www.euronics.ee", market: "EE", categories: ["electronics", "home-appliances"], deliveryToLatvia: "verify" },
  { slug: "klick-ee", name: "Klick", origin: "https://www.klick.ee", market: "EE", categories: ["electronics", "computers"], deliveryToLatvia: "verify" },
  { slug: "topocentras-lt", name: "Topo Centras", origin: "https://www.topocentras.lt", market: "LT", categories: ["electronics", "home-appliances"], deliveryToLatvia: "verify" },
];

const blocked = [
  // Weapons / self-defence
  'gun','firearm','ammo','ammunition','rifle','pistol','shotgun','silencer','taser','pepper spray','mace','switchblade','weapon','knife',
  'ierocis','ieroči','pistole','šautene','sautene','munīcija','municija','nazis','elektrošoks','piparu gāze','piparu gaze',

  // Drugs / intoxicants
  'cocaine','heroin','meth','fentanyl','weed','marijuana','cannabis','thc','magic mushroom','psychedelic','drug',
  'kokaīns','kokains','heroīns','heroins','narkotika','narkotikas','marihuāna','marihuana','kaņepes','kanepes','halucinogēn',

  // Nicotine / tobacco
  'vape','vaping','nicotine','cigarette','cigar','tobacco',
  'veips','veipot','nikotīns','nikotins','cigarete','cigaretes','tabaka',

  // Alcohol
  'vodka','whiskey','whisky','beer','wine','alcohol','liquor',
  'degvīns','degvins','viskijs','alus','vīns','vins','alkohols','liķieris','likieris',

  // Gambling
  'casino','sportsbook','betting','gambling','roulette','slot machine',
  'kazino','azartspēles','azartspeles','derības','deribas','ruletes','spēļu automāts','spelu automats',

  // Adult / unsafe products
  'porn','pornography','sex toy','adult toy','vibrator','dildo','steroid','anabolic','diet pill','laxative',
  'pornogrāf','pornograf','seksa rotaļlieta','seksrotaļlieta','vibrators','steroīdi','steroidi','anabolis','diētas tabletes','dietas tabletes','caurejas līdzeklis','caurejas lidzeklis',
];

export function isRestrictedShoppingQuery(value: string) {
  const q = value.toLowerCase();
  return blocked.some((term) => q.includes(term));
}

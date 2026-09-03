const blocked = [
  'gun','firearm','ammo','ammunition','rifle','pistol','shotgun','silencer','taser','pepper spray','mace','switchblade','weapon',
  'cocaine','heroin','meth','fentanyl','weed','marijuana','cannabis','thc','magic mushroom','psychedelic','drug',
  'vape','vaping','nicotine','cigarette','cigar','tobacco',
  'vodka','whiskey','whisky','beer','wine','alcohol','liquor',
  'casino','sportsbook','betting','gambling','roulette','slot machine',
  'porn','pornography','sex toy','adult toy','vibrator','dildo','steroid','anabolic','diet pill','laxative'
];

export function isRestrictedShoppingQuery(value: string) {
  const q = value.toLowerCase();
  return blocked.some((term) => q.includes(term));
}

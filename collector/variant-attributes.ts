import type { VariantAttributes } from '../lib/canonical/domain.ts';

const COLORS: Array<[RegExp,string]> = [
  [/\b(?:black|melns|melna|midnight|graphite)\b/i,'Black'],
  [/\b(?:white|balts|balta|starlight|porcelain)\b/i,'White'],
  [/\b(?:blue|zils|zila|navy|ultramarine)\b/i,'Blue'],
  [/\b(?:green|za[lļ]s|za[lļ]a|mint|teal)\b/i,'Green'],
  [/\b(?:grey|gray|pel[eē]ks|pel[eē]ka|silver|sudraba)\b/i,'Gray'],
  [/\b(?:pink|rose|roz[aā])\b/i,'Pink'],
  [/\b(?:red|sarkans|sarkana)\b/i,'Red'],
  [/\b(?:purple|violet|violets|violeta)\b/i,'Purple'],
  [/\b(?:gold|zelta)\b/i,'Gold'],
];

function capacity(value:string){
  const tb=value.match(/\b(1|2|4)\s*TB\b/i); if(tb)return `${tb[1]}TB`;
  const gb=value.match(/\b(32|64|128|256|512|1024)\s*GB\b/i); if(gb)return gb[1]==='1024'?'1TB':`${gb[1]}GB`;
  return undefined;
}

export function inferVariantAttributes(title:string):VariantAttributes{
  const attributes:VariantAttributes={};
  const storage=capacity(title); if(storage)attributes.storage=storage;
  const ram=title.match(/\b(4|6|8|12|16|24|32|48|64|96|128)\s*GB\s*(?:RAM|memory|operat[iī]v\w*)\b/i); if(ram)attributes.ram=`${ram[1]}GB`;
  for(const [pattern,label] of COLORS){ if(pattern.test(title)){ attributes.color=label; break; } }
  if(/\b5G\b/i.test(title))attributes.connectivity='5G'; else if(/\b4G\b/i.test(title))attributes.connectivity='4G';
  const size=title.match(/\b(\d{1,3}(?:[.,]\d)?)\s*(?:inch(?:es)?\b|\")/i); if(size)attributes.size=`${size[1].replace(',','.')}\"`;
  const hz=title.match(/\b(60|75|90|100|120|144|165|180|240|360)\s*Hz\b/i); if(hz)attributes.refreshRate=`${hz[1]}Hz`;
  if(/\bOLED\b/i.test(title))attributes.panelType='OLED'; else if(/\bQLED\b/i.test(title))attributes.panelType='QLED'; else if(/\bMini\s*LED\b/i.test(title))attributes.panelType='Mini LED'; else if(/\bIPS\b/i.test(title))attributes.panelType='IPS';
  if(/\b(?:4K|UHD)\b/i.test(title))attributes.resolution='4K'; else if(/\bQHD\b|2560\s*[x×]\s*1440/i.test(title))attributes.resolution='QHD'; else if(/\bFHD\b|Full\s*HD|1920\s*[x×]\s*1080/i.test(title))attributes.resolution='FHD';
  if(/\b(?:refurbished|refurb|atjaunot\w*)\b/i.test(title))attributes.condition='Refurbished'; else if(/\b(?:used|lietot\w*)\b/i.test(title))attributes.condition='Used'; else if(/\b(?:open\s*box|izpakot\w*|demo)\b/i.test(title))attributes.condition='Open box'; else attributes.condition='New';
  return attributes;
}

import { readFileSync,writeFileSync } from 'node:fs';
import { resolve,dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
export function extractListingFees(source){
  const matches=[...source.matchAll(/<li>(掲載料・予約手数料[^<{}]+)<\/li>/g)];
  if(matches.length!==1)throw new Error('The canonical public listing fee sentence must be unambiguous');
  return matches[0][1];
}
export function generateListingFees(root,{check=false}={}){
  const sentence=extractListingFees(readFileSync(resolve(root,'src/app/terms/page.tsx'),'utf8'));
  const text='// Generated from the public Terms page. Run scripts/generate-line-support-pricing.mjs.\n'
    +'export const LISTING_FEES_NOTICE = '+JSON.stringify(sentence)+';\n';
  const target=resolve(root,'src/lib/public-listing-terms.ts');
  if(check){if(readFileSync(target,'utf8')!==text)throw new Error('Support pricing snapshot is stale');}
  else writeFileSync(target,text);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  generateListingFees(resolve(dirname(fileURLToPath(import.meta.url)),'..'),{check:process.argv.includes('--check')});
}

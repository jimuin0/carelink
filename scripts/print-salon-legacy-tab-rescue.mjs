import { createLegacySalonTabRescue } from './salon-legacy-tab-rescue.mjs';
// Print code for an explicit local DevTools operation; never execute on a page.
console.log(`if (Object.hasOwn(window, 'carelinkLegacyRescue')) throw new Error('回収ツールは既に起動しています。保存後にdisposeしてから終了してください。');\nwindow.carelinkLegacyRescue = (${createLegacySalonTabRescue.toString()})(document);`);

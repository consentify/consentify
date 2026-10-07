// Entry for the script-tag cloud bundle (`dist/consentify-cloud.iife(.min).js`):
// every core export plus `createCloudConsentify` on one `Consentify` global.
// `reportConsent` is server-only, so it is left out. Build-only; not a package export.
export * from './index';
export { createCloudConsentify } from './cloud';

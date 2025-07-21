/* eslint-disable no-use-before-define, no-plusplus, no-continue, no-await-in-loop, no-restricted-syntax, max-len, no-unused-vars, import/no-unresolved, consistent-return, no-undef, no-alert, default-case, no-case-declarations, import/prefer-default-export, no-param-reassign, no-underscore-dangle, no-prototype-builtins, no-loop-func, no-empty */
/* eslint-disable no-use-before-define, no-plusplus, no-continue, no-await-in-loop, no-restricted-syntax, max-len, no-unused-vars, import/no-unresolved, consistent-return */
/* eslint-disable no-use-before-define, no-plusplus, no-continue, no-await-in-loop, no-restricted-syntax */
/* eslint-disable no-use-before-define */
export function isExternalAsset(src, internalDomains = [window.location.hostname]) {
  if (!src) return false;
  let assetDomain;
  try {
    assetDomain = new URL(src).hostname;
  } catch {
    return false;
  }
  if (internalDomains.some((domain) => assetDomain === domain)) return false;
  const externalPatterns = [
    'scene7.com', 'akamai.net', 'cloudfront.net', 's3.amazonaws.com',
    'cdn.', 'static.', 'media.', 'sling.com', 'dish.com',
  ];
  return externalPatterns.some((pattern) => assetDomain.includes(pattern));
}

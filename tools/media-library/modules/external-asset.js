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

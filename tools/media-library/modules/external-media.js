export default function isExternalMedia(src, internalDomains = [window.location.hostname]) {
  if (!src) return false;
  let mediaDomain;
  try {
    mediaDomain = new URL(src).hostname;
  } catch {
    return false;
  }
  if (internalDomains.some((domain) => mediaDomain === domain)) return false;
  const externalPatterns = [
    'scene7.com', 'akamai.net', 'cloudfront.net', 's3.amazonaws.com',
    'cdn.', 'static.', 'media.', 'sling.com', 'dish.com',
  ];
  return externalPatterns.some((pattern) => mediaDomain.includes(pattern));
}

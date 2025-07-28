export const CLOUDFLARE_AI_CONFIG = {
  API_TOKEN: 'YOUR_CLOUDFLARE_API_TOKEN',
  ACCOUNT_ID: 'YOUR_CLOUDFLARE_ACCOUNT_ID',
  MODEL: '@cf/microsoft/git-base-coco',
  BASE_URL: 'https://api.cloudflare.com/client/v4/ai/run',
  TIMEOUT: 30000,
  MAX_ALT_TEXT_LENGTH: 125,
  MAX_RETRIES: 3,
  RETRY_DELAY: 1000,
};

export function getCloudflareAIUrl() {
  return `${CLOUDFLARE_AI_CONFIG.BASE_URL}/${CLOUDFLARE_AI_CONFIG.MODEL}`;
}

export function validateCloudflareConfig() {
  const config = CLOUDFLARE_AI_CONFIG;
  const errors = [];
  if (!config.API_TOKEN || config.API_TOKEN === 'YOUR_CLOUDFLARE_API_TOKEN') {
    errors.push('Cloudflare API Token is not configured');
  }
  if (!config.ACCOUNT_ID || config.ACCOUNT_ID === 'YOUR_CLOUDFLARE_ACCOUNT_ID') {
    errors.push('Cloudflare Account ID is not configured');
  }
  return {
    isValid: errors.length === 0,
    errors,
  };
}
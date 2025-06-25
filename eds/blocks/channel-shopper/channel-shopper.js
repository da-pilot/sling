import {
  createTag, loadScript, readBlockConfig, decodeAmpersand,
  rewriteLinksForSlingDomain,
} from '../../scripts/utils.js';

const options = {
  threshold: 0,
};
// eslint-disable-next-line no-use-before-define
const observer = new IntersectionObserver(loadReactLib, options);
async function loadReactLib(entries) {
  if (entries.some(async (entry) => {
    if (entry.isIntersecting) {
      await loadScript('../../../eds/scripts/sling-react/channel-shopper-build.js', {}, entry.target);
      observer.unobserve(entry.target);
    }
  }));
}
export default async function decorate(block) {
  const config = await readBlockConfig(block);

  // note the channelIconUrl which is overwriting the path from /content/dam to drive location
  const slingProps = {
    classification: 'us',
    planIdentifier: config.planIdentifier?.trim() ? config.planIdentifier : 'one-month',
    planOfferIdentifier: config.planOfferIdentifier?.trim() ? config.planOfferIdentifier : 'monthly',
    buttonText: config.buttonText?.trim() ? config.buttonText : 'Shop By Channel',
    modalHeaderText: config.modalHeaderText?.trim() ? config.modalHeaderText : 'Choose the channels you like to watch & we\'ll recommend the best plan for you!',
    searchChannelPlaceholder: config.searchChannelPlaceholder?.trim() ? config.searchChannelPlaceholder : 'Search channels...',
    noResultFoundText: config.noResultFoundText?.trim() ? config.noResultFoundText : 'We couldn\'t find this channel, but we found other channels you might like.',
    recommendationText: config.recommendationText?.trim() ? config.recommendationText : 'Choose a channel to view a recommendation',
    localBadgeText: config.localBadgeText?.trim() ? config.localBadgeText : 'Local',
    checkoutButtonText: config.checkoutButtonText?.trim() ? config.checkoutButtonText : 'Checkout',
    channelIconUrl: '/eds/icons/channels/allloblogos/color',
    ctaUrl: config.ctaUrl ? decodeAmpersand(config.ctaUrl) : '/cart/magento/account',
    maxChannelsSelected: typeof config.maxChannelsSelected === 'number' ? config.maxChannelsSelected : 5,
    limitHitErrorText: config.limitHitErrorText?.trim() ? config.limitHitErrorText : 'Unselect a channel to add another. To view all channels in your recommended plan, click the \'more\' button(s).',
    errorMsgDuration: typeof config.errorMsgDuration === 'number' ? config.errorMsgDuration : 5000,
    promoTruncateCharLimit: typeof config.promoTruncateCharLimit === 'number' ? config.promoTruncateCharLimit : 13,
  };

  const container = createTag('div', { id: 'channel-shopper-app', 'data-sling-props': JSON.stringify(slingProps) });
  block.append(container);

  observer.observe(block);

  // Patch cart links for sling.com redirection
  rewriteLinksForSlingDomain(container, /^\/cart/);
}

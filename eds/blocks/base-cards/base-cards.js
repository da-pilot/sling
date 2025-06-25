import {
  createTag, readBlockConfig, loadScript, decodeAmpersand,
  rewriteLinksForSlingDomain,
} from '../../scripts/utils.js';

const options = {
  threshold: 0.25,
};// eslint-disable-next-line no-use-before-define
const observer = new IntersectionObserver(await loadReactLib, options);

function lowercaseSVGFileNames(node) {
  node.querySelectorAll('img[src$=".svg"]').forEach((img) => {
    const url = new URL(img.src, window.location.origin);
    const parts = url.pathname.split('/');
    const filename = parts.pop();
    const [name, ext] = filename.split('.');
    if (name !== name.toLowerCase()) {
      parts.push(`${name.toLowerCase()}.${ext}`);
      url.pathname = parts.join('/');
      img.src = url.toString();
    }
  });
}

function observeBaseCardsApp() {
  const container = document.querySelector('.base-cards.block #base-cards-app');
  if (!container) return;
  lowercaseSVGFileNames(container);
  const mo = new MutationObserver(() => {
    lowercaseSVGFileNames(container);
  });
  mo.observe(container, { childList: true, subtree: true });

  // Disconnect observers when the container is removed from the DOM
  const removalObserver = new MutationObserver(() => {
    if (!document.body.contains(container)) {
      mo.disconnect();
      removalObserver.disconnect();
    }
  });
  removalObserver.observe(document.body, { childList: true, subtree: true });

  // Patch cart links for sling.com redirection
  rewriteLinksForSlingDomain(container, /^\/cart/);
}

async function loadReactLib(entries) {
  if (entries.some((entry) => entry.isIntersecting)) {
    await loadScript('../../../eds/scripts/sling-react/base-cards-build.js', {}, entries.find((entry) => entry.isIntersecting).target);
    observer.unobserve(entries.find((entry) => entry.isIntersecting).target);
    observeBaseCardsApp();
  }
}

export default async function decorate(block) {
  const config = await readBlockConfig(block);
  const slingProps = {
    optionalSectionTitleText: config['Optional-Section-Title-Text']?.trim() ? config['Optional-Section-Title-Text'] : 'Sling TV Services',
    optionalSectionSubtitleText: config['Optional-Section-Subtitle-Text']?.trim() ? config['Optional-Section-Subtitle-Text'] : 'No annual contracts. Customize with extras.',
    blueServiceDeviceStreamsText: config['Blue-Service-Device-Stream-Text']?.trim() ? config['Blue-Service-Device-Stream-Text'] : 'Stream on 3 devices at a time',
    orangeServiceDeviceStreamsText: config['Orange-Service-Device-Stream-Text']?.trim() ? config['Orange-Service-Device-Stream-Text'] : 'Stream on 1 device at a time',
    comboServiceDeviceStreamsText: config['Combo-Service-Device-Stream-Text']?.trim() ? config['Combo-Service-Device-Stream-Text'] : '3 + 1 device streams',
    blueServiceDVRText: config['Blue-Service-DVR-Text']?.trim() ? config['Blue-Service-DVR-Text'] : '50 Hours DVR Storage Included',
    orangeServiceDVRText: config['Orange-Service-DVR-Text']?.trim() ? config['Orange-Service-DVR-Text'] : '50 Hours DVR Storage Included',
    comboServiceDVRText: config['Combo-Service-DVR-Text']?.trim() ? config['Combo-Service-DVR-Text'] : '50 Hours DVR Storage Included',
    orangeExclusiveChannelsGenres: 'Sports and Family',
    blueExclusiveChannelsGenres: 'News and Entertainment',
    showOrangeHighlightBanner: false,
    showBlueHighlightBanner: false,
    showComboHighlightBanner: false,
    blueServiceGoodForOne: config['Blue-Service-First-Good-For-Text']?.trim() ? config['Blue-Service-First-Good-For-Text'] : 'Families',
    orangeServiceGoodForOne: config['Orange-Service-First-Good-For-Text']?.trim() ? config['Orange-Service-First-Good-For-Text'] : 'Lifestyle',
    comboServiceGoodForOne: config['Combo-Service-First-Good-For-Text']?.trim() ? config['Combo-Service-First-Good-For-Text'] : 'Sports',
    blueServiceGoodForTwo: config['Blue-Service-Second-Good-For-Text']?.trim() ? config['Blue-Service-Second-Good-For-Text'] : 'NFL Fans',
    orangeServiceGoodForTwo: config['Orange-Service-Second-Good-For-Text']?.trim() ? config['Orange-Service-Second-Good-For-Text'] : 'Sports Lovers',
    comboServiceGoodForTwo: config['Combo-Service-Second-Good-For-Text']?.trim() ? config['Combo-Service-Second-Good-For-Text'] : 'Entertainment',
    showLocalsBanners: typeof config['Show-locals-banner-on-blue-and-combo-card'] === 'boolean' ? config['Show-locals-banner-on-blue-and-combo-card'] : true,
    classification: 'us',
    iconURLBase: config['Icons-Root-Path']?.trim() ? config['Icons-Root-Path'] : '/eds/icons/channels/allloblogos/color',
    grayIconURLBase: config['Gray-Icons-Root-Path']?.trim() ? config['Gray-Icons-Root-Path'] : '/eds/icons/channels/allloblogos/color',
    ctaStyle: 'primary',
    ctaTheme: 'light',
    ctaSubText: 'Offer Details',
    ctaSubTextColor: 'marshmallow',
    ctaSubTextDesktopAlignment: 'left',
    ctaSubTextMobileAlignment: 'left',
    planIdentifier: config['Plan-Identifier']?.trim() ? config['Plan-Identifier'] : 'one-month',
    planOfferIdentifier: config['Plan-Offer-Identifier']?.trim() ? config['Plan-Offer-Identifier'] : 'extra-stair-step-2',
    comparisonComponentProps: {
      analyticsModalName: 'package-compare-v2',
      usePageScroll: false,
      modalWidth: '1000px',
      modalHeight: '80%',
      headerText: 'Sling Channels',
      subheaderText: "Don't see a channel you like? More channels are available in add-ons.",
      slingComboAuthoredName: 'Get Both',
      monthText: ' ',
      compareIconURLBase: '/eds/icons/channels/allloblogos/color',
      hideFooterCTA: true,
      footerCtaLink: config['Footer-CTA-Link']?.trim() ? decodeAmpersand(config['Footer-CTA-Link']) : '/cart/magento/account?classification=us&plan=one-month&plan_offer=extra-stair-step-2',
      footerCtaText: config['Footer-CTA-Text']?.trim() ? config['Footer-CTA-Text'] : 'Try Us Today',
      targetWindow: '_self',
      mobileStickyCTATextColor: 'White',
      orangeServiceCTALink: config['Orange-Service-CTA-Link']?.trim() ? decodeAmpersand(config['Orange-Service-CTA-Link']) : '/cart/magento/account?classification=us&plan=one-month&plan_offer=extra-stair-step-2&sb=domestic',
      blueServiceCTALink: config['Blue-Service-CTA-Link']?.trim() ? decodeAmpersand(config['Blue-Service-CTA-Link']) : '/cart/magento/account?classification=us&plan=one-month&plan_offer=extra-stair-step-2&sb=sling-mss',
      comboServiceCTALink: config['Combo-Service-CTA-Link']?.trim() ? decodeAmpersand(config['Combo-Service-CTA-Link']) : '/cart/magento/account?classification=us&plan=one-month&plan_offer=extra-stair-step-2&sb=sling-combo',
      orangeServiceCTAText: config['Orange-Service-CTA-Text']?.trim() ? config['Orange-Service-CTA-Text'] : 'Add Orange',
      blueServiceCTAText: config['Blue-Service-CTA-Text']?.trim() ? config['Blue-Service-CTA-Text'] : 'Add Blue',
      comboServiceCTAText: config['Combo-Service-CTA-Text']?.trim() ? config['Combo-Service-CTA-Text'] : 'Add Both',
      orangeServiceTitleText: config['Orange-Service-Title-Text']?.trim() ? config['Orange-Service-Title-Text'] : 'Orange',
      blueServiceTitleText: config['Blue-Service-Title-Text']?.trim() ? config['Blue-Service-Title-Text'] : 'Blue',
      comboServiceTitleText: config['Combo-Service-Title-Text']?.trim() ? config['Combo-Service-Title-Text'] : 'Orange & Blue',
      servicesCompareToolBlueCtaText: config['Blue-CTA-Text']?.trim() ? config['Blue-CTA-Text'] : 'Select',
      servicesCompareToolOrangeCtaText: config['Orange-CTA-Text']?.trim() ? config['Orange-CTA-Text'] : 'Select',
      servicesCompareToolComboCtaText: config['Combo-CTA-Text']?.trim() ? config['Combo-CTA-Text'] : 'Select',
      domesticSegmentSectionText: 'Only on Sling Orange: {channelCount} channels',
      domesticSegmentSectionTextColor: '#171725',
      domesticSegmentSectionTextBackgroundColor: 'rgb(255,152,0)',
      slingMssSegmentSectionText: 'Only on Sling Blue: {channelCount} channels',
      slingMssSegmentSectionTextColor: '#E9E9EA',
      slingMssSegmentSectionTextBackgroundColor: 'rgb(0,50,175)',
      slingMssLocalsSegmentSectionText: 'Live Local Channels in {zipCode}',
      slingMssLocalsSegmentSectionTextColor: '#171725',
      slingMssLocalsSegmentSectionTextBackgroundColor: '#C3C3C3',
      slingMssOtherChannelsSegmentSectionText: 'More Channels on Sling Blue',
      slingMssOtherChannelsSegmentSectionTextColor: '#171725',
      slingMssOtherChannelsSegmentSectionTextBackgroundColor: '#C3C3C3',
      slingComboSegmentSectionText: 'Available in All Base Services: {channelCount} channels',
      slingComboSegmentSectionTextColor: '#E9E9EA',
      domesticSegmentSectionTextBackground: 'linear-gradient(90deg, rgba(255,152,0,1) 0%, rgba(255,208,60,1) 100%);',
      slingMssSegmentSectionTextBackground: 'linear-gradient(90deg, rgba(0,50,175,1) 0%, rgba(0,91,255,1) 100%)',
      slingComboSegmentSectionTextBackground: 'linear-gradient(90deg, rgba(23,23,37,1) 0%, rgba(0,50,175,1) 100%)',
      invalidZipText: 'Invalid ZIP Code',
      zipLabel: 'ZIP Code',
    },
    useV2ComparisonModal: true,
  };

  const container = createTag('div', { id: 'base-cards-app', 'data-sling-props': JSON.stringify(slingProps) });
  block.append(container);
  observer.observe(block);
  // listen to zipcode changes and redecorate
  document.addEventListener('zipupdate', async () => {
    await loadScript('../../../eds/scripts/sling-react/base-cards-build.js', {}, block);
    observeBaseCardsApp();
    // Patch cart links again after zip update
    const zipUpdateContainer = document.querySelector('.base-cards.block #base-cards-app');
    if (zipUpdateContainer) {
      rewriteLinksForSlingDomain(zipUpdateContainer, /^\/cart/);
    }
  });

  // Clean up any divs without IDs first
  const divsWithoutId = block.querySelectorAll('div:not([id])');
  divsWithoutId.forEach((div) => div.remove());
}

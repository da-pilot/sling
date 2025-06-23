import {
  createTag, readBlockConfig, decodeAmpersand, rewriteLinksForSlingDomain,
} from '../../scripts/utils.js';

function hideOrphanNoGamesDivs(container) {
  container.querySelectorAll('div').forEach(function(div) {
    if (div.textContent.trim().startsWith('No games are available on Sling for this date.')) {
      const prev = div.previousElementSibling;
      if (
        !prev ||
        !/^\w+,\s+\w+\s+\d{1,2},\s+\d{4}$/.test(prev.textContent.trim())
      ) {
        div.remove();
      }
    }
  });
}

export default async function decorate(block) {
  localStorage.setItem('user_dma', '524');
  const defultProps = {
    showFilter: false,
    channelsLogoPath: '/aemedge/icons/channels/AllLOBLogos/color',
    modalChannelsLogoPath: '/aemedge/icons/application-assets/shared/web/logos/black',
    filterOnlyFirstTwoPosition: false,
    showDetailsModal: false,
    agentView: false,
    packageFilterDefault: 'Available on Sling',
    matchupImgFormat: 'png',
    blackoutText:'*Blackout restrictions apply. All games subject to broadcast restrictions as determined by geographic location.',
    packageNotAvailableText: "Not Available",
    teamSearchPlaceholder: "Find my team"
  };
  const config = await readBlockConfig(block);
  // Clean up config values
  const cleanedConfig = {};
  Object.entries(config).forEach(([key, value]) => {
    if (typeof value === 'string') {
      cleanedConfig[key] = value.trim() ? value : undefined;
    } else if (typeof value === 'number') {
      cleanedConfig[key] = !Number.isNaN(value) ? value : undefined;
    } else if (typeof value === 'boolean') {
      cleanedConfig[key] = value;
    } else {
      cleanedConfig[key] = value;
    }
  });
  if (cleanedConfig.leagueList) {
    cleanedConfig.leagueList = cleanedConfig.leagueList
      .split(',')
      .map((item) => item.trim().replace(/^"(.+)"$/, '$1').replace(/^'(.*)'$/, '$1'));
  }
  if (cleanedConfig.numberOfDays) {
    cleanedConfig.numberOfDays = parseInt(cleanedConfig.numberOfDays, 10);
    if (Number.isNaN(cleanedConfig.numberOfDays)) delete cleanedConfig.numberOfDays;
  }
  if (cleanedConfig.preselectUrlPath) {
    cleanedConfig.preselectUrlPath = decodeAmpersand(cleanedConfig.preselectUrlPath);
  }
  const slingProps = { ...defultProps, ...cleanedConfig };
  const container = createTag('div', { id: 'gmfinder-app', 'data-sling-props': JSON.stringify(slingProps) });
  block.append(container);
  rewriteLinksForSlingDomain(container, /^\/cart/);
  const divsWithoutId = block.querySelectorAll('div:not([id])');
  divsWithoutId.forEach((div) => div.remove());

  const observer = new MutationObserver(() => hideOrphanNoGamesDivs(container));
  observer.observe(container, { childList: true, subtree: true });
  hideOrphanNoGamesDivs(container);
}
import { createTag, readBlockConfig } from '../../scripts/utils.js';

export default async function decorate(block) {
  const defultProps = {
    showFilter: false,
    channelsLogoPath: '/aemedge/icons/channels/AllLOBLogos/color',
    modalChannelsLogoPath: '/aemedge/icons/application-assets/shared/web/logos/black',
    filterOnlyFirstTwoPosition: false,
    showDetailsModal: false,
    agentView: false,
    packageFilterDefault: 'All Games',
    matchupImgFormat: 'png',
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
    cleanedConfig.leagueList = cleanedConfig.leagueList.split(',');
  }
  if (cleanedConfig.numberOfDays) {
    cleanedConfig.numberOfDays = parseInt(cleanedConfig.numberOfDays, 10);
    if (Number.isNaN(cleanedConfig.numberOfDays)) delete cleanedConfig.numberOfDays;
  }
  const slingProps = { ...defultProps, ...cleanedConfig };
  const container = createTag('div', { id: 'gmfinder-app', 'data-sling-props': JSON.stringify(slingProps) });
  block.append(container);
}

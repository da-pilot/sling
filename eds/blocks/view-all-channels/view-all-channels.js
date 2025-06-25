import { createTag } from '../../scripts/utils.js';

const defaultProps = {
  id: 'view-all-channels',
  package2Identifier: null,
  package2Type: null,
  package2Name: null,
};

const CONFIG = {
  baseURL: 'https://www.slingcommerce.com/graphql',
  channelLogoBaseURL: '/eds/icons/application-assets/shared/web/logos/black',
};

function normalizeConfigKeys(config) {
  const normalized = {};
  Object.keys(config).forEach((key) => {
    normalized[key.trim().toLowerCase()] = config[key];
  });
  return normalized;
}

function toPropName(name) {
  return typeof name === 'string'
    ? name
      .replace(/[^0-9a-z]/gi, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
    : '';
}

function readBlockConfigForViewAllChannels(block) {
  const config = {};
  block.querySelectorAll(':scope > div:not([id])').forEach((row) => {
    if (row.children) {
      const cols = [...row.children];
      if (cols[1]) {
        const name = toPropName(cols[0].textContent).toLowerCase().trim();
        const col = cols[1];
        let value = '';
        if (col.querySelector('img')) {
          const imgs = [...col.querySelectorAll('img')];
          if (imgs.length === 1) {
            value = imgs[0].src;
          } else {
            value = imgs.map((img) => img.src);
          }
        } else if (col.querySelector('p')) {
          const ps = [...col.querySelectorAll('p')];
          if (ps.length === 1) {
            value = ps[0].innerHTML;
          } else {
            value = ps.map((p) => p.textContent);
          }
        } else value = row.children[1].textContent;
        config[name] = value;
      }
    }
  });
  return config;
}

async function fetchPackageChannels(packageIdentifier, packageType = 'base_linear') {
  const query = `
    query GetPackage($filter: PackageAttributeFilterInput) {
      packages(filter: $filter) {
        items {
          package {
            name
            canonical_identifier
            channels {
              call_sign
              name
            }
          }
        }
      }
    }
  `;

  const variables = {
    filter: {
      pck_type: { in: [packageType] },
      is_channel_required: { eq: true },
      tag: { in: ['us'] },
      plan_identifier: { eq: 'one-month' },
      plan_offer_identifier: { eq: 'monthly' },
      region_id: ['5'],
    },
  };

  try {
    const response = await fetch(CONFIG.baseURL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables, operationName: 'GetPackage' }),
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();

    if (data.errors) {
      return null;
    }

    if (!data.data
        || !data.data.packages
        || !data.data.packages.items
        || !data.data.packages.items.package) {
      return null;
    }

    const allPackages = data.data.packages.items.package;

    // Find matching package with improved logic
    const selectedPackage = allPackages.find((pkg) => {
      const identifier = pkg.canonical_identifier;

      // Exact match first
      if (identifier === packageIdentifier) return true;

      // Handle specific known mappings
      if (packageIdentifier === 'sling-mss' && identifier === 'sling-mss') return true;
      if (packageIdentifier === 'sports-extra-mss-2' && identifier === 'sports-extra') return true;
      if (packageIdentifier === 'sling-combo' && (identifier === 'sling-combo' || identifier.includes('combo'))) return true;

      return false;
    });

    if (selectedPackage && selectedPackage.channels) {
      const channels = selectedPackage.channels.map((channel) => ({
        call_sign: channel.call_sign,
        name: channel.name,
      }));

      return {
        name: selectedPackage.name,
        channels,
      };
    }

    return null;
  } catch (error) {
    return null;
  }
}

async function fetchCombinedChannels(
  package1Identifier,
  package1Type,
  package2Identifier,
  package2Type,
) {
  const [package1Data, package2Data] = await Promise.all([
    fetchPackageChannels(package1Identifier, package1Type),
    fetchPackageChannels(package2Identifier, package2Type),
  ]);

  if (!package1Data && !package2Data) {
    return null;
  }

  const combinedChannels = [];
  const channelMap = new Map();

  // Add channels from package 1
  if (package1Data && package1Data.channels) {
    package1Data.channels.forEach((channel) => {
      if (!channelMap.has(channel.call_sign)) {
        channelMap.set(channel.call_sign, channel);
        combinedChannels.push(channel);
      }
    });
  }

  // Add channels from package 2 (avoiding duplicates)
  if (package2Data && package2Data.channels) {
    package2Data.channels.forEach((channel) => {
      if (!channelMap.has(channel.call_sign)) {
        channelMap.set(channel.call_sign, channel);
        combinedChannels.push(channel);
      }
    });
  }

  const packageNames = [
    package1Data?.name,
    package2Data?.name,
  ].filter(Boolean).join(' + ');

  return {
    name: packageNames,
    channels: combinedChannels,
  };
}

function renderChannelIcons(container, packageData) {
  if (!packageData || !packageData.channels) {
    container.innerHTML = '<p class="no-channels">No channels available</p>';
    return;
  }

  const content = createTag('div', { class: 'view-all-channels-content' });
  const grid = createTag('div', { class: 'channels-grid' });

  packageData.channels.forEach((channel) => {
    const channelItem = createTag('div', { class: 'channel-item' });
    const img = createTag('img', {
      src: `${CONFIG.channelLogoBaseURL}/${channel.call_sign.toLowerCase()}.svg`,
      alt: channel.name,
      title: channel.name,
      loading: 'lazy',
    });

    // Handle image load errors by hiding the item
    img.onerror = () => {
      channelItem.style.display = 'none';
    };

    channelItem.appendChild(img);
    grid.appendChild(channelItem);
  });

  content.appendChild(grid);
  container.appendChild(content);
}

export async function getPackageChannels(packageIdentifier, packageType = 'base_linear') {
  return fetchPackageChannels(packageIdentifier, packageType);
}

export async function getCombinedPackageChannels(
  package1Identifier,
  package1Type,
  package2Identifier,
  package2Type,
) {
  return fetchCombinedChannels(
    package1Identifier,
    package1Type,
    package2Identifier,
    package2Type,
  );
}

export default async function decorate(block) {
  const config = normalizeConfigKeys({
    ...defaultProps,
    ...readBlockConfigForViewAllChannels(block),
  });

  const package1Identifier = config.package1identifier || config['package-1-identifier'] || defaultProps.package1Identifier;
  const package1Type = config.package1type || config['package-1-type'] || defaultProps.package1Type;

  const package2Identifier = config.package2identifier || config['package-2-identifier'] || defaultProps.package2Identifier;
  const package2Type = config.package2type || config['package-2-type'] || defaultProps.package2Type;

  block.innerHTML = '';

  try {
    let packageData;

    if (package2Identifier && package2Type) {
      // Combined packages
      packageData = await fetchCombinedChannels(
        package1Identifier,
        package1Type,
        package2Identifier,
        package2Type,
      );
      renderChannelIcons(block, packageData);
    } else if (package1Identifier && package1Type) {
      // Single package
      packageData = await fetchPackageChannels(package1Identifier, package1Type);
      renderChannelIcons(block, packageData);
    }
  } catch (error) {
    // Silent error handling
  }
}
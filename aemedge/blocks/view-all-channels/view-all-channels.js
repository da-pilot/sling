import { createTag } from '../../scripts/utils.js';

const defaultProps = {
  id: 'view-all-channels',
  package1Identifier: 'sling-mss',
  package1Type: 'base_linear',
  package1Name: 'Sling Blue',
  package2Identifier: null,
  package2Type: null,
  package2Name: null,
  showTitle: true,
};

const CONFIG = {
  baseURL: 'https://www.slingcommerce.com/graphql',
  channelLogoBaseURL: '/aemedge/icons/application-assets/shared/web/logos/black',
  cachePrefix: 'sling_package_',
  cacheExpiry: 5 * 60 * 1000, // 5 minutes
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

function getCacheKey(packageIdentifier, packageType) {
  return `${CONFIG.cachePrefix}${packageIdentifier}_${packageType}`;
}

function getCachedData(cacheKey) {
  try {
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      const { data, timestamp } = JSON.parse(cached);
      if (Date.now() - timestamp < CONFIG.cacheExpiry) {
        return data;
      }
      localStorage.removeItem(cacheKey);
    }
  } catch (error) {
    // Ignore cache errors and fetch fresh data
  }
  return null;
}

function setCachedData(cacheKey, data) {
  try {
    const cacheObject = {
      data,
      timestamp: Date.now(),
      expiry: CONFIG.cacheExpiry,
    };
    localStorage.setItem(cacheKey, JSON.stringify(cacheObject));
  } catch (error) {
    // Ignore cache errors (storage might be full or disabled)
  }
}

async function fetchPackageChannels(packageIdentifier, packageType = 'base_linear') {
  const cacheKey = getCacheKey(packageIdentifier, packageType);
  const cachedData = getCachedData(cacheKey);

  if (cachedData) {
    return cachedData;
  }

  const query = `
    query GetPackage($filter: PackageAttributeFilterInput) {
      packages(filter: $filter) {
        items {
          plan {
            plan_code
            plan_identifier
            plan_name
            __typename
          }
          planOffer {
            plan_offer_identifier
            discount
            discount_type
            plan_offer_name
            offer_identifier
            description
            __typename
          }
          package {
            name
            base_price
            sku
            channels {
              identifier
              call_sign
              name
              __typename
            }
            plan_offer_price
            canonical_identifier
            __typename
          }
          __typename
        }
        __typename
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

    const selectedPackage = allPackages.find(
      (pkg) => pkg.canonical_identifier === packageIdentifier
      || (packageIdentifier === 'sling-mss' && pkg.canonical_identifier === 'sling-mss')
      || (packageIdentifier === 'domestic' && pkg.canonical_identifier === 'domestic')
      || (packageIdentifier === 'sling-combo' && pkg.canonical_identifier.includes('combo')),
    );

    if (selectedPackage && selectedPackage.channels) {
      const result = {
        name: selectedPackage.name,
        channels: selectedPackage.channels.map((channel) => ({
          call_sign: channel.call_sign,
          name: channel.name,
        })),
      };

      setCachedData(cacheKey, result);
      return result;
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

  if (package1Data && package1Data.channels) {
    package1Data.channels.forEach((channel) => {
      if (!channelMap.has(channel.call_sign)) {
        channelMap.set(channel.call_sign, channel);
        combinedChannels.push(channel);
      }
    });
  }

  if (package2Data && package2Data.channels) {
    package2Data.channels.forEach((channel) => {
      if (!channelMap.has(channel.call_sign)) {
        channelMap.set(channel.call_sign, channel);
        combinedChannels.push(channel);
      }
    });
  }

  return {
    name: 'Combined Packages',
    channels: combinedChannels,
  };
}

function renderChannelIcons(container, packageData, showTitle = true, customTitle = null) {
  if (!packageData || !packageData.channels) {
    container.innerHTML = '<p class="no-channels">No channels available</p>';
    return;
  }

  const content = createTag('div', { class: 'view-all-channels-content' });

  if (showTitle) {
    const header = createTag('div', { class: 'channels-header' });
    const titleText = customTitle || packageData.name;
    const title = createTag('h2', {}, `${titleText} Channels`);
    header.appendChild(title);
    content.appendChild(header);
  }

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
  const package1Name = config.package1name || config['package-1-name'] || defaultProps.package1Name;

  const package2Identifier = config.package2identifier || config['package-2-identifier'] || defaultProps.package2Identifier;
  const package2Type = config.package2type || config['package-2-type'] || defaultProps.package2Type;

  const showTitle = config.showtitle !== undefined ? config.showtitle !== 'false' : defaultProps.showTitle;

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
      // For combined packages, use a generic title or package1 name
      renderChannelIcons(block, packageData, showTitle, package1Name);
    } else if (package1Identifier && package1Type) {
      // Single package
      packageData = await fetchPackageChannels(package1Identifier, package1Type);
      renderChannelIcons(block, packageData, showTitle, package1Name);
    } else {
      // No packages configured - silent error
      console.error('View All Channels: Please configure Package 1 Identifier and Package 1 Type');
    }
  } catch (error) {
    console.error('View All Channels: Unable to load channels', error);
  }
}
import { createTag, decodeAmpersand } from '../../scripts/utils.js';

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

async function readBlockConfigForViewAllChannels(block) {
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

export const defaultProps = {
  id: 'view-all-channels',
  viewAllChannelsText: 'View All Channels',
  package1Identifier: 'sling-mss',
  package1Type: 'base_linear',
  package1Name: 'Sling Blue',
  package2Identifier: null,
  package2Type: null,
  package2Name: null,
};

class ChannelModal {
  constructor() {
    this.baseURL = 'https://www.slingcommerce.com/graphql';
    this.channelLogoBaseURL = '/aemedge/icons/sling-tv/channels/AllLOBLogos/Color';
  }

  async fetchPackageChannels(packageIdentifier, packageType = 'base_linear') {
    console.log('🔍 Fetching channels for package:', packageIdentifier);

    // Use the exact working GraphQL query from the live site
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

    console.log('📤 GraphQL Variables:', JSON.stringify(variables, null, 2));

    try {
      const response = await fetch(this.baseURL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, variables, operationName: 'GetPackage' }),
      });

      if (!response.ok) {
        console.error('HTTP Error:', response.status, response.statusText);
        return null;
      }

      const data = await response.json();
      console.log('📥 GraphQL Response received');

      if (data.errors) {
        console.error('GraphQL Errors:', data.errors);
        return null;
      }

      // Handle the correct response structure: data.packages.items.package (array)
      if (!data.data || !data.data.packages || !data.data.packages.items || !data.data.packages.items.package) {
        console.error('Unexpected response structure:', data);
        return null;
      }

      const allPackages = data.data.packages.items.package;
      console.log('📦 Available packages:', allPackages.map((pkg) => `${pkg.name} (${pkg.canonical_identifier})`));

      // Find package by canonical_identifier
      const selectedPackage = allPackages.find((pkg) => pkg.canonical_identifier === packageIdentifier
        || (packageIdentifier === 'sling-mss' && pkg.canonical_identifier === 'sling-mss')
        || (packageIdentifier === 'domestic' && pkg.canonical_identifier === 'domestic')
        || (packageIdentifier === 'sling-combo' && pkg.canonical_identifier.includes('combo')));

      if (selectedPackage && selectedPackage.channels) {
        console.log(
          '✅ Selected package:',
          selectedPackage.name,
          'with',
          selectedPackage.channels.length,
          'channels',
        );

        return {
          name: selectedPackage.name,
          channels: selectedPackage.channels.map((channel) => ({
            call_sign: channel.call_sign,
            name: channel.name,
          })),
        };
      }

      console.log('❌ No package found for identifier:', packageIdentifier);
      return null;
    } catch (error) {
      console.error('Error fetching package channels:', error);
      return null;
    }
  }

  createModal(packageData, modalTitle = null) {
    const modal = document.createElement('div');
    modal.className = 'channel-modal-overlay';

    // Use custom title if provided, otherwise use package name
    const title = modalTitle || `${packageData.name} Channels`;

    modal.innerHTML = `
      <div class="channel-modal">
        <div class="modal-header">
          <h2>${title}</h2>
          <button class="close-btn">&times;</button>
        </div>
        <div class="modal-body">
          <div class="channels-grid">
            ${packageData.channels.map((channel) => `
              <div class="channel-item">
                <img src="${this.channelLogoBaseURL}/${channel.call_sign.toLowerCase()}.svg" 
                     alt="${channel.name}" 
                     onerror="this.style.display='none'"
                     loading="lazy">
                <span>${channel.name}</span>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    `;

    // Close functionality
    modal.querySelector('.close-btn').onclick = () => modal.remove();
    modal.onclick = (e) => {
      if (e.target === modal) modal.remove();
    };

    document.body.appendChild(modal);
  }

  async showChannelsModal(packageIdentifier, packageType, modalTitle = null) {
    const packageData = await this.fetchPackageChannels(packageIdentifier, packageType);
    if (packageData && packageData.channels) {
      this.createModal(packageData, modalTitle);
    } else {
      console.error('Unable to load channel information for package:', packageIdentifier);
    }
  }

  async showCombinedChannelsModal(package1Identifier, package1Type, package2Identifier, package2Type, planIdentifier = 'one-month', modalTitle = 'All Channels') {
    try {
      // Fetch both packages simultaneously
      const [package1Data, package2Data] = await Promise.all([
        this.fetchPackageChannels(package1Identifier, package1Type, planIdentifier),
        this.fetchPackageChannels(package2Identifier, package2Type, planIdentifier),
      ]);

      // Combine channels from both packages
      const channelMap = new Map(); // To avoid duplicates

      // Add channels from package 1
      if (package1Data && package1Data.channels) {
        package1Data.channels.forEach((channel) => {
          channelMap.set(channel.call_sign, channel);
        });
      }

      // Add channels from package 2
      if (package2Data && package2Data.channels) {
        package2Data.channels.forEach((channel) => {
          channelMap.set(channel.call_sign, channel);
        });
      }

      // Convert map to array and sort alphabetically
      const combinedChannels = Array.from(channelMap.values())
        .sort((a, b) => a.name.localeCompare(b.name));

      if (combinedChannels.length > 0) {
        // Create a combined package object
        const combinedPackageData = {
          name: 'Combined',
          channels: combinedChannels,
        };

        this.createModal(combinedPackageData, modalTitle);
      } else {
        console.error('Unable to load channel information for combined packages');
      }
    } catch (error) {
      console.error('Error fetching combined channel data:', error);
    }
  }
}

export default async function decorate(block) {
  let config = await readBlockConfigForViewAllChannels(block);
  config = normalizeConfigKeys(config);

  // Map the config keys to the correct prop names and decode HTML entities
  const props = {
    ...defaultProps,
    id: config.id || defaultProps.id,
    viewAllChannelsText: decodeAmpersand(config['view-all-channels-text'] || defaultProps.viewAllChannelsText),
    package1Identifier: config['package-1-identifier'] || defaultProps.package1Identifier,
    package1Type: config['package-1-type'] || defaultProps.package1Type,
    package1Name: config['package-1-name'] ? decodeAmpersand(config['package-1-name']) : defaultProps.package1Name,
    package2Identifier: config['package-2-identifier'] || null,
    package2Type: config['package-2-type'] || null,
    package2Name: config['package-2-name'] ? decodeAmpersand(config['package-2-name']) : null,
    viewAllChannelsTextColor: config['view-all-channels-text-color'] || '#0078AD',
  };

  // Initialize channel modal
  const channelModal = new ChannelModal();

  // Create container for the view all channels functionality
  const container = createTag('div', {
    class: 'view-all-channels-container',
  });

  // Check if both packages are configured
  if (props.package1Identifier && props.package2Identifier) {
    // Show single link for combined channels
    const combinedLink = createTag('a', {
      href: '#',
      class: 'view-all-channels-link',
      style: `color: ${props.viewAllChannelsTextColor} !important;`,
    });
    combinedLink.textContent = props.viewAllChannelsText;

    combinedLink.addEventListener('click', async (e) => {
      e.preventDefault();
      await channelModal.showCombinedChannelsModal(
        props.package1Identifier,
        props.package1Type,
        props.package2Identifier,
        props.package2Type,
        'one-month',
        props.viewAllChannelsText,
      );
    });

    container.appendChild(combinedLink);
  } else if (props.package1Identifier) {
    // Show link for package 1 only
    const package1Link = createTag('a', {
      href: '#',
      class: 'view-all-channels-link',
      style: `color: ${props.viewAllChannelsTextColor} !important;`,
    });
    package1Link.textContent = props.viewAllChannelsText;

    package1Link.addEventListener('click', async (e) => {
      e.preventDefault();
      await channelModal.showChannelsModal(props.package1Identifier, props.package1Type, 'one-month');
    });

    container.appendChild(package1Link);
  } else if (props.package2Identifier) {
    // Show link for package 2 only
    const package2Link = createTag('a', {
      href: '#',
      class: 'view-all-channels-link',
      style: `color: ${props.viewAllChannelsTextColor} !important;`,
    });
    package2Link.textContent = props.viewAllChannelsText;

    package2Link.addEventListener('click', async (e) => {
      e.preventDefault();
      await channelModal.showChannelsModal(props.package2Identifier, props.package2Type, 'one-month');
    });

    container.appendChild(package2Link);
  } else {
    // Show default link if no packages are configured
    const defaultLink = createTag('a', {
      href: '#',
      class: 'view-all-channels-link',
      style: `color: ${props.viewAllChannelsTextColor} !important;`,
    });
    defaultLink.textContent = props.viewAllChannelsText;

    defaultLink.addEventListener('click', async (e) => {
      e.preventDefault();
      await channelModal.showChannelsModal('sling-mss', 'base_linear', 'one-month');
    });

    container.appendChild(defaultLink);
  }

  block.appendChild(container);

  // Clean up any configuration divs
  const divsWithoutId = block.querySelectorAll('div:not([class*="view-all-channels"])');
  divsWithoutId.forEach((div) => div.remove());
}
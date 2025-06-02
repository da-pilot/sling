import {
  createTag, getPictureUrlByScreenWidth, getVideoUrlByScreenWidth, readBlockConfig,
} from '../../scripts/utils.js';
import { toClassName } from '../../scripts/aem.js';

function setupVideo(url, block) {
  if (!url) return;

  const existingVideo = block.querySelector('video');
  if (existingVideo) {
    existingVideo.parentElement.remove();
  }

  const video = createTag('video', {
    autoplay: 'true',
    playsinline: 'true',
    muted: 'true',
    loop: 'true',
    oncanplay: 'this.muted=true',
  });

  video.oncanplaythrough = () => {
    video.muted = true;
    video.play();
  };
  const videoSource = createTag('source', { src: url, type: 'video/mp4' });
  video.append(videoSource);
  const container = createTag('div', { class: 'background' });
  container.append(video);
  block.prepend(container);
}

function setupBGVideos(block) {
  const extDamUrl = /content\/dam\//;
  const videoLinks = Array.from(block.querySelectorAll('a[href*=".mp4"]'));
  const domain = 'https://www.sling.com';
  videoLinks.forEach((link) => {
    if (extDamUrl.test(link.href)) {
      const fullDamUrl = `${domain}${link.pathname}`;
      if (link.pathname.startsWith('/')) {
        link.href = fullDamUrl;
      }
    }
  });
  let currentVideoUrl = getVideoUrlByScreenWidth(videoLinks);
  // Remove video links from DOM to prevent them from showing up as text
  videoLinks.forEach((link) => link.parentElement.remove());

  setupVideo(currentVideoUrl, block);

  // Resize event listener to update video based on screen size changes
  window.addEventListener('resize', () => {
    const newVideoUrl = getVideoUrlByScreenWidth(videoLinks);

    // Update video only if the URL changes
    if (newVideoUrl !== currentVideoUrl) {
      currentVideoUrl = newVideoUrl;
      setupVideo(currentVideoUrl, block);
    }
  });
}

function setupBGPictures(block) {
  const background = block.querySelector('.background');
  const pictures = Array.from(background.querySelectorAll('picture'));
  let currentPicture = getPictureUrlByScreenWidth(pictures);
  // Remove video links from DOM to prevent them from showing up as text
  pictures.forEach((picture) => picture.parentElement.remove());
  const existingPicture = background.querySelector('picture');
  if (existingPicture) {
    existingPicture.parentElement.remove();
  }
  const bgDIV = createTag('div', { class: 'background' });
  bgDIV.append(currentPicture);
  block.prepend(bgDIV);

  // Resize event listener to update video based on screen size changes
  window.addEventListener('resize', () => {
    const newPicture = getPictureUrlByScreenWidth(pictures);

    // Update video only if the URL changes
    if (newPicture !== currentPicture) {
      currentPicture = newPicture;
      const oldPicture = block.querySelector('picture');
      if (oldPicture) {
        oldPicture.parentElement.remove();
      }
      const container = createTag('div', { class: 'background' });
      container.append(currentPicture);
      block.prepend(container);
    }
  });
}

// read the config and construct the DOM
function processBlockConfig(block) {
  const marqueContent = createTag('div', { class: 'marquee-content' });
  const mediaDIV = createTag('div', { class: 'foreground-container' });
  const nonMediaDIV = createTag('div', { class: 'text-cta-container' });
  const btnsDIV = createTag('div', { class: 'buttons-container' });
  const dataAnalyticsProps = {};
  block.querySelectorAll(':scope > div:not([id])').forEach((row) => {
    if (row.children) {
      const cols = [...row.children];
      if (cols[1]) {
        const col = cols[1];
        const name = toClassName(cols[0].textContent);
        cols[0].classList.add('config-property');
        // Special handling for gradient
        if (name === 'gradient') {
          if (col.textContent.trim().toLowerCase() === 'true') {
            marqueContent.classList.add('gradient');
          }
          col.remove(); // Prevent the gradient configuration from being loaded into the DOM
          return;
        }
        col.classList.add(name);
        if (name.trim() === 'scroll-cta-into-header') {
          return;
        }
        if (name === 'id') {
          const id = col.textContent;
          if (id) {
            block.setAttribute('id', id);
          }
        }
        if (name !== 'foreground') {
          if (name.trim() === 'cta' || name.trim() === 'offer-details') {
            btnsDIV.append(col);
            nonMediaDIV.append(btnsDIV);
            // Create data-analytics-props object button interaction
            dataAnalyticsProps[name] = col.textContent;
            if (name === 'cta') {
              const anchor = col.querySelector('a');
              dataAnalyticsProps.event = 'click';
              dataAnalyticsProps.eventCategory = 'cta';
              dataAnalyticsProps.eventAction = 'click';
              if (anchor) {
                const ctaText = anchor.textContent;
                dataAnalyticsProps.eventLabel = ctaText;
              }
              block.setAttribute('data-analytics-props', JSON.stringify(dataAnalyticsProps));
            }
          } else {
            nonMediaDIV.append(col);
          }
        } else {
          mediaDIV.append(col);
        }
        // remove the config-only divs from the DOM
        if (name !== 'cta' && name !== 'offer-details' && name !== 'headline' && name !== 'sub-headline'
          && name !== 'foreground' && name !== 'background') {
          col.remove();
        }
      }
    }
  });

  if (mediaDIV.querySelector('.foreground')
      && mediaDIV.querySelector('.foreground').children.length > 0) {
    marqueContent.append(nonMediaDIV, mediaDIV);
  } else {
    marqueContent.append(nonMediaDIV);
  }
  block.append(marqueContent);
  block.querySelectorAll('.config-property').forEach((prop) => prop.remove()); // remove config property divs from dom
}

export default async function decorate(block) {
  const config = await readBlockConfig(block);
  processBlockConfig(block); // for data-analytics-props click interactions
  const slingProps = { // for data-sling-props properties
    ctaAnalyticsParent: config.ctaAnalyticsParent?.trim() ? config.ctaAnalyticsParent : '',
    ctaAnalyticsName: config.ctaAnalyticsName?.trim() ? config.ctaAnalyticsName : '', // aka ctaText
    ctaAnalyticsComponent: config.ctaAnalyticsComponent?.trim() ? config.ctaAnalyticsComponent : '', // aka ctaType, cartDestination
    ctaAnalyticsTarget: config.ctaAnalyticsTarget?.trim() ? config.ctaAnalyticsTarget : '',
    ctaUrl: config.cta || '',
  };
  const background = block.querySelector('.background');
  const bgColor = block.querySelector('.background-color');

  let bgMediaType;
  if (background) {
    if (background.querySelector('picture')) {
      bgMediaType = 'picture';
    } else if (background.querySelector('a[href*=".mp4"]')) {
      bgMediaType = 'video';
    }
  }

  // set the bg color on the section
  if (bgColor) {
    const section = block.closest('.section');
    if (section) {
      section.style.backgroundColor = bgColor.textContent;
    }
    bgColor.remove();
  }

  setupBGVideos(block);
  if (bgMediaType === 'picture') setupBGPictures(block);
  background.remove();
  block.querySelectorAll('div').forEach((div) => { if (div.children.length === 0) div.remove(); }); // remove empty divs
  block.setAttribute('data-sling-props', JSON.stringify(slingProps));
}

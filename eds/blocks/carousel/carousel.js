import { fetchPlaceholders } from '../../scripts/aem.js';

function hasAutoscrollClass(element) {
  let current = element;
  while (current) {
    if (current.classList && current.classList.contains('autoscroll')) {
      return true;
    }
    current = current.parentElement;
  }
  return false;
}

function showSlide(block, slideIndex = 0) {
  const slides = block.querySelectorAll('.carousel-slide');
  const totalSlides = slides.length;

  // Ensure the slide index wraps correctly
  const realSlideIndex = ((slideIndex % totalSlides) + totalSlides) % totalSlides;

  // Update block's active slide index
  block.dataset.activeSlide = realSlideIndex;

  // Scroll to the active slide with smoother transition
  const activeSlide = slides[realSlideIndex];
  block.querySelector('.carousel-slides').scrollTo({
    top: 0,
    left: activeSlide.offsetLeft,
    behavior: 'smooth',
  });

  // Update the aria-hidden and tabindex attributes
  slides.forEach((aSlide, idx) => {
    aSlide.setAttribute('aria-hidden', idx !== realSlideIndex);
    aSlide.querySelectorAll('a').forEach((link) => {
      if (idx !== realSlideIndex) {
        link.setAttribute('tabindex', '-1');
      } else {
        link.removeAttribute('tabindex');
      }
    });
  });

  // Update slide indicators
  const indicators = block.querySelectorAll('.carousel-slide-indicator');
  indicators.forEach((indicator, idx) => {
    const button = indicator.querySelector('button');
    if (idx !== realSlideIndex) {
      button.removeAttribute('disabled');
    } else {
      button.setAttribute('disabled', 'true');
    }
  });

  // Add shadow effect when slides change
  const slidesContainer = block.querySelector('.carousel-slides-container');
  slidesContainer.classList.add('slide-transition');

  // Remove the effect after animation completes
  setTimeout(() => {
    slidesContainer.classList.remove('slide-transition');
  }, 500);
}

function bindEvents(block) {
  const prevButton = block.querySelector('.slide-prev');
  const nextButton = block.querySelector('.slide-next');

  prevButton.addEventListener('click', () => {
    const currentSlide = parseInt(block.dataset.activeSlide, 10);
    showSlide(block, currentSlide - 1);
  });

  nextButton.addEventListener('click', () => {
    const currentSlide = parseInt(block.dataset.activeSlide, 10);
    showSlide(block, currentSlide + 1);
  });

  const slideIndicators = block.querySelector('.carousel-slide-indicators');
  if (slideIndicators) {
    slideIndicators.querySelectorAll('button').forEach((button) => {
      button.addEventListener('click', (e) => {
        const slideIndicator = e.currentTarget.parentElement;
        showSlide(block, parseInt(slideIndicator.dataset.targetSlide, 10));
      });
    });
  }

  // Remove IntersectionObserver as it's causing issues with the initial navigation
  // Instead, directly call showSlide on the active slide during setup.
  const initialSlideIndex = parseInt(block.dataset.activeSlide, 10) || 0;
  showSlide(block, initialSlideIndex);
}

function createSlide(row, slideIndex, carouselId) {
  const slide = document.createElement('li');
  slide.dataset.slideIndex = slideIndex;
  slide.setAttribute('id', `carousel-${carouselId}-slide-${slideIndex}`);
  slide.classList.add('carousel-slide');

  row.querySelectorAll(':scope > div').forEach((column, colIdx) => {
    column.classList.add(`carousel-slide-${colIdx === 0 ? 'image' : 'content'}`);
    slide.append(column);
  });

  const labeledBy = slide.querySelector('h1, h2, h3, h4, h5, h6');
  if (labeledBy) {
    slide.setAttribute('aria-labelledby', labeledBy.getAttribute('id'));
  }

  return slide;
}

function getVisibleSlidesCount(block) {
  // Look for a X-slides class on the block or its ancestors
  let parent = block;
  while (parent && parent !== document.body) {
    const match = Array.from(parent.classList).find((cls) => /^(\d+)-slides$/.test(cls));
    if (match) {
      return parseInt(match.replace('-slides', ''), 10);
    }
    parent = parent.parentElement;
  }
  // Fallback to default responsive logic
  if (window.matchMedia('(max-width: 767px)').matches) return 1;
  if (window.matchMedia('(max-width: 1023px)').matches) return 2;
  return 6;
}

function updateSlideArrows(block, rows) {
  const imageCount = rows.length;
  const visibleSlides = getVisibleSlidesCount(block);
  const navButtons = document.getElementById(`carousel-nav-${block.id}`);
  if (navButtons) {
    if (imageCount <= visibleSlides && !block.classList.contains('full')) {
      navButtons.classList.add('hide');
    } else {
      navButtons.classList.remove('hide');
    }
  }
}

let carouselId = 0;
export default async function decorate(block) {
  carouselId += 1;
  block.setAttribute('id', `carousel-${carouselId}`);
  const rows = block.querySelectorAll(':scope > div');
  const isSingleSlide = rows.length < 2;

  const placeholders = await fetchPlaceholders();

  block.setAttribute('role', 'region');
  block.setAttribute('aria-roledescription', placeholders.carousel || 'Carousel');

  const container = document.createElement('div');
  container.classList.add('carousel-slides-container');

  const slidesWrapper = document.createElement('ul');
  slidesWrapper.classList.add('carousel-slides');
  container.append(slidesWrapper);

  let slideIndicators;
  if (!isSingleSlide) {
    const slideIndicatorsNav = document.createElement('nav');
    slideIndicatorsNav.setAttribute('aria-label', placeholders.carouselSlideControls || 'Carousel Slide Controls');
    slideIndicators = document.createElement('ol');
    slideIndicators.classList.add('carousel-slide-indicators');
    slideIndicatorsNav.append(slideIndicators);
    block.append(slideIndicatorsNav);
    const slideNavButtons = document.createElement('div');
    slideNavButtons.classList.add('carousel-navigation-buttons');
    slideNavButtons.innerHTML = `
      <button type="button" class="slide-prev" aria-label="${placeholders.previousSlide || 'Previous Slide'}"></button>
      <button type="button" class="slide-next" aria-label="${placeholders.nextSlide || 'Next Slide'}"></button>
    `;
    slideNavButtons.setAttribute('id', `carousel-nav-${block.id}`);
    container.append(slideNavButtons);
  }

  rows.forEach((row, idx) => {
    const slide = createSlide(row, idx, carouselId);
    slidesWrapper.append(slide);

    if (slideIndicators) {
      const indicator = document.createElement('li');
      indicator.classList.add('carousel-slide-indicator');
      indicator.dataset.targetSlide = idx;
      indicator.innerHTML = `<button type="button"><span>${placeholders.showSlide || 'Show Slide'} ${idx + 1} ${placeholders.of || 'of'} ${rows.length}</span></button>`;
      slideIndicators.append(indicator);
    }
    row.remove();
  });

  block.prepend(container);

  // Find a parent with a class matching /n-slides/
  let parent = block;
  let slideClass = null;
  while (parent && parent !== document.body) {
    const match = Array.from(parent.classList).find((cls) => /^(\d+)-slides$/.test(cls));
    if (match) {
      slideClass = match;
      break;
    }
    parent = parent.parentElement;
  }

  // Add the found class, or fallback to rows.length
  if (slideClass) {
    // Convert 'n-slides' to 'slides-n'
    const nSlidesMatch = slideClass.match(/^(\d+)-slides$/);
    if (nSlidesMatch) {
      block.classList.add(`slides-${nSlidesMatch[1]}`);
    }
  } else {
    block.classList.add(`slides-${rows.length}`);
  }

  if (!isSingleSlide) {
    bindEvents(block);
    block.setAttribute('data-bound', 'true');
  }

  // Auto-scrolling functionality that's always enabled
  let slideIndex = parseInt(block.dataset.activeSlide, 10) || 0;
  let autoScrollInterval = null;

  // Define autoScroll function at the root level
  const autoScroll = () => {
    slideIndex += 1;
    if (slideIndex >= rows.length) {
      slideIndex = 0;
    }
    showSlide(block, slideIndex);
  };

  updateSlideArrows(block, rows);
  window.addEventListener('resize', () => updateSlideArrows(block, rows));

  // Start auto-scroll immediately if it has the autoscroll class
  if (hasAutoscrollClass(block) && rows.length > 1) {
    // Start auto-scrolling
    autoScrollInterval = setInterval(autoScroll, 4000);// Increased to 4s for smoother experience
  }
  const navButtons = block.querySelectorAll('.carousel-navigation-buttons button');
  navButtons.forEach((button) => {
    button.addEventListener('mouseenter', () => {
      if (autoScrollInterval) {
        clearInterval(autoScrollInterval);
      }
    });
    button.addEventListener('mouseleave', () => {
      if (hasAutoscrollClass(block) && rows.length > 1) {
        autoScrollInterval = setInterval(autoScroll, 4000);
      }
    });
  });
}

/**
 * Re-establishes event bindings for a carousel block
 * @param {HTMLElement} block The carousel block element
 */
export function rebindEvents(block) {
  // Get the carousel buttons - using the correct class names
  const prevButton = block.querySelector('.slide-prev');
  const nextButton = block.querySelector('.slide-next');

  // Get the carousel variant
  const variant = block.dataset.variant || 'default';

  // Re-establish event bindings
  if (prevButton && nextButton) {
    // Remove any existing event listeners
    prevButton.replaceWith(prevButton.cloneNode(true));
    nextButton.replaceWith(nextButton.cloneNode(true));

    // Get the fresh references after replacement
    const newPrevButton = block.querySelector('.slide-prev');
    const newNextButton = block.querySelector('.slide-next');

    // Add event listeners
    newPrevButton.addEventListener('click', () => {
      const currentSlide = parseInt(block.dataset.activeSlide, 10) || 0;
      showSlide(block, currentSlide - 1);
    });

    newNextButton.addEventListener('click', () => {
      const currentSlide = parseInt(block.dataset.activeSlide, 10) || 0;
      showSlide(block, currentSlide + 1);
    });

    // Re-initialize auto-scrolling if applicable
    if (variant.includes('autoscroll')) {
      const autoScrollInterval = block.dataset.autoScrollInterval || 3000;

      // Clear any existing interval
      if (block.autoScrollInterval) {
        clearInterval(block.autoScrollInterval);
      }

      // Set up new interval
      const autoScroll = () => {
        const currentSlide = parseInt(block.dataset.activeSlide, 10) || 0;
        showSlide(block, currentSlide + 1);
      };

      // Store the timer ID
      block.autoScrollInterval = setInterval(autoScroll, autoScrollInterval);
    }
  }
}

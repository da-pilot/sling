import { fetchPlaceholders } from '../../scripts/aem.js';

function showSlide(block, slideIndex = 0) {
  const slides = block.querySelectorAll('.carousel-slide');
  const totalSlides = slides.length;

  // Ensure the slide index wraps correctly
  const realSlideIndex = ((slideIndex % totalSlides) + totalSlides) % totalSlides;

  // Update block's active slide index
  block.dataset.activeSlide = realSlideIndex;

  // Scroll to the active slide
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

function updateSlideArrows(rows, slideNavButtons) {
  const isMobile = window.matchMedia('(max-width: 767px)').matches;
  const imageCount = rows.length;
  if ((isMobile && imageCount <= 2) || (!isMobile && imageCount <= 3)) {
    slideNavButtons.classList.add('hide');
  } else {
    slideNavButtons.classList.remove('hide');
  }
}

let carouselId = 0;
export default async function decorate(block) {
  const variant = block.classList.value;
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
      <button type="button" class= "slide-prev" aria-label="${placeholders.previousSlide || 'Previous Slide'}"></button>
      <button type="button" class="slide-next" aria-label="${placeholders.nextSlide || 'Next Slide'}"></button>
    `;

    container.append(slideNavButtons);
    updateSlideArrows(rows, slideNavButtons);
    window.addEventListener('resize', () => updateSlideArrows(rows, slideNavButtons));
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

  if (!isSingleSlide) {
    bindEvents(block);
    block.setAttribute('data-bound', 'true');
  }
  // Auto-scrolling functionality
  let slideIndex = 0;
  const slides = block.querySelectorAll('.carousel-slide');

  // Define autoScroll function at the root level
  const autoScroll = () => {
    slideIndex += 1;
    if (slideIndex >= slides.length) {
      slideIndex = 0;
    }
    showSlide(block, slideIndex);
  };

  // Call autoScroll every 3 seconds
  if (variant.includes('autoscroll')) {
    block.autoScrollInterval = setInterval(autoScroll, 3000);
  }
}

/**
 * Re-establishes event bindings for a carousel block
 * @param {HTMLElement} block The carousel block element
 */
export function rebindEvents(block) {
  console.log('rebindEvents called for carousel block:', block);

  // Get the carousel buttons - using the correct class names
  const prevButton = block.querySelector('.slide-prev');
  const nextButton = block.querySelector('.slide-next');

  console.log('Carousel buttons found:', {
    prevButton: !!prevButton,
    nextButton: !!nextButton,
  });

  // Get the carousel variant
  const variant = block.dataset.variant || 'default';
  console.log('Carousel variant:', variant);

  // Get the slides
  const slides = block.querySelectorAll('.carousel-slide');
  console.log('Number of slides found:', slides.length);

  // Re-establish event bindings
  if (prevButton && nextButton) {
    console.log('Re-establishing event bindings for carousel buttons');

    // Remove any existing event listeners
    prevButton.replaceWith(prevButton.cloneNode(true));
    nextButton.replaceWith(nextButton.cloneNode(true));

    // Get the fresh references after replacement
    const newPrevButton = block.querySelector('.slide-prev');
    const newNextButton = block.querySelector('.slide-next');

    // Add event listeners
    newPrevButton.addEventListener('click', () => {
      console.log('Previous button clicked');
      const currentSlide = parseInt(block.dataset.activeSlide, 10) || 0;
      showSlide(block, currentSlide - 1);
    });

    newNextButton.addEventListener('click', () => {
      console.log('Next button clicked');
      const currentSlide = parseInt(block.dataset.activeSlide, 10) || 0;
      showSlide(block, currentSlide + 1);
    });

    // Re-initialize auto-scrolling if applicable
    if (variant.includes('autoscroll')) {
      console.log('Re-initializing auto-scrolling');
      const autoScrollInterval = block.dataset.autoScrollInterval || 3000;
      console.log('Auto-scroll interval:', autoScrollInterval);

      // Clear any existing interval
      if (block.autoScrollInterval) {
        console.log('Clearing existing auto-scroll timer');
        clearInterval(block.autoScrollInterval);
      }

      // Set up new interval
      const autoScroll = () => {
        console.log('Auto-scroll timer triggered');
        const currentSlide = parseInt(block.dataset.activeSlide, 10) || 0;
        showSlide(block, currentSlide + 1);
      };

      // Store the timer ID
      block.autoScrollInterval = setInterval(autoScroll, autoScrollInterval);
      console.log('New auto-scroll timer set:', block.autoScrollInterval);
    }
  } else {
    console.warn('Carousel buttons not found, cannot rebind events');
  }
}

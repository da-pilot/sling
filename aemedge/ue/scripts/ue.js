// aemedge/scripts/ue.js
(function() {
    // Only run in UE context
    if (!window.UniversalEditor) return;
    
    console.log('Universal Editor detected - initializing special handling');
    
    // Handle accordion blocks
    document.querySelectorAll('.accordion').forEach((accordionBlock) => {
      // Keep details open when selected in editor
      const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
          if (mutation.type === 'attributes' && mutation.attributeName === 'data-universal-editor-selected') {
            const isSelected = accordionBlock.hasAttribute('data-universal-editor-selected');
            if (isSelected) {
              accordionBlock.querySelectorAll('details').forEach((details) => {
                details.setAttribute('open', '');
              });
            }
          }
        });
      });
      
      observer.observe(accordionBlock, { attributes: true });
      
      // Keep details open when clicked in editor
      accordionBlock.addEventListener('click', (event) => {
        if (window.UniversalEditor.isEditing) {
          const details = event.target.closest('details');
          if (details) {
            details.setAttribute('open', '');
            event.preventDefault();
            event.stopPropagation();
          }
        }
      }, true);
    });
  
    // Handle carousel blocks
    document.querySelectorAll('.carousel').forEach((carouselBlock) => {
      // Disable auto-rotation in editor
      if (window.UniversalEditor.isEditing) {
        // Find autoplay controls and disable them
        const autoRotationControls = carouselBlock.querySelectorAll('[data-carousel-autoplay]');
        autoRotationControls.forEach((control) => {
          control.setAttribute('data-carousel-autoplay', 'false');
        });
        
        // Stop any interval timers
        const carouselInstance = carouselBlock._carouselInstance;
        if (carouselInstance && carouselInstance.autoPlayInterval) {
          clearInterval(carouselInstance.autoPlayInterval);
        }
      }
      
      // Handle selection of carousel slides
      carouselBlock.addEventListener('click', (event) => {
        if (window.UniversalEditor.isEditing) {
          const slide = event.target.closest('.carousel-slide');
          if (slide) {
            // Find all slides
            const slides = Array.from(carouselBlock.querySelectorAll('.carousel-slide'));
            const slideIndex = slides.indexOf(slide);
            
            // Set active slide
            if (slideIndex >= 0) {
              slides.forEach((s, i) => {
                if (i === slideIndex) {
                  s.style.display = 'block';
                } else {
                  s.style.display = 'none';
                }
              });
            }
          }
        }
      }, true);
    });
  
    // Handle tabs blocks
    document.querySelectorAll('.tabs').forEach((tabsBlock) => {
      // When a tab panel is selected in the editor tree, activate that tab
      const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
          if (mutation.type === 'attributes' && mutation.attributeName === 'data-universal-editor-selected') {
            const tabPanels = tabsBlock.querySelectorAll('[role="tabpanel"]');
            tabPanels.forEach((panel) => {
              if (panel.hasAttribute('data-universal-editor-selected')) {
                // Find the associated tab and click it
                const tabId = panel.getAttribute('aria-labelledby');
                const tab = document.getElementById(tabId);
                if (tab) tab.click();
              }
            });
          }
        });
      });
      
      tabsBlock.querySelectorAll('[role="tabpanel"]').forEach((panel) => {
        observer.observe(panel, { attributes: true });
      });
    });
  
    // Add visual indicator for empty blocks
    document.querySelectorAll('.block').forEach((block) => {
      // Check if block is empty or has only placeholder content
      const isEmpty = block.innerHTML.trim() === '' || 
                     (block.children.length === 1 && 
                      block.children[0].children.length === 1 && 
                      block.children[0].children[0].textContent.trim() === 'Content');
      
      if (isEmpty) {
        const blockName = Array.from(block.classList)[0] || 'block';
        const placeholder = document.createElement('div');
        placeholder.className = 'ue-placeholder';
        placeholder.innerHTML = `<p>Add content for ${blockName} block</p>`;
        placeholder.style.padding = '24px';
        placeholder.style.backgroundColor = 'rgba(0, 0, 0, 0.05)';
        placeholder.style.border = '2px dashed #ccc';
        placeholder.style.borderRadius = '4px';
        placeholder.style.textAlign = 'center';
        placeholder.style.color = '#666';
        placeholder.style.fontStyle = 'italic';
        
        block.innerHTML = '';
        block.appendChild(placeholder);
      }
    });
  })();
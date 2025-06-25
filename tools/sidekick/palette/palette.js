/* eslint-disable import/no-unresolved */
import { LitElement, html, css } from 'https://da.live/deps/lit/lit-all.min.js';
import DA_SDK from 'https://da.live/nx/utils/sdk.js';
import { getPalette } from '../../../eds/scripts/tags.js';

class PaletteElement extends LitElement {
  static properties = {
    palette: { type: Array },
    searchTerm: { type: String },
  };

  static styles = css`
    ul {
      list-style: none;
      padding: 0;
      margin: 0;
      display: grid;
      gap: 1rem;
    }

    li {
      cursor: pointer;
      padding: 1rem;
      border: 1px solid #ddd;
      border-radius: 4px;
      transition: all 0.2s ease;
      display: grid;
    grid-template-columns: 100px auto;
    gap: 20px;
    font-family: 'Adobe Clean', adobe-clean, 'Trebuchet MS', sans-serif;
    }

    li:hover {
      transform: translateY(-2px);
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    }

    .swatch {
      width: 100%;
      height: 70px;
      border-radius: 4px;
    }

    .label p {
      margin: 0.25rem 0;
    }

    .value {
      font-family: monospace;
      color: #666;
    }

    .filtered {
      display: none;
    }
  `;

  constructor() {
    super();
    this.palette = [];
    this.searchTerm = '';
  }

  handleSearch(e) {
    this.searchTerm = e.target.value.toLowerCase();
    this.requestUpdate();
  }

  connectedCallback() {
    super.connectedCallback();
    this.initPalette();
    const searchInput = document.getElementById('search');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => this.handleSearch(e));
    }
  }

  async handleItemClick(brandName) {
    this.brandName = brandName;
    const { actions } = await DA_SDK;
    if (actions?.sendText) {
      actions.sendText(brandName);
      actions.closeLibrary();
    }
  }

  async initPalette() {
    const palette = await getPalette();
    if (!palette) return;
    this.palette = palette;
  }

  render() {
    return html`
      <ul>
        ${this.palette.map((color) => {
    const brandName = color['brand-name'];
    const colorValue = color['color-value'];
    const uses = color.application;
    const isMatch = !this.searchTerm
      || brandName.toLowerCase().includes(this.searchTerm)
      || colorValue.toLowerCase().includes(this.searchTerm)
      || (uses && uses.toLowerCase().includes(this.searchTerm));

    return html`
            <li class=${isMatch ? brandName : `${brandName} filtered`} 
                data-color=${colorValue} 
                data-name=${brandName}
                @click=${() => this.handleItemClick(brandName)}>
              <div class="swatch" style="background: ${colorValue};"></div>
              <div class="label">
                <p><strong>${brandName}</strong></p>
                <p>Uses: ${uses}</p>
                <p class="value">${colorValue}</p>
              </div>
            </li>
          `;
  })}
      </ul>
    `;
  }
}

customElements.define('palette-element', PaletteElement);
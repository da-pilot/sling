// import { createTag } from '../../../aemedge/scripts/utils.js';
import { LitElement, html, css } from 'https://da.live/deps/lit/lit-all.min.js';
import DA_SDK from 'https://da.live/nx/utils/sdk.js';
import { getPalette } from '../../../aemedge/scripts/tags.js';

class PaletteElement extends LitElement {
  static properties = {
    palette: { type: Array },
  };

  static styles = css`
    ul {
      list-style: none;
      padding: 0;
      margin: 0;
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
      gap: 1rem;
    }

    li {
      cursor: pointer;
      padding: 1rem;
      border: 1px solid #ddd;
      border-radius: 4px;
      transition: all 0.2s ease;
    }

    li:hover {
      transform: translateY(-2px);
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    }

    .swatch {
      width: 100%;
      height: 50px;
      border-radius: 4px;
      margin-bottom: 0.5rem;
    }

    .label {
      margin-top: 0.5rem;
    }

    .label p {
      margin: 0.25rem 0;
    }

    .value {
      font-family: monospace;
      color: #666;
    }
  `;

  constructor() {
    super();
    this.palette = [];
  }

  async connectedCallback() {
    super.connectedCallback();
    await this.initPalette();
  }

  async handleItemClick(brandName) {
    this.brandName = brandName;
    const { actions } = await DA_SDK;
    if (actions?.sendHTML) {
      actions.sendHTML(brandName);
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

    return html`
            <li class=${brandName} 
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
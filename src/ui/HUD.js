/**
 * HUD: crosshair, hitmarker flash, health bar, ammo counter.
 * Pure DOM overlay inside #hud-root; no pointer events.
 */
export class HUD {
  constructor() {
    const root = document.getElementById('hud-root');
    root.innerHTML = `
      <div id="crosshair"><span></span><span></span><span></span><span></span><span></span></div>
      <div id="hitmarker">✕</div>
      <div id="hud-bottom">
        <div id="health-wrap">
          <div id="health-bar"></div>
        </div>
        <div id="ammo">∞ / ∞</div>
      </div>
      <div id="damage-vignette"></div>
    `;
    this.root = root;
    this.healthBar = document.getElementById('health-bar');
    this.ammoEl = document.getElementById('ammo');
    this.hitmarkerEl = document.getElementById('hitmarker');
    this.crosshairEl = document.getElementById('crosshair');
    this._hitTimer = 0;
  }

  showHitmarker(kill = false) {
    this.hitmarkerEl.classList.add('active');
    if (kill) this.hitmarkerEl.classList.add('kill');
    this._hitTimer = 0.12;
  }

  /** Red edge flash when the player is hit. */
  flashDamage() {
    this.root = this.root || document.getElementById('hud-root');
    this.root.classList.add('damaged');
    this._damageTimer = 0.35;
  }

  update(player, weapon) {
    // Health (player.health defaults to 100 until damage system exists)
    const hp = player.health ?? 100;
    this.healthBar.style.width = `${Math.max(0, Math.min(100, hp))}%`;
    this.healthBar.classList.toggle('low', hp < 35);

    // Ammo (placeholder until magazine system exists)
    this.ammoEl.textContent = '30 / ∞';

    // Crosshair opens with the weapon's bloom cone: the reticle visibly
    // tracks how far shots are scattering (24px resting -> 64px full spray)
    const bloom = weapon?.bloom ?? 0.0015;
    const gap = 24 + Math.min(1, bloom / 0.028) * 40;
    this.crosshairEl.style.setProperty('--gap', `${gap.toFixed(1)}px`);

    // Hitmarker decay
    if (this._hitTimer > 0) {
      this._hitTimer -= 1 / 60;
      if (this._hitTimer <= 0) {
        this.hitmarkerEl.classList.remove('active');
        this.hitmarkerEl.classList.remove('kill');
      }
    }
    if (this._damageTimer > 0) {
      this._damageTimer -= 1 / 60;
      if (this._damageTimer <= 0) (this.root || document.getElementById('hud-root'))?.classList.remove('damaged');
    }
  }
}

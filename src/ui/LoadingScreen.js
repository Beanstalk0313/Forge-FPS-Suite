/**
 * Opaque, reusable loading presentation. Static HTML owns the first paint;
 * main.js owns the actual readiness barriers (this class never guesses asset
 * readiness from a percentage). Weighted phases are not byte progress.
 */

/** Boot phases in order. `weight` is relative; progress is the completed sum. */
export const LOADING_STEPS = [
  { id: 'project', label: 'Reading the project', weight: 1 },
  { id: 'physics', label: 'Starting physics', weight: 3 },
  { id: 'level', label: 'Loading the level', weight: 3 },
  { id: 'sky', label: 'Building the sky', weight: 1 },
  { id: 'weapons', label: 'Preparing weapons', weight: 2 },
  { id: 'menu', label: 'Preparing UI and the first frame', weight: 1 }
];

export const LOADING_STEP_IDS = LOADING_STEPS.map(step => step.id);

const TOTAL_WEIGHT = LOADING_STEPS.reduce((sum, step) => sum + step.weight, 0);

/**
 * Pure progress maths, exported so the ordering is testable without a DOM.
 * Unknown steps are ignored; out-of-order steps clamp instead of going back.
 */
export function loadingProgress(done, total = TOTAL_WEIGHT) {
  const value = (done / total) * 100;
  return Math.max(0, Math.min(99, Math.round(value)));
}

export class LoadingScreen {
  /**
   * @param {HTMLElement} [root] existing element to adopt; created when absent
   * @param {{ steps?: typeof LOADING_STEPS }} [options]
   */
  constructor(root, { steps = LOADING_STEPS } = {}) {
    this.steps = steps;
    this.total = steps.reduce((sum, step) => sum + step.weight, 0);
    this.done = 0;
    this.completed = new Set();
    this.finished = false;
    this.el = root || document.createElement('div');
    this.el.id = 'loading-screen';
    this.el.className = 'loading-screen';
    this.el.setAttribute('role', 'status');
    this.el.setAttribute('aria-live', 'polite');

    const inner = document.createElement('div');
    inner.className = 'loading-inner';
    this.title = document.createElement('p');
    this.title.className = 'loading-title';
    this.status = document.createElement('p');
    this.status.className = 'loading-status';
    this.status.textContent = steps[0]?.label ?? 'Loading';
    const track = document.createElement('div');
    track.className = 'loading-track';
    this.bar = document.createElement('div');
    this.bar.className = 'loading-bar';
    track.append(this.bar);
    inner.append(this.title, this.status, track);
    this.el.replaceChildren(inner);
    if (!root) document.body.append(this.el);
    this.show();
    this.setTitle(document.title || '');
  }

  show() {
    this.done = 0; this.completed.clear(); this.finished = false;
    this.el.style.transition = 'none';
    this.el.classList.remove('leaving', 'done', 'failed'); this.el.style.display = '';
    this.bar.style.width = '0%'; this.status.textContent = this.steps[0]?.label || 'Loading';
    return this;
  }

  setTitle(title) {
    this.title.textContent = title || '';
  }

  /** Mark a named step complete and show the next pending label. */
  step(id) {
    const index = this.steps.findIndex(step => step.id === id);
    if (index !== -1 && !this.completed.has(id)) {
      this.completed.add(id);
      this.done += this.steps[index].weight;
      const next = this.steps.find(step => !this.completed.has(step.id));
      this.status.textContent = next ? next.label : this.status.textContent;
    }
    this.bar.style.width = `${loadingProgress(this.done, this.total)}%`;
    return this;
  }

  /** Hide the screen with a short fade so the reveal is not a hard cut. */
  async finish({ fadeMs = 260 } = {}) {
    if (this.finished) return this;
    this.finished = true;
    this.bar.style.width = '100%';
    this.el.style.transition = '';
    this.el.classList.add('leaving');
    const wait = new Promise(resolve => setTimeout(resolve, fadeMs));
    try {
      await wait;
    } finally {
      this.el.classList.add('done');
      this.el.style.display = 'none';
    }
    return this;
  }

  /** Replace the body with the failure message; the screen stays up. */
  fail(message) {
    this.el.classList.remove('leaving', 'done');
    this.el.style.display = '';
    this.el.classList.add('failed');
    this.status.textContent = message;
    this.bar.style.width = '100%';
    return this;
  }

  /** Teardown, used when the game is stopped and re-started. */
  dispose() {
    this.el.classList.add('done');
    this.el.style.display = 'none';
    this.finished = true;
  }
}
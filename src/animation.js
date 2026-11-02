// TF2 plays animated sprays at a fixed rate of about 5 frames per second.
export const FRAME_RATE = 5;

export function sheetLayout(frames) {
  const columns = Math.ceil(Math.sqrt(frames));
  return { columns, rows: Math.ceil(frames / columns) };
}

// Packs decoded frames into one grid canvas that players crop from.
export function sheetCanvas({ frameWidth: width, frameHeight: height, frames, pixels }) {
  const { columns, rows } = sheetLayout(frames);
  const canvas = document.createElement('canvas');
  canvas.width = columns * width;
  canvas.height = rows * height;
  const context = canvas.getContext('2d');
  const size = width * height * 4;
  for (let i = 0; i < frames; i++) {
    const data = new Uint8ClampedArray(pixels.buffer, pixels.byteOffset + i * size, size);
    context.putImageData(new ImageData(data, width, height), (i % columns) * width, Math.floor(i / columns) * height);
  }
  return canvas;
}

export class SheetPlayer {
  constructor(canvas, source, { frameWidth, frameHeight, frames }, onFrame) {
    Object.assign(this, { canvas, source, frameWidth, frameHeight, frames, onFrame, columns: sheetLayout(frames).columns, current: -1 });
    canvas.width = frameWidth;
    canvas.height = frameHeight;
    this.context = canvas.getContext('2d');
    this.restart(0);
  }

  restart(frame) {
    this.start = frame;
    this.offset = null;
  }

  draw(step) {
    this.offset ??= step;
    this.show((this.start + step - this.offset) % this.frames);
  }

  show(frame) {
    if (frame === this.current) return;
    this.current = frame;
    const { frameWidth: width, frameHeight: height } = this;
    this.context.clearRect(0, 0, width, height);
    this.context.drawImage(this.source, (frame % this.columns) * width, Math.floor(frame / this.columns) * height, width, height, 0, 0, width, height);
    this.onFrame?.(frame);
  }
}

// One shared clock for every playing spray.
export class Animator {
  players = new Set();
  running = false;

  add(player) {
    this.players.add(player);
    player.draw(this.step(performance.now()));
    if (!this.running) {
      this.running = true;
      requestAnimationFrame(this.tick);
    }
  }

  delete(player) {
    this.players.delete(player);
  }

  clear() {
    this.players.clear();
  }

  step(time) {
    return Math.floor(time * FRAME_RATE / 1000);
  }

  tick = time => {
    if (!this.players.size) {
      this.running = false;
      return;
    }
    const step = this.step(time);
    for (const player of this.players) player.draw(step);
    requestAnimationFrame(this.tick);
  };
}

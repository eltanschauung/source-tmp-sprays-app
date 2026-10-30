export class DecoderPool {
  constructor(size = 2) {
    this.jobs = [];
    this.nextId = 0;
    this.closed = false;
    this.slots = Array.from({ length: size }, () => this.createSlot());
  }

  createSlot() {
    const slot = { worker: new Worker(new URL('./decode.worker.js', import.meta.url), { type: 'module' }), job: null };
    slot.worker.onmessage = ({ data }) => {
      const job = slot.job;
      if (!job || data.id !== job.id) return;
      clearTimeout(slot.timeout);
      slot.job = null;
      if (data.error) job.reject(new Error(data.error));
      else job.resolve(data.result);
      this.pump();
    };
    slot.worker.onerror = event => {
      event.preventDefault();
      this.failSlot(slot, 'VTF decoder failed.');
    };
    return slot;
  }

  failSlot(slot, message) {
    clearTimeout(slot.timeout);
    slot.worker.terminate();
    slot.job?.reject(new Error(message));
    slot.job = null;
    if (!this.closed) {
      const index = this.slots.indexOf(slot);
      this.slots[index] = this.createSlot();
      this.pump();
    }
  }

  decode(file, options = {}, priority = false) {
    if (this.closed) return Promise.reject(new Error('Collection closed.'));
    return new Promise((resolve, reject) => {
      const job = { id: ++this.nextId, file, ...options, resolve, reject };
      if (priority) this.jobs.unshift(job);
      else this.jobs.push(job);
      this.pump();
    });
  }

  pump() {
    if (this.closed) return;
    for (const slot of this.slots) {
      if (slot.job || !this.jobs.length) continue;
      const job = this.jobs.shift();
      slot.job = job;
      slot.timeout = setTimeout(() => this.failSlot(slot, 'VTF decode exceeded the 15-second safety limit.'), 15000);
      const { id, file, frame = 0, maxDimension = 256 } = job;
      slot.worker.postMessage({ id, file, frame, maxDimension });
    }
  }

  close() {
    this.closed = true;
    for (const job of this.jobs.splice(0)) job.reject(new Error('Collection closed.'));
    for (const slot of this.slots) this.failSlot(slot, 'Collection closed.');
  }
}

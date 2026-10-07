// Frame limiter for the phone (a 120 Hz screen would double the work and the heat for nothing).
// Called with the requestAnimationFrame timestamp before anything else in the frame: false = skip this
// frame (nothing is updated, so the next frame simply sees a longer dt). Exact on 60 and 120 Hz screens;
// not used in VR. fps <= 0: no limit.
export class FrameCap {
  constructor(fps) {
    this.setFps(fps);
    this.vsync = 16.7;   // ms between requestAnimationFrame calls (smoothed)
    this.prev = 0;
    this.next = 0;
  }
  setFps(fps) { this.fps = fps > 0 ? fps : 0; this.interval = this.fps ? 1000 / this.fps : 0; this.next = 0; }
  allow(now) {
    if (this.prev) {
      const d = now - this.prev;
      if (d > 3 && d < 40) this.vsync += (d - this.vsync) * 0.05;
    }
    this.prev = now;
    if (!this.interval) return true;
    if (now < this.next - this.vsync * 0.5) return false;
    this.next = now - this.next > this.interval * 2 ? now + this.interval : this.next + this.interval;
    return true;
  }
}

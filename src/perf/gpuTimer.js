// GPU time of the rendering commands (EXT_disjoint_timer_query_webgl2), averaged. Results arrive a
// few frames late; if the extension is missing (likely in some browsers) ms stays null = "н/д".
export class GpuTimer {
  constructor(gl) {
    this.gl = gl;
    this.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    this.pool = [];
    this.pending = [];
    this.active = null;
    this.sum = 0;
    this.n = 0;
    this.ms = null;
  }

  begin() {
    const { gl, ext } = this;
    if (!ext || this.active || this.pending.length > 6) return;
    this.active = this.pool.pop() || gl.createQuery();
    gl.beginQuery(ext.TIME_ELAPSED_EXT, this.active);
  }

  end() {
    if (!this.active) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.pending.push(this.active);
    this.active = null;
  }

  // collect finished queries; call once per frame
  poll() {
    const { gl, ext } = this;
    if (!ext || !this.pending.length) return;
    const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
    while (this.pending.length && gl.getQueryParameter(this.pending[0], gl.QUERY_RESULT_AVAILABLE)) {
      const q = this.pending.shift();
      if (!disjoint) { this.sum += gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6; this.n++; }
      this.pool.push(q);
    }
  }

  // average since the last call (ms), or the previous value
  take() {
    if (this.n) { this.ms = this.sum / this.n; this.sum = 0; this.n = 0; }
    return this.ms;
  }
}

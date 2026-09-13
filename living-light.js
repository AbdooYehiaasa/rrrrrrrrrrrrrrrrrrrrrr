/* <living-light> — warm procedural light field (WebGL1).
   Attributes: mode ("dark" | "ivory"), intensity (0.3–1.6), speed (0–2).
   Pauses when offscreen / tab hidden, renders a single frame under reduced motion,
   caps pixel count and downshifts resolution if frames get expensive. */
(() => {
  if (customElements.get('living-light')) return;

  const VERT = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';

  const FRAG = `precision mediump float;
uniform vec2 u_res;uniform float u_t;uniform float u_i;uniform float u_mode;
vec3 permute(vec3 x){return mod(((x*34.)+1.)*x,289.);}
float snoise(vec2 v){
  const vec4 C=vec4(0.211324865405187,0.366025403784439,-0.577350269189626,0.024390243902439);
  vec2 i=floor(v+dot(v,C.yy));vec2 x0=v-i+dot(i,C.xx);
  vec2 i1=(x0.x>x0.y)?vec2(1.,0.):vec2(0.,1.);
  vec4 x12=x0.xyxy+C.xxzz;x12.xy-=i1;i=mod(i,289.);
  vec3 p=permute(permute(i.y+vec3(0.,i1.y,1.))+i.x+vec3(0.,i1.x,1.));
  vec3 m=max(0.5-vec3(dot(x0,x0),dot(x12.xy,x12.xy),dot(x12.zw,x12.zw)),0.);
  m=m*m;m=m*m;
  vec3 x=2.*fract(p*C.www)-1.;vec3 h=abs(x)-0.5;vec3 ox=floor(x+0.5);vec3 a0=x-ox;
  m*=1.79284291400159-0.85373472095314*(a0*a0+h*h);
  vec3 g;g.x=a0.x*x0.x+h.x*x0.y;g.yz=a0.yz*x12.xz+h.yz*x12.yw;
  return 130.*dot(m,g);
}
void main(){
  vec2 p=(gl_FragCoord.xy-.5*u_res)/max(u_res.y,1.);
  float t=u_t*.055;
  vec2 q=p*1.15;
  float w1=snoise(q+vec2(.0,t));
  float w2=snoise(q*1.7+vec2(t*.62,-t*.44));
  vec2 s=q+.42*vec2(w1,w2);
  float n1=.5+.5*snoise(s*1.25+vec2(-t*.3,t*.18));
  float n2=.5+.5*snoise(s*2.6-vec2(t*.14,t*.1));
  float f=mix(n1,n2,.38);
  float d=length(p*vec2(1.,.92));
  float glow=exp(-2.3*d*d);
  float v=f*.62+glow*.55;
  vec3 dark=mix(vec3(.028,.020,.017),vec3(.115,.062,.040),smoothstep(.18,.92,v));
  dark=mix(dark,vec3(.34,.19,.105),smoothstep(.78,1.12,v)*.55);
  vec3 ivory=mix(vec3(1.,.976,.945),vec3(.910,.790,.752),smoothstep(.06,.96,v));
  ivory=mix(ivory,vec3(.945,.827,.671),glow*.55);
  vec3 col=mix(dark,ivory,u_mode);
  col*=mix(u_i,1.+(u_i-1.)*.35,u_mode);
  float hash=fract(sin(dot(gl_FragCoord.xy,vec2(12.9898,78.233)))*43758.5453);
  col+=(hash-.5)/95.;
  gl_FragColor=vec4(max(col,vec3(0.)),1.);
}`;

  const compile = (gl, type, src) => {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      console.warn('living-light shader:', gl.getShaderInfoLog(sh));
      gl.deleteShader(sh);
      return null;
    }
    return sh;
  };

  class LivingLight extends HTMLElement {
    static get observedAttributes() { return ['mode', 'intensity', 'speed']; }

    connectedCallback() {
      if (this._booted) { this._pump(); return; }
      this._booted = true;
      this.style.display = 'block';
      if (!this.style.width) this.style.width = '100%';
      if (!this.style.height) this.style.height = '100%';

      const c = this._canvas = document.createElement('canvas');
      c.style.cssText = 'display:block;width:100%;height:100%';
      this.appendChild(c);

      const gl = this._gl = c.getContext('webgl', {
        alpha: false, antialias: false, depth: false, stencil: false,
        powerPreference: 'low-power', preserveDrawingBuffer: false
      });
      if (!gl) { this.style.display = 'none'; return; }

      const vs = compile(gl, gl.VERTEX_SHADER, VERT);
      const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
      if (!vs || !fs) { this.style.display = 'none'; return; }
      const prog = this._prog = gl.createProgram();
      gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { this.style.display = 'none'; return; }
      gl.useProgram(prog);

      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, 'p');
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

      this._u = {
        res: gl.getUniformLocation(prog, 'u_res'),
        t: gl.getUniformLocation(prog, 'u_t'),
        i: gl.getUniformLocation(prog, 'u_i'),
        mode: gl.getUniformLocation(prog, 'u_mode')
      };

      this._time = Math.random() * 120;
      this._last = 0;
      this._raf = null;
      this._visible = false;
      this._dprCap = 1.5;
      this._maxPixels = 900000;
      this._frames = 0;
      this._acc = 0;
      this._mq = window.matchMedia('(prefers-reduced-motion: reduce)');
      this._reduced = this._mq.matches;
      this._onMq = () => { this._reduced = this._mq.matches; this._pump(); };
      if (this._mq.addEventListener) this._mq.addEventListener('change', this._onMq);

      this._onVis = () => this._pump();
      document.addEventListener('visibilitychange', this._onVis);

      this._ro = new ResizeObserver(() => this._resize());
      this._ro.observe(this);
      this._io = new IntersectionObserver((entries) => {
        this._visible = entries[entries.length - 1].isIntersecting;
        this._pump();
      }, { rootMargin: '120px' });
      this._io.observe(this);

      this._resize();
    }

    disconnectedCallback() {
      if (this._raf) cancelAnimationFrame(this._raf);
      this._raf = null;
      document.removeEventListener('visibilitychange', this._onVis);
      if (this._ro) this._ro.disconnect();
      if (this._io) this._io.disconnect();
      if (this._mq && this._mq.removeEventListener) this._mq.removeEventListener('change', this._onMq);
    }

    attributeChangedCallback() { if (this._booted) this._draw(0); }

    _resize() {
      const gl = this._gl;
      if (!gl) return;
      const w = this.clientWidth || 1, h = this.clientHeight || 1;
      const dpr = Math.min(window.devicePixelRatio || 1, this._dprCap);
      let pw = Math.max(1, Math.round(w * dpr)), ph = Math.max(1, Math.round(h * dpr));
      const over = Math.sqrt(this._maxPixels / (pw * ph));
      if (over < 1) { pw = Math.max(1, Math.round(pw * over)); ph = Math.max(1, Math.round(ph * over)); }
      if (this._canvas.width !== pw || this._canvas.height !== ph) {
        this._canvas.width = pw; this._canvas.height = ph;
        gl.viewport(0, 0, pw, ph);
      }
      this._draw(0);
    }

    _draw(dt) {
      const gl = this._gl;
      if (!gl || !this._prog) return;
      const speed = parseFloat(this.getAttribute('speed') || '1');
      this._time += (dt || 0) * 0.001 * (isFinite(speed) ? speed : 1);
      gl.useProgram(this._prog);
      gl.uniform2f(this._u.res, this._canvas.width, this._canvas.height);
      gl.uniform1f(this._u.t, this._time);
      const i = parseFloat(this.getAttribute('intensity') || '1');
      gl.uniform1f(this._u.i, isFinite(i) ? Math.max(0.2, Math.min(1.8, i)) : 1);
      gl.uniform1f(this._u.mode, this.getAttribute('mode') === 'ivory' ? 1 : 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    _pump() {
      const run = this._visible && !document.hidden && !this._reduced && this._gl && this._prog;
      if (run && this._raf === null) {
        this._last = 0;
        this._raf = requestAnimationFrame(this._tick);
      } else if (!run && this._raf !== null) {
        cancelAnimationFrame(this._raf);
        this._raf = null;
        if (this._reduced) this._draw(0);
      }
    }

    _tick = (now) => {
      if (!this._last) this._last = now;
      const dt = Math.min(64, now - this._last);
      this._last = now;
      this._draw(dt);
      // adaptive: if the device struggles, drop resolution once
      this._acc += dt; this._frames++;
      if (this._frames === 70) {
        if (this._acc / this._frames > 26 && this._dprCap > 1) { this._dprCap = 1; this._maxPixels = 620000; this._resize(); }
        this._frames = 0; this._acc = 0;
      }
      this._raf = requestAnimationFrame(this._tick);
    };
  }

  customElements.define('living-light', LivingLight);
})();

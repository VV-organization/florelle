'use client';

import {useEffect, useRef} from 'react';

const vertexSource = `
attribute vec2 position;
varying vec2 uv;
void main(){ uv = position * .5 + .5; gl_Position = vec4(position, 0., 1.); }
`;
const fragmentSource = `
precision mediump float;
varying vec2 uv;
uniform sampler2D greenery;
uniform sampler2D flowers;
uniform vec2 resolution;
uniform vec2 cover;
uniform vec2 anchor;
uniform float time;
uniform float opened;
uniform float radius;
uniform vec3 touches[12];
void main(){
  vec2 imageUV = uv * cover + (1. - cover) * anchor;
  // The left text field stays still; the foliage bends at different depths.
  float foliage = smoothstep(.22, .85, imageUV.x);
  float heightWeight = .28 + .72 * imageUV.y;
  float gust = .68 + .32 * sin(time * .29);
  float sway = sin(time * .72 + imageUV.y * 3.8) * .0048;
  sway += sin(time * 1.13 + imageUV.x * 8. + imageUV.y * 5.) * .0017;
  imageUV.x += sway * foliage * heightWeight * gust;
  imageUV.y += sin(time * .58 + imageUV.x * 6.2) * .0017 * foliage;
  imageUV = clamp(imageUV, vec2(.001), vec2(.999));
  float reveal = opened;
  for(int i = 0; i < 12; i++){
    vec2 distanceUV = (uv - touches[i].xy) * vec2(resolution.x / resolution.y, 1.);
    // Most of the brush is fully opaque. Only its outer edge is feathered.
    float brush = 1. - smoothstep(radius * .72, radius, length(distanceUV));
    reveal = max(reveal, brush * touches[i].z);
  }
  vec3 green = texture2D(greenery, imageUV).rgb;
  vec3 bloom = texture2D(flowers, imageUV).rgb;
  gl_FragColor = vec4(mix(green, bloom, reveal), 1.);
}
`;

type Touch = {x: number; y: number; born: number};

/** One shared deformation keeps the two photographs aligned while flowers open. */
export default function BotanicalScene({expanded}: {expanded: boolean}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const expandedRef = useRef(expanded);
  useEffect(() => { expandedRef.current = expanded; }, [expanded]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const hero = canvas?.parentElement;
    if (!canvas || !hero) return;
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    let teardown: (() => void) | undefined;

    function start() {
      teardown?.();
      teardown = undefined;
      if (reducedMotion.matches || !canvas || !hero) return;
      const gl = canvas.getContext('webgl', {alpha: false, antialias: false, powerPreference: 'low-power'});
      if (!gl) return; // CSS photographs and the bloom button remain functional.
      const shaders: WebGLShader[] = [];
      const textures: WebGLTexture[] = [];
      let disposed = false;
      let frame = 0;
      let visible = true;
      let ready = false;
      let width = 1, height = 1;
      let opened = expandedRef.current ? 1 : 0;
      let lastTime = 0;
      let elapsed = 0;
      let touches: Touch[] = [];
      let pointer: {x: number; y: number} | undefined;
      const values = new Float32Array(36);
      const program = gl.createProgram();
      const buffer = gl.createBuffer();
      if (!program || !buffer) return;
      function shader(type: number, source: string) {
        const result = gl!.createShader(type)!;
        shaders.push(result);
        gl!.shaderSource(result, source);
        gl!.compileShader(result);
        if (!gl!.getShaderParameter(result, gl!.COMPILE_STATUS)) return false;
        gl!.attachShader(program!, result);
        return true;
      }
      const compiled = shader(gl.VERTEX_SHADER, vertexSource) && shader(gl.FRAGMENT_SHADER, fragmentSource);
      gl.linkProgram(program);
      if (!compiled || !gl.getProgramParameter(program, gl.LINK_STATUS)) {
        shaders.forEach(s => gl.deleteShader(s));
        gl.deleteProgram(program); gl.deleteBuffer(buffer);
        return;
      }
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]), gl.STATIC_DRAW);
      const position = gl.getAttribLocation(program, 'position');
      gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      const uniforms = Object.fromEntries(['greenery','flowers','resolution','cover','anchor','time','opened','radius','touches[0]'].map(name => [name, gl.getUniformLocation(program, name)]));
      gl.uniform1i(uniforms.greenery, 0);
      gl.uniform1i(uniforms.flowers, 1);
      const images = [new Image(), new Image()];
      function resize() {
        width = hero!.clientWidth; height = hero!.clientHeight;
        const ratio = Math.min(devicePixelRatio || 1, 1.5);
        canvas!.width = Math.round(width * ratio); canvas!.height = Math.round(height * ratio);
        gl!.viewport(0, 0, canvas!.width, canvas!.height);
        gl!.uniform2f(uniforms.resolution, width, height);
        const aspect = width / height, imageAspect = 1.5;
        gl!.uniform2f(uniforms.cover, Math.min(1, aspect / imageAspect), Math.min(1, imageAspect / aspect));
        gl!.uniform2f(uniforms.anchor, width <= 700 ? .66 : width <= 1050 ? .6 : .5, .54);
        gl!.uniform1f(uniforms.radius, Math.min(420, Math.max(180, Math.min(width, height) * .4)) / height);
      }
      function draw(now: number) {
        frame = 0;
        if (disposed || !ready || !visible || document.hidden) { lastTime = 0; return; }
        const delta = lastTime ? Math.min((now - lastTime) / 1000, .05) : 0;
        lastTime = now; elapsed += delta;
        const target = expandedRef.current ? 1 : 0;
        opened += (target - opened) * (1 - Math.exp(-delta * 5));
        if (Math.abs(target - opened) < .002) opened = target;
        touches = touches.filter(t => now - t.born < 2400);
        values.fill(0);
        touches.slice(-11).forEach((t,i) => {
          values[i*3] = t.x; values[i*3+1] = t.y;
          values[i*3+2] = Math.min(1, Math.max(0, (2400 - (now - t.born)) / 1400));
        });
        if (pointer) { values[33] = pointer.x; values[34] = pointer.y; values[35] = 1; }
        gl!.uniform3fv(uniforms['touches[0]'], values);
        gl!.uniform1f(uniforms.time, elapsed);
        gl!.uniform1f(uniforms.opened, opened);
        gl!.drawArrays(gl!.TRIANGLES, 0, 6);
        canvas!.classList.add('is-ready');
        frame = requestAnimationFrame(draw);
      }
      function resume() {
        if (ready && visible && !document.hidden && !frame && !disposed) frame = requestAnimationFrame(draw);
      }
      images.forEach((image,index) => {
        image.onload = () => {
          if (disposed) return;
          const texture = gl.createTexture()!;
          textures.push(texture);
          gl.activeTexture(gl.TEXTURE0 + index);
          gl.bindTexture(gl.TEXTURE_2D, texture);
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
          if (textures.length === 2) { ready = true; resize(); resume(); }
        };
        image.src = index ? '/images/botanical-bloom.jpg' : '/images/botanical-green.jpg';
      });
      function move(event: PointerEvent) {
        if (event.pointerType === 'touch') return;
        const rect = hero!.getBoundingClientRect();
        pointer = {x: (event.clientX - rect.left) / width, y: 1 - (event.clientY - rect.top) / height};
        const now = performance.now();
        if (!touches.length || now - touches[touches.length-1].born > 80) {
          touches.push({...pointer, born: now}); touches = touches.slice(-11);
        }
      }
      function leave() {
        if (pointer) touches.push({...pointer, born: performance.now()});
        pointer = undefined;
      }
      function lost(event: Event) {
        event.preventDefault();
        ready = false;
        canvas!.classList.remove('is-ready');
        cancelAnimationFrame(frame); frame = 0;
      }
      const resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(hero);
      const visibilityObserver = new IntersectionObserver(([entry]) => {visible = entry.isIntersecting; resume();});
      visibilityObserver.observe(hero);
      hero.addEventListener('pointermove', move);
      hero.addEventListener('pointerleave', leave);
      document.addEventListener('visibilitychange', resume);
      canvas.addEventListener('webglcontextlost', lost);
      canvas.addEventListener('webglcontextrestored', start);
      teardown = () => {
        disposed = true; cancelAnimationFrame(frame);
        canvas.classList.remove('is-ready');
        resizeObserver.disconnect(); visibilityObserver.disconnect();
        hero.removeEventListener('pointermove', move); hero.removeEventListener('pointerleave', leave);
        document.removeEventListener('visibilitychange', resume);
        canvas.removeEventListener('webglcontextlost', lost); canvas.removeEventListener('webglcontextrestored', start);
        images.forEach(image => { image.onload = null; });
        textures.forEach(texture => gl.deleteTexture(texture)); shaders.forEach(s => gl.deleteShader(s));
        gl.deleteBuffer(buffer); gl.deleteProgram(program);
      };
    }
    start();
    reducedMotion.addEventListener('change', start);
    return () => { teardown?.(); reducedMotion.removeEventListener('change', start); };
  }, []);

  return <canvas ref={canvasRef} className="botanical-canvas" aria-hidden="true"/>;
}

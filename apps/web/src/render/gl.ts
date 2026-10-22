/** Small WebGL2 helpers shared by the sky renderer and the 360° viewer. */

/** Compiles and links a program; throws with the driver's log on failure. */
export function compileProgram(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const make = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
      throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
    return s;
  };
  const p = gl.createProgram()!;
  gl.attachShader(p, make(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, make(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS))
    throw new Error(gl.getProgramInfoLog(p) ?? 'link');
  return p;
}

/**
 * Sampling for an equirectangular image on the texture bound to TEXTURE_2D: a full mip chain,
 * wrapping in longitude, clamped at the poles, and anisotropic filtering (up to 8×).
 */
export function finishEquirectTexture(gl: WebGL2RenderingContext): void {
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
  if (aniso) {
    const max = gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT) as number;
    gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, max));
  }
}

import {
  AmbientLight,
  Box3,
  BufferAttribute,
  BufferGeometry,
  DirectionalLight,
  Group,
  Mesh,
  NeutralToneMapping,
  OrthographicCamera,
  SRGBColorSpace,
  Scene,
  Vector3,
  WebGLRenderer,
  type Material,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { DATA_VERSION, dataUrl } from '../../config';

/**
 * The Mars 2020 sample tube: NASA's own model (NASA-3D-Resources, built by
 * scripts/data/build-sample-tube.ts), 14.2 cm long, stood up along +Y with its open end (the
 * crenellated head) up. Loaded once; used for the tubes left at the depot, and drawn into small
 * pictures for the inventory's rack and the sample card.
 */

export interface TubeModel {
  geometry: BufferGeometry;
  material: Material;
  lengthM: number;
}

let loading: Promise<TubeModel | null> | null = null;

export function loadTube(): Promise<TubeModel | null> {
  loading ??= new GLTFLoader()
    .setMeshoptDecoder(MeshoptDecoder)
    .loadAsync(dataUrl(`models/sample-tube.glb?v=${DATA_VERSION}`))
    .then((gltf) => {
      let mesh: Mesh | null = null;
      gltf.scene.traverse((o) => {
        if ((o as Mesh).isMesh && !mesh) mesh = o as Mesh;
      });
      if (!mesh) return null;
      const m = mesh as Mesh;
      // In metres: the optimised file stores quantised positions with a scale on the node.
      gltf.scene.updateMatrixWorld(true);
      const geometry = new BufferGeometry();
      for (const name of ['position', 'normal', 'color']) {
        const a = m.geometry.getAttribute(name);
        if (!a) continue;
        const arr = new Float32Array(a.count * a.itemSize);
        for (let i = 0; i < a.count; i++)
          for (let c = 0; c < a.itemSize; c++) arr[i * a.itemSize + c] = a.getComponent(i, c);
        geometry.setAttribute(name, new BufferAttribute(arr, a.itemSize));
      }
      geometry.setIndex(m.geometry.index);
      geometry.applyMatrix4(m.matrixWorld);
      geometry.computeBoundingBox();
      const box = geometry.boundingBox!;
      return {
        geometry,
        material: m.material as Material,
        lengthM: box.max.y - box.min.y,
      };
    })
    .catch((e: unknown) => {
      console.warn('[Copernico game] sample tube model not loaded', e);
      return null;
    });
  return loading;
}

const pictures = new Map<string, Promise<string | null>>();

/**
 * A picture of the tube (PNG data URL, transparent background), upright or lying (`horizontal`),
 * lit like a product shot. Drawn once per kind with its own small renderer, then cached.
 */
export function tubePicture(horizontal = false): Promise<string | null> {
  const k = horizontal ? 'h' : 'v';
  let p = pictures.get(k);
  if (p) return p;
  p = loadTube().then((tube) => {
    if (!tube) return null;
    const W = horizontal ? 640 : 120;
    const H = horizontal ? 160 : 480;
    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    } catch {
      return null;
    }
    renderer.setSize(W, H, false);
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = NeutralToneMapping;
    const scene = new Scene();
    const group = new Group();
    const mesh = new Mesh(tube.geometry, tube.material);
    group.add(mesh);
    // Turned a little so the head's features read; lying with the head to the left.
    group.rotation.set(0, 0.5, horizontal ? Math.PI / 2 : 0);
    scene.add(group);
    scene.add(new AmbientLight(0xffffff, 1.1));
    const key = new DirectionalLight(0xfff4e6, 2.6);
    key.position.set(2, 3, 4);
    const rim = new DirectionalLight(0xbcd2ff, 1.2);
    rim.position.set(-3, 1, -2);
    scene.add(key, rim);
    const box = new Box3().setFromObject(group);
    const c = box.getCenter(new Vector3());
    const s = box.getSize(new Vector3());
    const margin = 1.08;
    const halfW = Math.max(s.x / 2, (s.y / 2) * (W / H)) * margin;
    const camera = new OrthographicCamera(-halfW, halfW, halfW * (H / W), -halfW * (H / W), 0.01, 10);
    camera.position.set(c.x, c.y, c.z + 1);
    camera.lookAt(c);
    renderer.render(scene, camera);
    const url = renderer.domElement.toDataURL('image/png');
    renderer.dispose();
    renderer.forceContextLoss();
    return url;
  });
  pictures.set(k, p);
  return p;
}

import * as THREE from "three";
import type { SpatialData } from "../../packages/client/src/core/types.js";

let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let renderer: THREE.WebGLRenderer;
let cube: THREE.Mesh;

const _quat = new THREE.Quaternion();
const _euler = new THREE.Euler();

export function init(canvas: HTMLCanvasElement): void {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1a2e);

  camera = new THREE.PerspectiveCamera(50, canvas.clientWidth / canvas.clientHeight, 0.1, 100);
  camera.up.set(0, 0, 1);
  camera.position.set(0, -5, 0);
  camera.lookAt(0, 0, 0);

  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(canvas.clientWidth, canvas.clientHeight);

  scene.add(new THREE.AmbientLight(0x404040, 2));
  const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
  dirLight.position.set(3, 4, 5);
  scene.add(dirLight);

  const geometry = new THREE.BoxGeometry(1.2, 1.2, 1.2);
  const material = new THREE.MeshStandardMaterial({
    color: 0x3498db,
    metalness: 0.3,
    roughness: 0.4,
  });
  cube = new THREE.Mesh(geometry, material);
  scene.add(cube);

  cube.add(
    new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry),
      new THREE.LineBasicMaterial({ color: 0x5dade2, linewidth: 1 }),
    ),
  );

  const grid = new THREE.GridHelper(10, 20, 0x0f3460, 0x0f3460);
  grid.rotation.x = Math.PI / 2;
  grid.position.z = -2;
  scene.add(grid);

  const observer = new ResizeObserver(() => {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  });
  observer.observe(canvas);

  (function animate() {
    requestAnimationFrame(animate);
    renderer.render(scene, camera);
  })();
}

/** Apply processed spatial data (post-transform from InputManager) */
export function applyFrame(data: SpatialData, lockOrbit: boolean): void {
  if (!cube) return;

  cube.position.x += data.translation.x;
  cube.position.y += data.translation.y;
  cube.position.z += data.translation.z;

  _euler.set(data.rotation.x, data.rotation.y, data.rotation.z, "XYZ");
  _quat.setFromEuler(_euler);

  if (lockOrbit) {
    const offset = camera.position.clone().sub(cube.position);
    offset.applyQuaternion(_quat.invert());
    camera.position.copy(cube.position).add(offset);
    camera.lookAt(cube.position);
  } else {
    cube.quaternion.premultiply(_quat);
  }
}

export function reset(): void {
  if (!cube) return;
  cube.position.set(0, 0, 0);
  cube.quaternion.identity();
  camera.position.set(0, -5, 0);
  camera.lookAt(0, 0, 0);
}

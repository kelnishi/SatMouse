import * as THREE from "three";

const SCALE_T = 0.002; // translation sensitivity
const SCALE_R = 0.005; // rotation sensitivity

let scene, camera, renderer, cube;

export function init(canvas) {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1a2e);

  camera = new THREE.PerspectiveCamera(50, canvas.clientWidth / canvas.clientHeight, 0.1, 100);
  camera.position.set(0, 0, 5);

  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(canvas.clientWidth, canvas.clientHeight);

  // Lights
  scene.add(new THREE.AmbientLight(0x404040, 2));
  const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
  dirLight.position.set(3, 4, 5);
  scene.add(dirLight);

  // Cube
  const geometry = new THREE.BoxGeometry(1.2, 1.2, 1.2);
  const material = new THREE.MeshStandardMaterial({
    color: 0x3498db,
    metalness: 0.3,
    roughness: 0.4,
  });
  cube = new THREE.Mesh(geometry, material);
  scene.add(cube);

  // Wireframe overlay
  const wireframe = new THREE.LineSegments(
    new THREE.EdgesGeometry(geometry),
    new THREE.LineBasicMaterial({ color: 0x5dade2, linewidth: 1 })
  );
  cube.add(wireframe);

  // Grid helper
  const grid = new THREE.GridHelper(10, 20, 0x0f3460, 0x0f3460);
  grid.position.y = -2;
  scene.add(grid);

  // Handle resize
  const observer = new ResizeObserver(() => {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  });
  observer.observe(canvas);

  // Double-click to reset
  canvas.addEventListener("dblclick", reset);

  // Render loop
  function animate() {
    requestAnimationFrame(animate);
    renderer.render(scene, camera);
  }
  animate();
}

export function update(spatialData) {
  if (!cube) return;
  const { translation: t, rotation: r } = spatialData;
  cube.position.x += t.x * SCALE_T;
  cube.position.y += t.y * SCALE_T;
  cube.position.z += t.z * SCALE_T;
  cube.rotation.x += r.x * SCALE_R;
  cube.rotation.y += r.y * SCALE_R;
  cube.rotation.z += r.z * SCALE_R;
}

export function reset() {
  if (!cube) return;
  cube.position.set(0, 0, 0);
  cube.rotation.set(0, 0, 0);
}

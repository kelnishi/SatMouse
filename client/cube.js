import * as THREE from "three";

let scaleT = 0.001; // translation sensitivity
let scaleR = 0.001; // rotation sensitivity

export function setSensitivity(type, v) {
  if (type === "t") scaleT = v;
  else scaleR = v;
}

let scene, camera, renderer, cube;

// Input filtering state
let lockPosition = false;
let lockRotation = false;
let dominant = false;

// Axis flip signs (1 or -1)
let flipTX = 1, flipTY = -1, flipTZ = -1;
let flipRX = 1, flipRY = -1, flipRZ = -1;
let lockOrbit = false;

export function setLockPosition(v) { lockPosition = v; }
export function setLockRotation(v) { lockRotation = v; }
export function setLockOrbit(v) { lockOrbit = v; }
export function setDominant(v) { dominant = v; }
export function setFlip(axis, v) {
  const sign = v ? -1 : 1;
  switch (axis) {
    case "tx": flipTX = sign; break;
    case "ty": flipTY = sign; break;
    case "tz": flipTZ = sign; break;
    case "rx": flipRX = sign; break;
    case "ry": flipRY = sign; break;
    case "rz": flipRZ = sign; break;
  }
}
export function getFlip(axis) {
  switch (axis) {
    case "tx": return flipTX < 0;
    case "ty": return flipTY < 0;
    case "tz": return flipTZ < 0;
    case "rx": return flipRX < 0;
    case "ry": return flipRY < 0;
    case "rz": return flipRZ < 0;
  }
}

// Reusable math objects
const _quat = new THREE.Quaternion();
const _euler = new THREE.Euler();

export function init(canvas) {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1a2e);

  camera = new THREE.PerspectiveCamera(50, canvas.clientWidth / canvas.clientHeight, 0.1, 100);
  camera.up.set(0, 0, 1);
  camera.position.set(0, -5, 0);
  camera.lookAt(0, 0, 0);

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

  // Grid helper — XY plane (Z-up)
  const grid = new THREE.GridHelper(10, 20, 0x0f3460, 0x0f3460);
  grid.rotation.x = Math.PI / 2;
  grid.position.z = -2;
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

  // Render loop
  function animate() {
    requestAnimationFrame(animate);
    renderer.render(scene, camera);
  }
  animate();
}

export function update(spatialData) {
  if (!cube) return;

  let { translation: t, rotation: r } = spatialData;

  if (dominant) {
    const vals = [
      { type: "t", axis: "x", v: Math.abs(t.x) },
      { type: "t", axis: "y", v: Math.abs(t.y) },
      { type: "t", axis: "z", v: Math.abs(t.z) },
      { type: "r", axis: "x", v: Math.abs(r.x) },
      { type: "r", axis: "y", v: Math.abs(r.y) },
      { type: "r", axis: "z", v: Math.abs(r.z) },
    ];
    const max = vals.reduce((a, b) => (b.v > a.v ? b : a));
    t = { x: 0, y: 0, z: 0 };
    r = { x: 0, y: 0, z: 0 };
    if (max.type === "t") t[max.axis] = spatialData.translation[max.axis];
    else r[max.axis] = spatialData.rotation[max.axis];
  }

  if (!lockPosition) {
    cube.position.x += t.x * flipTX * scaleT;
    cube.position.y += t.y * flipTY * scaleT;
    cube.position.z += t.z * flipTZ * scaleT;
  }

  if (!lockRotation) {
    _euler.set(
      r.x * flipRX * scaleR,
      r.y * flipRY * scaleR,
      r.z * flipRZ * scaleR,
      "XYZ"
    );
    _quat.setFromEuler(_euler);

    if (lockOrbit) {
      // Orbit: rotate camera around the cube's position in world space
      const offset = camera.position.clone().sub(cube.position);
      offset.applyQuaternion(_quat.invert());
      camera.position.copy(cube.position).add(offset);
      camera.lookAt(cube.position);
    } else {
      cube.quaternion.premultiply(_quat);
    }
  }
}

export function reset() {
  if (!cube) return;
  cube.position.set(0, 0, 0);
  cube.quaternion.identity();
  camera.position.set(0, -5, 0);
  camera.lookAt(0, 0, 0);
}

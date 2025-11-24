// map.js
// XL AI – Home ↔ Map slider + Futuristic 3D globe

// ---------- Page slider logic (Chats <-> Map) ----------
document.addEventListener("DOMContentLoaded", () => {
  const slideContainer = document.querySelector(".slide-container");
  const navChats = document.getElementById("nav-chats");
  const navMap = document.getElementById("nav-map");

  function setPage(page) {
    if (!slideContainer) return;

    if (page === "home") {
      slideContainer.style.transform = "translateX(0%)";
      slideContainer.dataset.active = "home";
      navChats.classList.add("bottom-nav-active");
      navMap.classList.remove("bottom-nav-active");
    } else if (page === "map") {
      // We have 2 pages, each 50% width. Going to page 2 = -50%.
      slideContainer.style.transform = "translateX(-50%)";
      slideContainer.dataset.active = "map";
      navMap.classList.add("bottom-nav-active");
      navChats.classList.remove("bottom-nav-active");
    }
  }

  if (navChats) navChats.addEventListener("click", () => setPage("home"));
  if (navMap) navMap.addEventListener("click", () => setPage("map"));

  // Touch swipe support (for iPad / phones)
  let touchStartX = null;

  slideContainer.addEventListener("touchstart", (e) => {
    if (!e.touches || e.touches.length === 0) return;
    touchStartX = e.touches[0].clientX;
  });

  slideContainer.addEventListener("touchend", (e) => {
    if (touchStartX === null) return;
    const endX = e.changedTouches[0].clientX;
    const deltaX = endX - touchStartX;

    const active = slideContainer.dataset.active || "home";
    const threshold = 70; // how far to swipe (px) before switching

    if (deltaX < -threshold && active === "home") {
      // swipe left → go to map
      setPage("map");
    } else if (deltaX > threshold && active === "map") {
      // swipe right → go back home
      setPage("home");
    }

    touchStartX = null;
  });

  // Start on home page
  setPage("home");

  // After page slider setup, initialize the globe
  initGlobe();
});

// ---------- 3D Globe with Three.js ----------

function initGlobe() {
  const container = document.getElementById("globe-container");
  if (!container || typeof THREE === "undefined") {
    console.error("Globe container or THREE.js missing");
    return;
  }

  const width = container.clientWidth;
  const height = container.clientHeight || 400;

  const scene = new THREE.Scene();
  scene.background = null;

  const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
  camera.position.z = 3.2;

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
  });
  renderer.setSize(width, height);
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  container.innerHTML = ""; // in case of hot reload
  container.appendChild(renderer.domElement);

  // Soft ambient + neon light
  const ambient = new THREE.AmbientLight(0x6366f1, 0.7);
  scene.add(ambient);

  const pointLight = new THREE.PointLight(0xf97316, 0.9);
  pointLight.position.set(5, 3, 5);
  scene.add(pointLight);

  // Sphere geometry for the earth
  const sphereGeom = new THREE.SphereGeometry(1, 64, 64);

  const sphereMat = new THREE.MeshStandardMaterial({
    color: 0x111827,
    metalness: 0.6,
    roughness: 0.35,
    emissive: 0x4c1d95,
    emissiveIntensity: 0.6,
  });

  const earth = new THREE.Mesh(sphereGeom, sphereMat);
  scene.add(earth);

  // Add a subtle "wave" overlay using wireframe
  const waveMat = new THREE.MeshBasicMaterial({
    color: 0x6ee7b7,
    wireframe: true,
    transparent: true,
    opacity: 0.12,
  });
  const waveSphere = new THREE.Mesh(sphereGeom, waveMat);
  waveSphere.scale.set(1.01, 1.01, 1.01);
  scene.add(waveSphere);

  // Helper to convert lat/lng (degrees) to 3D position on sphere
  function latLngToVector3(lat, lng, radius = 1.01) {
    const phi = (90 - lat) * (Math.PI / 180);
    const theta = (lng + 180) * (Math.PI / 180);

    const x = -(radius * Math.sin(phi) * Math.cos(theta));
    const z = radius * Math.sin(phi) * Math.sin(theta);
    const y = radius * Math.cos(phi);

    return new THREE.Vector3(x, y, z);
  }

  // Demo counselor markers (fake locations)
  const counselorLocations = [
    {
      id: "c1",
      name: "Calm Path Therapy",
      lat: 37.7749,
      lng: -122.4194,
      isOpen: true,
    },
    {
      id: "c2",
      name: "Northside Counseling",
      lat: 34.0522,
      lng: -118.2437,
      isOpen: false,
    },
    {
      id: "c3",
      name: "Mindful Connections",
      lat: 40.7128,
      lng: -74.006,
      isOpen: true,
    },
  ];

  const markerGroup = new THREE.Group();
  scene.add(markerGroup);

  counselorLocations.forEach((loc) => {
    const markerGeom = new THREE.SphereGeometry(0.03, 16, 16);
    const markerMat = new THREE.MeshBasicMaterial({
      color: loc.isOpen ? 0x22c55e : 0xf97373,
    });
    const marker = new THREE.Mesh(markerGeom, markerMat);
    const pos = latLngToVector3(loc.lat, loc.lng, 1.05);
    marker.position.copy(pos);
    marker.userData = loc; // save info for future interactivity
    markerGroup.add(marker);
  });

  // Rotation + drag to rotate
  let isDragging = false;
  let lastX = 0;

  function onPointerDown(e) {
    isDragging = true;
    lastX = e.clientX || (e.touches && e.touches[0].clientX) || 0;
  }

  function onPointerMove(e) {
    if (!isDragging) return;
    const clientX = e.clientX || (e.touches && e.touches[0].clientX) || 0;
    const deltaX = clientX - lastX;
    lastX = clientX;
    earth.rotation.y += deltaX * 0.005;
    waveSphere.rotation.y += deltaX * 0.005;
    markerGroup.rotation.y += deltaX * 0.005;
  }

  function onPointerUp() {
    isDragging = false;
  }

  renderer.domElement.addEventListener("pointerdown", onPointerDown);
  renderer.domElement.addEventListener("pointermove", onPointerMove);
  renderer.domElement.addEventListener("pointerup", onPointerUp);
  renderer.domElement.addEventListener("pointerleave", onPointerUp);

  // For touch (iPad)
  renderer.domElement.addEventListener("touchstart", (e) => {
    onPointerDown(e.touches[0]);
  });
  renderer.domElement.addEventListener("touchmove", (e) => {
    onPointerMove(e.touches[0]);
  });
  renderer.domElement.addEventListener("touchend", onPointerUp);

  // Animate
  function animate() {
    requestAnimationFrame(animate);

    if (!isDragging) {
      earth.rotation.y += 0.0008;
      waveSphere.rotation.y += 0.001;
      markerGroup.rotation.y += 0.0008;
    }

    renderer.render(scene, camera);
  }

  animate();

  // Handle resize
  window.addEventListener("resize", () => {
    const newWidth = container.clientWidth;
    const newHeight = container.clientHeight || 400;
    camera.aspect = newWidth / newHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(newWidth, newHeight);
  });
}
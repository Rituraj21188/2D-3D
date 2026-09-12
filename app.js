/* =========================================================
   SITE BOUNDS & CORE COORDINATES
========================================================= */

const MIN_LAT = 25.21063054697481;
const MAX_LAT = 25.21277826092301;
const MIN_LNG = 91.06061914668449;
const MAX_LNG = 91.06305746574276;

const SITE_CENTER = [
  (MIN_LAT + MAX_LAT) / 2,
  (MIN_LNG + MAX_LNG) / 2
];

const SITE_BOUNDS = L.latLngBounds(
  [MIN_LAT, MIN_LNG],
  [MAX_LAT, MAX_LNG]
);

const PAN_BOUNDS = SITE_BOUNDS.pad(0.3);

let currentMode = '2d';
let activeRasterType = 'ortho';
let map2d = null;
let tileLayers = {};
let currentTileLayer = null;

// Contour states
let contourLayer2D = null;
let is2DContoursVisible = true;
let is2DLabelsVisible = false;
let cachedContourGeoJSON = null;

let contourLines3D = null;
let contourLineMaterial3D = null;
let contourLabels3DGroup = null;
let is3DContoursVisible = true;
let is3DLabelsVisible = false;
let contour3DColor = '#f59e0b';

// Three.js states
let renderer3d = null;
let scene3d = null;
let camera3d = null;
let controls3d = null;
let pointCloudGroup = null;
let pointCloud3d = null;
let pointsMaterial3d = null;
let animationFrameId = null;
let is3dInitialized = false;

let cloudCenter = new THREE.Vector3();
let cloudSize = new THREE.Vector3();

let defaultCameraPosition = new THREE.Vector3();
let defaultTarget = new THREE.Vector3();

/* =========================================================
   WELCOME SCREEN (FAIL-SAFE TRANSITION)
========================================================= */

function runWelcomeScreen() {
  const splash = document.getElementById('welcome-screen');
  const progress = document.getElementById('splash-progress');

  if (progress) {
    setTimeout(() => { progress.style.width = '45%'; }, 150);
    setTimeout(() => { progress.style.width = '85%'; }, 400);
    setTimeout(() => { progress.style.width = '100%'; }, 700);
  }

  setTimeout(() => {
    if (splash) splash.classList.add('hidden');
    if (map2d) {
      try {
        map2d.invalidateSize();
        map2d.fitBounds(SITE_BOUNDS);
      } catch (e) {
        console.warn('Deferred map fitBounds:', e);
      }
    }
  }, 950);
}

/* =========================================================
   TRANSPARENT TILE LAYER
========================================================= */

const TransparentBlackTileLayer = L.TileLayer.extend({
  createTile: function(coords, done) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');

    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = function() {
      ctx.drawImage(img, 0, 0);
      const imgData = ctx.getImageData(0, 0, 256, 256);
      const d = imgData.data;

      for (let i = 0; i < d.length; i += 4) {
        if (d[i] <= 8 && d[i + 1] <= 8 && d[i + 2] <= 8) {
          d[i + 3] = 0;
        }
      }

      ctx.putImageData(imgData, 0, 0);
      done(null, canvas);
    };

    img.onerror = function(error) {
      done(error, canvas);
    };

    img.src = this.getTileUrl(coords);
    return canvas;
  }
});

/* =========================================================
   2D MAP & CONTOURS
========================================================= */

function init2DMap() {
  try {
    const container = document.getElementById('view-2d');
    if (!container) return;

    map2d = L.map('view-2d', {
      zoomControl: false,
      attributionControl: false,
      center: SITE_CENTER,
      zoom: 18,
      minZoom: 14,
      maxZoom: 22,
      maxBounds: PAN_BOUNDS,
      maxBoundsViscosity: 1.0
    });

    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 22
    }).addTo(map2d);

    const tileConfig = {
      minZoom: 14,
      maxNativeZoom: 20,
      maxZoom: 22,
      tms: true,
      opacity: 1.0
    };

    const LayerClass = (typeof TransparentBlackTileLayer !== 'undefined') ? TransparentBlackTileLayer : L.TileLayer;

    tileLayers = {
      ortho: L.tileLayer('./data/ortho/{z}/{x}/{y}.png', tileConfig),
      dsm:   new LayerClass('./data/dsm/{z}/{x}/{y}.png', tileConfig),
      dtm:   new LayerClass('./data/dtm/{z}/{x}/{y}.png', tileConfig)
    };

    currentTileLayer = tileLayers.ortho;
    currentTileLayer.addTo(map2d);
    map2d.fitBounds(SITE_BOUNDS);

    map2d.on('mousemove', function(e) {
      const el = document.getElementById('coord-display');
      if (el) {
        el.innerText =
          `Lat: ${e.latlng.lat.toFixed(6)}° | ` +
          `Lng: ${e.latlng.lng.toFixed(6)}° | ` +
          `Zoom: ${map2d.getZoom()} | ` +
          `Layer: ${activeRasterType.toUpperCase()}`;
      }
    });

    loadContourData();
  } catch (err) {
    console.error('2D Map Initialization Error:', err);
  }
}

function loadContourData() {
  fetch('./Contour.geojson')
    .then(res => {
      if (!res.ok) throw new Error(`HTTP error ${res.status}`);
      return res.json();
    })
    .then(geoJson => {
      cachedContourGeoJSON = geoJson;
      render2DContours(geoJson);

      if (pointCloudGroup && !contourLines3D) {
        build3DContours(geoJson);
      }
    })
    .catch(err => console.error('Error loading Contour.geojson:', err));
}

function render2DContours(data) {
  if (!map2d) return;

  if (contourLayer2D) {
    map2d.removeLayer(contourLayer2D);
  }

  contourLayer2D = L.geoJSON(data, {
    style: function(feature) {
      const coords = feature.geometry.coordinates;
      const elev = Math.round(coords[0][2] || 0)[cite: 1];
      const isIndex = elev % 5 === 0;

      return {
        color: isIndex ? '#f59e0b' : '#38bdf8',
        weight: isIndex ? 2.2 : 1.0,
        opacity: 0.85
      };
    },
    onEachFeature: function(feature, layer) {
      const coords = feature.geometry.coordinates;
      const elev = Math.round(coords[0][2] || 0)[cite: 1];
      layer.bindTooltip(`${elev} m`, {
        permanent: is2DLabelsVisible,
        sticky: !is2DLabelsVisible,
        direction: 'top',
        className: 'contour-tooltip'
      });
    }
  });

  if (is2DContoursVisible) {
    contourLayer2D.addTo(map2d);
  }
}

window.toggle2DContours = function() {
  const card = document.getElementById('vector-card-contours');
  is2DContoursVisible = !is2DContoursVisible;

  if (contourLayer2D && map2d) {
    if (is2DContoursVisible) {
      map2d.addLayer(contourLayer2D);
      if (card) card.classList.add('active');
    } else {
      map2d.removeLayer(contourLayer2D);
      if (card) card.classList.remove('active');
    }
  }
};

window.toggle2DLabels = function() {
  is2DLabelsVisible = !is2DLabelsVisible;
  const btn = document.getElementById('btn-2d-labels');

  if (btn) {
    btn.classList.toggle('active', is2DLabelsVisible);
    btn.innerHTML = `<i class="fa-solid fa-tag"></i> Labels ${is2DLabelsVisible ? 'On' : 'Off'}`;
  }

  if (cachedContourGeoJSON) {
    render2DContours(cachedContourGeoJSON);
  }
};

window.selectRasterLayer = function(type) {
  if (activeRasterType === type || !map2d) return;

  if (currentTileLayer) {
    map2d.removeLayer(currentTileLayer);
  }

  currentTileLayer = tileLayers[type];
  if (currentTileLayer) {
    currentTileLayer.addTo(map2d);
    const opacity = parseFloat(document.getElementById('layer-opacity').value);
    currentTileLayer.setOpacity(opacity);
  }

  activeRasterType = type;
  document.querySelectorAll('.layer-option').forEach(el => el.classList.remove('active'));
  const card = document.getElementById(`layer-card-${type}`);
  if (card) card.classList.add('active');
};

window.setLayerOpacity = function(val) {
  document.getElementById('opacity-val').innerText = Math.round(val * 100) + '%';
  if (currentTileLayer) {
    currentTileLayer.setOpacity(val);
  }
};

/* =========================================================
   3D POINT CLOUD & CONTOURS
========================================================= */

function init3DView() {
  const container = document.getElementById('view-3d');
  const loadingOverlay = document.getElementById('loading-overlay');
  const loadingText = document.getElementById('loading-text');

  const width = container.clientWidth || window.innerWidth;
  const height = container.clientHeight || window.innerHeight;

  scene3d = new THREE.Scene();
  scene3d.background = new THREE.Color(0x0b0f19);

  camera3d = new THREE.PerspectiveCamera(55, width / height, 0.01, 100000);

  renderer3d = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
    powerPreference: 'high-performance',
    logarithmicDepthBuffer: true
  });

  renderer3d.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer3d.setSize(width, height);
  renderer3d.outputEncoding = THREE.sRGBEncoding;
  renderer3d.domElement.style.display = 'block';
  container.appendChild(renderer3d.domElement);

  controls3d = new THREE.OrbitControls(camera3d, renderer3d.domElement);
  controls3d.enableDamping = true;
  controls3d.dampingFactor = 0.07;
  controls3d.rotateSpeed = 0.65;
  controls3d.zoomSpeed = 1.0;
  controls3d.panSpeed = 0.8;
  controls3d.screenSpacePanning = false;
  controls3d.minDistance = 0.01;
  controls3d.maxDistance = 1000000;

  loadingOverlay.style.display = 'flex';
  loadingText.innerText = 'Loading cloud.ply...';

  const loader = new THREE.PLYLoader();
  loader.load(
    './cloud.ply',
    function(geometry) {
      geometry.computeBoundingBox();
      const sourceBox = geometry.boundingBox.clone();
      cloudCenter = sourceBox.getCenter(new THREE.Vector3());
      cloudSize = sourceBox.getSize(new THREE.Vector3());

      geometry.translate(-cloudCenter.x, -cloudCenter.y, -cloudCenter.z);

      pointCloudGroup = new THREE.Group();
      pointCloudGroup.rotation.x = -Math.PI / 2;

      const hasColors = geometry.hasAttribute('color');
      const maxDimension = Math.max(cloudSize.x, cloudSize.y, cloudSize.z);

      const baseSize = maxDimension * 0.0012;
      const initialSize = baseSize * 0.6;

      pointsMaterial3d = new THREE.PointsMaterial({
        size: initialSize,
        sizeAttenuation: true,
        vertexColors: hasColors,
        color: hasColors ? 0xffffff : 0x38bdf8,
        transparent: true,
        opacity: 0.8,
        depthTest: true,
        depthWrite: true
      });

      pointCloud3d = new THREE.Points(geometry, pointsMaterial3d);
      pointCloud3d.frustumCulled = true;
      pointCloudGroup.add(pointCloud3d);

      scene3d.add(pointCloudGroup);

      if (cachedContourGeoJSON && !contourLines3D) {
        build3DContours(cachedContourGeoJSON);
      }

      const distance = maxDimension * 1.7;
      camera3d.position.set(distance, distance * 0.75, distance);
      camera3d.near = Math.max(maxDimension * 0.00001, 0.001);
      camera3d.far = Math.max(maxDimension * 100, 1000);
      camera3d.updateProjectionMatrix();

      controls3d.target.set(0, 0, 0);
      controls3d.update();

      defaultCameraPosition.copy(camera3d.position);
      defaultTarget.copy(controls3d.target);

      create3DControls();
      loadingOverlay.style.display = 'none';
    },
    function(xhr) {
      if (xhr.lengthComputable) {
        const percent = Math.round((xhr.loaded / xhr.total) * 100);
        loadingText.innerText = `Loading cloud.ply... ${percent}%`;
      }
    },
    function(error) {
      console.error('PLY loading error:', error);
      loadingText.innerText = 'Failed to load cloud.ply';
    }
  );

  is3dInitialized = true;
}

function create3DTextSprite(text) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 48;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
  ctx.roundRect(4, 4, 120, 40, 6);
  ctx.fill();
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.75)';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = '#f8fafc';
  ctx.font = 'bold 20px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 64, 24);

  const texture = new THREE.CanvasTexture(canvas);
  const spriteMaterial = new THREE.SpriteMaterial({
    map: texture,
    depthTest: true,
    transparent: true
  });
  const sprite = new THREE.Sprite(spriteMaterial);
  const scale = Math.max(cloudSize.x, cloudSize.y) * 0.035;
  sprite.scale.set(scale * 1.6, scale * 0.6, 1);
  return sprite;
}

function build3DContours(geoJson) {
  if (!pointCloudGroup || !geoJson) return;

  if (contourLines3D) pointCloudGroup.remove(contourLines3D);
  if (contourLabels3DGroup) pointCloudGroup.remove(contourLabels3DGroup);

  const positions = [];
  contourLabels3DGroup = new THREE.Group();

  const latRad = (SITE_CENTER[0] * Math.PI) / 180.0;
  const metersPerDegLat = 111132.92 - 559.82 * Math.cos(2 * latRad) + 1.175 * Math.cos(4 * latRad);
  const metersPerDegLon = 111412.84 * Math.cos(latRad) - 93.5 * Math.cos(3 * latRad);

  geoJson.features.forEach((feature, idx) => {
    const coords = feature.geometry.coordinates;
    if (!coords || coords.length < 2) return;

    const elev = Math.round(coords[0][2] || 0)[cite: 1];

    if ((elev % 5 === 0 || idx % 4 === 0) && coords.length > 3) {
      const midIndex = Math.floor(coords.length / 2);
      const pMid = coords[midIndex];
      const lx = (pMid[0] - SITE_CENTER[1]) * metersPerDegLon;
      const ly = (pMid[1] - SITE_CENTER[0]) * metersPerDegLat;
      const lz = pMid[2];[cite: 1]

      const sprite = create3DTextSprite(`${elev}m`);
      sprite.position.set(lx, ly, lz - cloudCenter.z + 0.7);
      contourLabels3DGroup.add(sprite);
    }

    for (let i = 0; i < coords.length - 1; i++) {
      const p1 = coords[i];
      const p2 = coords[i + 1];

      const x1 = (p1[0] - SITE_CENTER[1]) * metersPerDegLon;
      const y1 = (p1[1] - SITE_CENTER[0]) * metersPerDegLat;
      const z1 = p1[2];[cite: 1]

      const x2 = (p2[0] - SITE_CENTER[1]) * metersPerDegLon;
      const y2 = (p2[1] - SITE_CENTER[0]) * metersPerDegLat;
      const z2 = p2[2];[cite: 1]

      positions.push(
        x1, y1, z1 - cloudCenter.z,
        x2, y2, z2 - cloudCenter.z
      );
    }
  });

  const lineGeometry = new THREE.BufferGeometry();
  lineGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));

  contourLineMaterial3D = new THREE.LineBasicMaterial({
    color: new THREE.Color(contour3DColor),
    depthTest: true,
    transparent: true,
    opacity: 0.9
  });

  contourLines3D = new THREE.LineSegments(lineGeometry, contourLineMaterial3D);
  contourLines3D.visible = is3DContoursVisible;
  contourLabels3DGroup.visible = is3DLabelsVisible;

  pointCloudGroup.add(contourLines3D);
  pointCloudGroup.add(contourLabels3DGroup);
}

function create3DControls() {
  if (document.getElementById('pc-controls')) return;

  const panel = document.createElement('div');
  panel.id = 'pc-controls';
  panel.className = 'glass-card';
  panel.innerHTML = `
    <div class="pc-title">Point Cloud Controls</div>
    <div class="pc-row">
      <div class="pc-row-header">
        <span>Point Size</span>
        <span id="pc-size-value">60%</span>
      </div>
      <input id="pc-size" type="range" min=".2" max="5" step=".1" value="0.6" />
    </div>
    <div class="pc-row">
      <div class="pc-row-header">
        <span>Opacity</span>
        <span id="pc-opacity-value">80%</span>
      </div>
      <input id="pc-opacity" type="range" min=".1" max="1" step=".05" value="0.8" />
    </div>
    <div class="pc-row">
      <div class="pc-row-header">
        <span>Contour Color</span>
        <div class="pc-color-picker-container">
          <input type="color" id="pc-contour-color" class="pc-color-picker" value="${contour3DColor}" />
        </div>
      </div>
    </div>
    <div class="pc-buttons">
      <button id="pc-home"><i class="fa-solid fa-cube"></i> 3D</button>
      <button id="pc-top"><i class="fa-solid fa-arrow-down"></i> Top</button>
      <button id="pc-front"><i class="fa-solid fa-arrows-up-down"></i> Front</button>
      <button id="pc-side"><i class="fa-solid fa-arrows-left-right"></i> Side</button>
      <button id="pc-contour" class="active"><i class="fa-solid fa-water"></i> Contours</button>
      <button id="pc-3d-labels"><i class="fa-solid fa-tag"></i> 3D Labels</button>
      <button id="pc-auto">Auto Rotate</button>
      <button id="pc-full">Fullscreen</button>
    </div>
  `;

  document.getElementById('view-3d').appendChild(panel);

  document.getElementById('pc-size').addEventListener('input', function() {
    if (!pointsMaterial3d) return;
    const factor = parseFloat(this.value);
    const maxDim = Math.max(cloudSize.x, cloudSize.y, cloudSize.z);
    pointsMaterial3d.size = (maxDim * 0.0012) * factor;
    document.getElementById('pc-size-value').innerText = Math.round(factor * 100) + '%';
  });

  document.getElementById('pc-opacity').addEventListener('input', function() {
    if (!pointsMaterial3d) return;
    const value = parseFloat(this.value);
    pointsMaterial3d.opacity = value;
    pointsMaterial3d.transparent = value < 1;
    document.getElementById('pc-opacity-value').innerText = Math.round(value * 100) + '%';
  });

  document.getElementById('pc-contour-color').addEventListener('input', function() {
    contour3DColor = this.value;
    if (contourLineMaterial3D) {
      contourLineMaterial3D.color.set(contour3DColor);
    }
  });

  document.getElementById('pc-home').onclick = () => set3DView('oblique');
  document.getElementById('pc-top').onclick = () => set3DView('top');
  document.getElementById('pc-front').onclick = () => set3DView('front');
  document.getElementById('pc-side').onclick = () => set3DView('side');
  document.getElementById('pc-auto').onclick = () => {
    controls3d.autoRotate = !controls3d.autoRotate;
  };

  document.getElementById('pc-contour').onclick = function() {
    is3DContoursVisible = !is3DContoursVisible;
    if (contourLines3D) {
      contourLines3D.visible = is3DContoursVisible;
    }
    this.classList.toggle('active', is3DContoursVisible);
  };

  document.getElementById('pc-3d-labels').onclick = function() {
    is3DLabelsVisible = !is3DLabelsVisible;
    if (contourLabels3DGroup) {
      contourLabels3DGroup.visible = is3DLabelsVisible;
    }
    this.classList.toggle('active', is3DLabelsVisible);
  };

  document.getElementById('pc-full').onclick = () => {
    const element = document.getElementById('view-3d');
    if (!document.fullscreenElement) {
      element.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  };
}

function set3DView(view) {
  if (!camera3d || !controls3d) return;
  const maxDim = Math.max(cloudSize.x, cloudSize.y, cloudSize.z);
  const distance = maxDim * 1.7;

  if (view === 'oblique') camera3d.position.set(distance, distance * 0.75, distance);
  if (view === 'top') camera3d.position.set(0, distance, 0);
  if (view === 'front') camera3d.position.set(0, 0, distance);
  if (view === 'side') camera3d.position.set(distance, 0, 0);

  controls3d.target.set(0, 0, 0);
  controls3d.update();
}

function animate3D() {
  if (currentMode !== '3d') return;
  animationFrameId = requestAnimationFrame(animate3D);

  if (controls3d) controls3d.update();
  if (renderer3d && scene3d && camera3d) {
    renderer3d.render(scene3d, camera3d);
  }
}

function pause3DRenderer() {
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
}

function resume3DRenderer() {
  if (!is3dInitialized) {
    init3DView();
  }
  if (!animationFrameId) {
    animate3D();
  }
}

/* =========================================================
   UI SWITCHING & RESIZE
========================================================= */

window.switchMode = function(mode) {
  if (mode === currentMode) return;
  currentMode = mode;

  const view2D = document.getElementById('view-2d');
  const view3D = document.getElementById('view-3d');
  const card2D = document.getElementById('card-2d');
  const card3D = document.getElementById('card-3d');
  const label = document.getElementById('active-mode-label');

  if (mode === '2d') {
    view2D.classList.remove('inactive');
    view2D.classList.add('active');
    view3D.classList.remove('active');
    view3D.classList.add('inactive');

    card2D.classList.add('active');
    card3D.classList.remove('active');
    label.innerText = `Active Mode: 2D ${activeRasterType.toUpperCase()}`;

    pause3DRenderer();

    setTimeout(() => {
      if (map2d) {
        map2d.invalidateSize();
        map2d.fitBounds(SITE_BOUNDS);
      }
    }, 150);
  } else {
    view3D.classList.remove('inactive');
    view3D.classList.add('active');
    view2D.classList.remove('active');
    view2D.classList.add('inactive');

    card3D.classList.add('active');
    card2D.classList.remove('active');
    label.innerText = 'Active Mode: 3D Point Cloud';

    resume3DRenderer();

    setTimeout(() => {
      if (renderer3d && camera3d) {
        const w = view3D.clientWidth;
        const h = view3D.clientHeight;
        camera3d.aspect = w / h;
        camera3d.updateProjectionMatrix();
        renderer3d.setSize(w, h);
      }
    }, 100);
  }
};

window.toggleSidebar = function() {
  const sidebar = document.getElementById('left-sidebar');
  const icon = document.getElementById('collapse-icon');
  const isMobile = window.innerWidth <= 768;

  if (isMobile) {
    sidebar.classList.toggle('expanded');
    icon.className = sidebar.classList.contains('expanded') ? 'fa-solid fa-angles-down' : 'fa-solid fa-angles-up';
  } else {
    if (sidebar.style.width === '44px') {
      sidebar.style.width = '230px';
      icon.className = 'fa-solid fa-angles-left';
    } else {
      sidebar.style.width = '44px';
      icon.className = 'fa-solid fa-angles-right';
    }
  }
};

window.addEventListener('resize', function() {
  if (currentMode === '2d' && map2d) {
    map2d.invalidateSize();
  }
  if (currentMode === '3d' && renderer3d && camera3d) {
    const view = document.getElementById('view-3d');
    camera3d.aspect = view.clientWidth / view.clientHeight;
    camera3d.updateProjectionMatrix();
    renderer3d.setSize(view.clientWidth, view.clientHeight);
  }
});

window.addEventListener('DOMContentLoaded', function() {
  runWelcomeScreen();
  init2DMap();
});

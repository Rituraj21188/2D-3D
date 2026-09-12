/* =========================================================
   SITE BOUNDS
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

/* Global layer holders for Contours */
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

/* =========================================================
   2D MAP & CONTOUR LOADER
========================================================= */

function init2DMap() {
  map2d = L.map('view-2d', {
    zoomControl: false,
    attributionControl: false,
    center: SITE_CENTER,
    zoom: 18,
    minZoom: 16,
    maxZoom: 22,
    maxBounds: PAN_BOUNDS,
    maxBoundsViscosity: 1.0
  });

  L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 22
    }
  ).addTo(map2d);

  const tileConfig = {
    minZoom: 14,
    maxNativeZoom: 20,
    maxZoom: 22,
    tms: true,
    opacity: 1.0
  };

  tileLayers = {
    ortho: L.tileLayer('./data/ortho/{z}/{x}/{y}.png', tileConfig),
    dsm:   new TransparentBlackTileLayer('./data/dsm/{z}/{x}/{y}.png', tileConfig),
    dtm:   new TransparentBlackTileLayer('./data/dtm/{z}/{x}/{y}.png', tileConfig)
  };

  currentTileLayer = tileLayers.ortho;
  currentTileLayer.addTo(map2d);

  map2d.fitBounds(SITE_BOUNDS);

  map2d.on('mousemove', function(e) {
    const coordEl = document.getElementById('coord-display');
    if (coordEl) {
      coordEl.innerText =
        `Lat: ${e.latlng.lat.toFixed(6)}° | ` +
        `Lng: ${e.latlng.lng.toFixed(6)}° | ` +
        `Zoom: ${map2d.getZoom()} | ` +
        `Layer: ${activeRasterType.toUpperCase()}`;
    }
  });

  loadContourData();
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
        weight: isIndex ? 2.0 : 1.0,
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

/* =========================================================
   3D CONTOUR BUILDER & LABELS
========================================================= */

function create3DTextSprite(text) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 48;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
  ctx.roundRect(4, 4, 120, 40, 6);
  ctx.fill();
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.7)';
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
      sprite.position.set(lx, ly, lz - cloudCenter.z + 0.8);
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

/* =========================================================
   3D UI CONTROLS (WITHOUT GRID)
========================================================= */

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

// 福岡市・北九州市 地域特性ビューア
// ラジオボタンで5つのモード（住居、商業、オフィス、多用途、飲食店）を切り替え
// - 住居が多い: 住居系(共同住宅+住宅+店舗等併用住宅+店舗等併用共同住宅) >= 60%
// - 商業が多い: (商業施設+商業系複合施設) >= 30%
// - オフィスが多い: 業務施設 >= 30%
// - 多用途: 住居系・商業系・業務施設がそれぞれ >=15% かつ 建物総数 >= 50
// - 飲食店の多さ: 飲食店数によるヒートマップ

// Mapbox token（方針により空）
// ※必ず自分の token を設定してください
mapboxgl.accessToken = 'pk.eyJ1IjoibmFtaTAwIiwiYSI6ImNta2FlNGFkeTFsbzkzZnNjY3kyY3h3a2QifQ._Xgc5PBf9qCnhgtcpe_mjw';

let map;

// 現在のモード（radio button切り替え）
let currentCharacteristicMode = 'residential';

// データ
let meshUsageData = null;
let buildingsUsageData = null;

// ===== URLs =====
const MESH_USAGE_URL = 'web_data/mesh_usage.geojson';
const BUILDINGS_USAGE_URL = 'web_data/buildings_usage.geojson';

// ===== Zoom threshold for layer switching =====
const ZOOM_THRESHOLD = 14;

// ===== Layer IDs =====
const MESH_SOURCE_ID = 'mesh-usage';
const MESH_FILL_LAYER_ID = 'mesh-fill';
const MESH_OUTLINE_LAYER_ID = 'mesh-outline';
const BUILDINGS_SOURCE_ID = 'buildings-usage';
const BUILDINGS_LAYER_ID = 'buildings-circles';

// ===== Building usage colors =====
const BUILDING_USAGE_COLORS = {
  '住宅': '#66c2a5',
  '共同住宅': '#66c2a5',
  '商業施設': '#fc8d62',
  '業務施設': '#8da0cb',
  '店舗': '#fc8d62',
  '飲食店': '#e78ac3',
  'その他': '#cccccc'
};

// ===== Mode configuration =====
const MODES = {
  residential: {
    label: '住居が多い',
    color: '#66c2a5'
  },
  commercial: {
    label: '商業が多い',
    color: '#fc8d62'
  },
  office: {
    label: 'オフィスが多い',
    color: '#8da0cb'
  },
  diverse: {
    label: '多用途',
    color: '#e78ac3'
  },
  restaurants: {
    label: '飲食店の多さ',
    colorExpression: [
      'interpolate', ['linear'], ['get', '飲食店数'],
      0, '#ffffcc',
      10, '#ffeda0',
      20, '#fed976',
      50, '#feb24c',
      100, '#fd8d3c',
      200, '#fc4e2a',
      500, '#e31a1c',
      1000, '#bd0026'
    ]
  }
};

function injectPopupCSSOnce() {
  if (document.getElementById('mesh-popup-style')) return;
  const style = document.createElement('style');
  style.id = 'mesh-popup-style';
  style.textContent = `
    .mapboxgl-popup.mesh-popup .mapboxgl-popup-content{
      max-width: 52-0px !important;
      width: 520px !important;
      box-sizing: border-box;
      padding: 10px 12px;
    }
  `;
  document.head.appendChild(style);
}

// ===== Characteristic calculation =====
function calcMeshCharacteristic(props) {
  const total = Number(props['建物総数'] ?? 0);
  if (total < 1) return null;

  const getVal = (k) => Number(props[k] ?? 0);

  const residentialSum =
    getVal('建物_共同住宅') +
    getVal('建物_住宅') +
    getVal('建物_店舗等併用住宅') +
    getVal('建物_店舗等併用共同住宅');

  const commercialSum =
    getVal('建物_商業施設') +
    getVal('建物_商業系複合施設');

  const officeSum = getVal('建物_業務施設');

  const rRes = residentialSum / total;
  const rCom = commercialSum / total;
  const rOff = officeSum / total;

  // 多用途: 建物総数 >= 50 かつ 3種類がそれぞれ >= 15%
  if (total >= 50 && rRes >= 0.15 && rCom >= 0.15 && rOff >= 0.15) return 'diverse';
  // 住居: 建物総数条件なし
  if (rRes >= 0.6) return 'residential';
  // 商業: 建物総数条件なし
  if (rCom >= 0.3) return 'commercial';
  // オフィス: 建物総数条件なし
  if (rOff >= 0.3) return 'office';
  return null;
}

// ===== Load mesh data =====
async function loadMeshData() {
  if (meshUsageData) return;
  try {
    const response = await fetch(MESH_USAGE_URL);
    meshUsageData = await response.json();
    
    // Add __char property for each mesh
    for (const f of meshUsageData.features || []) {
      f.properties = f.properties || {};
      f.properties.__char = calcMeshCharacteristic(f.properties);
    }
    console.log(`Mesh data loaded: ${meshUsageData.features.length} meshes`);
  } catch (e) {
    console.error('Error loading mesh data:', e);
    throw e;
  }
}

// ===== Load buildings data =====
async function loadBuildingsData() {
  if (buildingsUsageData) return;
  try {
    const response = await fetch(BUILDINGS_USAGE_URL);
    buildingsUsageData = await response.json();
    console.log(`Buildings data loaded: ${buildingsUsageData.features.length} buildings`);
  } catch (e) {
    console.error('Error loading buildings data:', e);
    throw e;
  }
}

// ===== Ensure building layers are created first =====
function ensureBuildingLayersFirst() {
  if (!map || !map.isStyleLoaded()) return;
  if (!buildingsUsageData) return;

  // Add source
  if (!map.getSource(BUILDINGS_SOURCE_ID)) {
    map.addSource(BUILDINGS_SOURCE_ID, {
      type: 'geojson',
      data: buildingsUsageData
    });
  } else {
    map.getSource(BUILDINGS_SOURCE_ID).setData(buildingsUsageData);
  }

  // Build color expression for building usage
  const colorExpr = ['match', ['get', '用途']];
  for (const [usage, color] of Object.entries(BUILDING_USAGE_COLORS)) {
    colorExpr.push(usage, color);
  }
  colorExpr.push('#cccccc'); // default color

  // Add circle layer (first, so it appears below mesh)
  if (!map.getLayer(BUILDINGS_LAYER_ID)) {
    map.addLayer({
      id: BUILDINGS_LAYER_ID,
      type: 'circle',
      source: BUILDINGS_SOURCE_ID,
      paint: {
        'circle-radius': 4,
        'circle-color': colorExpr,
        'circle-opacity': 0.7,
        'circle-stroke-width': 0.5,
        'circle-stroke-color': '#fff'
      },
      layout: { visibility: 'visible' }
    });
  }

  // Bind popup for buildings
  bindBuildingPopupOnce();
}

// ===== Ensure layers are created =====
function ensureMeshLayers() {
  if (!map || !map.isStyleLoaded()) return;
  if (!meshUsageData) return;

  // Add source
  if (!map.getSource(MESH_SOURCE_ID)) {
    map.addSource(MESH_SOURCE_ID, {
      type: 'geojson',
      data: meshUsageData
    });
  } else {
    map.getSource(MESH_SOURCE_ID).setData(meshUsageData);
  }

  // Add fill layer (after buildings layer so it appears on top when visible)
  if (!map.getLayer(MESH_FILL_LAYER_ID)) {
    map.addLayer({
      id: MESH_FILL_LAYER_ID,
      type: 'fill',
      source: MESH_SOURCE_ID,
      paint: {
        'fill-opacity': 0.6
      },
      layout: { visibility: 'visible' }
    });
  }

  // Add outline layer
  if (!map.getLayer(MESH_OUTLINE_LAYER_ID)) {
    map.addLayer({
      id: MESH_OUTLINE_LAYER_ID,
      type: 'line',
      source: MESH_SOURCE_ID,
      paint: {
        'line-color': '#666',
        'line-width': 0.6,
        'line-opacity': 0.35
      },
      layout: { visibility: 'visible' }
    });
  }

  // Bind popup
  bindPopupOnce();
}



// ===== Popup binding =====
let popupBound = false;

function bindPopupOnce() {
  if (popupBound) return;
  if (!map.getLayer(MESH_FILL_LAYER_ID)) return;

  map.on('click', MESH_FILL_LAYER_ID, (e) => {
    const f = e.features && e.features[0];
    if (!f) return;

    const p = f.properties || {};
    const meshCode = p.mesh_code ?? p.meshcode ?? p.MESHCODE ?? '(unknown)';

    const toNum = (v) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    };

    const total = toNum(p['建物総数']);
    const house = toNum(p['建物_住宅']);
    const apt = toNum(p['建物_共同住宅']);
    const comm = toNum(p['建物_商業施設']);
    const commMix = toNum(p['建物_商業系複合施設']);
    const office = toNum(p['建物_業務施設']);
    const restaurants = toNum(p['飲食店数']);

    const residential = house + apt;
    const commercial = comm + commMix;
    const other = Math.max(0, total - residential - commercial - office);

    const html = `
      <div style="font-size:12px; line-height:1.45;">
        <div style="font-weight:700;margin-bottom:8px; font-size:13px;">メッシュ ${meshCode}</div>

        <table style="width:100%; border-collapse:collapse; table-layout:fixed;">
          <colgroup>
            <col style="width:72%;">
            <col style="width:28%;">
          </colgroup>

          <tr>
            <td style="padding:4px 8px 4px 0; white-space:normal; word-break:break-word;">建物総数</td>
            <td style="padding:4px 0; text-align:right; white-space:nowrap;">${total.toLocaleString()}</td>
          </tr>
          <tr>
            <td style="padding:4px 8px 4px 0; white-space:normal; word-break:break-word;">住宅（住宅+共同住宅）</td>
            <td style="padding:4px 0; text-align:right; white-space:nowrap;">${residential.toLocaleString()}</td>
          </tr>
          <tr>
            <td style="padding:4px 8px 4px 0; white-space:normal; word-break:break-word;">商業（商業施設+商業系複合）</td>
            <td style="padding:4px 0; text-align:right; white-space:nowrap;">${commercial.toLocaleString()}</td>
          </tr>
          <tr>
            <td style="padding:4px 8px 4px 0; white-space:normal; word-break:break-word;">業務（オフィス）</td>
            <td style="padding:4px 0; text-align:right; white-space:nowrap;">${office.toLocaleString()}</td>
          </tr>
          <tr>
            <td style="padding:4px 8px 4px 0; white-space:normal; word-break:break-word;">その他</td>
            <td style="padding:4px 0; text-align:right; white-space:nowrap;">${other.toLocaleString()}</td>
          </tr>
          <tr>
            <td style="padding:4px 8px 4px 0; white-space:normal; word-break:break-word;">飲食店数</td>
            <td style="padding:4px 0; text-align:right; white-space:nowrap;">${restaurants.toLocaleString()}</td>
          </tr>
        </table>
      </div>
    `;

injectPopupCSSOnce();

  new mapboxgl.Popup({
    closeButton: true,
    closeOnClick: true,
    maxWidth: '520px',      // ★これが重要（外枠）
    className: 'mesh-popup' // ★CSS適用
  })
    .setLngLat(e.lngLat)
    .setHTML(html)
    .addTo(map);
    });

  map.on('mouseenter', MESH_FILL_LAYER_ID, () => {
    map.getCanvas().style.cursor = 'pointer';
  });
  map.on('mouseleave', MESH_FILL_LAYER_ID, () => {
    map.getCanvas().style.cursor = '';
  });

  popupBound = true;
}

// ===== Building popup binding =====
let buildingPopupBound = false;

function bindBuildingPopupOnce() {
  if (buildingPopupBound) return;
  if (!map.getLayer(BUILDINGS_LAYER_ID)) return;

  map.on('click', BUILDINGS_LAYER_ID, (e) => {
    const f = e.features && e.features[0];
    if (!f) return;

    const p = f.properties || {};
    const buildingId = p.id ?? p.building_id ?? '(unknown)';
    const buildingType = p.用途 ?? p.usage ?? 'Unknown';

    const html = `
      <div style="font-size:12px; line-height:1.45;">
        <div style="font-weight:700;margin-bottom:8px; font-size:13px;">建物 ${buildingId}</div>
        <table style="width:100%; border-collapse:collapse; table-layout:fixed;">
          <colgroup>
            <col style="width:40%;">
            <col style="width:60%;">
          </colgroup>
          <tr>
            <td style="padding:4px 8px 4px 0; white-space:normal; word-break:break-word;">用途</td>
            <td style="padding:4px 0; white-space:normal; word-break:break-word;">${buildingType}</td>
          </tr>
        </table>
      </div>
    `;

    new mapboxgl.Popup({
      closeButton: true,
      closeOnClick: true,
      maxWidth: '300px'
    })
      .setLngLat(e.lngLat)
      .setHTML(html)
      .addTo(map);
  });

  map.on('mouseenter', BUILDINGS_LAYER_ID, () => {
    map.getCanvas().style.cursor = 'pointer';
  });
  map.on('mouseleave', BUILDINGS_LAYER_ID, () => {
    map.getCanvas().style.cursor = '';
  });

  buildingPopupBound = true;
}

// ===== Update colors based on mode =====
function updateMeshColors() {
  if (!map.getLayer(MESH_FILL_LAYER_ID)) return;

  let colorExpr;
  
  if (currentCharacteristicMode === 'restaurants') {
    // Heatmap by restaurant count
    colorExpr = MODES.restaurants.colorExpression;
  } else {
    // Categorical by characteristic
    colorExpr = [
      'match', ['get', '__char'],
      currentCharacteristicMode, MODES[currentCharacteristicMode].color,
      'rgba(0,0,0,0)'
    ];
  }

  map.setPaintProperty(MESH_FILL_LAYER_ID, 'fill-color', colorExpr);
}

// ===== Toggle mesh/building layers based on zoom =====
function updateLayerVisibility() {
  if (!map) return;
  const zoom = map.getZoom();
  const showBuildings = zoom >= ZOOM_THRESHOLD;

  // Show/hide mesh layers
  const meshFillVisibility = showBuildings ? 'none' : 'visible';
  const meshOutlineVisibility = showBuildings ? 'none' : 'visible';

  if (map.getLayer(MESH_FILL_LAYER_ID)) {
    map.setLayoutProperty(MESH_FILL_LAYER_ID, 'visibility', meshFillVisibility);
  }
  if (map.getLayer(MESH_OUTLINE_LAYER_ID)) {
    map.setLayoutProperty(MESH_OUTLINE_LAYER_ID, 'visibility', meshOutlineVisibility);
  }

  // Show/hide building layer
  const buildingsVisibility = showBuildings ? 'visible' : 'none';
  if (map.getLayer(BUILDINGS_LAYER_ID)) {
    map.setLayoutProperty(BUILDINGS_LAYER_ID, 'visibility', buildingsVisibility);
  }

  console.log(`Zoom: ${zoom.toFixed(2)} - ${showBuildings ? 'Showing buildings' : 'Showing mesh'}`);
}

// ===== Initialize legend =====
function updateLegend() {
  const meshContainer = document.getElementById('legend-content');
  const buildingsContainer = document.getElementById('buildings-legend-content');
  
  if (!meshContainer) return;
  meshContainer.innerHTML = '';
  if (buildingsContainer) buildingsContainer.innerHTML = '';

  const mode = MODES[currentCharacteristicMode];
  if (!mode) return;

  const heading = document.createElement('h4');
  heading.textContent = mode.label;
  meshContainer.appendChild(heading);

  if (currentCharacteristicMode === 'restaurants') {
    // Show restaurant count legend
    const legendItems = [
      { value: '0-10', color: '#ffffcc' },
      { value: '10-20', color: '#ffeda0' },
      { value: '20-50', color: '#fed976' },
      { value: '50-100', color: '#feb24c' },
      { value: '100-200', color: '#fd8d3c' },
      { value: '200-500', color: '#fc4e2a' },
      { value: '500-1000', color: '#e31a1c' },
      { value: '1000+', color: '#bd0026' }
    ];

    legendItems.forEach((item) => {
      const row = document.createElement('div');
      row.className = 'legend-item';

      const colorBox = document.createElement('span');
      colorBox.className = 'legend-color';
      colorBox.style.backgroundColor = item.color;

      const label = document.createElement('span');
      label.className = 'legend-label';
      label.textContent = item.value + ' 店舗';

      row.appendChild(colorBox);
      row.appendChild(label);
      meshContainer.appendChild(row);
    });

    const desc = document.createElement('div');
    desc.style.marginTop = '10px';
    desc.innerHTML = '<p style="margin:0; font-size:12px;"><strong>飲食店数</strong>によるヒートマップ表示。</p>';
    meshContainer.appendChild(desc);
  } else {
    // Show characteristic legend
    const row = document.createElement('div');
    row.className = 'legend-item';

    const colorBox = document.createElement('span');
    colorBox.className = 'legend-color';
    colorBox.style.backgroundColor = mode.color;

    const label = document.createElement('span');
    label.className = 'legend-label';
    label.textContent = mode.label;

    row.appendChild(colorBox);
    row.appendChild(label);
    meshContainer.appendChild(row);

    // Mode-specific descriptions
    const desc = document.createElement('div');
    desc.style.marginTop = '10px';
    desc.style.fontSize = '12px';
    desc.style.lineHeight = '1.4';
    
    if (currentCharacteristicMode === 'residential') {
      desc.innerHTML = '<p style="margin:0;"><strong>判定条件:</strong></p>' +
                       '<p style="margin:4px 0 0 0;">住居系（共同住宅+住宅+</p>' +
                       '<p style="margin:2px 0 0 0;">店舗等併用住宅+店舗等併用共同住宅）</p>' +
                       '<p style="margin:2px 0 0 0;">≥ 60%</p>';
    } else if (currentCharacteristicMode === 'commercial') {
      desc.innerHTML = '<p style="margin:0;"><strong>判定条件:</strong></p>' +
                       '<p style="margin:4px 0 0 0;">商業系</p>' +
                       '<p style="margin:2px 0 0 0;">（商業施設+商業系複合施設）</p>' +
                       '<p style="margin:2px 0 0 0;">≥ 30%</p>';
    } else if (currentCharacteristicMode === 'office') {
      desc.innerHTML = '<p style="margin:0;"><strong>判定条件:</strong></p>' +
                       '<p style="margin:4px 0 0 0;">業務施設 ≥ 30%</p>';
    } else if (currentCharacteristicMode === 'diverse') {
      desc.innerHTML = '<p style="margin:0;"><strong>判定条件:</strong></p>' +
                       '<p style="margin:4px 0 0 0;">・住居系 ≥ 15%</p>' +
                       '<p style="margin:2px 0 0 0;">・商業系 ≥ 15%</p>' +
                       '<p style="margin:2px 0 0 0;">・業務施設 ≥ 15%</p>' +
                       '<p style="margin:2px 0 0 0;">・建物総数 ≥ 50</p>';
    }
    
    meshContainer.appendChild(desc);
  }

  // Show building usage legend when buildings are visible
  if (buildingsContainer && map && map.getZoom() >= ZOOM_THRESHOLD) {
    const heading = document.createElement('h4');
    heading.textContent = '建物用途';
    buildingsContainer.appendChild(heading);

    const usageItems = Object.entries(BUILDING_USAGE_COLORS).slice(0, -1); // Exclude 'その他'
    usageItems.forEach(([usage, color]) => {
      const row = document.createElement('div');
      row.className = 'legend-item';

      const colorBox = document.createElement('span');
      colorBox.className = 'legend-color';
      colorBox.style.backgroundColor = color;
      colorBox.style.borderRadius = '50%';
      colorBox.style.display = 'inline-block';
      colorBox.style.width = '12px';
      colorBox.style.height = '12px';

      const label = document.createElement('span');
      label.className = 'legend-label';
      label.textContent = usage;

      row.appendChild(colorBox);
      row.appendChild(label);
      buildingsContainer.appendChild(row);
    });
  }
}

// ===== Initialize map =====
function initMap() {
  map = new mapboxgl.Map({
    container: 'map',
    style: {
      version: 8,
      sources: {
        'gsi-pale': {
          type: 'raster',
          tiles: ['https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png'],
          tileSize: 256,
          attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html">国土地理院</a>'
        }
      },
      layers: [
        { id: 'gsi-pale-layer', type: 'raster', source: 'gsi-pale', minzoom: 0, maxzoom: 18 }
      ]
    },
    center: [130.4017, 33.5904],
    zoom: 10
  });

  map.addControl(new mapboxgl.NavigationControl(), 'top-right');

  map.on('load', () => {
    loadMeshData()
      .then(() => {
        loadBuildingsData();
      })
      .then(() => {
        ensureBuildingLayersFirst();
        ensureMeshLayers();
        updateMeshColors();
        updateLayerVisibility();
        updateLegend();
      })
      .catch((e) => console.error('Error:', e));

    // Listen for zoom changes
    map.on('zoom', () => {
      updateLayerVisibility();
      updateLegend();
    });
  });
}

// ===== Setup radio button controls =====
function setupControls() {
  const radios = document.querySelectorAll('input[name="mode-select"]');
  radios.forEach((radio) => {
    radio.addEventListener('change', (e) => {
      if (e.target.checked) {
        currentCharacteristicMode = e.target.value;
        updateMeshColors();
        updateLegend();
      }
    });
  });
}

// ===== DOM Ready =====
document.addEventListener('DOMContentLoaded', () => {
  console.log('[DOM ready]');
  initMap();
  setupControls();
});

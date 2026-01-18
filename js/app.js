// 福岡市・北九州市 クラスター分析・乗降客数・地域特性ビューア
// 優先：地域特性（mesh_usage.geojson + buildings_usage.geojson + zoom連動）
//
// 地域特性の判定（建物総数>=10のみ）
// - 住居が多い: 住居系(共同住宅+住宅+店舗等併用住宅+店舗等併用共同住宅) >= 50%
// - 商業が多い: (商業施設+商業系複合施設) >= 40%
// - オフィスが多い: 業務施設 >= 40%
// - 多用途: 住居系・商業系・業務施設がそれぞれ >=20%
//
// ズーム連動（当初仕様）
// - zoom >= 14: buildings_usage の建物点
// - zoom >= 15: buildings_usage の用途ラベル（usage_ja）

// Mapbox token（方針により空）
// ※必ず自分の token を設定してください
mapboxgl.accessToken = '';

let map;

// --- 既存モード（簡略運用） ---
let currentMode = 'passengers'; // passengers | mesh | characteristics

// 乗降客数モードの状態
let passengerShowStations = true;
let passengerShowStoreAreas = true;

// 商圏メッシュ（クラスター）状態（統計・クラスタON/OFFは後回し）
let currentClusterCount = 6;
let currentDisplayMode = 'cluster';
let meshData = null;
let clusterConfig = null;
let visibleClusters = new Set();
let stationData = null;

// 乗降客数：駅統合＋バッファ
const MERGE_DISTANCE_METERS = 150;
const RADIUS_RULES = [
  { max: 30000, radius: 0.3 },
  { max: 50000, radius: 0.5 },
  { max: Infinity, radius: 1.0 }
];

// 地域特性：色・表示名
const CHARACTER_FILTERS = {
  residential: { color: '#66c2a5', label: '住居が多い地域' },
  commercial:  { color: '#fc8d62', label: '商業施設が多い地域' },
  office:      { color: '#8da0cb', label: 'オフィスが多い地域' },
  diverse:     { color: '#e78ac3', label: '多用途地域' }
};

// ===== 地域特性（当初仕様） =====
const MESH_USAGE_URL = 'web_data/mesh_usage.geojson';
const BUILDINGS_USAGE_URL = 'web_data/buildings_usage.geojson';

const CHARACTERISTICS_MESH_SOURCE_ID = 'mesh-usage';
const CHARACTERISTICS_MESH_BASE_LAYER_ID = 'mesh-usage-base';
const CHARACTERISTICS_MESH_OUTLINE_LAYER_ID = 'mesh-usage-outline';

const BUILDINGS_SOURCE_ID = 'buildings-usage';
const BUILDINGS_POINTS_LAYER_ID = 'buildings-points';
const BUILDINGS_LABELS_LAYER_ID = 'buildings-labels';

const SHOW_BUILDINGS_ZOOM = 14;
const SHOW_BUILDING_LABELS_ZOOM = 15;

let meshUsageData = null;
let buildingsUsageData = null;

function calcMeshCharacteristic(props) {
  const total = Number(props['建物総数'] ?? 0);
  if (total < 10) return null;

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

  if (rRes >= 0.2 && rCom >= 0.2 && rOff >= 0.2) return 'diverse';
  if (rRes >= 0.5) return 'residential';
  if (rCom >= 0.4) return 'commercial';
  if (rOff >= 0.4) return 'office';
  return null;
}

async function loadCharacteristicsDataIfNeeded() {
  if (meshUsageData && buildingsUsageData) return;

  const [mRes, bRes] = await Promise.all([
    fetch(MESH_USAGE_URL),
    fetch(BUILDINGS_USAGE_URL)
  ]);

  meshUsageData = await mRes.json();
  buildingsUsageData = await bRes.json();

  // __char を付与（Mapboxの式で参照しやすくする）
  for (const f of meshUsageData.features || []) {
    f.properties = f.properties || {};
    f.properties.__char = calcMeshCharacteristic(f.properties);
  }
}

function ensureCharacteristicsLayers() {
  if (!map || !map.isStyleLoaded()) return;

  if (!map.getSource(CHARACTERISTICS_MESH_SOURCE_ID) && meshUsageData) {
    map.addSource(CHARACTERISTICS_MESH_SOURCE_ID, { type: 'geojson', data: meshUsageData });
  }
  if (!map.getSource(BUILDINGS_SOURCE_ID) && buildingsUsageData) {
    map.addSource(BUILDINGS_SOURCE_ID, { type: 'geojson', data: buildingsUsageData });
  }

  // mesh_usage：薄色塗り（選択でfilter）
  if (!map.getLayer(CHARACTERISTICS_MESH_BASE_LAYER_ID) && map.getSource(CHARACTERISTICS_MESH_SOURCE_ID)) {
    map.addLayer({
      id: CHARACTERISTICS_MESH_BASE_LAYER_ID,
      type: 'fill',
      source: CHARACTERISTICS_MESH_SOURCE_ID,
      paint: {
        'fill-color': [
          'match', ['get', '__char'],
          'residential', CHARACTER_FILTERS.residential.color,
          'commercial',  CHARACTER_FILTERS.commercial.color,
          'office',      CHARACTER_FILTERS.office.color,
          'diverse',     CHARACTER_FILTERS.diverse.color,
          'rgba(0,0,0,0)'
        ],
        'fill-opacity': 0.18
      },
      layout: { 'visibility': 'none' }
    });
  }

  if (!map.getLayer(CHARACTERISTICS_MESH_OUTLINE_LAYER_ID) && map.getSource(CHARACTERISTICS_MESH_SOURCE_ID)) {
    map.addLayer({
      id: CHARACTERISTICS_MESH_OUTLINE_LAYER_ID,
      type: 'line',
      source: CHARACTERISTICS_MESH_SOURCE_ID,
      paint: { 'line-color': '#666', 'line-width': 0.6, 'line-opacity': 0.35 },
      layout: { 'visibility': 'none' }
    });
  }

  // buildings_usage：建物点（zoom>=14）
  if (!map.getLayer(BUILDINGS_POINTS_LAYER_ID) && map.getSource(BUILDINGS_SOURCE_ID)) {
    map.addLayer({
      id: BUILDINGS_POINTS_LAYER_ID,
      type: 'circle',
      source: BUILDINGS_SOURCE_ID,
      minzoom: SHOW_BUILDINGS_ZOOM,
      paint: {
        'circle-radius': 2.5,
        'circle-color': [
          'match', ['get', 'usage_ja'],
          '住宅', '#66c2a5',
          '共同住宅', '#66c2a5',
          '店舗等併用住宅', '#66c2a5',
          '店舗等併用共同住宅', '#66c2a5',
          '商業施設', '#fc8d62',
          '商業系複合施設', '#fc8d62',
          '業務施設', '#8da0cb',
          '官公庁施設', '#bdbdbd',
          '宿泊施設', '#a6d854',
          '文教厚生施設', '#ffd92f',
          '#888888'
        ],
        'circle-opacity': 0.75
      },
      layout: { 'visibility': 'none' }
    });
  }

  // buildings_usage：用途ラベル（zoom>=15）
  if (!map.getLayer(BUILDINGS_LABELS_LAYER_ID) && map.getSource(BUILDINGS_SOURCE_ID)) {
    map.addLayer({
      id: BUILDINGS_LABELS_LAYER_ID,
      type: 'symbol',
      source: BUILDINGS_SOURCE_ID,
      minzoom: SHOW_BUILDING_LABELS_ZOOM,
      layout: {
        'text-field': ['get', 'usage_ja'],
        'text-font': ['Open Sans Regular'],
        'text-size': 10,
        'text-anchor': 'top',
        'text-offset': [0, 0.6],
        'text-allow-overlap': false
      },
      paint: {
        'text-color': '#111',
        'text-halo-color': '#fff',
        'text-halo-width': 1
      },
      layout: { 'visibility': 'none' }
    });
  }
}

function setCharacteristicsVisibility(isVisible) {
  const vis = isVisible ? 'visible' : 'none';
  if (map.getLayer(CHARACTERISTICS_MESH_BASE_LAYER_ID)) map.setLayoutProperty(CHARACTERISTICS_MESH_BASE_LAYER_ID, 'visibility', vis);
  if (map.getLayer(CHARACTERISTICS_MESH_OUTLINE_LAYER_ID)) map.setLayoutProperty(CHARACTERISTICS_MESH_OUTLINE_LAYER_ID, 'visibility', vis);
  if (map.getLayer(BUILDINGS_POINTS_LAYER_ID)) map.setLayoutProperty(BUILDINGS_POINTS_LAYER_ID, 'visibility', vis);
  if (map.getLayer(BUILDINGS_LABELS_LAYER_ID)) map.setLayoutProperty(BUILDINGS_LABELS_LAYER_ID, 'visibility', vis);
}

function applyCharacteristicsSelection() {
  const sel = document.getElementById('characteristic-filter');
  const key = sel ? sel.value : null;

  if (!map.getLayer(CHARACTERISTICS_MESH_BASE_LAYER_ID)) return;

  if (!key || !CHARACTER_FILTERS[key]) {
    const none = ['==', ['get', '__char'], '___none___'];
    map.setFilter(CHARACTERISTICS_MESH_BASE_LAYER_ID, none);
    map.setFilter(CHARACTERISTICS_MESH_OUTLINE_LAYER_ID, none);
    return;
  }

  const f = ['==', ['get', '__char'], key];
  map.setFilter(CHARACTERISTICS_MESH_BASE_LAYER_ID, f);
  map.setFilter(CHARACTERISTICS_MESH_OUTLINE_LAYER_ID, f);
}

// ===== 起動 =====
document.addEventListener('DOMContentLoaded', () => {
  initMap();
  setupControls();
});

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
    // 既存のモード（必要なら後で復旧）
    // loadClusterData(currentClusterCount);
    // loadStationData();

    // 初期凡例
    updateLegend();
  });
}

function setupControls() {
  // タブ切替
  document.getElementById('tab-passengers')?.addEventListener('click', () => switchMode('passengers'));
  document.getElementById('tab-mesh')?.addEventListener('click', () => switchMode('mesh'));
  document.getElementById('tab-characteristics')?.addEventListener('click', () => switchMode('characteristics'));

  // 地域特性：適用ボタン
  document.getElementById('apply-characteristic-filter')?.addEventListener('click', () => {
    if (currentMode !== 'characteristics') {
      switchMode('characteristics');
      return;
    }
    applyCharacteristicsSelection();
    updateLegend();
  });
}

function switchMode(mode) {
  if (mode === currentMode) return;
  currentMode = mode;

  // コントロール表示（index.htmlにある想定）
  const meshControls = document.getElementById('mesh-controls');
  const passengerControls = document.getElementById('passenger-controls');
  const charControls = document.getElementById('characteristics-controls');
  if (meshControls) meshControls.style.display = (mode === 'mesh') ? 'block' : 'none';
  if (passengerControls) passengerControls.style.display = (mode === 'passengers') ? 'block' : 'none';
  if (charControls) charControls.style.display = (mode === 'characteristics') ? 'block' : 'none';

  // タブ見た目
  ['tab-passengers','tab-mesh','tab-characteristics'].forEach(id => document.getElementById(id)?.classList.remove('active'));
  if (mode === 'passengers') document.getElementById('tab-passengers')?.classList.add('active');
  if (mode === 'mesh') document.getElementById('tab-mesh')?.classList.add('active');
  if (mode === 'characteristics') document.getElementById('tab-characteristics')?.classList.add('active');

  // 地域特性の表示/非表示
  if (mode !== 'characteristics') {
    setCharacteristicsVisibility(false);
    updateLegend();
    return;
  }

  // 地域特性へ切替：データ読み込み→レイヤ生成→表示→選択適用
  loadCharacteristicsDataIfNeeded()
    .then(() => {
      ensureCharacteristicsLayers();
      setCharacteristicsVisibility(true);
      applyCharacteristicsSelection();
      updateLegend();
    })
    .catch((e) => console.error('地域特性データ読込エラー:', e));
}

function updateLegend() {
  const container = document.getElementById('legend-content');
  if (!container) return;
  container.innerHTML = '';

  if (currentMode === 'characteristics') {
    container.innerHTML = '<h4>地域特性（mesh_usage）</h4>';

    const note = document.createElement('div');
    note.style.margin = '6px 0 10px';
    note.innerHTML = '<p style="margin:0;">ズーム14以上で建物点、ズーム15以上で用途ラベル（usage_ja）を表示（buildings_usage）。</p>';
    container.appendChild(note);

    Object.keys(CHARACTER_FILTERS).forEach((k) => {
      const row = document.createElement('div');
      row.className = 'legend-item';

      const colorBox = document.createElement('span');
      colorBox.className = 'legend-color';
      colorBox.style.backgroundColor = CHARACTER_FILTERS[k].color;

      const label = document.createElement('span');
      label.className = 'legend-label';
      label.textContent = CHARACTER_FILTERS[k].label;

      row.appendChild(colorBox);
      row.appendChild(label);
      container.appendChild(row);
    });

    const desc = document.createElement('div');
    desc.style.marginTop = '10px';
    desc.innerHTML =
      '<p style="margin:0;"><strong>判定条件:</strong> 建物総数が10棟以上のメッシュのみ対象。</p>' +
      '<p style="margin:0;">住居>=50%、商業>=40%、業務>=40%、多用途は3種>=20%。</p>';
    container.appendChild(desc);
    return;
  }

  // 後回し：他モードの凡例は最小表示
  if (currentMode === 'passengers') {
    container.innerHTML = '<h4>乗降客数</h4><p style="margin:0;">（地域特性を優先実装中）</p>';
    return;
  }
  if (currentMode === 'mesh') {
    container.innerHTML = '<h4>商圏メッシュ</h4><p style="margin:0;">（地域特性を優先実装中）</p>';
    return;
  }
}

/**
 * PC 悬浮小窗（列表 + 小地图）。
 *
 * 交互（2026-11-08 定稿）：
 * - 主交互是「收起 / 展开」：收起后只剩一条状态条，点「展开」再回来；
 * - 主题可切明 / 暗，默认暗色，选择会记住；
 * - 「鼠标不挡点击」属于高级选项，放在工具箱「附近」页里，不占小窗按钮；
 *   打开后点击会落到游戏里，按 Ctrl+Alt+O 恢复。
 */
'use strict';

const KIND_COLOR = {
  pollution: '#7c3aed', shiny: '#f59e0b', colorful: '#ec4899',
  big: '#0ea5e9', small: '#0ea5e9', high: '#059669', low: '#059669',
};
const KIND_PRIORITY = ['pollution', 'shiny', 'colorful', 'big', 'small', 'high', 'low'];
/** 牌子文案：声音不再用「婉转声 / 粗嗓门」分类词，只在列表里直接显示分贝 */
const KIND_LABEL = {
  colorful: '炫彩', shiny: '异色', pollution: '污染',
  big: '大块头', small: '小不点',
};
const VIEW_METERS = 300; // 横向 300m（半径 150m），120m 圈完整可见
const THEME_KEY = 'roco.overlayTheme';
const COLLAPSED_KEY = 'roco.overlayCollapsed';

const state = {
  payload: null,
  calibration: null,
  image: null,
  theme: 'dark',
  collapsed: false,
};

const statusEl = document.getElementById('status');
const listEl = document.getElementById('list');
const emptyEl = document.getElementById('empty');
const sceneEl = document.getElementById('scene');
const updatedEl = document.getElementById('updated');
const mapHintEl = document.getElementById('map-hint');
const canvas = document.getElementById('map');
const ctx = canvas.getContext('2d');

const colorOf = (kinds) => {
  for (const kind of KIND_PRIORITY) if (kinds.includes(kind)) return KIND_COLOR[kind];
  return '#64748b';
};
/** 只取有文案的牌子（声音走分贝，不再出分类词） */
const labelsOf = (kinds) => kinds.map((kind) => KIND_LABEL[kind]).filter(Boolean).join('·');
/** 声音统一显示分贝：+99dB / -99dB（2026-11-11 与网页、手机悬浮窗同一口径） */
const dbTextOf = (pet) => (pet.voiceDb == null ? '' : `${pet.voiceDb > 0 ? '+' : ''}${Math.round(pet.voiceDb)}dB`);

function setStatus() {
  const payload = state.payload;
  if (!payload) {
    statusEl.textContent = state.collapsed ? '附近 · 等待采集' : '等待采集数据…';
    return;
  }
  // total / rareTotal 是截断前的总数（手机面板同口径）；旧版 payload 没有时按列表算
  const rare = payload.rareTotal ?? payload.pets.filter((pet) => pet.rare).length;
  const total = payload.total ?? payload.pets.length;
  if (state.collapsed) {
    statusEl.innerHTML = `<b>${payload.capturing ? '采集中' : '已停止'}</b> · ${total} 只 · 稀有 ${rare}`;
    return;
  }
  const key = payload.hasKey ? '已接通' : '等待登录';
  statusEl.innerHTML = `<b>${payload.capturing ? '采集中' : '已停止'}</b> · ${key} · 附近 ${total} 只`;
}

function renderList() {
  const payload = state.payload;
  listEl.innerHTML = '';
  if (!payload || payload.pets.length === 0) {
    emptyEl.hidden = false;
    // 有精灵但都被筛选挡掉时，别误报「还没收到数据」
    emptyEl.innerHTML = payload && payload.total > 0
      ? '当前筛选下没有精灵'
      : '还没收到附近精灵<br />开始采集并进入野外后自动出现';
    return;
  }
  emptyEl.hidden = true;
  const rows = [...payload.pets]
    .sort((a, b) => Number(b.alert) - Number(a.alert) || Number(b.rare) - Number(a.rare) || (a.distanceM ?? 1e9) - (b.distanceM ?? 1e9))
    .slice(0, 8);
  for (const pet of rows) {
    const li = document.createElement('li');
    if (pet.alert) li.className = 'alert';
    else if (pet.rare) li.className = 'rare';
    const dot = document.createElement('i');
    dot.className = 'dot';
    dot.style.background = colorOf(pet.kinds || []);
    const name = document.createElement('span');
    name.className = 'name';
    // 等级统一「xx级」写法，不再用 Lv 前缀
    name.textContent = `${pet.name} ${pet.level}级`;
    const meta = document.createElement('span');
    meta.className = 'meta';
    // 方位用随自身朝向旋转的箭头，没有有效方向时只显示距离
    const bearing = pet.bearingArrow || pet.bearingLabel || '';
    const db = dbTextOf(pet);
    meta.textContent = [pet.distanceM != null ? `${Math.round(pet.distanceM)}m` : '', bearing, db].filter(Boolean).join(' ');
    li.append(dot, name, meta);
    const tags = [];
    if (pet.alert) tags.push('需求');
    else if (pet.rare && labelsOf(pet.kinds || [])) tags.push(labelsOf(pet.kinds || []).split('·')[0]);
    if (tags.length) {
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = tags.join('·');
      li.append(tag);
    }
    li.title = [
      `${pet.name} ${pet.level}级`,
      pet.gender || '',
      pet.nature ? `性格:${pet.nature}` : '',
      labelsOf(pet.kinds || []),
      pet.heightPct != null ? `高:${pet.heightPct.toFixed(1)}%` : '',
      pet.weightPct != null ? `重:${pet.weightPct.toFixed(1)}%` : '',
      db ? `声音:${db}` : '',
      pet.distanceM != null ? `${Math.round(pet.distanceM)}m ${bearing}` : '',
    ].filter(Boolean).join(' · ');
    listEl.append(li);
  }
}

function worldToPixel(point) {
  const cal = state.calibration;
  return {
    px: ((point.x - cal.origin_x) / cal.side_units) * cal.declared_width,
    py: ((point.y - cal.origin_y) / cal.side_units) * cal.declared_height,
  };
}

/** 自身点：有朝向画三角箭头（0 = 正北、顺时针），没有可靠朝向退回圆点，不假装在指。 */
function drawSelfMarker(cx, cy, heading) {
  if (!Number.isFinite(heading)) {
    ctx.beginPath();
    ctx.fillStyle = '#0ea5e9';
    ctx.arc(cx, cy, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.6;
    ctx.stroke();
    return;
  }
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((heading * Math.PI) / 180);
  ctx.beginPath();
  ctx.moveTo(0, -7);
  ctx.lineTo(5, 5);
  ctx.lineTo(0, 2.2);
  ctx.lineTo(-5, 5);
  ctx.closePath();
  ctx.fillStyle = '#0ea5e9';
  ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.4;
  ctx.stroke();
  ctx.restore();
}

function drawMap() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (state.collapsed) return;
  const payload = state.payload;
  const cal = state.calibration;
  if (!cal || !payload) return;
  // 地图画附近所有带坐标的精灵（mapPets）；旧版 payload 没有该字段时退回列表里的点
  const points = payload.mapPets && payload.mapPets.length > 0 ? payload.mapPets : payload.pets;
  const self = payload.self && Number.isFinite(payload.self.x) ? payload.self : null;
  const center = self || (points.find((pet) => Number.isFinite(pet.x)) || null);
  if (!center) {
    mapHintEl.textContent = '无坐标';
    return;
  }
  const metersPerPx = cal.side_units / 100 / cal.declared_width;
  const viewPx = VIEW_METERS / metersPerPx;
  const scale = canvas.width / viewPx;
  const centerPixel = worldToPixel(center);
  const toScreen = (point) => {
    const pixel = worldToPixel(point);
    return {
      x: (pixel.px - centerPixel.px) * scale + canvas.width / 2,
      y: (pixel.py - centerPixel.py) * scale + canvas.height / 2,
    };
  };

  if (state.image && state.image.complete) {
    ctx.save();
    ctx.globalAlpha = 0.92;
    ctx.drawImage(
      state.image,
      centerPixel.px - viewPx / 2, centerPixel.py - viewPx / 2, viewPx, viewPx,
      0, 0, canvas.width, canvas.height,
    );
    ctx.restore();
  } else {
    ctx.fillStyle = state.theme === 'light' ? '#e2e8f0' : '#1e293b';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  // 120m 距离圈：深色垫底 + 白线，亮色地图上也看得清
  const ringRadius = (120 / metersPerPx) * scale;
  ctx.beginPath();
  ctx.strokeStyle = state.theme === 'light' ? 'rgba(15,23,42,0.35)' : 'rgba(0,0,0,0.45)';
  ctx.lineWidth = 3;
  ctx.arc(canvas.width / 2, canvas.height / 2, ringRadius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.strokeStyle = 'rgba(255,255,255,0.88)';
  ctx.lineWidth = 1.3;
  ctx.arc(canvas.width / 2, canvas.height / 2, ringRadius, 0, Math.PI * 2);
  ctx.stroke();

  for (const pet of points) {
    if (!Number.isFinite(pet.x) || !Number.isFinite(pet.y)) continue;
    const point = toScreen(pet);
    if (point.x < -8 || point.y < -8 || point.x > canvas.width + 8 || point.y > canvas.height + 8) continue;
    ctx.beginPath();
    ctx.fillStyle = colorOf(pet.kinds || []);
    ctx.arc(point.x, point.y, pet.rare ? 4 : 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    if (pet.alert) {
      ctx.beginPath();
      ctx.strokeStyle = '#f43f5e';
      ctx.lineWidth = 1.6;
      ctx.arc(point.x, point.y, 6, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  drawSelfMarker(canvas.width / 2, canvas.height / 2, payload.selfHeading);
  mapHintEl.textContent = `≈${VIEW_METERS / 2}m`;
}

function render() {
  setStatus();
  renderList();
  drawMap();
  const payload = state.payload;
  sceneEl.textContent = payload?.scene ? `场景 ${payload.scene}` : '';
  updatedEl.textContent = payload?.updatedAt ? `更新 ${new Date(payload.updatedAt).toLocaleTimeString('zh-CN', { hour12: false })}` : '';
}

function applyTheme(theme) {
  state.theme = theme === 'light' ? 'light' : 'dark';
  document.body.dataset.theme = state.theme;
  try {
    window.localStorage.setItem(THEME_KEY, state.theme);
  } catch {
    /* 忽略 */
  }
  window.rocoOverlay?.setTheme?.(state.theme);
  drawMap();
}

function applyCollapsed(collapsed) {
  state.collapsed = Boolean(collapsed);
  document.body.classList.toggle('collapsed', state.collapsed);
  try {
    window.localStorage.setItem(COLLAPSED_KEY, state.collapsed ? '1' : '0');
  } catch {
    /* 忽略 */
  }
  window.rocoOverlay?.setCollapsed?.(state.collapsed);
  render();
}

async function boot() {
  let savedTheme = 'dark';
  let savedCollapsed = false;
  try {
    savedTheme = window.localStorage.getItem(THEME_KEY) || 'dark';
    savedCollapsed = window.localStorage.getItem(COLLAPSED_KEY) === '1';
  } catch {
    /* 忽略 */
  }
  applyTheme(savedTheme);
  applyCollapsed(savedCollapsed);

  try {
    const response = await fetch('/maps/maps.json');
    if (response.ok) {
      const raw = await response.json();
      state.calibration = raw.maps['10003'] || null;
    }
  } catch {
    /* 没有地图时只画列表 */
  }
  if (state.calibration) {
    state.image = new Image();
    state.image.onload = () => drawMap();
    state.image.src = `/maps/${state.calibration.image}`;
  }

  window.rocoOverlay?.onPayload((text) => {
    try {
      state.payload = text ? JSON.parse(text) : null;
    } catch {
      state.payload = null;
    }
    render();
  });
  const initial = await window.rocoOverlay?.getPayload();
  if (initial) {
    try {
      state.payload = JSON.parse(initial);
    } catch {
      state.payload = null;
    }
  }
  render();
}

document.getElementById('collapse').addEventListener('click', () => applyCollapsed(true));
document.getElementById('expand').addEventListener('click', () => applyCollapsed(false));
document.getElementById('theme').addEventListener('click', () => applyTheme(state.theme === 'light' ? 'dark' : 'light'));
document.getElementById('close').addEventListener('click', () => window.rocoOverlay?.hide());

window.rocoOverlay?.onClickThrough?.((flag) => {
  // 高级选项：打开后由主进程设置点击穿透，这里只更新标题提示
  document.body.dataset.clickThrough = flag ? '1' : '0';
  document.getElementById('status').title = flag ? '鼠标不挡点击已开启：Ctrl+Alt+O 恢复' : '';
});

boot();

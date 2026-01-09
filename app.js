const $ = (id) => document.getElementById(id);

const floorSelect = $("floorSelect");
const search = $("search");
const results = $("results");
const floorImg = $("floorImg");
const viewport = $("viewport");
const canvas = $("canvas");
const marker = $("marker");
const minimap = $("minimap");
const minimapImg = $("minimapImg");
const minimapRect = $("minimapRect");
const toast = $("toast");
const btnMinimap = $("btnMinimap");
const btnPick = $("btnPick");
const sidebar = $("sidebar");
const btnResultsToggle = $("btnResultsToggle");
const resultsCount = $("resultsCount");
const btnMoreResults = $("btnMoreResults");

let currentFloor = null;
let currentScale = 1.6;
let pickMode = false;
let resultsExpanded = false;   // 모바일에서 더보기 상태
let resultsHidden = false;     // 결과 영역 접기/펼치기 상태
let imgNaturalW = 0;
let imgNaturalH = 0;

function showToast(msg, ms = 1400) {
  toast.textContent = msg;
  toast.classList.remove("hidden");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.add("hidden"), ms);
}

function uniqueFloorsFromData() {
  const floors = new Set(window.PANELS.map(p => p.floor));
  return [...floors].sort();
}

function setFloor(floor) {
  currentFloor = floor;
  const src = window.FLOORS[floor];
  if (!src) {
    showToast(`층 이미지 매핑이 없습니다: ${floor}`);
    return;
  }
  floorImg.src = src;
  minimapImg.src = src;
  marker.classList.add("hidden");

  floorImg.onload = () => {
    imgNaturalW = floorImg.naturalWidth || floorImg.width;
    imgNaturalH = floorImg.naturalHeight || floorImg.height;
    applyScale(currentScale);
    viewport.scrollLeft = 0;
    viewport.scrollTop = 0;
    updateMinimapRect();
  };
}

function applyScale(scale) {
  currentScale = Math.max(0.6, Math.min(4.0, scale));
  canvas.style.transform = `scale(${currentScale})`;
  updateMinimapRect();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));
}

function isMobile() {
  return window.matchMedia && window.matchMedia("(max-width: 900px)").matches;
}

function filterPanels(q) {
  const query = q.trim().toLowerCase();
  if (!query) return window.PANELS;
  return window.PANELS.filter(p => p.name.toLowerCase().includes(query));
}

function renderResults(list) {
  results.innerHTML = "";

  const total = list.length;
  if (resultsCount) resultsCount.textContent = total ? `총 ${total}개` : "";

  // 모바일은 기본 2개만 보여주고, 더보기 누르면 늘림
  const mobileLimit = 2;
  const limit = (isMobile() && !resultsExpanded) ? mobileLimit : 200;

  // 더보기 버튼 표시/문구
  if (btnMoreResults) {
    if (isMobile() && total > mobileLimit) {
      btnMoreResults.classList.remove("hidden");
      btnMoreResults.textContent = resultsExpanded ? "접기(2개만)" : `더 보기(총 ${total}개)`;
    } else {
      btnMoreResults.classList.add("hidden");
    }
  }

  if (total === 0) {
    const empty = document.createElement("div");
    empty.className = "result";
    empty.innerHTML = `<div class="name">결과 없음</div><div class="meta">검색어를 확인하세요.</div>`;
    results.appendChild(empty);
    return;
  }

  for (const p of list.slice(0, limit)) {
    const el = document.createElement("div");
    el.className = "result";
    el.innerHTML = `
      <div class="name">${escapeHtml(p.name)}</div>
      <div class="meta">층: ${escapeHtml(p.floor)} · 좌표: (${p.x.toFixed(3)}, ${p.y.toFixed(3)})</div>
    `;
    el.onclick = () => goToPanel(p);
    results.appendChild(el);
  }

  // 모바일에서 제한 표시 중이면 안내(선택)
  if (isMobile() && !resultsExpanded && total > mobileLimit) {
    const note = document.createElement("div");
    note.className = "hint";
    note.style.padding = "6px 4px 2px";
    note.textContent = `모바일에서는 상위 ${mobileLimit}개만 표시 중입니다.`;
    results.appendChild(note);
  }
}


function goToPanel(p) {
  if (p.floor !== currentFloor) {
    setFloor(p.floor);
    const tryMove = () => {
      if (floorImg.complete && imgNaturalW > 0) {
        focusXY(p.x, p.y, `${p.name} (${p.floor})`);
      } else {
        requestAnimationFrame(tryMove);
      }
    };
    requestAnimationFrame(tryMove);
  } else {
    focusXY(p.x, p.y, `${p.name} (${p.floor})`);
  }
}

function focusXY(nx, ny, label) {
  const x = nx * imgNaturalW;
  const y = ny * imgNaturalH;

  marker.style.left = `${x}px`;
  marker.style.top  = `${y}px`;
  marker.classList.remove("hidden");
  marker.classList.remove("pulse");
  void marker.offsetWidth;
  marker.classList.add("pulse");

  applyScale(currentScale);

  const targetLeft = x * currentScale - viewport.clientWidth / 2;
  const targetTop  = y * currentScale - viewport.clientHeight / 2;

  viewport.scrollLeft = Math.max(0, targetLeft);
  viewport.scrollTop  = Math.max(0, targetTop);

  updateMinimapRect();
  showToast(`이동: ${label}`);
}

function updateMinimapRect() {
  if (minimap.classList.contains("hidden")) return;
  if (!floorImg.complete || imgNaturalW === 0) return;

  const mmW = minimapImg.clientWidth;
  const mmH = minimapImg.clientHeight;

  const viewLeft = viewport.scrollLeft / currentScale;
  const viewTop  = viewport.scrollTop  / currentScale;
  const viewW    = viewport.clientWidth  / currentScale;
  const viewH    = viewport.clientHeight / currentScale;

  const rx = (viewLeft / imgNaturalW) * mmW;
  const ry = (viewTop  / imgNaturalH) * mmH;
  const rw = (viewW    / imgNaturalW) * mmW;
  const rh = (viewH    / imgNaturalH) * mmH;

  minimapRect.style.left = `${rx}px`;
  minimapRect.style.top  = `${ry}px`;
  minimapRect.style.width  = `${rw}px`;
  minimapRect.style.height = `${rh}px`;
}

viewport.addEventListener("scroll", () => updateMinimapRect(), { passive: true });

btnMinimap.onclick = () => {
  minimap.classList.toggle("hidden");
  if (!minimap.classList.contains("hidden")) updateMinimapRect();
};

btnPick.onclick = () => {
  pickMode = !pickMode;
  btnPick.textContent = `좌표찍기: ${pickMode ? "ON" : "OFF"}`;
  showToast(pickMode ? "이미지 탭하면 (x,y)가 표시됩니다." : "좌표찍기 모드 OFF");
};

// 모바일: 더보기/접기
if (btnMoreResults) {
  btnMoreResults.onclick = () => {
    resultsExpanded = !resultsExpanded;
    renderResults(filterPanels(search.value));
  };
}

// 결과 영역 접기/펼치기 (모바일에서 도면 크게 보기)
if (btnResultsToggle) {
  btnResultsToggle.onclick = () => {
    resultsHidden = !resultsHidden;
    document.body.classList.toggle("resultsHidden", resultsHidden);
    btnResultsToggle.textContent = resultsHidden ? "결과 펼치기" : "결과 접기";
    // 접었다 펼칠 때 미니맵 영역/스크롤 사각형 갱신
    setTimeout(updateMinimapRect, 50);
  };
}

floorImg.addEventListener("click", (ev) => {
  if (!pickMode) return;
  const rect = floorImg.getBoundingClientRect();
  const px = (ev.clientX - rect.left);
  const py = (ev.clientY - rect.top);
  const nx = px / rect.width;
  const ny = py / rect.height;

  const msg = `좌표: floor=${currentFloor}, x=${nx.toFixed(4)}, y=${ny.toFixed(4)}`;
  showToast(msg, 2200);

  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(msg).catch(() => {});
  }
});

function init() {
  const floors = uniqueFloorsFromData();
  floorSelect.innerHTML = floors.map(f => `<option value="${escapeHtml(f)}">${escapeHtml(f)}</option>`).join("");
  const firstFloor = floors[0] || Object.keys(window.FLOORS)[0];
  floorSelect.value = firstFloor;
  setFloor(firstFloor);

  const doSearch = () => renderResults(filterPanels(search.value));
  search.addEventListener("input", doSearch);

  floorSelect.addEventListener("change", () => {
    setFloor(floorSelect.value);
    renderResults(filterPanels(search.value));
  });

  renderResults(window.PANELS);
  if (btnResultsToggle) btnResultsToggle.textContent = "결과 접기";
}
init();

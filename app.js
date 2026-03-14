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
const minimapDot = $("minimapDot");         // 추가
const floorBadge = $("floorBadge");         // 추가

const toast = $("toast");
const btnMinimap = $("btnMinimap");
const btnPick = $("btnPick");
const btnResultsToggle = $("btnResultsToggle");
const resultsCount = $("resultsCount");
const btnMoreResults = $("btnMoreResults");
const btnExport = $("btnExport");
const btnZoomOut = $("btnZoomOut");
const btnZoomIn = $("btnZoomIn");
const btnZoomReset = $("btnZoomReset");
const pickKeySelect = $("pickKeySelect");
const btnPickNext = $("btnPickNext");
const AUTO_FOCUS_SCALE = 1.6; // 검색/결과 클릭 이동 시 항상 이 배율로 복귀

let currentFloor = null;
let currentScale = 1.6;
let pickMode = false;
let resultsExpanded = false;   // 모바일에서 더보기 상태
let resultsHidden = false;     // 결과 영역 접기/펼치기 상태

let pickedSubRows = []; // Sub 시트로 내보낼 임시 목록: {SubKey, Sub, floor, x, y, aliases}
let pickSubKey = "";   // 좌표찍기 대상 SubKey(미리 입력)
let pickSelectedKey = "";  // 드롭다운에서 선택한 SubKey

let imgNaturalW = 0;
let imgNaturalH = 0;
let miniDragging = false;
let miniDragOffsetX = 0;
let miniDragOffsetY = 0;

let lastSelectedXY = null; // { x, y, floor }

function showToast(msg, ms = 1400) {
  toast.textContent = msg;
  toast.classList.remove("hidden");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.add("hidden"), ms);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));
}

function isMobile() {
  return window.matchMedia && window.matchMedia("(max-width: 900px)").matches;
}

/* ===== floor image mapping UX ===== */
function canonicalFloorKey(floor) {
  const src = (window.FLOORS || {})[floor];
  if (!src) return floor;

  const mergedSrc = (window.FLOORS || {})["B2F"];
  if (mergedSrc && src === mergedSrc) return "B2F";
  return floor;
}

function updateFloorUX() {
  const sel = floorSelect?.value || currentFloor;
  if (!sel) return;

  const canon = canonicalFloorKey(sel);
  const isMerged = (canon === "B2F" && sel !== "B2F");

  const txt = isMerged
    ? `선택 층: ${sel}\n표시 도면: ${canon} (통합)`
    : `선택 층: ${sel}\n표시 도면: ${canon}`;

  if (floorBadge) floorBadge.textContent = txt;
}

/* ===== data index ===== */
let IDX = null;

function buildIndex() {
  const subs = Array.isArray(window.Sub) ? window.Sub : [];
  const invs = Array.isArray(window.Inv) ? window.Inv : [];

  const subByKey = new Map();
  const subList = [];

  for (const s of subs) {
    if (!s || !s.SubKey) continue;
    const item = {
      SubKey: String(s.SubKey),
      name: String(s.Sub || ""),
      floor: String(s.floor || ""),
      x: Number(s.x ?? 0),
      y: Number(s.y ?? 0),
      aliases: Array.isArray(s.aliases)
        ? s.aliases
        : (typeof s.aliases === "string" && s.aliases
            ? s.aliases.split(",").map(x=>x.trim()).filter(Boolean)
            : [])
    };
    subByKey.set(item.SubKey, item);
    subList.push(item);
  }

  const invToKeys = new Map();     // full text
  const digitsToKeys = new Map();  // numbers only

  for (const r of invs) {
    if (!r || !r.Inv || !r.SubKey) continue;
    const inv = String(r.Inv);
    const key = String(r.SubKey);

    const k1 = inv.toLowerCase();
    if (!invToKeys.has(k1)) invToKeys.set(k1, []);
    invToKeys.get(k1).push(key);

    const digits = (r.digits ? String(r.digits) : inv.replace(/\D/g, ""));
    if (digits) {
      if (!digitsToKeys.has(digits)) digitsToKeys.set(digits, []);
      digitsToKeys.get(digits).push(key);
    }
  }

  for (const [k, arr] of invToKeys) invToKeys.set(k, [...new Set(arr)]);
  for (const [k, arr] of digitsToKeys) digitsToKeys.set(k, [...new Set(arr)]);

  IDX = { subByKey, subList, invToKeys, digitsToKeys };
}

function fillPickKeySelect() {
  if (!pickKeySelect) return;
  if (!IDX) buildIndex();

  // SubKey 목록: Sub 데이터 기반
  const items = IDX.subList
    .slice()
    .sort((a,b) => a.floor.localeCompare(b.floor) || a.SubKey.localeCompare(b.SubKey));

  // 옵션 HTML 생성 (표시: [층] SubKey | 판넬명)
  pickKeySelect.innerHTML = [
    `<option value="">(SubKey 선택)</option>`,
    ...items.map(p => {
      const label = `[${escapeHtml(p.floor)}] ${escapeHtml(p.SubKey)} | ${escapeHtml(p.name || "")}`;
      return `<option value="${escapeHtml(p.SubKey)}">${label}</option>`;
    })
  ].join("");

  // 기존 선택 유지
  if (pickSelectedKey) pickKeySelect.value = pickSelectedKey;
}

function uniqueFloorsFromData() {
  if (!IDX) buildIndex();
  const floors = new Set(IDX.subList.map(p => p.floor).filter(Boolean));
  for (const f of Object.keys(window.FLOORS || {})) floors.add(f);
  return [...floors];
}

function filterPanels(q) {
  if (!IDX) buildIndex();

  const queryRaw = q.trim();
  const query = queryRaw.toLowerCase();
  if (!query) return IDX.subList;

  const digits = queryRaw.replace(/\D/g, "");
  const hitKeys = new Set();

  for (const p of IDX.subList) {
    if (p.name.toLowerCase().includes(query)) hitKeys.add(p.SubKey);
    else if (p.aliases.some(a => a.toLowerCase().includes(query))) hitKeys.add(p.SubKey);
  }

  const keys1 = IDX.invToKeys.get(query);
  if (keys1) keys1.forEach(k => hitKeys.add(k));

  if (digits) {
    const keys2 = IDX.digitsToKeys.get(digits);
    if (keys2) keys2.forEach(k => hitKeys.add(k));
  }

  const out = [];
  for (const k of hitKeys) {
    const p = IDX.subByKey.get(k);
    if (p) out.push(p);
  }

  out.sort((a,b) => a.floor.localeCompare(b.floor) || a.SubKey.localeCompare(b.SubKey));
  return out;
}

/* ===== floor / zoom ===== */
function setFloor(floor) {
  currentFloor = floor;
  const src = (window.FLOORS || {})[floor];
  if (!src) {
    showToast(`층 이미지 매핑이 없습니다: ${floor}`);
    return;
  }

  floorImg.src = src;
  if (minimapImg) minimapImg.src = src;

  marker.classList.add("hidden");
  updateFloorUX();

  floorImg.onload = () => {
    imgNaturalW = floorImg.naturalWidth || floorImg.width;
    imgNaturalH = floorImg.naturalHeight || floorImg.height;

    applyScale(currentScale);
    viewport.scrollLeft = 0;
    viewport.scrollTop = 0;

    updateMinimapRect();
    updateMinimapDot();
  };
}

function applyScale(newScale, anchorClientX = null, anchorClientY = null) {
  const prevScale = currentScale;
  currentScale = Math.max(0.6, Math.min(4.0, newScale));
  canvas.style.transform = `scale(${currentScale})`;

  if (anchorClientX !== null && anchorClientY !== null && imgNaturalW > 0) {
    const vpRect = viewport.getBoundingClientRect();
    const ax = anchorClientX - vpRect.left;
    const ay = anchorClientY - vpRect.top;

    const worldX = (viewport.scrollLeft + ax) / prevScale;
    const worldY = (viewport.scrollTop + ay) / prevScale;

    viewport.scrollLeft = worldX * currentScale - ax;
    viewport.scrollTop  = worldY * currentScale - ay;
  }

  if (btnZoomReset) btnZoomReset.textContent = `${Math.round(currentScale * 100)}%`;
  updateMinimapRect();
}

/* ===== minimap ===== */
function updateMinimapRect() {
  if (!minimap || minimap.classList.contains("hidden")) return;
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

function updateMinimapDot() {
  if (!minimapDot) return;
  if (!lastSelectedXY || lastSelectedXY.floor !== currentFloor) {
    minimapDot.style.display = "none";
    return;
  }
  if (!minimapImg) return;

  const mmW = minimapImg.clientWidth;
  const mmH = minimapImg.clientHeight;

  minimapDot.style.left = `${lastSelectedXY.x * mmW}px`;
  minimapDot.style.top  = `${lastSelectedXY.y * mmH}px`;
  minimapDot.style.display = "block";
}

/* ===== results ===== */
function renderResults(list) {
  results.innerHTML = "";

  const total = list.length;
  if (resultsCount) resultsCount.textContent = total ? `총 ${total}개` : "";

  const mobileLimit = 2;
  const limit = (isMobile() && !resultsExpanded) ? mobileLimit : 200;

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

  if (isMobile() && !resultsExpanded && total > mobileLimit) {
    const note = document.createElement("div");
    note.className = "hint";
    note.style.padding = "6px 4px 2px";
    note.textContent = `모바일에서는 상위 ${mobileLimit}개만 표시 중입니다.`;
    results.appendChild(note);
  }

  if (list.length === 1) {
    goToPanel(list[0]);
  }
}

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

function setMinimapPos(left, top) {
  minimap.style.left = `${left}px`;
  minimap.style.top  = `${top}px`;
  // 저장(원하면 유지)
  try { localStorage.setItem("minimap_pos", JSON.stringify({ left, top })); } catch {}
}

function restoreMinimapPos() {
  try {
    const raw = localStorage.getItem("minimap_pos");
    if (!raw) return;
    const p = JSON.parse(raw);
    if (typeof p.left === "number" && typeof p.top === "number") {
      minimap.style.left = `${p.left}px`;
      minimap.style.top  = `${p.top}px`;
    }
  } catch {}
}

function startMinimapDrag(clientX, clientY) {
  if (!minimap || minimap.classList.contains("hidden")) return;
  const mmRect = minimap.getBoundingClientRect();
  miniDragging = true;
  miniDragOffsetX = clientX - mmRect.left;
  miniDragOffsetY = clientY - mmRect.top;
  minimap.style.cursor = "grabbing";
}

function moveMinimapDrag(clientX, clientY) {
  if (!miniDragging) return;

  // 기준: viewer 안에서만 움직이게 제한
  const viewer = document.querySelector(".viewer");
  if (!viewer) return;

  const vRect = viewer.getBoundingClientRect();
  const mmRect = minimap.getBoundingClientRect();

  // viewer 좌표계 기준으로 목표 좌표 계산
  let left = (clientX - vRect.left) - miniDragOffsetX;
  let top  = (clientY - vRect.top)  - miniDragOffsetY;

  const maxLeft = vRect.width  - mmRect.width;
  const maxTop  = vRect.height - mmRect.height;

  left = clamp(left, 0, Math.max(0, maxLeft));
  top  = clamp(top,  0, Math.max(0, maxTop));

  setMinimapPos(left, top);
}

function endMinimapDrag() {
  if (!miniDragging) return;
  miniDragging = false;
  minimap.style.cursor = "grab";
}

function goToPanel(p) {
  lastSelectedXY = { x: p.x, y: p.y, floor: p.floor };

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
	//검색 이동 시 기본 배율로 복귀
	applyScale(AUTO_FOCUS_SCALE);
	
  const x = nx * imgNaturalW;
  const y = ny * imgNaturalH;

  marker.style.left = `${x}px`;
  marker.style.top  = `${y}px`;
  marker.classList.remove("hidden");
  marker.classList.remove("pulse");
  void marker.offsetWidth;
  marker.classList.add("pulse");

  const targetLeft = x * currentScale - viewport.clientWidth / 2;
  const targetTop  = y * currentScale - viewport.clientHeight / 2;

  viewport.scrollLeft = Math.max(0, targetLeft);
  viewport.scrollTop  = Math.max(0, targetTop);

  updateMinimapRect();
  updateMinimapDot();
  showToast(`이동: ${label}`);
}

/* ===== events ===== */
viewport.addEventListener("scroll", () => {
  updateMinimapRect();
}, { passive: true });

viewport.addEventListener("wheel", (e) => {
  if (!e.ctrlKey) return;
  e.preventDefault();
  const delta = -e.deltaY;
  const factor = delta > 0 ? 1.08 : 1/1.08;
  applyScale(currentScale * factor, e.clientX, e.clientY);
}, { passive: false });

window.addEventListener("resize", () => setTimeout(() => {
  updateMinimapRect();
  updateMinimapDot();
}, 0));

if (btnMinimap) {
  btnMinimap.onclick = () => {
    minimap.classList.toggle("hidden");
    if (!minimap.classList.contains("hidden")) {
      updateMinimapRect();
      updateMinimapDot();
    }
  };
}

if (btnPick) {
  btnPick.onclick = () => {
    pickMode = !pickMode;

    const k = (pickKeySelect && pickKeySelect.value) ? pickKeySelect.value : pickSelectedKey;

    if (pickMode) {
      btnPick.textContent = `좌표찍기: ON${k ? ` (${k})` : ""}`;
      showToast("도면을 탭하면 선택된 SubKey에 좌표가 저장됩니다.", 1800);

      // SubKey 선택이 안 되어 있으면 안내
      if (!k) showToast("먼저 상단 드롭다운에서 SubKey를 선택하세요.", 2200);
    } else {
      btnPick.textContent = "좌표찍기: OFF";
      showToast("좌표찍기 모드 OFF", 1400);
    }
  };
}

// 모바일: 더보기/접기
if (btnMoreResults) {
  btnMoreResults.onclick = () => {
    resultsExpanded = !resultsExpanded;
    renderResults(filterPanels(search.value));
  };
}

// 결과 영역 접기/펼치기
if (btnResultsToggle) {
  btnResultsToggle.onclick = () => {
    resultsHidden = !resultsHidden;
    document.body.classList.toggle("resultsHidden", resultsHidden);
    btnResultsToggle.textContent = resultsHidden ? "결과 펼치기" : "결과 접기";
    setTimeout(updateMinimapRect, 50);
  };
}

// Export: TSV 전체 복사 (※ 원래 코드에서 중괄호가 여기로 들어와야 정상)
if (btnExport) {
  btnExport.onclick = async () => {
    if (!pickedSubRows.length) {
      showToast("내보낼 Sub 데이터가 없습니다. 좌표찍기 ON으로 먼저 저장하세요.", 1800);
      return;
    }

    const header = ["SubKey", "Sub", "floor", "x", "y", "aliases"].join("\t");
    const lines = pickedSubRows
      .slice()
      .sort((a,b) => a.floor.localeCompare(b.floor) || a.SubKey.localeCompare(b.SubKey))
      .map(r => [r.SubKey ?? "", r.Sub ?? "", r.floor ?? "", r.x ?? "", r.y ?? "", r.aliases ?? ""].join("\t"));

    const tsv = [header, ...lines].join("\n");

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(tsv);
        showToast(`TSV 복사 완료 (${pickedSubRows.length}개) - 엑셀 Sub 시트에 붙여넣기`, 2200);
      } else {
        alert(tsv);
      }
    } catch (e) {
      alert(tsv);
    }
  };
}

if (btnZoomIn) {
  btnZoomIn.onclick = () => {
    const r = viewport.getBoundingClientRect();
    applyScale(currentScale * 1.15, r.left + r.width/2, r.top + r.height/2);
  };
}
if (btnZoomOut) {
  btnZoomOut.onclick = () => {
    const r = viewport.getBoundingClientRect();
    applyScale(currentScale / 1.15, r.left + r.width/2, r.top + r.height/2);
  };
}
if (btnZoomReset) {
  btnZoomReset.onclick = () => {
    const r = viewport.getBoundingClientRect();
    applyScale(1.0, r.left + r.width/2, r.top + r.height/2);
  };
}

/* ===== pick tool ===== */
floorImg.addEventListener("click", (ev) => {
  if (!pickMode) return;

  // ✅ SubKey를 먼저 선택해야 함
  const subKey = (pickKeySelect && pickKeySelect.value) ? pickKeySelect.value : pickSelectedKey;
  if (!subKey) {
    showToast("먼저 상단 드롭다운에서 SubKey를 선택하세요.", 1800);
    return;
  }

  const rect = floorImg.getBoundingClientRect();
  const px = (ev.clientX - rect.left);
  const py = (ev.clientY - rect.top);
  const nx = px / rect.width;
  const ny = py / rect.height;

  const x = Number(nx.toFixed(4));
  const y = Number(ny.toFixed(4));

  // 1) 임시 내보내기 목록(pickedSubRows)에 덮어쓰기
  const item = {
    SubKey: subKey,
    Sub: "",               // 이름/별칭은 미리 작성한 것을 엑셀에서 관리
    floor: currentFloor,
    x, y,
    aliases: ""
  };
  const idx = pickedSubRows.findIndex(r => r.SubKey === subKey);
  if (idx >= 0) pickedSubRows[idx] = item;
  else pickedSubRows.push(item);

  // 2) 메모리의 Sub 데이터도 즉시 갱신(검색/이동이 바로 반영되게)
  if (!IDX) buildIndex();
  const p = IDX.subByKey.get(subKey);
  if (p) {
    p.floor = currentFloor;
    p.x = x; p.y = y;

    // window.Sub 원본도 같이 업데이트(새로고침 전까지)
    const raw = Array.isArray(window.Sub) ? window.Sub : [];
    const rawIdx = raw.findIndex(r => String(r.SubKey) === String(subKey));
    if (rawIdx >= 0) {
      raw[rawIdx].floor = currentFloor;
      raw[rawIdx].x = x;
      raw[rawIdx].y = y;
    }
  }

  // 3) 하이라이트 표시 (기존 focusXY 이용)
  focusXY(x, y, `${subKey}`);

  // 4) 안내
  showToast(`${subKey} 좌표 저장되었습니다.`, 1600);
});

/* ===== pinch zoom (mobile) ===== */
let pinchStartDist = null;
let pinchStartScale = null;

function dist2(a, b) {
  const dx = a.clientX - b.clientX;
  const dy = a.clientY - b.clientY;
  return Math.sqrt(dx*dx + dy*dy);
}

viewport.addEventListener("touchstart", (e) => {
  if (e.touches.length === 2) {
    pinchStartDist = dist2(e.touches[0], e.touches[1]);
    pinchStartScale = currentScale;
  }
}, { passive: true });

viewport.addEventListener("touchmove", (e) => {
  if (e.touches.length === 2 && pinchStartDist && pinchStartScale) {
    e.preventDefault();
    const d = dist2(e.touches[0], e.touches[1]);
    const ratio = d / pinchStartDist;

    const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
    const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2;

    applyScale(pinchStartScale * ratio, cx, cy);
  }
}, { passive: false });

viewport.addEventListener("touchend", (e) => {
  if (e.touches.length < 2) {
    pinchStartDist = null;
    pinchStartScale = null;
  }
}, { passive: true });

/* ===== init ===== */
let __inited = false;

function init() {
  // ✅ 중복 init 방지 (새로고침/중복 스크립트 로드/핫리로드 대비)
  if (__inited) return;
  __inited = true;

  if (!IDX) buildIndex();

  // 층 목록 구성
  const floors = uniqueFloorsFromData();
  floorSelect.innerHTML = floors
    .map(f => `<option value="${escapeHtml(f)}">${escapeHtml(f)}</option>`)
    .join("");

  // 첫 층 선택
  const floorKeys = Object.keys(window.FLOORS || {});
  const firstFloor = floorKeys[0] || floors[0];

  if (firstFloor) {
    floorSelect.value = firstFloor;
    setFloor(firstFloor);
  }

  // 검색/층 변경
  const doSearch = () => renderResults(filterPanels(search.value));
  search.addEventListener("input", doSearch);

  floorSelect.addEventListener("change", () => {
    setFloor(floorSelect.value);
    doSearch();
  });

  // 드롭다운 채우기 (SubKey 목록)
  fillPickKeySelect();

  // SubKey 선택 변경: 층 자동 이동 + (좌표 있으면) 이동
  if (pickKeySelect) {
    pickKeySelect.addEventListener("change", () => {
      pickSelectedKey = pickKeySelect.value || "";
      if (!pickSelectedKey) return;

      if (!IDX) buildIndex();
      const p = IDX.subByKey.get(pickSelectedKey);
      if (!p) return;

      if (p.floor && p.floor !== currentFloor) setFloor(p.floor);

      if (typeof p.x === "number" && typeof p.y === "number" && (p.x !== 0 || p.y !== 0)) {
        goToPanel(p);
      } else {
        showToast(`선택됨: ${p.SubKey} / ${p.name}\n이제 도면을 탭하면 좌표가 저장됩니다.`, 2200);
      }
    });
  }

  // "다음" 버튼
  if (btnPickNext) {
    btnPickNext.onclick = () => {
      if (!pickKeySelect) return;

      // 0번은 "(SubKey 선택)"이므로, 비어있으면 1번부터 시작
      let idx = pickKeySelect.selectedIndex;
      if (idx <= 0) idx = 1;

      const next = Math.min(pickKeySelect.options.length - 1, idx + 1);
      pickKeySelect.selectedIndex = next;
      pickKeySelect.dispatchEvent(new Event("change"));
    };
  }

  // 미니맵 드래그 이벤트
  if (minimap) {
    minimap.style.cursor = "grab";
    restoreMinimapPos();

    minimap.addEventListener("mousedown", (e) => {
      e.preventDefault();
      startMinimapDrag(e.clientX, e.clientY);
    });

    window.addEventListener("mousemove", (e) => moveMinimapDrag(e.clientX, e.clientY));
    window.addEventListener("mouseup", () => endMinimapDrag());

    minimap.addEventListener("touchstart", (e) => {
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      startMinimapDrag(t.clientX, t.clientY);
    }, { passive: true });

    window.addEventListener("touchmove", (e) => {
      if (!miniDragging) return;
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      moveMinimapDrag(t.clientX, t.clientY);
    }, { passive: true });

    window.addEventListener("touchend", () => endMinimapDrag(), { passive: true });
  }

  // 초기 렌더
  renderResults(filterPanels(""));
  if (btnResultsToggle) btnResultsToggle.textContent = "결과 접기";
  updateFloorUX();

  // ✅ 추가 권장: 첫 SubKey 자동 선택 + change 실행
  if (pickKeySelect && pickKeySelect.options.length > 1 && !pickKeySelect.value) {
    pickKeySelect.selectedIndex = 1;
    pickKeySelect.dispatchEvent(new Event("change"));
  }
}

window.addEventListener("DOMContentLoaded", () => {
  init();
});
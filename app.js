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
const btnExport = $("btnExport");
const btnZoomOut = $("btnZoomOut");
const btnZoomIn = $("btnZoomIn");
const btnZoomReset = $("btnZoomReset");

let currentFloor = null;
let currentScale = 1.6;
let pickMode = false;
let resultsExpanded = false;   // 모바일에서 더보기 상태
let resultsHidden = false;     // 결과 영역 접기/펼치기 상태
let pickedSubRows = []; // Sub 시트로 내보낼 임시 목록: {SubKey, Sub, floor, x, y, aliases}
let imgNaturalW = 0;
let imgNaturalH = 0;

function showToast(msg, ms = 1400) {
  toast.textContent = msg;
  toast.classList.remove("hidden");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.add("hidden"), ms);
}

function uniqueFloorsFromData() {
  if (!IDX) buildIndex();
  const floors = new Set(IDX.subList.map(p => p.floor).filter(Boolean));
  // 혹시 Sub 데이터가 비어 있어도 FLOORS 키로 선택 가능하게
  for (const f of Object.keys(window.FLOORS || {})) floors.add(f);
  return [...floors];
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

function applyScale(newScale, anchorClientX = null, anchorClientY = null) {
  const prevScale = currentScale;
  currentScale = Math.max(0.6, Math.min(4.0, newScale));
  canvas.style.transform = `scale(${currentScale})`;

  // 줌 시 화면 중심(또는 포인터 위치)을 최대한 유지
  if (anchorClientX !== null && anchorClientY !== null && imgNaturalW > 0) {
    const vpRect = viewport.getBoundingClientRect();

    // anchor가 viewport 안에서 차지하는 비율
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

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));
}

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
      aliases: Array.isArray(s.aliases) ? s.aliases : (typeof s.aliases === "string" && s.aliases ? s.aliases.split(",").map(x=>x.trim()).filter(Boolean) : [])
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
    if (!invToKeys.has(inv.toLowerCase())) invToKeys.set(inv.toLowerCase(), []);
    invToKeys.get(inv.toLowerCase()).push(key);

    const digits = (r.digits ? String(r.digits) : inv.replace(/\D/g, ""));
    if (digits) {
      if (!digitsToKeys.has(digits)) digitsToKeys.set(digits, []);
      digitsToKeys.get(digits).push(key);
    }
  }

  // 중복 제거(키 목록)
  for (const [k, arr] of invToKeys) invToKeys.set(k, [...new Set(arr)]);
  for (const [k, arr] of digitsToKeys) digitsToKeys.set(k, [...new Set(arr)]);

  IDX = { subByKey, subList, invToKeys, digitsToKeys };
}

function isMobile() {
  return window.matchMedia && window.matchMedia("(max-width: 900px)").matches;
}

function getPanelList() {
  // 요구사항: 판넬 목록은 window.Sub, 설비 목록은 Inv
  const arr = window.Sub || [];
  return arr.map(it => ({
    name: it.Sub,          // 판넬명
    floor: it.floor,
    x: it.x,
    y: it.y,
    Inv: Array.isArray(it.Inv) ? it.Inv : []
  }));
}

function filterPanels(q) {
  if (!IDX) buildIndex();

  const queryRaw = q.trim();
  const query = queryRaw.toLowerCase();
  if (!query) return IDX.subList;

  const digits = queryRaw.replace(/\D/g, "");

  const hitKeys = new Set();

  // 1) Sub / aliases 매칭
  for (const p of IDX.subList) {
    if (p.name.toLowerCase().includes(query)) hitKeys.add(p.SubKey);
    else if (p.aliases.some(a => a.toLowerCase().includes(query))) hitKeys.add(p.SubKey);
  }

  // 2) Inv 전체 매칭
  const keys1 = IDX.invToKeys.get(query);
  if (keys1) keys1.forEach(k => hitKeys.add(k));

  // 3) Inv 숫자만 매칭 (25485)
  if (digits) {
    const keys2 = IDX.digitsToKeys.get(digits);
    if (keys2) keys2.forEach(k => hitKeys.add(k));
  }

  // SubKey -> panel 변환, 없는 키는 무시
  const out = [];
  for (const k of hitKeys) {
    const p = IDX.subByKey.get(k);
    if (p) out.push(p);
  }

  // 정렬(층 -> SubKey)
  out.sort((a,b) => a.floor.localeCompare(b.floor) || a.SubKey.localeCompare(b.SubKey));
  return out;
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
    // UX: 검색 결과가 정확히 1개면 자동 이동(모바일에서 특히 편함)
  if (list.length === 1) {
    goToPanel(list[0]);
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
viewport.addEventListener("wheel", (e) => {
  // 트랙패드/휠로 스크롤은 그대로 두고, Ctrl(또는 pinch-to-zoom in Chrome)일 때만 확대
  if (!e.ctrlKey) return;

  e.preventDefault();
  const delta = -e.deltaY; // 위로 휠: 확대
  const factor = delta > 0 ? 1.08 : 1/1.08;
  applyScale(currentScale * factor, e.clientX, e.clientY);
}, { passive: false });

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
	if (btnExport) {
  btnExport.onclick = async () => {
		if (!pickedSubRows.length) {
		  showToast("내보낼 Sub 데이터가 없습니다. 좌표찍기 ON으로 먼저 저장하세요.", 1800);
		  return;
		}

		// TSV 헤더 포함
		const header = ["SubKey", "Sub", "floor", "x", "y", "aliases"].join("\t");
		const lines = pickedSubRows
		  .slice()
		  .sort((a,b) => a.floor.localeCompare(b.floor) || a.SubKey.localeCompare(b.SubKey))
		  .map(r => [
			r.SubKey ?? "",
			r.Sub ?? "",
			r.floor ?? "",
			r.x ?? "",
			r.y ?? "",
			r.aliases ?? ""
		  ].join("\t"));

		const tsv = [header, ...lines].join("\n");

		// 클립보드 복사 시도
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
  };
}

if (btnZoomIn) {
  btnZoomIn.onclick = () => applyScale(currentScale * 1.15, viewport.getBoundingClientRect().left + viewport.clientWidth/2, viewport.getBoundingClientRect().top + viewport.clientHeight/2);
}
if (btnZoomOut) {
  btnZoomOut.onclick = () => applyScale(currentScale / 1.15, viewport.getBoundingClientRect().left + viewport.clientWidth/2, viewport.getBoundingClientRect().top + viewport.clientHeight/2);
}
if (btnZoomReset) {
  btnZoomReset.onclick = () => applyScale(1.0, viewport.getBoundingClientRect().left + viewport.clientWidth/2, viewport.getBoundingClientRect().top + viewport.clientHeight/2);
}

floorImg.addEventListener("click", (ev) => {
  if (!pickMode) return;

  const rect = floorImg.getBoundingClientRect();
  const px = (ev.clientX - rect.left);
  const py = (ev.clientY - rect.top);
  const nx = px / rect.width;
  const ny = py / rect.height;

  // 좌표찍기 ON일 때: SubKey / Sub 입력받아 임시 목록에 추가
  const subKey = prompt("SubKey(층-일련번호) 입력 (예: B1F-001):");
  if (!subKey || !subKey.trim()) {
    showToast("SubKey가 없어 저장하지 않았습니다.", 1400);
    return;
  }

  const subName = prompt("판넬명(Sub) 입력 (예: SC1F25470):");
  if (!subName || !subName.trim()) {
    showToast("판넬명이 없어 저장하지 않았습니다.", 1400);
    return;
  }

  const aliases = prompt("별칭(선택) - 콤마로 구분 (없으면 빈칸):") || "";

  const item = {
    SubKey: subKey.trim(),
    Sub: subName.trim(),
    floor: currentFloor,
    x: Number(nx.toFixed(4)),
    y: Number(ny.toFixed(4)),
    aliases: aliases.trim()
  };

  // 같은 SubKey가 있으면 덮어쓰기(좌표 재찍기 편의)
  const idx = pickedSubRows.findIndex(r => r.SubKey === item.SubKey);
  if (idx >= 0) pickedSubRows[idx] = item;
  else pickedSubRows.push(item);

  // 저장 안내
  showToast(`저장됨: ${item.SubKey} / ${item.Sub} (x=${item.x}, y=${item.y})`, 1800);

  // 클립보드에는 "Sub 시트 1줄 TSV" 복사(붙여넣기 편의)
  const tsvLine = [item.SubKey, item.Sub, item.floor, item.x, item.y, item.aliases].join("\t");
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(tsvLine).catch(() => {});
  }
});

function init() {
  // 검색 인덱스 준비 (window.Sub / window.Inv 기반)
  if (!IDX) buildIndex();

  // 층 목록 구성 (Sub 데이터의 floor + FLOORS 키 포함)
  const floors = uniqueFloorsFromData();
  floorSelect.innerHTML = floors
    .map(f => `<option value="${escapeHtml(f)}">${escapeHtml(f)}</option>`)
    .join("");

  // 첫 층 선택 우선순위: FLOORS 첫 키 -> floors[0]
  const floorKeys = Object.keys(window.FLOORS || {});
  const firstFloor = floorKeys[0] || floors[0];

  if (firstFloor) {
    floorSelect.value = firstFloor;
    setFloor(firstFloor);
  }

  const doSearch = () => renderResults(filterPanels(search.value));
  search.addEventListener("input", doSearch);

  floorSelect.addEventListener("change", () => {
    setFloor(floorSelect.value);
    renderResults(filterPanels(search.value));
  });

  // 초기 렌더: 전체(Sub 전체) 표시
  renderResults(filterPanels(""));

  if (btnResultsToggle) btnResultsToggle.textContent = "결과 접기";
}

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
    // iOS/Android 브라우저 기본 확대 제스처와 충돌 방지
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

init();

const Rules = window.DotsRules;
const canvas = document.querySelector("#board");
const ctx = canvas.getContext("2d");

const resetButton = document.querySelector("#resetButton");
const fullscreenButton = document.querySelector("#fullscreenButton");
const exitFullscreenButton = document.querySelector("#exitFullscreenButton");
const redChip = document.querySelector("#redChip");
const blueChip = document.querySelector("#blueChip");
const redScore = document.querySelector("#redScore");
const blueScore = document.querySelector("#blueScore");
const turnText = document.querySelector("#turnText");
const hint = document.querySelector("#hint");
const modeText = document.querySelector("#modeText");
const nickInput = document.querySelector("#nickInput");
const createRoomButton = document.querySelector("#createRoomButton");
const quickGameButton = document.querySelector("#quickGameButton");
const localGameButton = document.querySelector("#localGameButton");
const boardSizeSelect = document.querySelector("#boardSizeSelect");
const boardSizeText = document.querySelector("#boardSizeText");
const shareBox = document.querySelector("#shareBox");
const roomLinkInput = document.querySelector("#roomLink");
const copyLinkButton = document.querySelector("#copyLinkButton");
const roomPlayers = document.querySelector("#roomPlayers");
const leaderboardList = document.querySelector("#leaderboardList");

const DESKTOP_PADDING = 58;
const MOBILE_PADDING = 34;
const DOT_RADIUS = 6;
const DESKTOP_HIT_RADIUS = 16;
const MOBILE_HIT_RADIUS = 24;
const PLAYER_RED = Rules.PLAYER_RED;
const PLAYER_BLUE = Rules.PLAYER_BLUE;
const POLL_INTERVAL = 900;

const COLORS = {
  red: "#d4473f",
  blue: "#2079a8",
  paper: "#fbfcf8",
  grid: "#cfd8d2",
  ink: "#17211d",
  muted: "#637069",
};

let cell = 32;
let renderScale = 1;
let boardOrigin = { x: DESKTOP_PADDING, y: DESKTOP_PADDING };
let state = Rules.createState(getSelectedSize());
let hoverPoint = null;
let lastMessage = "";
let online = {
  enabled: false,
  roomId: null,
  playerId: null,
  role: null,
  version: 0,
  pollTimer: null,
};

function resetLocalGame() {
  const message = lastMessage;
  stopPolling();
  online = {
    enabled: false,
    roomId: null,
    playerId: null,
    role: null,
    version: 0,
    pollTimer: null,
  };
  state = Rules.createState(getSelectedSize());
  hoverPoint = null;
  lastMessage = message || "Локальная партия. Красные начинают.";
  setShareLink("");
  renderOnlineInfo(null);
  updateStatus();
  draw();
}

function pointKey(x, y) {
  return Rules.pointKey(x, y);
}

function boardToCanvas(x, y) {
  const visual = boardToVisual(x, y);
  return {
    x: boardOrigin.x + visual.x * cell,
    y: boardOrigin.y + visual.y * cell,
  };
}

function boardToVisual(x, y) {
  if (!shouldRotateBoard()) {
    return { x, y };
  }
  return {
    x: y,
    y: state.cols - 1 - x,
  };
}

function visualToBoard(x, y) {
  if (!shouldRotateBoard()) {
    return { x, y };
  }
  return {
    x: state.cols - 1 - y,
    y: x,
  };
}

function getVisualSize() {
  if (!shouldRotateBoard()) {
    return {
      cols: state.cols,
      rows: state.rows,
    };
  }
  return {
    cols: state.rows,
    rows: state.cols,
  };
}

function shouldRotateBoard() {
  return isCompactLayout() && window.innerHeight >= window.innerWidth;
}

function canvasToBoard(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const x = (clientX - rect.left) * scaleX;
  const y = (clientY - rect.top) * scaleY;
  const vx = Math.round((x - boardOrigin.x) / cell);
  const vy = Math.round((y - boardOrigin.y) / cell);
  const board = visualToBoard(vx, vy);
  const gx = board.x;
  const gy = board.y;

  if (gx < 0 || gy < 0 || gx >= state.cols || gy >= state.rows) {
    return null;
  }

  const snapped = boardToCanvas(gx, gy);
  const dist = Math.hypot(snapped.x - x, snapped.y - y);
  if (dist > getHitRadius()) {
    return null;
  }

  return { x: gx, y: gy };
}

function canPlayAt(x, y) {
  if (state.gameOver) {
    return false;
  }
  if (online.enabled && online.role !== state.currentPlayer) {
    return false;
  }
  return Rules.canPlayAt(state, x, y);
}

async function placeDot(point) {
  if (!point) {
    return;
  }

  if (online.enabled) {
    await placeOnlineDot(point);
    return;
  }

  const result = Rules.applyMove(state, state.currentPlayer, point.x, point.y);
  lastMessage = getMoveMessage(result, Rules.otherPlayer(state.currentPlayer));
  updateStatus();
  draw();
}

async function placeOnlineDot(point) {
  if (!online.role) {
    lastMessage = "Вы наблюдаете за партией. Ходы доступны двум игрокам.";
    updateStatus();
    draw();
    return;
  }

  if (online.role !== state.currentPlayer) {
    lastMessage = "Сейчас ход соперника.";
    updateStatus();
    draw();
    return;
  }

  const response = await api(`/api/move/${online.roomId}`, {
    method: "POST",
    body: {
      playerId: online.playerId,
      x: point.x,
      y: point.y,
    },
  });

  applyRoomSnapshot(response);
  lastMessage = response.message || (response.result ? getMoveMessage(response.result, online.role) : "Ход принят.");
  updateStatus();
  draw();
  renderLeaderboard(response.leaderboard);
}

function getMoveMessage(result, player) {
  if (!result.ok) {
    return result.reason;
  }

  if (result.gameOver) {
    return Rules.getResultText(state);
  }

  const gained = result.gained[player] || 0;
  const name = player === PLAYER_RED ? "Красные" : "Синие";
  return gained > 0
    ? `${name} захватили ${gained} ${plural(gained, "точку", "точки", "точек")}.`
    : "Ход принят.";
}

function plural(number, one, few, many) {
  const mod10 = number % 10;
  const mod100 = number % 100;
  if (mod10 === 1 && mod100 !== 11) {
    return one;
  }
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return few;
  }
  return many;
}

function updateStatus() {
  const captured = Rules.countCaptured(state);
  redScore.textContent = captured.red;
  blueScore.textContent = captured.blue;
  redChip.classList.toggle("active", state.currentPlayer === PLAYER_RED);
  blueChip.classList.toggle("active", state.currentPlayer === PLAYER_BLUE);

  if (state.gameOver) {
    turnText.textContent = "Партия завершена";
    hint.textContent = lastMessage || Rules.getResultText(state);
    modeText.textContent = getModeLabel();
    if (!online.enabled) {
      renderOnlineInfo(null);
    }
    return;
  }

  const turnName = state.currentPlayer === PLAYER_RED ? "красных" : "синих";
  if (online.enabled && online.role) {
    const yourTurn = online.role === state.currentPlayer;
    turnText.textContent = yourTurn ? `Ваш ход: ${turnName}` : `Ход ${turnName}`;
  } else {
    turnText.textContent = `Ход ${turnName}`;
  }

  hint.textContent = lastMessage || "Ставьте точки на пересечения.";
  modeText.textContent = getModeLabel();
  if (!online.enabled) {
    renderOnlineInfo(null);
  }
}

function getModeLabel() {
  if (!online.enabled) {
    return `Локальная игра: ${getSizeLabel(state.sizeName)}`;
  }
  if (!online.role) {
    return `Комната ${online.roomId}: наблюдение, ${getSizeLabel(state.sizeName)}`;
  }
  const color = online.role === PLAYER_RED ? "красные" : "синие";
  return `Комната ${online.roomId}: вы играете за ${color}, ${getSizeLabel(state.sizeName)}`;
}

function getSelectedSize() {
  return Rules.normalizeSizeName(boardSizeSelect ? boardSizeSelect.value : Rules.DEFAULT_SIZE);
}

function getSizeLabel(sizeName) {
  return Rules.getBoardSize(sizeName).label.toLowerCase();
}

function getSizeText(sizeName) {
  const size = Rules.getBoardSize(sizeName);
  return `${size.cols}x${size.rows}`;
}

function updateBoardSizeControls() {
  const sizeName = state.sizeName || getSelectedSize();
  boardSizeSelect.value = sizeName;
  boardSizeText.textContent = getSizeText(sizeName);
  boardSizeSelect.disabled = online.enabled;
  boardSizeSelect.title = online.enabled
    ? "Размер онлайн-партии фиксируется при создании комнаты."
    : "Размер применится к новой локальной партии или новой онлайн-комнате.";
}

function draw() {
  resizeBoardMetrics();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawPaper();
  drawCaptureZones();
  drawConnections();
  drawDots();
  drawHover();
}

function resizeBoardMetrics() {
  syncCanvasResolution();
  const padding = getBoardPadding();
  const visualSize = getVisualSize();
  const usableWidth = canvas.width - padding * 2;
  const usableHeight = canvas.height - padding * 2;
  cell = Math.min(usableWidth / (visualSize.cols - 1), usableHeight / (visualSize.rows - 1));
  boardOrigin = {
    x: (canvas.width - (visualSize.cols - 1) * cell) / 2,
    y: (canvas.height - (visualSize.rows - 1) * cell) / 2,
  };
}

function syncCanvasResolution() {
  const rect = canvas.getBoundingClientRect();
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  renderScale = ratio;
  const width = Math.max(320, Math.round(rect.width * ratio));
  const height = Math.max(280, Math.round(rect.height * ratio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
}

function getBoardPadding() {
  return scaled(isCompactLayout() ? MOBILE_PADDING : DESKTOP_PADDING);
}

function getHitRadius() {
  return scaled(isCompactLayout() ? MOBILE_HIT_RADIUS : DESKTOP_HIT_RADIUS);
}

function scaled(value) {
  return value * renderScale;
}

function isCompactLayout() {
  return window.matchMedia("(max-width: 720px), (pointer: coarse)").matches || document.body.classList.contains("game-fullscreen");
}

function drawPaper() {
  const visualSize = getVisualSize();
  ctx.fillStyle = COLORS.paper;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = scaled(1);
  for (let x = 0; x < visualSize.cols; x += 1) {
    const p = visualToCanvas(x, 0);
    const b = visualToCanvas(x, visualSize.rows - 1);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  for (let y = 0; y < visualSize.rows; y += 1) {
    const p = visualToCanvas(0, y);
    const b = visualToCanvas(visualSize.cols - 1, y);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
}

function visualToCanvas(x, y) {
  return {
    x: boardOrigin.x + x * cell,
    y: boardOrigin.y + y * cell,
  };
}

function drawCaptureZones() {
  for (const zone of state.captureZones) {
    const color = zone.owner === PLAYER_RED ? COLORS.red : COLORS.blue;
    ctx.fillStyle = colorWithAlpha(color, 0.14);
    ctx.strokeStyle = colorWithAlpha(color, 0.45);
    ctx.lineWidth = scaled(1);

    for (const key of zone.points) {
      const [x, y] = key.split(",").map(Number);
      const p = boardToCanvas(x, y);
      ctx.beginPath();
      ctx.rect(p.x - cell * 0.43, p.y - cell * 0.43, cell * 0.86, cell * 0.86);
      ctx.fill();
      ctx.stroke();
    }
  }
}

function drawConnections() {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  for (const player of [PLAYER_RED, PLAYER_BLUE]) {
    ctx.strokeStyle = colorWithAlpha(COLORS[player], 0.72);
    ctx.lineWidth = scaled(3);

    for (let y = 0; y < state.rows; y += 1) {
      for (let x = 0; x < state.cols; x += 1) {
        if (state.dots[y][x] !== player) {
          continue;
        }
        for (const n of neighbors8(x, y)) {
          if (n.y < y || (n.y === y && n.x <= x)) {
            continue;
          }
          if (state.dots[n.y][n.x] !== player) {
            continue;
          }
          const a = boardToCanvas(x, y);
          const b = boardToCanvas(n.x, n.y);
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }
    }
  }
}

function neighbors8(x, y) {
  const result = [];
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dy === 0) {
        continue;
      }
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < state.cols && ny < state.rows) {
        result.push({ x: nx, y: ny });
      }
    }
  }
  return result;
}

function drawDots() {
  for (let y = 0; y < state.rows; y += 1) {
    for (let x = 0; x < state.cols; x += 1) {
      const player = state.dots[y][x];
      if (!player) {
        continue;
      }
      const p = boardToCanvas(x, y);
      const capturedBy = state.capturedByPoint[pointKey(x, y)];
      ctx.fillStyle = COLORS[player];
      ctx.strokeStyle = capturedBy ? COLORS.ink : "#ffffff";
      ctx.lineWidth = capturedBy ? scaled(3) : scaled(2);
      ctx.beginPath();
      ctx.arc(p.x, p.y, scaled(DOT_RADIUS), 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      if (capturedBy) {
        ctx.strokeStyle = COLORS[capturedBy];
        ctx.lineWidth = scaled(2);
        ctx.beginPath();
        ctx.arc(p.x, p.y, scaled(DOT_RADIUS + 7), 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }
}

function drawHover() {
  if (!hoverPoint) {
    return;
  }

  const p = boardToCanvas(hoverPoint.x, hoverPoint.y);
  const allowed = canPlayAt(hoverPoint.x, hoverPoint.y);
  ctx.strokeStyle = allowed ? COLORS[state.currentPlayer] : COLORS.muted;
  ctx.fillStyle = allowed ? colorWithAlpha(COLORS[state.currentPlayer], 0.18) : "rgba(99, 112, 105, 0.16)";
  ctx.lineWidth = scaled(2);
  ctx.beginPath();
  ctx.arc(p.x, p.y, scaled(DOT_RADIUS + 5), 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

function colorWithAlpha(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

async function createRoom() {
  const response = await api("/api/room", {
    method: "POST",
    body: {
      nick: getNick(),
      size: getSelectedSize(),
    },
  });
  enterOnlineRoom(response, "Комната создана. Отправьте ссылку второму игроку.");
}

async function quickGame() {
  const response = await api("/api/quick", {
    method: "POST",
    body: {
      nick: getNick(),
      size: getSelectedSize(),
    },
  });
  const message = response.waiting
    ? "Ищем соперника. Можно отправить ссылку другу."
    : "Соперник найден. Партия началась.";
  enterOnlineRoom(response, message);
}

async function joinRoomFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const roomId = params.get("room");
  if (!roomId) {
    return false;
  }

  const knownPlayer = localStorage.getItem(`dots.player.${roomId}`);
  if (knownPlayer) {
    const response = await api(`/api/state/${roomId}?playerId=${encodeURIComponent(knownPlayer)}`);
    enterOnlineRoom(response, "Вы вернулись в комнату.");
    return true;
  }

  const response = await api(`/api/join/${roomId}`, {
    method: "POST",
    body: {
      nick: getNick(),
    },
  });
  enterOnlineRoom(response, response.role ? "Вы вошли в комнату." : "Комната заполнена. Вы наблюдаете за партией.");
  return true;
}

function enterOnlineRoom(response, message) {
  online.enabled = true;
  online.roomId = response.roomId;
  online.playerId = response.playerId || online.playerId;
  online.role = response.role || null;
  online.version = response.version || 0;
  state = response.state || Rules.createState(getSelectedSize());
  lastMessage = message;

  if (online.playerId) {
    localStorage.setItem(`dots.player.${online.roomId}`, online.playerId);
  }

  const url = `${window.location.origin}${window.location.pathname}?room=${online.roomId}`;
  setShareLink(url);
  applyRoomSnapshot(response);
  updateStatus();
  draw();
  startPolling();
}

function applyRoomSnapshot(response) {
  if (!response || !response.state) {
    return;
  }

  state = response.state;
  updateBoardSizeControls();
  online.roomId = response.roomId || online.roomId;
  online.version = response.version || online.version;
  if (Object.prototype.hasOwnProperty.call(response, "role")) {
    online.role = response.role;
  }
  if (response.playerId) {
    online.playerId = response.playerId;
  }
  renderOnlineInfo(response);
  renderLeaderboard(response.leaderboard);
}

function startPolling() {
  stopPolling();
  online.pollTimer = window.setInterval(pollRoom, POLL_INTERVAL);
}

function stopPolling() {
  if (online.pollTimer) {
    window.clearInterval(online.pollTimer);
    online.pollTimer = null;
  }
}

async function pollRoom() {
  if (!online.enabled || !online.roomId) {
    return;
  }

  try {
    const response = await api(`/api/state/${online.roomId}?playerId=${encodeURIComponent(online.playerId || "")}&since=${online.version}`);
    if (response.changed) {
      applyRoomSnapshot(response);
      lastMessage = response.message || lastMessage;
      updateStatus();
      draw();
    } else {
      renderOnlineInfo(response);
      renderLeaderboard(response.leaderboard);
    }
  } catch (error) {
    lastMessage = "Связь с сервером потеряна. Пробую переподключиться.";
    updateStatus();
  }
}

async function resetGame() {
  if (!online.enabled) {
    resetLocalGame();
    return;
  }

  if (!online.role) {
    lastMessage = "Наблюдатель не может перезапустить партию.";
    updateStatus();
    return;
  }

  const response = await api(`/api/reset/${online.roomId}`, {
    method: "POST",
    body: {
      playerId: online.playerId,
    },
  });
  applyRoomSnapshot(response);
  lastMessage = "Партия началась заново.";
  updateStatus();
  draw();
}

function getNick() {
  const stored = localStorage.getItem("dots.nick");
  const value = (nickInput.value || stored || "").trim().slice(0, 18);
  const nick = value || makeGuestName();
  nickInput.value = nick;
  localStorage.setItem("dots.nick", nick);
  return nick;
}

function makeGuestName() {
  return `Игрок-${Math.floor(100 + Math.random() * 900)}`;
}

function getVisitorId() {
  const stored = localStorage.getItem("dots.visitorId");
  if (stored) {
    return stored;
  }
  const visitorId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
  localStorage.setItem("dots.visitorId", visitorId);
  return visitorId;
}

function recordVisit() {
  api("/api/visit", {
    method: "POST",
    body: {
      visitorId: getVisitorId(),
      screen: `${window.innerWidth}x${window.innerHeight}`,
    },
  }).catch(() => {
    // Statistics should never block the game.
  });
}

function setShareLink(url) {
  shareBox.hidden = !url;
  roomLinkInput.value = url;
}

function renderOnlineInfo(response) {
  const captured = Rules.countCaptured(state);
  const remaining = typeof state.remainingMoves === "number" ? state.remainingMoves : Rules.countLegalMoves(state);
  const finish = state.gameOver ? ` ${Rules.getResultText(state)}` : "";
  const stats = `Ходов: ${state.moves}. Доступных ходов: ${remaining}. Захвачено: красные ${captured.red}, синие ${captured.blue}.${finish}`;
  if (!response || !response.players) {
    updateBoardSizeControls();
    roomPlayers.textContent = `Локальная партия. Поле: ${getSizeLabel(state.sizeName)}. ${stats}`;
    return;
  }

  const red = response.players.red ? response.players.red.nick : "ждем игрока";
  const blue = response.players.blue ? response.players.blue.nick : "ждем игрока";
  const watchers = response.watchers || 0;
  roomPlayers.textContent = `Красные: ${red}. Синие: ${blue}. Наблюдателей: ${watchers}. Поле: ${getSizeLabel(state.sizeName)}. ${stats}`;
}

function renderLeaderboard(items) {
  if (!items || items.length === 0) {
    leaderboardList.innerHTML = "<li>Первые захваты появятся здесь.</li>";
    return;
  }

  leaderboardList.innerHTML = items
    .map((item, index) => `<li><span>${index + 1}. ${escapeHtml(item.nick)}</span><strong>${item.captured}</strong></li>`)
    .join("");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function api(path, options = {}) {
  const init = {
    method: options.method || "GET",
    headers: {},
  };
  if (options.body) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(options.body);
  }

  const response = await fetch(path, init);
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Ошибка сервера");
  }
  return data;
}

canvas.addEventListener("pointermove", (event) => {
  hoverPoint = canvasToBoard(event.clientX, event.clientY);
  draw();
});

canvas.addEventListener("pointerleave", () => {
  hoverPoint = null;
  draw();
});

canvas.addEventListener("click", (event) => {
  placeDot(canvasToBoard(event.clientX, event.clientY)).catch((error) => {
    lastMessage = error.message;
    updateStatus();
  });
});

resetButton.addEventListener("click", () => {
  resetGame().catch((error) => {
    lastMessage = error.message;
    updateStatus();
  });
});
createRoomButton.addEventListener("click", () => createRoom().catch((error) => {
  lastMessage = error.message;
  updateStatus();
}));
quickGameButton.addEventListener("click", () => quickGame().catch((error) => {
  lastMessage = error.message;
  updateStatus();
}));
localGameButton.addEventListener("click", resetLocalGame);
boardSizeSelect.addEventListener("change", () => {
  if (online.enabled) {
    updateBoardSizeControls();
    lastMessage = "В онлайн-комнате размер уже зафиксирован. Выберите размер перед созданием новой комнаты.";
    updateStatus();
    return;
  }
  const selectedSize = getSelectedSize();
  localStorage.setItem("dots.boardSize", selectedSize);
  lastMessage = `Поле изменено: ${getSizeLabel(selectedSize)} ${getSizeText(selectedSize)}. Новая партия началась.`;
  resetLocalGame();
});
copyLinkButton.addEventListener("click", async () => {
  await navigator.clipboard.writeText(roomLinkInput.value);
  lastMessage = "Ссылка скопирована.";
  updateStatus();
});
fullscreenButton.addEventListener("click", toggleFullscreen);
exitFullscreenButton.addEventListener("click", exitFullscreenMode);
document.addEventListener("fullscreenchange", syncFullscreenState);
window.addEventListener("resize", draw);
window.addEventListener("orientationchange", () => {
  window.setTimeout(draw, 250);
});

async function toggleFullscreen() {
  const panel = document.querySelector(".game-panel");
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else if (panel.requestFullscreen) {
      await panel.requestFullscreen();
    } else {
      document.body.classList.toggle("game-fullscreen");
    }
  } catch (error) {
    document.body.classList.toggle("game-fullscreen");
  }
  syncFullscreenState();
  window.setTimeout(draw, 80);
}

async function exitFullscreenMode() {
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    }
  } catch (error) {
    // CSS fallback below still closes the app-level fullscreen mode.
  }
  document.body.classList.remove("game-fullscreen");
  syncFullscreenState();
  window.setTimeout(draw, 80);
}

function syncFullscreenState() {
  const active = Boolean(document.fullscreenElement) || document.body.classList.contains("game-fullscreen");
  document.body.classList.toggle("game-fullscreen", active);
  fullscreenButton.textContent = active ? "Свернуть" : "Во весь экран";
  draw();
}

nickInput.value = localStorage.getItem("dots.nick") || "";
boardSizeSelect.value = Rules.normalizeSizeName(localStorage.getItem("dots.boardSize"));
updateBoardSizeControls();
recordVisit();
joinRoomFromUrl().then((joined) => {
  if (!joined) {
    resetLocalGame();
  }
}).catch((error) => {
  resetLocalGame();
  lastMessage = error.message;
  updateStatus();
});

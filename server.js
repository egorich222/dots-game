const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const Rules = require("./rules");

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = __dirname;
const DATA_DIR = path.join(__dirname, "data");
const EVENTS_FILE = path.join(DATA_DIR, "events.jsonl");
const rooms = new Map();
const leaderboard = new Map();
const quickWaitingRooms = new Map();
const SERVER_TEXT = {
  en: {
    serverError: "Server error",
    opponentJoined: "Opponent joined.",
    playersOnly: "Only game players can use this room.",
    watcherNoReset: "A watcher cannot restart the game.",
    reset: "started a new game.",
    notFoundRoute: "Route not found.",
    redStarts: "Red starts.",
    joinedBlue: "joined as blue.",
    roomNotFound: "Room not found.",
    draw: "Game over. Draw",
    winner: "Game over. Winner",
    red: "red",
    blue: "blue",
    moveAccepted: "move accepted.",
    captured: "captured",
    dot: "dot",
    dots: "dots",
    guest: "Player",
    statsTitle: "GridTrap Stats",
    updated: "Updated",
    back: "Back to game",
    funnel: "Funnel",
    topCaptures: "Top captures",
    recentFinished: "Recent finished games",
    visits: "Visits",
    uniqueBrowsers: "Unique browsers",
    createdRooms: "Created rooms",
    joinedRooms: "Rooms with second player",
    totalMoves: "Total moves",
    totalCaptured: "Total captured dots",
    completedGames: "Finished games",
    avgDuration: "Average game duration",
    avgMoves: "Average moves per finished game",
    noCaptures: "No captures yet",
    noFinished: "No finished games yet",
    room: "Room",
    board: "Board",
    result: "Result",
    score: "Score",
    moves: "Moves",
    time: "Time",
    seconds: "sec",
    minutes: "min",
    badJson: "Could not parse JSON.",
  },
  ru: {
    serverError: "Ошибка сервера",
    opponentJoined: "Соперник подключился.",
    playersOnly: "Эта комната доступна только игрокам партии.",
    watcherNoReset: "Наблюдатель не может перезапустить партию.",
    reset: "начал новую партию.",
    notFoundRoute: "Маршрут не найден.",
    redStarts: "Красные начинают.",
    joinedBlue: "подключился за синих.",
    roomNotFound: "Комната не найдена.",
    draw: "Партия завершена. Ничья",
    winner: "Партия завершена. Победили",
    red: "красные",
    blue: "синие",
    moveAccepted: "ход принят.",
    captured: "захватил",
    dot: "точку",
    dots: "точек",
    guest: "Игрок",
    statsTitle: "Статистика Точек",
    updated: "Обновлено",
    back: "Вернуться к игре",
    funnel: "Воронка",
    topCaptures: "Лучшие захваты",
    recentFinished: "Последние завершенные партии",
    visits: "Визиты",
    uniqueBrowsers: "Уникальные браузеры",
    createdRooms: "Создано комнат",
    joinedRooms: "Комнат со вторым игроком",
    totalMoves: "Ходов всего",
    totalCaptured: "Захвачено точек всего",
    completedGames: "Завершено партий",
    avgDuration: "Средняя длительность партии",
    avgMoves: "Среднее ходов в завершенной партии",
    noCaptures: "Пока нет захватов",
    noFinished: "Завершенных партий пока нет",
    room: "Комната",
    board: "Поле",
    result: "Итог",
    score: "Счет",
    moves: "Ходы",
    time: "Время",
    seconds: "сек",
    minutes: "мин",
    badJson: "Не удалось прочитать JSON.",
  },
};

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

const server = http.createServer(async (request, response) => {
  const lang = getRequestLang(request);
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(request, response, url);
      return;
    }

    if (request.method === "GET" && url.pathname === "/stats") {
      sendHtml(response, 200, renderStatsPage(readStats(), lang));
      return;
    }

    serveStatic(response, url.pathname);
  } catch (error) {
    sendJson(response, error.status || 500, { error: error.message || st(lang, "serverError") });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Dots server: http://localhost:${PORT}`);
});

async function handleApi(request, response, url) {
  if (request.method === "POST" && url.pathname === "/api/visit") {
    const body = await readJson(request);
    recordEvent("visit", {
      visitorId: cleanId(body.visitorId),
      screen: cleanText(body.screen, 30),
    });
    sendJson(response, 200, { ok: true });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/room") {
    const body = await readJson(request);
    const room = createRoom(cleanNick(body.nick), body.size);
    recordEvent("room_created", {
      roomId: room.id,
      size: room.state.sizeName,
      playerId: room.players.red.id,
      nick: room.players.red.nick,
    });
    sendJson(response, 200, roomPayload(room, room.players.red.id));
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/quick") {
    const body = await readJson(request);
    const nick = cleanNick(body.nick);
    const sizeName = Rules.normalizeSizeName(body.size);
    const quickWaitingRoom = quickWaitingRooms.get(sizeName);

    if (quickWaitingRoom && rooms.has(quickWaitingRoom)) {
      const room = rooms.get(quickWaitingRoom);
      quickWaitingRooms.delete(sizeName);
      if (!room.players.blue) {
        const player = makePlayer(nick, Rules.PLAYER_BLUE);
        room.players.blue = player;
        room.version += 1;
        room.message = "Opponent joined.";
        recordEvent("quick_matched", {
          roomId: room.id,
          size: room.state.sizeName,
          playerId: player.id,
          nick: player.nick,
        });
        sendJson(response, 200, { ...roomPayload(room, player.id), waiting: false });
        return;
      }
    }

    const room = createRoom(nick, sizeName);
    quickWaitingRooms.set(sizeName, room.id);
    recordEvent("quick_waiting", {
      roomId: room.id,
      size: room.state.sizeName,
      playerId: room.players.red.id,
      nick: room.players.red.nick,
    });
    sendJson(response, 200, { ...roomPayload(room, room.players.red.id), waiting: true });
    return;
  }

  const joinMatch = url.pathname.match(/^\/api\/join\/([A-Z0-9]+)$/);
  if (request.method === "POST" && joinMatch) {
    const room = getRoom(joinMatch[1]);
    const body = await readJson(request);
    const playerId = joinOrWatch(room, cleanNick(body.nick));
    const player = findPlayer(room, playerId);
    recordEvent(player ? "player_joined" : "watcher_joined", {
      roomId: room.id,
      size: room.state.sizeName,
      playerId,
      nick: player ? player.nick : "observer",
      role: player ? player.role : "watcher",
    });
    sendJson(response, 200, roomPayload(room, playerId));
    return;
  }

  const stateMatch = url.pathname.match(/^\/api\/state\/([A-Z0-9]+)$/);
  if (request.method === "GET" && stateMatch) {
    const room = getRoom(stateMatch[1]);
    const playerId = url.searchParams.get("playerId") || "";
    const since = Number(url.searchParams.get("since") || 0);
    sendJson(response, 200, {
      ...roomPayload(room, playerId),
      changed: room.version !== since,
    });
    return;
  }

  const moveMatch = url.pathname.match(/^\/api\/move\/([A-Z0-9]+)$/);
  if (request.method === "POST" && moveMatch) {
    const room = getRoom(moveMatch[1]);
    const body = await readJson(request);
    const player = findPlayer(room, body.playerId);
    if (!player) {
      sendJson(response, 403, { error: "Only game players can use this room." });
      return;
    }

    const result = Rules.applyMove(room.state, player.role, Number(body.x), Number(body.y));
    if (!result.ok) {
      sendJson(response, 400, {
        ...roomPayload(room, player.id),
        result,
        message: result.reason,
      });
      return;
    }

    const gained = result.gained[player.role] || 0;
    if (gained > 0) {
      addLeaderboardCapture(player.nick, gained);
      recordEvent("capture_made", {
        roomId: room.id,
        size: room.state.sizeName,
        playerId: player.id,
        nick: player.nick,
        role: player.role,
        captured: gained,
      });
    }
    room.version += 1;
    room.updatedAt = Date.now();
    room.message = buildMoveMessage(player, result);
    recordEvent("move_made", {
      roomId: room.id,
      size: room.state.sizeName,
      playerId: player.id,
      nick: player.nick,
      role: player.role,
      x: Number(body.x),
      y: Number(body.y),
      moves: room.state.moves,
      remainingMoves: room.state.remainingMoves,
    });
    if (result.gameOver) {
      recordEvent("game_finished", {
        roomId: room.id,
        size: room.state.sizeName,
        winner: result.winner,
        redScore: result.finalScore.red,
        blueScore: result.finalScore.blue,
        moves: room.state.moves,
        durationMs: room.updatedAt - room.createdAt,
      });
    }
    sendJson(response, 200, {
      ...roomPayload(room, player.id),
      result,
      message: room.message,
    });
    return;
  }

  const resetMatch = url.pathname.match(/^\/api\/reset\/([A-Z0-9]+)$/);
  if (request.method === "POST" && resetMatch) {
    const room = getRoom(resetMatch[1]);
    const body = await readJson(request);
    const player = findPlayer(room, body.playerId);
    if (!player) {
      sendJson(response, 403, { error: "A watcher cannot restart the game." });
      return;
    }

    room.state = Rules.createState(room.state.sizeName);
    room.version += 1;
    room.updatedAt = Date.now();
    room.createdAt = Date.now();
    room.message = `${player.nick} started a new game.`;
    recordEvent("game_reset", {
      roomId: room.id,
      size: room.state.sizeName,
      playerId: player.id,
      nick: player.nick,
    });
    sendJson(response, 200, roomPayload(room, player.id));
    return;
  }

  sendJson(response, 404, { error: "Route not found." });
}

function createRoom(nick, sizeName) {
  const id = createRoomId();
  const red = makePlayer(nick, Rules.PLAYER_RED);
  const room = {
    id,
    state: Rules.createState(sizeName),
    players: {
      red,
      blue: null,
    },
    watchers: new Set(),
    version: 1,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    message: "Red starts.",
  };
  rooms.set(id, room);
  return room;
}

function joinOrWatch(room, nick) {
  if (!room.players.blue) {
    const player = makePlayer(nick, Rules.PLAYER_BLUE);
    room.players.blue = player;
    room.version += 1;
    room.updatedAt = Date.now();
    room.message = `${player.nick} joined as blue.`;
    return player.id;
  }

  const watcherId = createId(12);
  room.watchers.add(watcherId);
  return watcherId;
}

function roomPayload(room, playerId) {
  const player = findPlayer(room, playerId);
  const isWatcher = playerId && !player && room.watchers.has(playerId);
  return {
    roomId: room.id,
    playerId,
    role: player ? player.role : null,
    state: room.state,
    version: room.version,
    players: {
      red: publicPlayer(room.players.red),
      blue: publicPlayer(room.players.blue),
    },
    watchers: room.watchers.size + (isWatcher ? 0 : 0),
    message: room.message,
    leaderboard: topLeaderboard(),
  };
}

function findPlayer(room, playerId) {
  if (!playerId) {
    return null;
  }
  for (const player of [room.players.red, room.players.blue]) {
    if (player && player.id === playerId) {
      return player;
    }
  }
  return null;
}

function publicPlayer(player) {
  if (!player) {
    return null;
  }
  return {
    nick: player.nick,
    role: player.role,
  };
}

function makePlayer(nick, role) {
  return {
    id: createId(18),
    nick,
    role,
  };
}

function getRoom(roomId) {
  const room = rooms.get(roomId);
  if (!room) {
    const error = new Error("Room not found.");
    error.status = 404;
    throw error;
  }
  return room;
}

function buildMoveMessage(player, result) {
  if (result.gameOver) {
    const score = result.finalScore || { red: 0, blue: 0 };
    if (result.winner === "draw") {
      return `Game over. Draw: ${score.red}:${score.blue}.`;
    }
    const winnerName = result.winner === Rules.PLAYER_RED ? "red" : "blue";
    return `Game over. Winner ${winnerName}: ${score.red}:${score.blue}.`;
  }

  const gained = result.gained[player.role] || 0;
  if (gained <= 0) {
    return `${player.nick}: move accepted.`;
  }
  return `${player.nick} captured ${gained} ${gained === 1 ? "dot" : "dots"}.`;
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

function addLeaderboardCapture(nick, amount) {
  const current = leaderboard.get(nick) || { nick, captured: 0 };
  current.captured += amount;
  leaderboard.set(nick, current);
}

function topLeaderboard() {
  return [...leaderboard.values()]
    .sort((a, b) => b.captured - a.captured || a.nick.localeCompare(b.nick, "ru"))
    .slice(0, 5);
}

function cleanNick(nick) {
  const value = String(nick || "").trim().slice(0, 18);
  return value || `Player-${Math.floor(100 + Math.random() * 900)}`;
}

function cleanText(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

function cleanId(value) {
  return String(value || "")
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 64);
}

function recordEvent(type, payload = {}) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const event = {
      ts: new Date().toISOString(),
      type,
      ...payload,
    };
    fs.appendFileSync(EVENTS_FILE, `${JSON.stringify(event)}\n`);
  } catch (error) {
    console.error(`Stats write failed: ${error.message}`);
  }
}

function readEvents() {
  try {
    const content = fs.readFileSync(EVENTS_FILE, "utf8");
    return content
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch (error) {
          return null;
        }
      })
      .filter(Boolean);
  } catch (error) {
    return [];
  }
}

function readStats() {
  const events = readEvents();
  const counts = {};
  const visitors = new Set();
  const roomsCreated = new Set();
  const joinedRooms = new Set();
  const finishedGames = [];
  const capturesByNick = new Map();
  let totalMoves = 0;
  let totalCaptured = 0;

  for (const event of events) {
    counts[event.type] = (counts[event.type] || 0) + 1;
    if (event.visitorId) {
      visitors.add(event.visitorId);
    }
    if (event.type === "room_created" || event.type === "quick_waiting") {
      roomsCreated.add(event.roomId);
    }
    if (event.type === "player_joined" || event.type === "quick_matched") {
      joinedRooms.add(event.roomId);
    }
    if (event.type === "move_made") {
      totalMoves += 1;
    }
    if (event.type === "capture_made") {
      const amount = Number(event.captured || 0);
      totalCaptured += amount;
      const current = capturesByNick.get(event.nick) || 0;
      capturesByNick.set(event.nick, current + amount);
    }
    if (event.type === "game_finished") {
      finishedGames.push(event);
    }
  }

  const totalDuration = finishedGames.reduce((sum, event) => sum + Number(event.durationMs || 0), 0);
  const totalFinishedMoves = finishedGames.reduce((sum, event) => sum + Number(event.moves || 0), 0);
  const completed = finishedGames.length;
  const topCaptures = [...capturesByNick.entries()]
    .map(([nick, captured]) => ({ nick, captured }))
    .sort((a, b) => b.captured - a.captured || a.nick.localeCompare(b.nick, "ru"))
    .slice(0, 10);

  return {
    generatedAt: new Date().toISOString(),
    totalEvents: events.length,
    counts,
    visitors: visitors.size,
    roomsCreated: roomsCreated.size,
    roomsJoined: joinedRooms.size,
    totalMoves,
    completed,
    totalCaptured,
    avgGameDurationMs: completed ? Math.round(totalDuration / completed) : 0,
    avgMovesPerFinishedGame: completed ? Math.round(totalFinishedMoves / completed) : 0,
    topCaptures,
    recentFinished: finishedGames.slice(-10).reverse(),
  };
}

function getRequestLang(request) {
  const header = String(request.headers["accept-language"] || "").toLowerCase();
  return header.startsWith("ru") ? "ru" : "en";
}

function st(lang, key) {
  return (SERVER_TEXT[lang] && SERVER_TEXT[lang][key]) || SERVER_TEXT.en[key] || key;
}

function renderStatsPage(stats, lang = "en") {
  const rows = [
    [st(lang, "visits"), stats.counts.visit || 0],
    [st(lang, "uniqueBrowsers"), stats.visitors],
    [st(lang, "createdRooms"), stats.roomsCreated],
    [st(lang, "joinedRooms"), stats.roomsJoined],
    [st(lang, "totalMoves"), stats.totalMoves],
    [st(lang, "totalCaptured"), stats.totalCaptured],
    [st(lang, "completedGames"), stats.completed],
    [st(lang, "avgDuration"), formatDuration(stats.avgGameDurationMs, lang)],
    [st(lang, "avgMoves"), stats.avgMovesPerFinishedGame],
  ];

  const topRows = stats.topCaptures.length
    ? stats.topCaptures.map((item, index) => `<tr><td>${index + 1}. ${escapeHtml(item.nick)}</td><td>${item.captured}</td></tr>`).join("")
    : `<tr><td colspan="2">${st(lang, "noCaptures")}</td></tr>`;

  const finishedRows = stats.recentFinished.length
    ? stats.recentFinished.map((event) => {
      const winner = event.winner === "draw" ? "draw" : event.winner === Rules.PLAYER_RED ? st(lang, "red") : st(lang, "blue");
      return `<tr><td>${escapeHtml(event.roomId)}</td><td>${escapeHtml(event.size)}</td><td>${winner}</td><td>${event.redScore}:${event.blueScore}</td><td>${event.moves}</td><td>${formatDuration(event.durationMs, lang)}</td></tr>`;
    }).join("")
    : `<tr><td colspan="6">${st(lang, "noFinished")}</td></tr>`;

  return `<!doctype html>
<html lang="${lang}">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${st(lang, "statsTitle")}</title>
    <style>
      body { margin: 0; padding: 24px; color: #17211d; background: #fbfcf8; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      main { width: min(980px, 100%); margin: 0 auto; }
      h1 { margin: 0 0 6px; font-size: 2rem; }
      p { color: #637069; }
      section { margin-top: 18px; }
      table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #cfd8d2; border-radius: 8px; overflow: hidden; }
      th, td { padding: 10px 12px; border-bottom: 1px solid #e2e8e3; text-align: left; }
      th { background: #edf4ef; }
      tr:last-child td { border-bottom: 0; }
      a { color: #2079a8; }
      @media (max-width: 720px) { body { padding: 12px; } th, td { padding: 8px; font-size: 0.9rem; } h1 { font-size: 1.45rem; } }
    </style>
  </head>
  <body>
    <main>
      <h1>${st(lang, "statsTitle")}</h1>
      <p>${st(lang, "updated")}: ${formatDate(stats.generatedAt, lang)}. <a href="/">${st(lang, "back")}</a></p>
      <section>
        <h2>${st(lang, "funnel")}</h2>
        <table>
          <tbody>
            ${rows.map(([label, value]) => `<tr><td>${label}</td><td><strong>${value}</strong></td></tr>`).join("")}
          </tbody>
        </table>
      </section>
      <section>
        <h2>${st(lang, "topCaptures")}</h2>
        <table><tbody>${topRows}</tbody></table>
      </section>
      <section>
        <h2>${st(lang, "recentFinished")}</h2>
        <table>
          <thead><tr><th>${st(lang, "room")}</th><th>${st(lang, "board")}</th><th>${st(lang, "result")}</th><th>${st(lang, "score")}</th><th>${st(lang, "moves")}</th><th>${st(lang, "time")}</th></tr></thead>
          <tbody>${finishedRows}</tbody>
        </table>
      </section>
    </main>
  </body>
</html>`;
}

function formatDuration(ms, lang = "en") {
  const seconds = Math.max(0, Math.round(Number(ms || 0) / 1000));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes > 0 ? `${minutes} ${st(lang, "minutes")} ${rest} ${st(lang, "seconds")}` : `${rest} ${st(lang, "seconds")}`;
}

function formatDate(value, lang = "en") {
  return new Date(value).toLocaleString(lang === "ru" ? "ru-RU" : "en-US");
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function createRoomId() {
  let id = createId(5).toUpperCase();
  while (rooms.has(id)) {
    id = createId(5).toUpperCase();
  }
  return id;
}

function createId(length) {
  return crypto
    .randomBytes(length)
    .toString("base64")
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, length);
}

function serveStatic(response, pathname) {
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, safePath));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendText(response, 403, "Forbidden");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      sendText(response, 404, "Not found");
      return;
    }

    response.writeHead(200, {
      "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    response.end(content);
  });
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        request.destroy();
      }
    });
    request.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(new Error("Could not parse JSON."));
      }
    });
    request.on("error", reject);
  });
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

function sendText(response, status, text) {
  response.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
  });
  response.end(text);
}

function sendHtml(response, status, html) {
  response.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(html);
}

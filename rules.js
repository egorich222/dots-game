(function initRules(root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.DotsRules = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : window, function createRules() {
  const PLAYER_RED = "red";
  const PLAYER_BLUE = "blue";
  const BOARD_SIZES = {
    small: { label: "Маленькое", cols: 11, rows: 9 },
    medium: { label: "Среднее", cols: 17, rows: 13 },
    large: { label: "Большое", cols: 25, rows: 19 },
  };
  const DEFAULT_SIZE = "medium";

  function getBoardSize(sizeName) {
    return BOARD_SIZES[sizeName] || BOARD_SIZES[DEFAULT_SIZE];
  }

  function normalizeSizeName(sizeName) {
    return BOARD_SIZES[sizeName] ? sizeName : DEFAULT_SIZE;
  }

  function makeBoard(sizeName = DEFAULT_SIZE) {
    const size = getBoardSize(sizeName);
    return Array.from({ length: size.rows }, () => Array.from({ length: size.cols }, () => null));
  }

  function createState(sizeName = DEFAULT_SIZE) {
    const normalizedSize = normalizeSizeName(sizeName);
    const size = getBoardSize(normalizedSize);
    return {
      sizeName: normalizedSize,
      cols: size.cols,
      rows: size.rows,
      dots: makeBoard(normalizedSize),
      currentPlayer: PLAYER_RED,
      captureZones: [],
      blockedPoints: {},
      capturedByPoint: {},
      moves: 0,
      lastMove: null,
      gameOver: false,
      winner: null,
      finalScore: null,
      remainingMoves: size.cols * size.rows,
    };
  }

  function pointKey(x, y) {
    return `${x},${y}`;
  }

  function otherPlayer(player) {
    return player === PLAYER_RED ? PLAYER_BLUE : PLAYER_RED;
  }

  function isInsideBoard(state, x, y) {
    return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < state.cols && y < state.rows;
  }

  function getBlockedOwner(state, x, y) {
    return state.blockedPoints[pointKey(x, y)] || null;
  }

  function canPlayAt(state, x, y) {
    return !state.gameOver && isInsideBoard(state, x, y) && !state.dots[y][x] && !getBlockedOwner(state, x, y);
  }

  function applyMove(state, player, x, y) {
    if (state.gameOver) {
      return {
        ok: false,
        reason: "Партия уже завершена.",
      };
    }

    if (player !== state.currentPlayer) {
      return {
        ok: false,
        reason: "Сейчас ход другого игрока.",
      };
    }

    if (!isInsideBoard(state, x, y)) {
      return {
        ok: false,
        reason: "Ход вне поля.",
      };
    }

    if (!canPlayAt(state, x, y)) {
      const blockedOwner = getBlockedOwner(state, x, y);
      const ownerName = blockedOwner === PLAYER_RED ? "красными" : "синими";
      return {
        ok: false,
        reason: blockedOwner
          ? `Эта область уже окружена ${ownerName}. Внутри нее ходы запрещены.`
          : "На этом пересечении уже стоит точка.",
      };
    }

    const previousCaptured = countCaptured(state);
    state.dots[y][x] = player;
    state.moves += 1;
    state.lastMove = { player, x, y };
    recalculateCaptures(state);
    const nextCaptured = countCaptured(state);
    const gained = {
      red: nextCaptured.red - previousCaptured.red,
      blue: nextCaptured.blue - previousCaptured.blue,
    };
    state.currentPlayer = otherPlayer(player);
    updateGameStatus(state);

    return {
      ok: true,
      gained,
      captured: nextCaptured,
      gameOver: state.gameOver,
      winner: state.winner,
      finalScore: state.finalScore,
      remainingMoves: state.remainingMoves,
    };
  }

  function countCaptured(state) {
    const result = {
      red: 0,
      blue: 0,
    };

    for (const owner of Object.values(state.capturedByPoint)) {
      if (owner === PLAYER_RED || owner === PLAYER_BLUE) {
        result[owner] += 1;
      }
    }

    return result;
  }

  function recalculateCaptures(state) {
    const zones = [
      ...findCaptureZones(state, PLAYER_RED),
      ...findCaptureZones(state, PLAYER_BLUE),
    ];

    const nextBlocked = {};
    const nextCaptured = {};

    for (const zone of zones) {
      for (const key of zone.points) {
        nextBlocked[key] = zone.owner;
      }
      for (const key of zone.capturedDots) {
        if (!nextCaptured[key]) {
          nextCaptured[key] = zone.owner;
        }
      }
    }

    state.captureZones = zones;
    state.blockedPoints = nextBlocked;
    state.capturedByPoint = nextCaptured;
    state.remainingMoves = countLegalMoves(state);
  }

  function countLegalMoves(state) {
    if (state.gameOver) {
      return 0;
    }

    let total = 0;
    for (let y = 0; y < state.rows; y += 1) {
      for (let x = 0; x < state.cols; x += 1) {
        if (!state.dots[y][x] && !getBlockedOwner(state, x, y)) {
          total += 1;
        }
      }
    }
    return total;
  }

  function updateGameStatus(state) {
    state.remainingMoves = countLegalMoves(state);
    if (state.remainingMoves > 0) {
      state.gameOver = false;
      state.winner = null;
      state.finalScore = null;
      return;
    }

    const captured = countCaptured(state);
    state.gameOver = true;
    state.finalScore = captured;
    if (captured.red > captured.blue) {
      state.winner = PLAYER_RED;
    } else if (captured.blue > captured.red) {
      state.winner = PLAYER_BLUE;
    } else {
      state.winner = "draw";
    }
  }

  function getResultText(state) {
    const score = state.finalScore || countCaptured(state);
    if (!state.gameOver) {
      return "";
    }
    if (state.winner === "draw") {
      return `Партия завершена. Ничья: ${score.red}:${score.blue}.`;
    }
    const winnerName = state.winner === PLAYER_RED ? "Красные" : "Синие";
    return `Партия завершена. Победили ${winnerName}: ${score.red}:${score.blue}.`;
  }

  function findCaptureZones(state, owner) {
    const opponent = otherPlayer(owner);
    const mask = buildWallMask(state, owner);
    const outside = floodOutside(mask);
    const zones = [];
    const visited = new Uint8Array(mask.width * mask.height);

    for (let y = 0; y < mask.height; y += 1) {
      for (let x = 0; x < mask.width; x += 1) {
        const index = y * mask.width + x;
        if (mask.wall[index] || outside[index] || visited[index]) {
          continue;
        }

        const component = collectComponent(mask, outside, visited, x, y);
        const points = [];
        const capturedDots = [];

        for (let py = 0; py < state.rows; py += 1) {
          for (let px = 0; px < state.cols; px += 1) {
            const sample = logicalToMask(mask, px, py);
            const sampleIndex = sample.y * mask.width + sample.x;
            if (!component.has(sampleIndex)) {
              continue;
            }

            const key = pointKey(px, py);
            points.push(key);
            if (state.dots[py][px] === opponent) {
              capturedDots.push(key);
            }
          }
        }

        if (capturedDots.length > 0) {
          zones.push({
            owner,
            points,
            capturedDots,
          });
        }
      }
    }

    return zones;
  }

  function neighbors8(state, x, y) {
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

  function buildWallMask(state, owner) {
    const scale = 10;
    const pad = 12;
    const width = (state.cols - 1) * scale + pad * 2 + 1;
    const height = (state.rows - 1) * scale + pad * 2 + 1;
    const wall = new Uint8Array(width * height);

    const setWall = (x, y, radius = 2) => {
      for (let yy = y - radius; yy <= y + radius; yy += 1) {
        for (let xx = x - radius; xx <= x + radius; xx += 1) {
          if (xx < 0 || yy < 0 || xx >= width || yy >= height) {
            continue;
          }
          if (Math.hypot(xx - x, yy - y) <= radius) {
            wall[yy * width + xx] = 1;
          }
        }
      }
    };

    const drawLine = (ax, ay, bx, by) => {
      const steps = Math.max(Math.abs(bx - ax), Math.abs(by - ay));
      for (let i = 0; i <= steps; i += 1) {
        const t = steps === 0 ? 0 : i / steps;
        const x = Math.round(ax + (bx - ax) * t);
        const y = Math.round(ay + (by - ay) * t);
        setWall(x, y, 2);
      }
    };

    for (let y = 0; y < state.rows; y += 1) {
      for (let x = 0; x < state.cols; x += 1) {
        if (state.dots[y][x] !== owner) {
          continue;
        }

        const a = logicalToMask({ scale, pad }, x, y);
        setWall(a.x, a.y, 2);

        for (const n of neighbors8(state, x, y)) {
          if (state.dots[n.y][n.x] !== owner) {
            continue;
          }
          const b = logicalToMask({ scale, pad }, n.x, n.y);
          drawLine(a.x, a.y, b.x, b.y);
        }
      }
    }

    return { wall, width, height, scale, pad };
  }

  function logicalToMask(mask, x, y) {
    return {
      x: mask.pad + x * mask.scale,
      y: mask.pad + y * mask.scale,
    };
  }

  function floodOutside(mask) {
    const outside = new Uint8Array(mask.width * mask.height);
    const queue = [];
    const push = (x, y) => {
      if (x < 0 || y < 0 || x >= mask.width || y >= mask.height) {
        return;
      }
      const index = y * mask.width + x;
      if (mask.wall[index] || outside[index]) {
        return;
      }
      outside[index] = 1;
      queue.push(index);
    };

    for (let x = 0; x < mask.width; x += 1) {
      push(x, 0);
      push(x, mask.height - 1);
    }
    for (let y = 0; y < mask.height; y += 1) {
      push(0, y);
      push(mask.width - 1, y);
    }

    for (let head = 0; head < queue.length; head += 1) {
      const index = queue[head];
      const x = index % mask.width;
      const y = Math.floor(index / mask.width);
      push(x + 1, y);
      push(x - 1, y);
      push(x, y + 1);
      push(x, y - 1);
    }

    return outside;
  }

  function collectComponent(mask, outside, visited, startX, startY) {
    const queue = [];
    const component = new Set();
    const push = (x, y) => {
      if (x < 0 || y < 0 || x >= mask.width || y >= mask.height) {
        return;
      }
      const index = y * mask.width + x;
      if (mask.wall[index] || outside[index] || visited[index]) {
        return;
      }
      visited[index] = 1;
      component.add(index);
      queue.push(index);
    };

    push(startX, startY);

    for (let head = 0; head < queue.length; head += 1) {
      const index = queue[head];
      const x = index % mask.width;
      const y = Math.floor(index / mask.width);
      push(x + 1, y);
      push(x - 1, y);
      push(x, y + 1);
      push(x, y - 1);
    }

    return component;
  }

  return {
    BOARD_SIZES,
    DEFAULT_SIZE,
    PLAYER_RED,
    PLAYER_BLUE,
    createState,
    getBoardSize,
    normalizeSizeName,
    pointKey,
    otherPlayer,
    canPlayAt,
    getBlockedOwner,
    applyMove,
    countCaptured,
    countLegalMoves,
    updateGameStatus,
    getResultText,
  };
});

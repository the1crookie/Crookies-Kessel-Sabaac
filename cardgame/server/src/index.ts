import express from "express";
import http from "http";
import path from "path";
import { Server } from "socket.io";
import { makeDeck, drawCard } from "./game";
import { Room, Card, PendingImposter } from "./types";

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const rooms = new Map<string, Room>();

function formatTime(ts: number) {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

io.on("connection", (socket) => {
  console.log("client connected:", socket.id);

  socket.on("createRoom", ({ roomId, name, chips }, cb) => {
    if (rooms.has(roomId)) return cb({ error: "room exists" });

    const room: Room = {
      id: roomId,
      players: [
        {
          id: socket.id,
          name,
          chipsTotal: chips,
          initialChips: chips,
          chipsAnted: 0,
          hand: [],
        },
      ],
      deckRed: makeDeck("red"),
      deckYellow: makeDeck("yellow"),
      discardRed: [],
      discardYellow: [],
      currentTurnPlayerIndex: 0,
      startingPlayerIndex: 0,          // added
      roundNumber: 0,
      turnsThisRound: 0,
      phase: "waiting",
      gameLog: [],
    };

    rooms.set(roomId, room);
    socket.join(roomId);
    io.to(roomId).emit("roomUpdate", room);

    room.gameLog.push({
      playerId: "system",
      playerName: "system",
      message: `Room ${roomId} created by ${name} (starting chips: ${chips})`,
      timestamp: Date.now(),
      timeFormatted: formatTime(Date.now()),
    });

    cb({ ok: true });
  });

  socket.on("joinRoom", ({ roomId, name, chips }, cb) => {
    let room = rooms.get(roomId);

    if (room && room.players.length === 0) {
      rooms.delete(roomId);
      room = undefined;
    }

    if (!room) return cb({ error: "room does not exist, please create it first" });
    if (room.phase !== "waiting") return cb({ error: "game already started" });
    if (room.players.find((p) => p.id === socket.id)) return cb({ error: "already joined" });

    const hostChips = room.players[0]?.initialChips ?? chips;

    room.players.push({
      id: socket.id,
      name,
      chipsTotal: hostChips,
      initialChips: hostChips,
      chipsAnted: 0,
      hand: [],
    });
    socket.join(roomId);

    room.gameLog.push({
      playerId: socket.id,
      playerName: name,
      message: `${name} joined the room (starting chips: ${hostChips})`,
      timestamp: Date.now(),
      timeFormatted: formatTime(Date.now()),
    });

    io.to(roomId).emit("roomUpdate", room);
    cb({ ok: true });
  });

  socket.on("startGame", ({ roomId }, cb) => {
    const room = rooms.get(roomId);
    if (!room) return cb({ error: "no room" });

    startNewRound(room);
    io.to(roomId).emit("roomUpdate", room);

    room.gameLog.push({
      playerId: "system",
      playerName: "system",
      message: "Game started",
      timestamp: Date.now(),
      timeFormatted: formatTime(Date.now()),
    });

    cb({ ok: true });
  });

  socket.on("drawCard", ({ roomId, color, source }, cb) => {
    const room = rooms.get(roomId);
    if (!room) return cb({ error: "no room" });

    const player = room.players[room.currentTurnPlayerIndex];
    if (player.id !== socket.id) return cb({ error: "not your turn" });

    let drawn: Card | undefined;
    if (source === "deck") drawn = color === "red" ? drawCard(room.deckRed) : drawCard(room.deckYellow);
    else if (source === "discard") drawn = color === "red" ? room.discardRed.pop() : room.discardYellow.pop();

    if (!drawn) return cb({ error: "no card available" });
    if (player.chipsTotal <= 0) return cb({ error: "no chips" });

    player.chipsTotal -= 1;
    player.chipsAnted += 1;
    player.hand.push(drawn);

    room.gameLog.push({
      playerId: player.id,
      playerName: player.name,
      message: `${player.name} drew a ${color} card from ${source}`,
      timestamp: Date.now(),
      timeFormatted: formatTime(Date.now()),
    });

    io.to(roomId).emit("roomUpdate", room);
    cb({ ok: true });
  });

  socket.on("discardCard", ({ roomId, discardIndex }, cb) => {
    const room = rooms.get(roomId);
    if (!room) return cb({ error: "no room" });

    const player = room.players[room.currentTurnPlayerIndex];
    if (player.id !== socket.id) return cb({ error: "not your turn" });
    if (discardIndex < 0 || discardIndex >= player.hand.length) return cb({ error: "invalid discard index" });

    const discardCard = player.hand.splice(discardIndex, 1)[0];
    if (discardCard.color === "red") room.discardRed.push(discardCard);
    else room.discardYellow.push(discardCard);

    room.turnsThisRound = (room.turnsThisRound ?? 0) + 1;

    room.gameLog.push({
      playerId: player.id,
      playerName: player.name,
      message: `${player.name} discarded a ${discardCard.color} ${discardCard.value}`,
      timestamp: Date.now(),
      timeFormatted: formatTime(Date.now()),
    });

    if (room.turnsThisRound >= room.players.length * 3) {
      beginImposterPhase(room, roomId);
      return cb({ ok: true });
    }

    room.currentTurnPlayerIndex = (room.currentTurnPlayerIndex + 1) % room.players.length;
    if (room.currentTurnPlayerIndex === room.startingPlayerIndex) room.roundNumber++;

    io.to(roomId).emit("roomUpdate", room);
    cb({ ok: true });
  });

  socket.on("resolveMysteryCards", ({ roomId, chosenValue, cardId }, cb) => {
    const room = rooms.get(roomId);
    if (!room) return cb({ error: "no room" });

    const player = room.players.find((p) => p.id === socket.id);
    if (!player || !player.pendingImposters || player.pendingImposters.length === 0)
      return cb({ error: "no active imposters" });

    const activeImposter = player.pendingImposters.find((pi) => pi.active);
    if (!activeImposter) return cb({ error: "no active imposter" });

    const card = player.hand.find((c) => c.id === activeImposter.cardId);
    if (!card) return cb({ error: "card not found" });
    card.value = chosenValue;

    player.pendingImposters = player.pendingImposters.filter(
      (pi) => pi.cardId !== activeImposter.cardId
    );

    room.gameLog.push({
      playerId: player.id,
      playerName: player.name,
      message: `${player.name} resolved a mystery card to ${chosenValue}`,
      timestamp: Date.now(),
      timeFormatted: formatTime(Date.now()),
    });

    if (player.pendingImposters.length > 0) player.pendingImposters[0].active = true;

    const anyPending = room.players.some(
      (p) => p.pendingImposters && p.pendingImposters.length > 0
    );

    if (!anyPending) {
      room.phase = "reveal";
      room.players.forEach((p) => {
        const sylopsCard = p.hand.find((c) => c.value === "Sylops" || c.type === "Sylops");
        if (sylopsCard) {
          const otherCard = p.hand.find((c) => c.id !== sylopsCard.id);
          if (otherCard) sylopsCard.value = otherCard.value;
        }
      });
      handleScoring(room);
    }

    io.to(roomId).emit("roomUpdate", room);
    cb({ ok: true });
  });

  socket.on("stand", ({ roomId }, cb) => {
    const room = rooms.get(roomId);
    if (!room) return cb({ error: "no room" });

    const player = room.players[room.currentTurnPlayerIndex];
    if (player.id !== socket.id) return cb({ error: "not your turn" });

    room.turnsThisRound = (room.turnsThisRound ?? 0) + 1;

    room.gameLog.push({
      playerId: player.id,
      playerName: player.name,
      message: `${player.name} stands`,
      timestamp: Date.now(),
      timeFormatted: formatTime(Date.now()),
    });

    if (room.turnsThisRound >= room.players.length * 3) {
      beginImposterPhase(room, roomId);
      return cb({ ok: true });
    }

    room.currentTurnPlayerIndex = (room.currentTurnPlayerIndex + 1) % room.players.length;
    if (room.currentTurnPlayerIndex === room.startingPlayerIndex) room.roundNumber++;

    io.to(roomId).emit("roomUpdate", room);
    cb({ ok: true });
  });

  socket.on("nextRound", ({ roomId }, cb) => {
    const room = rooms.get(roomId);
    if (!room) return cb({ error: "no room" });

    startNewRound(room);

    room.gameLog.push({
      playerId: "system",
      playerName: "system",
      message: "Players advanced to next round manually.",
      timestamp: Date.now(),
      timeFormatted: formatTime(Date.now()),
    });

    io.to(roomId).emit("roomUpdate", room);
    cb({ ok: true });
  });

  socket.on("playAgain", ({ roomId }, cb) => {
    const room = rooms.get(roomId);
    if (!room) return cb({ error: "no room" });

    room.phase = "waiting";
    room.roundNumber = 0;
    room.turnsThisRound = 0;
    room.winnerId = undefined;
    room.grandWinnerId = undefined;
    room.deckRed = makeDeck("red");
    room.deckYellow = makeDeck("yellow");
    room.discardRed = [];
    room.discardYellow = [];
    room.startingPlayerIndex = 0;
    room.currentTurnPlayerIndex = 0;

    room.players.forEach((p) => {
      p.hand = [];
      p.chipsAnted = 0;
      p.pendingImposters = [];
      p.roundScore = undefined;
    });

    room.gameLog.push({
      playerId: "system",
      playerName: "system",
      message: "Game restarted using previous settings.",
      timestamp: Date.now(),
      timeFormatted: formatTime(Date.now()),
    });

    io.to(roomId).emit("roomUpdate", room);
    cb({ ok: true });
  });

  socket.on("remakeRoom", ({ roomId }, cb) => {
    const oldRoom = rooms.get(roomId);
    if (!oldRoom) return cb({ error: "no room found" });

    const previousPlayers = oldRoom.players.map(p => ({
      id: p.id,
      name: p.name,
      chipsTotal: p.initialChips ?? 8,
      chipsAnted: 0,
      hand: [],
    }));

    const newRoom: Room = {
      id: roomId,
      players: previousPlayers,
      deckRed: makeDeck("red"),
      deckYellow: makeDeck("yellow"),
      discardRed: [],
      discardYellow: [],
      currentTurnPlayerIndex: 0,
      startingPlayerIndex: 0,
      roundNumber: 0,
      turnsThisRound: 0,
      phase: "waiting",
      gameLog: [...oldRoom.gameLog],
    };

    newRoom.gameLog.push({
      playerId: "system",
      playerName: "system",
      message: "Game restarted with same settings.",
      timestamp: Date.now(),
      timeFormatted: formatTime(Date.now()),
    });

    rooms.set(roomId, newRoom);
    io.to(roomId).emit("roomUpdate", newRoom);
    cb({ ok: true });
  });

  socket.on("disconnect", () => {
    for (const [roomId, room] of rooms) {
      const leavingIndex = room.players.findIndex(p => p.id === socket.id);
      const wasStartingPlayer = leavingIndex === room.startingPlayerIndex;

      room.players = room.players.filter((p) => p.id !== socket.id);

      if (room.players.length === 0) {
        rooms.delete(roomId);
        continue;
      }

      if (leavingIndex >= 0) {
        if (leavingIndex < room.startingPlayerIndex) {
          room.startingPlayerIndex = (room.startingPlayerIndex - 1 + room.players.length) % room.players.length;
        }
        if (wasStartingPlayer) {
          room.startingPlayerIndex = room.startingPlayerIndex % room.players.length;
        }
        room.currentTurnPlayerIndex = room.startingPlayerIndex;
      }

      io.to(roomId).emit("roomUpdate", room);
    }
  });
});

function beginImposterPhase(room: Room, roomId: string) {
  room.players.forEach((p) => {
    const imposters: PendingImposter[] = p.hand
      .filter((c) => c.value === "Imposter")
      .map((c, i) => ({
        cardId: c.id,
        rolls: [
          Math.ceil(Math.random() * 6),
          Math.ceil(Math.random() * 6),
        ],
        active: i === 0,
      }));
    p.pendingImposters = imposters;
  });

  const anyImposters = room.players.some(
    (p) => (p.pendingImposters ?? []).length > 0
  );

  if (!anyImposters) {
    room.phase = "reveal";
    room.players.forEach((p) => {
      const sylopsCard = p.hand.find(
        (c) => c.value === "Sylops" || c.type === "Sylops"
      );
      if (sylopsCard) {
        const otherCard = p.hand.find((c) => c.id !== sylopsCard.id);
        if (otherCard) sylopsCard.value = otherCard.value;
      }
    });
    handleScoring(room);

    room.gameLog.push({
      playerId: "system",
      playerName: "system",
      message: "No imposter cards. Proceeding to reveal phase.",
      timestamp: Date.now(),
      timeFormatted: formatTime(Date.now()),
    });

    io.to(roomId).emit("roomUpdate", room);
    return;
  }

  room.phase = "imposterRoll";
  room.turnsThisRound = 0;

  room.gameLog.push({
    playerId: "system",
    playerName: "system",
    message: "Imposter phase started.",
    timestamp: Date.now(),
    timeFormatted: formatTime(Date.now()),
  });

  io.to(roomId).emit("roomUpdate", room);
}

function handleScoring(room: Room) {
  type HandScore = {
    id: string;
    isSylopsPair: boolean;
    pairValue?: number;
    diff?: number;
    lowTotal?: number;
  };

  const scores: HandScore[] = room.players.map((p) => {
    const values = p.hand.map((c) => {
      if (c.value === "Sylops") return "Sylops";
      return parseInt(c.value as any) || 0;
    });

    const isSylopsPair = values.every((v) => v === "Sylops");
    if (isSylopsPair) return { id: p.id, isSylopsPair };

    const numericValues = values.map((v) => (v === "Sylops" ? 0 : (v as number)));
    numericValues.sort((a, b) => a - b);

    let pairValue: number | undefined;
    if (numericValues[0] === numericValues[1]) pairValue = numericValues[0];

    const diff = numericValues[1] - numericValues[0];
    const lowTotal = numericValues[0] + numericValues[1];

    return { id: p.id, isSylopsPair, pairValue, diff, lowTotal };
  });

  let winningPlayers: HandScore[] = [];
  const sylopsPlayers = scores.filter((s) => s.isSylopsPair);
  if (sylopsPlayers.length) winningPlayers = sylopsPlayers;
  else {
    const pairs = scores.filter((s) => s.pairValue !== undefined);
    if (pairs.length) {
      const minPair = Math.min(...pairs.map((p) => p.pairValue!));
      winningPlayers = pairs.filter((p) => p.pairValue === minPair);
    } else {
      const minDiff = Math.min(...scores.map((s) => s.diff!));
      const candidates = scores.filter((s) => s.diff === minDiff);
      const minLowTotal = Math.min(...candidates.map((c) => c.lowTotal!));
      winningPlayers = candidates.filter((c) => c.lowTotal === minLowTotal);
    }
  }

  room.winnerId = winningPlayers.map((w) => w.id).join(",");

  room.players.forEach((p) => {
    if (!winningPlayers.some((w) => w.id === p.id)) {
      const playerScore = scores.find((s) => s.id === p.id)!;
      if (playerScore.pairValue === undefined) {
        p.chipsTotal -= playerScore.diff!;
        if (p.chipsTotal < 0) p.chipsTotal = 0;
      }
    }
  });

  room.players.forEach((p) => {
    if (winningPlayers.some((w) => w.id === p.id)) {
      p.chipsTotal += p.chipsAnted;
    }
  });

  room.players.forEach((p) => {
    const playerScore = scores.find((s) => s.id === p.id)!;
    if (playerScore.pairValue !== undefined) p.roundScore = playerScore.pairValue;
    else p.roundScore = playerScore.diff!;
  });

  room.players.forEach((p) => (p.chipsAnted = 0));

  const winnerNames = winningPlayers
    .map((p) => room.players.find((pl) => pl.id === p.id)!.name)
    .join(", ");

  room.gameLog.push({
    playerId: "system",
    playerName: "system",
    message: `Round ended. Winners: ${winnerNames}`,
    timestamp: Date.now(),
    timeFormatted: formatTime(Date.now()),
  });

  room.players.forEach((p) => {
    room.gameLog.push({
      playerId: p.id,
      playerName: p.name,
      message: `${p.name} now has ${p.chipsTotal} chips.`,
      timestamp: Date.now(),
      timeFormatted: formatTime(Date.now()),
    });
  });

  const stillIn = room.players.filter((p) => p.chipsTotal > 0);
  if (stillIn.length === 1) {
    const grandWinner = stillIn[0];
    room.phase = "gameOver";
    room.grandWinnerId = grandWinner.id;

    room.gameLog.push({
      playerId: "system",
      playerName: "system",
      message: `Grand Winner: ${grandWinner.name}!`,
      timestamp: Date.now(),
      timeFormatted: formatTime(Date.now()),
    });

    return;
  }
}

function startNewRound(room: Room) {
  room.phase = "playing";
  room.roundNumber++;

  if (room.roundNumber === 1) {
    room.startingPlayerIndex = 0;
  } else {
    room.startingPlayerIndex = (room.startingPlayerIndex + 1) % room.players.length;
  }

  room.currentTurnPlayerIndex = room.startingPlayerIndex;

  room.turnsThisRound = 0;
  room.winnerId = undefined;

  room.deckRed = makeDeck("red");
  room.deckYellow = makeDeck("yellow");
  room.discardRed = [];
  room.discardYellow = [];

  room.players.forEach((p) => {
    p.hand = [];
    p.chipsAnted = 0;
    p.pendingImposters = [];
    p.roundScore = undefined;
  });

  const topRed = drawCard(room.deckRed);
  const topYellow = drawCard(room.deckYellow);
  if (topRed) room.discardRed.push(topRed);
  if (topYellow) room.discardYellow.push(topYellow);

  room.players.forEach((p) => {
    const redCard = drawCard(room.deckRed);
    const yellowCard = drawCard(room.deckYellow);
    if (redCard) p.hand.push(redCard);
    if (yellowCard) p.hand.push(yellowCard);
  });

  room.gameLog.push({
    playerId: "system",
    playerName: "system",
    message: `Round ${room.roundNumber} started. First player: ${room.players[room.startingPlayerIndex].name}`,
    timestamp: Date.now(),
    timeFormatted: formatTime(Date.now()),
  });
}

{
  const buildPath = path.join(__dirname, "../client/dist");
  app.use(express.static(buildPath));

  app.use((req, res) => {
    res.sendFile(path.join(buildPath, "index.html"));
  });
}

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));

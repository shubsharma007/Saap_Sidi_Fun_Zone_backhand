const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

/**
 * rooms[roomId] = {
 *   roomId,
 *   roomName,
 *   creatorId,
 *   maxPlayers,
 *   password,
 *   started,
 *   players: [{ id, name }]
 * }
 */
const rooms = {};

/* ================= ROOM LIST ================= */
function emitRoomList() {
  io.sockets.sockets.forEach(sock => {
    const list = Object.values(rooms)
      .filter(r => r.creatorId !== sock.id)
      .map(r => ({
        roomId: r.roomId,
        roomName: r.roomName,
        currentPlayers: r.players.length,
        maxPlayers: r.maxPlayers,
        hasPassword: r.password !== null
      }));

    sock.emit("room_list", list);
  });
}

/* ================= HEALTH ================= */
app.get("/", (_, res) => {
  res.send("✅ Saap Sidi Socket Server Running");
});

/* ================= SOCKET ================= */
io.on("connection", socket => {
  console.log("🔗 Connected:", socket.id);

  /* ===== CREATE ROOM ===== */
  socket.on("create_room", ({ roomName, password, maxPlayers, playerName }) => {

    if (![2, 3, 4].includes(maxPlayers)) {
      socket.emit("error_message", "Invalid player size");
      return;
    }

    const roomId = Math.random()
      .toString(36)
      .substring(2, 8)
      .toUpperCase();

    rooms[roomId] = {
      roomId,
      roomName: roomName?.trim() || "Room",
      creatorId: socket.id,
      maxPlayers,
      password: password?.length ? password : null,
      started: false,
      players: [
        { id: socket.id, name: playerName || "Player" }
      ]
    };

    socket.join(roomId);

    console.log(`🟢 Room created: ${roomId}`);

    socket.emit("room_created", {
      roomId,
      roomName: rooms[roomId].roomName,
      maxPlayers,
      password: password || ""
    });

    io.to(roomId).emit("player_list_update", {
      players: rooms[roomId].players,
      maxPlayers
    });

    emitRoomList();
  });

  /* ===== GET ROOMS ===== */
  socket.on("get_rooms", emitRoomList);

  /* ===== JOIN ROOM ===== */
  socket.on("join_room", ({ roomId, password, playerName }) => {
    const room = rooms[roomId];

    if (!room) {
      socket.emit("join_failed", "Room not found");
      return;
    }

    // ❌ creator cannot re-join
    if (room.creatorId === socket.id) {
      socket.emit("join_failed", "Creator cannot join own room");
      return;
    }

    if (room.password && room.password !== password) {
      socket.emit("join_failed", "Wrong password");
      return;
    }

    if (room.players.length >= room.maxPlayers) {
      socket.emit("join_failed", "Room full");
      return;
    }

    room.players.push({
      id: socket.id,
      name: playerName || "Player"
    });

    socket.join(roomId);

    console.log(`👤 ${playerName} joined ${roomId}`);

    // ✅ IMPORTANT SUCCESS EVENT
    socket.emit("join_success", {
      roomId: room.roomId,
      roomName: room.roomName,
      maxPlayers: room.maxPlayers
    });

    io.to(roomId).emit("player_list_update", {
      players: room.players,
      maxPlayers: room.maxPlayers
    });

    emitRoomList();
  });

  /* ===== START GAME ===== */
  socket.on("start_game", ({ roomId }) => {
    const room = rooms[roomId];
    if (!room) return;

    if (room.creatorId !== socket.id) {
      socket.emit("error_message", "Only creator can start game");
      return;
    }

    if (room.players.length < 2) {
      socket.emit("error_message", "At least 2 players required");
      return;
    }

    room.started = true;

    console.log(`🎮 Game started: ${roomId}`);

    io.to(roomId).emit("game_started", {
      roomId,
      players: room.players
    });
  });

  /* ===== LEAVE ROOM ===== */
  socket.on("leave_room", ({ roomId }) => {
    const room = rooms[roomId];
    if (!room) return;

    if (room.creatorId === socket.id) {
      io.to(roomId).emit("room_destroyed");
      delete rooms[roomId];
      emitRoomList();
    }
  });

  /* ===== DISCONNECT ===== */
  socket.on("disconnect", () => {
    console.log("❌ Disconnected:", socket.id);

    for (const roomId in rooms) {
      const room = rooms[roomId];

      // 🔴 creator left → destroy room
      if (room.creatorId === socket.id) {
        io.to(roomId).emit("room_destroyed");
        delete rooms[roomId];
        continue;
      }

      // 🔹 normal player left
      const before = room.players.length;
      room.players = room.players.filter(p => p.id !== socket.id);

      if (room.players.length !== before) {
        io.to(roomId).emit("player_list_update", {
          players: room.players,
          maxPlayers: room.maxPlayers
        });
      }

      // 🧹 cleanup empty room
      if (room.players.length === 0) {
        delete rooms[roomId];
      }
    }

    emitRoomList();
  });
});

/* ================= START SERVER ================= */
const PORT = process.env.PORT || 3000;
server.listen(PORT, () =>
  console.log(`🚀 Server running on port ${PORT}`)
);

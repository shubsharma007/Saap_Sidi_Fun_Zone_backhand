const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

/**
 * rooms = {
 *   roomId: {
 *     roomId,
 *     roomName,
 *     creatorId,
 *     maxPlayers,
 *     password,
 *     started,
 *     players: [{ id, name }]
 *   }
 * }
 */
const rooms = {};

/* ================= ROOM LIST ================= */
function emitRoomList() {
  io.sockets.sockets.forEach(sock => {
    const list = Object.values(rooms)
      .filter(room => room.creatorId !== sock.id)
      .map(room => ({
        roomId: room.roomId,
        roomName: room.roomName,
        currentPlayers: room.players.length,
        maxPlayers: room.maxPlayers,
        hasPassword: room.password !== null
      }));

    sock.emit("room_list", list);
  });
}

/* ================= SOCKET ================= */
io.on("connection", socket => {
  console.log("🔗 Connected:", socket.id);

  /* ===== CREATE ROOM ===== */
  socket.on("create_room", ({ roomName, password, maxPlayers, playerName }) => {

    if (![2, 3, 4].includes(maxPlayers)) {
      socket.emit("error_message", "Invalid player size");
      return;
    }

    const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();

    const creatorPlayer = {
      id: socket.id,
      name: playerName || "Player"
    };

    rooms[roomId] = {
      roomId,
      roomName: roomName?.trim() || "Room",
      creatorId: socket.id,
      maxPlayers,
      password: password?.length ? password : null,
      started: false,
      players: [creatorPlayer]
    };

    socket.join(roomId);

    console.log(`🟢 Room created: ${roomId}`);

    // 🔹 Notify creator room created
    socket.emit("room_created", {
      roomId,
      roomName: rooms[roomId].roomName,
      maxPlayers,
      password: password || ""
    });

    // 🔥 NEW: creator is also a joined player
    io.to(roomId).emit("player_joined", {
      roomId,
      joinedPlayer: creatorPlayer,
      players: rooms[roomId].players,
      maxPlayers
    });

    // 🔹 Full list update
    io.to(roomId).emit("player_list_update", {
      players: rooms[roomId].players,
      maxPlayers
    });

    emitRoomList();
  });

  /* ===== JOIN ROOM ===== */
  socket.on("join_room", ({ roomId, password, playerName }) => {
    const room = rooms[roomId];

    if (!room) {
      socket.emit("join_failed", "Room not found");
      return;
    }

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

    const newPlayer = {
      id: socket.id,
      name: playerName || "Player"
    };

    room.players.push(newPlayer);
    socket.join(roomId);

    console.log(`👤 ${newPlayer.name} joined room ${roomId}`);

    // 🔥 MAIN EVENT: notify ALL users in room
    io.to(roomId).emit("player_joined", {
      roomId,
      joinedPlayer: newPlayer,
      players: room.players,
      maxPlayers: room.maxPlayers
    });

    // 🔹 Success only for joiner
    socket.emit("join_success", {
      roomId,
      roomName: room.roomName,
      maxPlayers: room.maxPlayers,
      players: room.players
    });

    // 🔹 Sync list
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
    for (const roomId in rooms) {
      const room = rooms[roomId];

      if (room.creatorId === socket.id) {
        io.to(roomId).emit("room_destroyed");
        delete rooms[roomId];
        continue;
      }

      const before = room.players.length;
      room.players = room.players.filter(p => p.id !== socket.id);

      if (room.players.length !== before) {
        io.to(roomId).emit("player_list_update", {
          players: room.players,
          maxPlayers: room.maxPlayers
        });
      }

      if (room.players.length === 0) {
        delete rooms[roomId];
      }
    }
    emitRoomList();
  });
});

/* ================= START SERVER ================= */
server.listen(3000, () =>
  console.log("🚀 Server running on port 3000")
);

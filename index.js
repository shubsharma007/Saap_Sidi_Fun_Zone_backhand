const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

/**
 * In-memory room storage
 */
const rooms = {};

/**
 * Send updated room list to ALL clients
 * (creator apna room nahi dekhega)
 */
function emitRoomList() {
  io.sockets.sockets.forEach((sock) => {
    const list = Object.values(rooms)
      .filter(r => r.creatorId !== sock.id)
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

/**
 * Health check
 */
app.get("/", (req, res) => {
  res.send("✅ Saap Sidi Socket Server Running");
});

/**
 * SOCKET CONNECTION
 */
io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  /* ---------------- CREATE ROOM ---------------- */
  socket.on("create_room", ({ maxPlayers, roomName, password }) => {

    if (![2, 3, 4].includes(maxPlayers)) return;

    const roomId = Math.random()
      .toString(36)
      .substring(2, 8)
      .toUpperCase();

    rooms[roomId] = {
      roomId,
      roomName: roomName?.trim() || "Room",
      creatorId: socket.id,
      players: [socket.id],
      maxPlayers,
      password: password?.length ? password : null,
      started: false
    };

    socket.join(roomId);

    console.log(`Room created: ${roomId} (${rooms[roomId].roomName})`);

    socket.emit("room_created", {
      roomId,
      roomName: rooms[roomId].roomName
    });

    emitRoomList();
  });

  /* ---------------- GET ROOMS ---------------- */
  socket.on("get_rooms", () => {
    emitRoomList();
  });

  /* ---------------- JOIN ROOM ---------------- */
  socket.on("join_room", ({ roomId, password }) => {
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

    room.players.push(socket.id);
    socket.join(roomId);

    console.log(`User ${socket.id} joined room ${roomId}`);

    io.to(roomId).emit("player_joined", {
      currentPlayers: room.players.length,
      roomName: room.roomName
    });

    emitRoomList();
  });

  /* ---------------- START GAME ---------------- */
  socket.on("start_game", ({ roomId }) => {
    const room = rooms[roomId];
    if (!room) return;

    if (room.creatorId !== socket.id) return;

    room.started = true;

    io.to(roomId).emit("game_started", {
      roomId,
      roomName: room.roomName,
      players: room.players
    });
  });

  /* ---------------- CREATOR LEAVES ROOM ---------------- */
  socket.on("leave_room", ({ roomId }) => {
    const room = rooms[roomId];
    if (!room) return;

    if (room.creatorId === socket.id) {
      console.log("Room destroyed by creator:", roomId);

      io.to(roomId).emit("room_destroyed", {
        reason: "creator_left"
      });

      delete rooms[roomId];
      emitRoomList();
    }
  });

  /* ---------------- DISCONNECT ---------------- */
  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);

    let changed = false;

    for (const roomId in rooms) {
      const room = rooms[roomId];

      // 🔴 Creator disconnect → destroy room
      if (room.creatorId === socket.id) {
        console.log("Room destroyed (creator disconnect):", roomId);

        io.to(roomId).emit("room_destroyed", {
          reason: "creator_disconnect"
        });

        delete rooms[roomId];
        changed = true;
        continue;
      }

      // 🔹 Normal player disconnect
      const before = room.players.length;
      room.players = room.players.filter(p => p !== socket.id);

      if (room.players.length !== before) {
        io.to(roomId).emit("player_left", {
          currentPlayers: room.players.length,
          roomName: room.roomName
        });
        changed = true;
      }

      if (room.players.length === 0) {
        delete rooms[roomId];
        changed = true;
      }
    }

    if (changed) {
      emitRoomList();
    }
  });
});

/**
 * START SERVER
 */
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

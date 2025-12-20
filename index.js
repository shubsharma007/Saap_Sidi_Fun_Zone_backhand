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
 * Test route
 */
app.get("/", (req, res) => {
  res.send("✅ Saap Sidi Socket Server Running");
});

/**
 * SOCKET CONNECTION
 */
io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  /**
   * CREATE ROOM
   * maxPlayers = 2 | 3 | 4
   */
  socket.on("create_room", ({ maxPlayers, password }) => {

    if (![2, 3, 4].includes(maxPlayers)) {
      socket.emit("error_message", "Invalid player size");
      return;
    }

    const roomId = Math.random()
      .toString(36)
      .substring(2, 8)
      .toUpperCase();

    rooms[roomId] = {
      creatorId: socket.id,
      players: [socket.id],
      maxPlayers: maxPlayers,
      password: password || null,
      started: false
    };

    socket.join(roomId);

    console.log(`Room ${roomId} created by ${socket.id}`);

    socket.emit("room_created", {
      roomId,
      maxPlayers
    });
  });

  /**
   * GET ROOM LIST
   */
  socket.on("get_rooms", () => {
    const roomList = Object.keys(rooms).map((roomId) => ({
      roomId,
      currentPlayers: rooms[roomId].players.length,
      maxPlayers: rooms[roomId].maxPlayers,
      hasPassword: rooms[roomId].password !== null
    }));

    socket.emit("room_list", roomList);
  });

  /**
   * JOIN ROOM
   */
  socket.on("join_room", ({ roomId, password }) => {
    const room = rooms[roomId];

    if (!room) {
      socket.emit("join_failed", "Room not found");
      return;
    }

    if (room.password && room.password !== password) {
      socket.emit("join_failed", "Wrong password");
      return;
    }

    if (room.players.length >= room.maxPlayers) {
      socket.emit("join_failed", "Room is full");
      return;
    }

    room.players.push(socket.id);
    socket.join(roomId);

    console.log(`User ${socket.id} joined room ${roomId}`);

    io.to(roomId).emit("player_joined", {
      currentPlayers: room.players.length,
      maxPlayers: room.maxPlayers,
      creatorId: room.creatorId
    });
  });

  /**
   * START GAME (ONLY CREATOR)
   */
  socket.on("start_game", ({ roomId }) => {
    const room = rooms[roomId];

    if (!room) return;

    if (room.creatorId !== socket.id) {
      socket.emit("error_message", "Only creator can start game");
      return;
    }

    if (room.players.length < room.maxPlayers) {
      socket.emit("error_message", "Waiting for players");
      return;
    }

    room.started = true;

    console.log(`Game started in room ${roomId}`);

    io.to(roomId).emit("game_started", {
      roomId,
      players: room.players
    });
  });

  /**
   * DISCONNECT
   */
  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);

    // Remove user from any room
    for (const roomId in rooms) {
      const room = rooms[roomId];
      room.players = room.players.filter(id => id !== socket.id);

      if (room.players.length === 0) {
        delete rooms[roomId]; // delete empty room
      } else {
        io.to(roomId).emit("player_left", {
          currentPlayers: room.players.length
        });
      }
    }
  });
});

/**
 * START SERVER
 */
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

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
 *     turnIndex,
 *     players: [{ id, name, pos }]
 *   }
 * }
 */
const rooms = {};


/* =============== ROOM LIST EMIT =============== */
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


  /* ========== CREATE ROOM ========== */
  socket.on("create_room", ({ roomName, password, maxPlayers, playerName, level,boardIndex}) => {

    if (![2, 3, 4].includes(maxPlayers)) {
      socket.emit("error_message", "Invalid player size");
      return;
    }

    const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();

    const creatorPlayer = {
      id: socket.id,
      name: playerName || "Player",
      pos: 0
    };
  
    rooms[roomId] = {
      roomId,
      roomName: roomName?.trim() || "Room",
      creatorId: socket.id,
      maxPlayers,
      password: password?.length ? password : null,
      started: false,
      turnIndex: 0, // 👈 IMPORTANT
      level: level || "easy",   // ⭐ NEW
      boardIndex,        // ⭐ same board for all
      players: [creatorPlayer]
    };

    socket.join(roomId);

    console.log(`🟢 Room created: ${roomId}`);

    socket.emit("room_created", {
      roomId,
      roomName: rooms[roomId].roomName,
      maxPlayers,
      password: password || "",
      level: rooms[roomId].level,   // ⭐ NEW
       boardIndex        // ⭐ IMPORTANT
    });

    io.to(roomId).emit("player_joined", {
      roomId,
      joinedPlayer: creatorPlayer,
      players: rooms[roomId].players,
      maxPlayers
    });
    // 👇 creator always index 0
   socket.emit("your_index", {
     roomId,
     index: 0
   });

    io.to(roomId).emit("player_list_update", {
      players: rooms[roomId].players,
      maxPlayers
    });

    emitRoomList();
  });



  /* ========== JOIN ROOM ========== */
  socket.on("join_room", ({ roomId, password, playerName }) => {

    const room = rooms[roomId];
    if (!room) return socket.emit("join_failed", "Room not found");

    if (room.creatorId === socket.id)
      return socket.emit("join_failed", "Creator cannot join own room");

    if (room.password && room.password !== password)
      return socket.emit("join_failed", "Wrong password");

    if (room.players.length >= room.maxPlayers)
      return socket.emit("join_failed", "Room full");


    const newPlayer = {
      id: socket.id,
      name: playerName || "Player",
      pos: 0
    };

    room.players.push(newPlayer);
    socket.join(roomId);

    console.log(`👤 ${newPlayer.name} joined ${roomId}`);

    io.to(roomId).emit("player_joined", {
      roomId,
      joinedPlayer: newPlayer,
      players: room.players,
      maxPlayers: room.maxPlayers
    });
 // 👇 send exact index to joining player
   socket.emit("your_index", {
     roomId,
     index: room.players.findIndex(p => p.id === socket.id)
   });
    socket.emit("join_success", {
      roomId,
      roomName: room.roomName,
      maxPlayers: room.maxPlayers,
      players: room.players,
      level: room.level,
      boardIndex: room.boardIndex     // ⭐ send same board
    });

    io.to(roomId).emit("player_list_update", {
      players: room.players,
      maxPlayers: room.maxPlayers
    });

    emitRoomList();
  });



  /* ========== GET ROOMS LIST ========== */
  socket.on("get_rooms", () => {
    console.log("📤 get_rooms:", socket.id);
    emitRoomList();
  });



  /* ========== REQUEST PLAYER LIST ========== */
  socket.on("request_player_list", ({ roomId }) => {

    const room = rooms[roomId];
    if (!room) return socket.emit("error_message", "Room not found");

    socket.emit("player_list_update", {
      players: room.players,
      maxPlayers: room.maxPlayers
    });
  });



  /* ========== START GAME ========== */
  socket.on("start_game", ({ roomId }) => {

    const room = rooms[roomId];
    if (!room) return;

    if (room.creatorId !== socket.id)
      return socket.emit("error_message", "Only creator can start game");

    if (room.players.length < 2)
      return socket.emit("error_message", "At least 2 players required");

    room.started = true;

    io.to(roomId).emit("game_started", {
      roomId,
      players: room.players,
      turnIndex: room.turnIndex,
      level: room.level,    // ⭐ NEW
      boardIndex: room.boardIndex   // ⭐ same for everyone
    });
  });



  /* 🎲 ROLL DICE */
  socket.on("roll_dice", ({ roomId }) => {

    const room = rooms[roomId];
    if (!room) return;

    const current = room.players[room.turnIndex];

    if (current.id !== socket.id)
      return socket.emit("error_message", "Not your turn");

    const dice = Math.floor(Math.random() * 6) + 1;

    io.to(roomId).emit("dice_result", {
      roomId,
      dice,
      playerIndex: room.turnIndex
    });
  });



  /* 🧩 MOVE COMPLETE */
 // socket.on("move_complete", ({ roomId, playerIndex, newPos }) => {

 //  const room = rooms[roomId];
 //  if (!room) return;

 //  // ❗ only accept move from current turn player
 //  if (playerIndex !== room.turnIndex) {
 //    console.log("❌ Rejected move_complete from wrong player");
 //    return;
 //  }

 //  room.players[playerIndex].pos = newPos;

 //  room.turnIndex =
 //    (room.turnIndex + 1) % room.players.length;

 //  io.to(roomId).emit("turn_changed", {
 //    turnIndex: room.turnIndex,
 //    players: room.players
 //  });

 //    /* 🔥 SYNC POSITIONS TO ALL */
 //    io.to(roomId).emit("sync_positions", {
 //      positions: room.players.map(p => p.pos)
 //    });
 //  });
socket.on("move_complete", ({ roomId, playerIndex, newPos }) => {

  const room = rooms[roomId];
  if (!room) return;

  // accept only current player's move
  if (playerIndex !== room.turnIndex) return;

  room.players[playerIndex].pos = newPos;

    /* 🏆 WIN CHECK */
  if (newPos === 100) {

    const winner = room.players[playerIndex];

    io.to(roomId).emit("game_finished", {
      roomId,
      winner,
      ranking: room.players   // send order list
    });

    // ❌ auto destroy room after finish
    delete rooms[roomId];
    emitRoomList();
    return;
  }
  
  // next turn
  room.turnIndex =
    (room.turnIndex + 1) % room.players.length;

  io.to(roomId).emit("turn_changed", {
    turnIndex: room.turnIndex,
    players: room.players
  });

  // sync final positions
  io.to(roomId).emit("sync_positions", {
    positions: room.players.map(p => p.pos)
  });

});



  /* ❌ LEAVE ROOM */
  socket.on("leave_room", ({ roomId }) => {
    const room = rooms[roomId];
    if (!room) return;

    if (room.creatorId === socket.id) {
      io.to(roomId).emit("room_destroyed");
      delete rooms[roomId];
      emitRoomList();
    }
  });



  /* ❌ DISCONNECT */
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

        io.to(roomId).emit("sync_positions", {
          positions: room.players.map(p => p.pos)
        });
      }

      if (room.players.length === 0)
        delete rooms[roomId];
    }

    emitRoomList();
  });

});



/* 🚀 START SERVER */
server.listen(3000, () =>
  console.log("🚀 Server running on port 3000")
);

// server.js - Node.js + Socket.io Backend for Scrabble Game
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const PORT = 3001;

// Scrabble tile distribution
const TILE_DISTRIBUTION = {
    'A': 9, 'B': 2, 'C': 2, 'D': 4, 'E': 12, 'F': 2, 'G': 3, 'H': 2,
    'I': 9, 'J': 1, 'K': 1, 'L': 4, 'M': 2, 'N': 6, 'O': 8, 'P': 2,
    'Q': 1, 'R': 6, 'S': 4, 'T': 6, 'U': 4, 'V': 2, 'W': 2, 'X': 1,
    'Y': 2, 'Z': 1, '_': 2
};

const TILE_VALUES = {
    'A': 1, 'B': 3, 'C': 3, 'D': 2, 'E': 1, 'F': 4, 'G': 2, 'H': 4,
    'I': 1, 'J': 8, 'K': 5, 'L': 1, 'M': 3, 'N': 1, 'O': 1, 'P': 3,
    'Q': 10, 'R': 1, 'S': 1, 'T': 1, 'U': 1, 'V': 4, 'W': 4, 'X': 8,
    'Y': 4, 'Z': 10, '_': 0
};

// Premium squares
const PREMIUM_SQUARES = {
    TW: [[0, 0], [0, 7], [0, 14], [7, 0], [7, 14], [14, 0], [14, 7], [14, 14]],
    DW: [[1, 1], [2, 2], [3, 3], [4, 4], [1, 13], [2, 12], [3, 11], [4, 10],
    [13, 1], [12, 2], [11, 3], [10, 4], [13, 13], [12, 12], [11, 11], [10, 10], [7, 7]],
    TL: [[1, 5], [1, 9], [5, 1], [5, 5], [5, 9], [5, 13], [9, 1], [9, 5], [9, 9], [9, 13], [13, 5], [13, 9]],
    DL: [[0, 3], [0, 11], [2, 6], [2, 8], [3, 0], [3, 7], [3, 14], [6, 2], [6, 6], [6, 8], [6, 12],
    [7, 3], [7, 11], [8, 2], [8, 6], [8, 8], [8, 12], [11, 0], [11, 7], [11, 14], [12, 6], [12, 8], [14, 3], [14, 11]]
};

const gameRooms = {};

class ScrabbleGame {
    constructor(roomId) {
        this.roomId = roomId;
        this.players = [];
        this.currentPlayerIndex = 0;
        this.board = Array(15).fill(null).map(() => Array(15).fill(null));
        this.tileBag = this.initializeTileBag();
        this.gameStarted = false;
        this.firstMoveMade = false;
        this.hostId = null;
    }

    initializeTileBag() {
        const bag = [];
        for (const letter in TILE_DISTRIBUTION) {
            const count = TILE_DISTRIBUTION[letter];
            for (let i = 0; i < count; i++) {
                bag.push({
                    letter: letter,
                    value: TILE_VALUES[letter],
                    id: letter + '-' + i + '-' + Math.random()
                });
            }
        }
        return this.shuffle(bag);
    }

    shuffle(array) {
        const shuffled = array.slice();
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            const temp = shuffled[i];
            shuffled[i] = shuffled[j];
            shuffled[j] = temp;
        }
        return shuffled;
    }

    addPlayer(socketId, name) {
        if (this.players.length >= 4) return false;

        const player = {
            id: socketId,
            name: name || 'Player ' + (this.players.length + 1),
            score: 0,
            tiles: [],
            isHost: this.players.length === 0
        };

        if (player.isHost) {
            this.hostId = socketId;
        }

        this.players.push(player);
        return true;
    }

    removePlayer(socketId) {
        const index = this.players.findIndex(p => p.id === socketId);
        if (index !== -1) {
            const removedPlayer = this.players[index];
            this.tileBag = this.tileBag.concat(removedPlayer.tiles);
            this.players.splice(index, 1);

            if (removedPlayer.isHost && this.players.length > 0) {
                this.players[0].isHost = true;
                this.hostId = this.players[0].id;
            }

            if (this.currentPlayerIndex >= this.players.length) {
                this.currentPlayerIndex = 0;
            }
        }
    }

    startGame() {
        if (this.gameStarted || this.players.length < 2) return false;

        this.gameStarted = true;
        for (let i = 0; i < this.players.length; i++) {
            this.dealTiles(this.players[i], 7);
        }
        return true;
    }

    dealTiles(player, count) {
        const tilesToDeal = Math.min(count, this.tileBag.length);
        for (let i = 0; i < tilesToDeal; i++) {
            player.tiles.push(this.tileBag.pop());
        }
    }

    getCurrentPlayer() {
        return this.players[this.currentPlayerIndex];
    }

    nextTurn() {
        this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.players.length;
    }

    validateMove(playedTiles) {
        if (playedTiles.length === 0) {
            return { valid: false, error: "No tiles played" };
        }

        if (!this.firstMoveMade) {
            const crossesCenter = playedTiles.some(pt => pt.row === 7 && pt.col === 7);
            if (!crossesCenter) {
                return { valid: false, error: "First word must cross the center square" };
            }
        }

        const rows = new Set(playedTiles.map(pt => pt.row));
        const cols = new Set(playedTiles.map(pt => pt.col));

        if (rows.size > 1 && cols.size > 1) {
            return { valid: false, error: "Tiles must be in a single row or column" };
        }

        if (rows.size === 1) {
            const row = playedTiles[0].row;
            const sortedCols = playedTiles.map(pt => pt.col).sort((a, b) => a - b);
            for (let i = sortedCols[0]; i <= sortedCols[sortedCols.length - 1]; i++) {
                const hasNewTile = playedTiles.some(pt => pt.col === i);
                const hasExistingTile = this.board[row][i] !== null;
                if (!hasNewTile && !hasExistingTile) {
                    return { valid: false, error: "Tiles must be contiguous" };
                }
            }
        } else {
            const col = playedTiles[0].col;
            const sortedRows = playedTiles.map(pt => pt.row).sort((a, b) => a - b);
            for (let i = sortedRows[0]; i <= sortedRows[sortedRows.length - 1]; i++) {
                const hasNewTile = playedTiles.some(pt => pt.row === i);
                const hasExistingTile = this.board[i][col] !== null;
                if (!hasNewTile && !hasExistingTile) {
                    return { valid: false, error: "Tiles must be contiguous" };
                }
            }
        }

        if (this.firstMoveMade) {
            let connected = false;
            for (let p = 0; p < playedTiles.length; p++) {
                const pt = playedTiles[p];
                const neighbors = [
                    [pt.row - 1, pt.col],
                    [pt.row + 1, pt.col],
                    [pt.row, pt.col - 1],
                    [pt.row, pt.col + 1]
                ];
                for (let n = 0; n < neighbors.length; n++) {
                    const r = neighbors[n][0];
                    const c = neighbors[n][1];
                    if (r >= 0 && r < 15 && c >= 0 && c < 15 && this.board[r][c] !== null) {
                        connected = true;
                        break;
                    }
                }
                if (connected) break;
            }
            if (!connected) {
                return { valid: false, error: "New tiles must connect to existing tiles" };
            }
        }

        return { valid: true };
    }

    calculateScore(playedTiles) {
        let totalScore = 0;
        let wordMultiplier = 1;

        for (let i = 0; i < playedTiles.length; i++) {
            const pt = playedTiles[i];
            let tileScore = pt.tile.value;
            const premiumKey = this.getPremiumSquare(pt.row, pt.col);

            if (premiumKey === 'DL') tileScore *= 2;
            if (premiumKey === 'TL') tileScore *= 3;
            if (premiumKey === 'DW') wordMultiplier *= 2;
            if (premiumKey === 'TW') wordMultiplier *= 3;

            totalScore += tileScore;
        }

        if (playedTiles.length > 0) {
            const rows = new Set(playedTiles.map(pt => pt.row));
            const cols = new Set(playedTiles.map(pt => pt.col));

            if (rows.size === 1) {
                const row = playedTiles[0].row;
                const sortedCols = playedTiles.map(pt => pt.col).sort((a, b) => a - b);
                for (let col = sortedCols[0]; col <= sortedCols[sortedCols.length - 1]; col++) {
                    if (this.board[row][col] !== null && !playedTiles.some(pt => pt.col === col)) {
                        totalScore += this.board[row][col].value;
                    }
                }
            } else {
                const col = playedTiles[0].col;
                const sortedRows = playedTiles.map(pt => pt.row).sort((a, b) => a - b);
                for (let row = sortedRows[0]; row <= sortedRows[sortedRows.length - 1]; row++) {
                    if (this.board[row][col] !== null && !playedTiles.some(pt => pt.row === row)) {
                        totalScore += this.board[row][col].value;
                    }
                }
            }
        }

        totalScore *= wordMultiplier;

        if (playedTiles.length === 7) {
            totalScore += 50;
        }

        return totalScore;
    }

    getPremiumSquare(row, col) {
        if (this.board[row][col] !== null) return null;

        for (const key in PREMIUM_SQUARES) {
            const positions = PREMIUM_SQUARES[key];
            for (let i = 0; i < positions.length; i++) {
                if (positions[i][0] === row && positions[i][1] === col) {
                    return key;
                }
            }
        }
        return null;
    }

    playMove(playerId, playedTiles) {
        const player = this.players.find(p => p.id === playerId);
        if (!player || this.getCurrentPlayer().id !== playerId) {
            return { success: false, error: "Not your turn" };
        }

        const validation = this.validateMove(playedTiles);
        if (!validation.valid) {
            return { success: false, error: validation.error };
        }

        // IMPORTANT: Calculate score BEFORE placing tiles on board
        const score = this.calculateScore(playedTiles);

        // NOW place the tiles on the board
        for (let i = 0; i < playedTiles.length; i++) {
            const pt = playedTiles[i];
            this.board[pt.row][pt.col] = pt.tile;
        }

        player.score += score;

        const playedTileIds = new Set(playedTiles.map(pt => pt.tile.id));
        player.tiles = player.tiles.filter(t => !playedTileIds.has(t.id));

        this.dealTiles(player, playedTiles.length);

        this.firstMoveMade = true;
        this.nextTurn();

        return { success: true, score: score };
    }


    passTurn(playerId) {
        const player = this.players.find(p => p.id === playerId);
        if (!player || this.getCurrentPlayer().id !== playerId) {
            return { success: false, error: "Not your turn" };
        }

        this.nextTurn();
        return { success: true };
    }

    exchangeTiles(playerId, tileIds) {
        const player = this.players.find(p => p.id === playerId);
        if (!player || this.getCurrentPlayer().id !== playerId) {
            return { success: false, error: "Not your turn" };
        }

        if (this.tileBag.length < tileIds.length) {
            return { success: false, error: "Not enough tiles in bag" };
        }

        const exchangedTiles = player.tiles.filter(t => tileIds.includes(t.id));
        player.tiles = player.tiles.filter(t => !tileIds.includes(t.id));
        this.tileBag = this.tileBag.concat(exchangedTiles);
        this.tileBag = this.shuffle(this.tileBag);

        this.dealTiles(player, exchangedTiles.length);

        this.nextTurn();
        return { success: true };
    }

    getGameState() {
        return {
            roomId: this.roomId,
            players: this.players.map(p => ({
                id: p.id,
                name: p.name,
                score: p.score,
                tileCount: p.tiles.length,
                isHost: p.isHost
            })),
            currentPlayerIndex: this.currentPlayerIndex,
            board: this.board,
            gameStarted: this.gameStarted,
            tilesRemaining: this.tileBag.length,
            hostId: this.hostId
        };
    }

    getPlayerState(playerId) {
        const player = this.players.find(p => p.id === playerId);
        return player ? { tiles: player.tiles } : null;
    }
}

io.on('connection', (socket) => {
    console.log('New client connected:', socket.id);

    socket.on('createRoom', (data) => {
        const roomId = data.roomId;
        const playerName = data.playerName;

        if (!gameRooms[roomId]) {
            gameRooms[roomId] = new ScrabbleGame(roomId);
        }

        const game = gameRooms[roomId];
        const success = game.addPlayer(socket.id, playerName);

        if (success) {
            socket.join(roomId);
            socket.emit('roomJoined', {
                roomId: roomId,
                playerId: socket.id,
                gameState: game.getGameState(),
                playerState: game.getPlayerState(socket.id)
            });
            io.to(roomId).emit('gameStateUpdate', game.getGameState());
        } else {
            socket.emit('error', { message: 'Room is full' });
        }
    });

    socket.on('joinRoom', (data) => {
        const roomId = data.roomId;
        const playerName = data.playerName;

        const game = gameRooms[roomId];
        if (!game) {
            socket.emit('error', { message: 'Room not found' });
            return;
        }

        if (game.gameStarted) {
            socket.emit('error', { message: 'Game already started' });
            return;
        }

        const success = game.addPlayer(socket.id, playerName);
        if (success) {
            socket.join(roomId);
            socket.emit('roomJoined', {
                roomId: roomId,
                playerId: socket.id,
                gameState: game.getGameState(),
                playerState: game.getPlayerState(socket.id)
            });
            io.to(roomId).emit('gameStateUpdate', game.getGameState());
        } else {
            socket.emit('error', { message: 'Room is full' });
        }
    });

    socket.on('startGame', (data) => {
        const roomId = data.roomId;
        const game = gameRooms[roomId];
        if (!game) return;

        if (game.hostId !== socket.id) {
            socket.emit('error', { message: 'Only host can start the game' });
            return;
        }

        if (game.startGame()) {
            io.to(roomId).emit('gameStarted', game.getGameState());
            for (let i = 0; i < game.players.length; i++) {
                const player = game.players[i];
                io.to(player.id).emit('playerState', game.getPlayerState(player.id));
            }
        }
    });

    socket.on('playMove', (data) => {
        const roomId = data.roomId;
        const playedTiles = data.playedTiles;

        const game = gameRooms[roomId];
        if (!game) return;

        const result = game.playMove(socket.id, playedTiles);

        if (result.success) {
            io.to(roomId).emit('gameStateUpdate', game.getGameState());
            for (let i = 0; i < game.players.length; i++) {
                const player = game.players[i];
                io.to(player.id).emit('playerState', game.getPlayerState(player.id));
            }
            io.to(roomId).emit('moveCompleted', {
                playerId: socket.id,
                score: result.score
            });
        } else {
            socket.emit('error', { message: result.error });
        }
    });

    socket.on('passTurn', (data) => {
        const roomId = data.roomId;
        const game = gameRooms[roomId];
        if (!game) return;

        const result = game.passTurn(socket.id);
        if (result.success) {
            io.to(roomId).emit('gameStateUpdate', game.getGameState());
            io.to(roomId).emit('playerPassed', { playerId: socket.id });
        } else {
            socket.emit('error', { message: result.error });
        }
    });

    socket.on('exchangeTiles', (data) => {
        const roomId = data.roomId;
        const tileIds = data.tileIds;

        const game = gameRooms[roomId];
        if (!game) return;

        const result = game.exchangeTiles(socket.id, tileIds);
        if (result.success) {
            io.to(roomId).emit('gameStateUpdate', game.getGameState());
            socket.emit('playerState', game.getPlayerState(socket.id));
        } else {
            socket.emit('error', { message: result.error });
        }
    });

    socket.on('chatMessage', (data) => {
        const roomId = data.roomId;
        const message = data.message;
        const playerName = data.playerName;

        io.to(roomId).emit('chatMessage', {
            playerName: playerName,
            message: message,
            timestamp: Date.now()
        });
    });

    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);

        for (const roomId in gameRooms) {
            const game = gameRooms[roomId];
            game.removePlayer(socket.id);

            if (game.players.length === 0) {
                delete gameRooms[roomId];
            } else {
                io.to(roomId).emit('gameStateUpdate', game.getGameState());
            }
        }
    });
});

server.listen(PORT, () => {
    console.log('Scrabble server running on port ' + PORT);
    console.log('Players can connect from local network');
});
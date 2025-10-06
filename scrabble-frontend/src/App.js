import React, { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';

const PREMIUM_SQUARES = {
  TW: [[0,0], [0,7], [0,14], [7,0], [7,14], [14,0], [14,7], [14,14]],
  DW: [[1,1], [2,2], [3,3], [4,4], [1,13], [2,12], [3,11], [4,10], 
       [13,1], [12,2], [11,3], [10,4], [13,13], [12,12], [11,11], [10,10], [7,7]],
  TL: [[1,5], [1,9], [5,1], [5,5], [5,9], [5,13], [9,1], [9,5], [9,9], [9,13], [13,5], [13,9]],
  DL: [[0,3], [0,11], [2,6], [2,8], [3,0], [3,7], [3,14], [6,2], [6,6], [6,8], [6,12], 
       [7,3], [7,11], [8,2], [8,6], [8,8], [8,12], [11,0], [11,7], [11,14], [12,6], [12,8], [14,3], [14,11]]
};

const getPremiumType = (row, col) => {
  for (const [type, positions] of Object.entries(PREMIUM_SQUARES)) {
    if (positions.some(([r, c]) => r === row && c === col)) return type;
  }
  return null;
};

export default function ScrabbleGame() {
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);
  const [roomId, setRoomId] = useState('');
  const [playerName, setPlayerName] = useState('');
  const [playerId, setPlayerId] = useState(null);
  const [gameState, setGameState] = useState(null);
  const [playerTiles, setPlayerTiles] = useState([]);
  const [draggedTile, setDraggedTile] = useState(null);
  const [boardPlacements, setBoardPlacements] = useState({});
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [inLobby, setInLobby] = useState(true);

  useEffect(() => {
    const newSocket = io('http://localhost:3001');
    setSocket(newSocket);

    newSocket.on('connect', () => {
      setConnected(true);
    });

    newSocket.on('roomJoined', ({ roomId, playerId, gameState, playerState }) => {
      setPlayerId(playerId);
      setGameState(gameState);
      if (playerState) setPlayerTiles(playerState.tiles);
      setInLobby(true);
    });

    newSocket.on('gameStateUpdate', (state) => {
      setGameState(state);
    });

    newSocket.on('gameStarted', (state) => {
      setGameState(state);
      setInLobby(false);
    });

    newSocket.on('playerState', (state) => {
      if (state) setPlayerTiles(state.tiles);
    });

    newSocket.on('chatMessage', ({ playerName, message, timestamp }) => {
      setChatMessages(prev => [...prev, { playerName, message, timestamp }]);
    });

    newSocket.on('error', ({ message }) => {
      setErrorMessage(message);
      setTimeout(() => setErrorMessage(''), 3000);
    });

    newSocket.on('moveCompleted', ({ playerId: movedPlayerId, score }) => {
      const player = gameState?.players.find(p => p.id === movedPlayerId);
      setChatMessages(prev => [...prev, { 
        playerName: 'System', 
        message: `${player?.name || 'Player'} scored ${score} points!`, 
        timestamp: Date.now() 
      }]);
    });

    newSocket.on('playerPassed', ({ playerId: passedPlayerId }) => {
      const player = gameState?.players.find(p => p.id === passedPlayerId);
      setChatMessages(prev => [...prev, { 
        playerName: 'System', 
        message: `${player?.name || 'Player'} passed their turn`, 
        timestamp: Date.now() 
      }]);
    });

    return () => newSocket.close();
  }, []);

  const createRoom = () => {
    if (!playerName.trim() || !roomId.trim()) {
      setErrorMessage('Please enter both name and room ID');
      setTimeout(() => setErrorMessage(''), 3000);
      return;
    }
    socket.emit('createRoom', { roomId, playerName });
  };

  const joinRoom = () => {
    if (!playerName.trim() || !roomId.trim()) {
      setErrorMessage('Please enter both name and room ID');
      setTimeout(() => setErrorMessage(''), 3000);
      return;
    }
    socket.emit('joinRoom', { roomId, playerName });
  };

  const startGame = () => {
    socket.emit('startGame', { roomId: gameState.roomId });
  };

  const handleDragStart = (e, tile, source) => {
    setDraggedTile({ tile, source });
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDropOnBoard = (e, row, col) => {
    e.preventDefault();
    if (!draggedTile) return;

    const key = `${row}-${col}`;
    
    // Check if square is already occupied
    if (gameState.board[row][col] || boardPlacements[key]) return;

    // If from rack, add to placements
    if (draggedTile.source === 'rack') {
      setBoardPlacements(prev => ({
        ...prev,
        [key]: { row, col, tile: draggedTile.tile }
      }));
      setPlayerTiles(prev => prev.filter(t => t.id !== draggedTile.tile.id));
    }
    // If from board, move placement
    else if (draggedTile.source === 'board') {
      const newPlacements = { ...boardPlacements };
      delete newPlacements[draggedTile.source];
      newPlacements[key] = { row, col, tile: draggedTile.tile };
      setBoardPlacements(newPlacements);
    }

    setDraggedTile(null);
  };

  const handleDropOnRack = (e) => {
    e.preventDefault();
    if (!draggedTile || draggedTile.source === 'rack') return;

    // Return tile to rack
    const newPlacements = { ...boardPlacements };
    delete newPlacements[draggedTile.source];
    setBoardPlacements(newPlacements);
    setPlayerTiles(prev => [...prev, draggedTile.tile]);
    setDraggedTile(null);
  };

  const playMove = () => {
    const playedTiles = Object.values(boardPlacements);
    if (playedTiles.length === 0) {
      setErrorMessage('Place at least one tile');
      setTimeout(() => setErrorMessage(''), 3000);
      return;
    }

    socket.emit('playMove', { 
      roomId: gameState.roomId, 
      playedTiles 
    });
    setBoardPlacements({});
  };

  const passTurn = () => {
    socket.emit('passTurn', { roomId: gameState.roomId });
    // Return tiles to rack
    Object.values(boardPlacements).forEach(placement => {
      setPlayerTiles(prev => [...prev, placement.tile]);
    });
    setBoardPlacements({});
  };

  const shuffleTiles = () => {
    setPlayerTiles(prev => [...prev].sort(() => Math.random() - 0.5));
  };

  const recallTiles = () => {
    Object.values(boardPlacements).forEach(placement => {
      setPlayerTiles(prev => [...prev, placement.tile]);
    });
    setBoardPlacements({});
  };

  const sendChat = () => {
    if (!chatInput.trim()) return;
    const player = gameState?.players.find(p => p.id === playerId);
    socket.emit('chatMessage', { 
      roomId: gameState.roomId, 
      message: chatInput,
      playerName: player?.name || 'Unknown'
    });
    setChatInput('');
  };

  const isMyTurn = gameState && gameState.players[gameState.currentPlayerIndex]?.id === playerId;

  if (!connected) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-100">
        <div className="text-xl">Connecting to server...</div>
      </div>
    );
  }

  if (!gameState) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
        <div className="bg-white p-8 rounded-lg shadow-2xl w-96">
          <h1 className="text-3xl font-bold text-center mb-6 text-indigo-600">Scrabble Online</h1>
          <input
            type="text"
            placeholder="Your Name"
            value={playerName}
            onChange={(e) => setPlayerName(e.target.value)}
            className="w-full p-3 border border-gray-300 rounded-lg mb-4 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <input
            type="text"
            placeholder="Room ID"
            value={roomId}
            onChange={(e) => setRoomId(e.target.value)}
            className="w-full p-3 border border-gray-300 rounded-lg mb-4 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <div className="flex gap-3">
            <button
              onClick={createRoom}
              className="flex-1 bg-indigo-600 text-white py-3 rounded-lg hover:bg-indigo-700 transition font-semibold"
            >
              Create Room
            </button>
            <button
              onClick={joinRoom}
              className="flex-1 bg-green-600 text-white py-3 rounded-lg hover:bg-green-700 transition font-semibold"
            >
              Join Room
            </button>
          </div>
          {errorMessage && (
            <div className="mt-4 p-3 bg-red-100 text-red-700 rounded-lg text-center">
              {errorMessage}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (inLobby) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
        <div className="bg-white p-8 rounded-lg shadow-2xl w-96">
          <h1 className="text-3xl font-bold text-center mb-4 text-indigo-600">Game Lobby</h1>
          <div className="mb-4 p-3 bg-gray-100 rounded">
            <div className="text-sm text-gray-600 mb-1">Room ID</div>
            <div className="font-mono font-bold text-lg">{gameState.roomId}</div>
          </div>
          <div className="mb-6">
            <h3 className="font-semibold mb-2">Players ({gameState.players.length}/4)</h3>
            {gameState.players.map(player => (
              <div key={player.id} className="flex items-center justify-between p-2 bg-gray-50 rounded mb-2">
                <span>{player.name}</span>
                {player.isHost && <span className="text-xs bg-indigo-600 text-white px-2 py-1 rounded">HOST</span>}
              </div>
            ))}
          </div>
          {gameState.hostId === playerId && (
            <button
              onClick={startGame}
              disabled={gameState.players.length < 2}
              className="w-full bg-green-600 text-white py-3 rounded-lg hover:bg-green-700 transition font-semibold disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              Start Game
            </button>
          )}
          {gameState.hostId !== playerId && (
            <div className="text-center text-gray-600">Waiting for host to start...</div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-4xl font-bold text-center mb-6 text-indigo-700">Scrabble Online</h1>
        
        {errorMessage && (
          <div className="mb-4 p-3 bg-red-100 text-red-700 rounded-lg text-center">
            {errorMessage}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
          {/* Left sidebar - Players */}
          <div className="bg-white rounded-lg shadow-lg p-4">
            <h2 className="text-xl font-bold mb-4">Players</h2>
            {gameState.players.map((player, idx) => (
              <div 
                key={player.id} 
                className={`p-3 rounded-lg mb-2 ${
                  idx === gameState.currentPlayerIndex 
                    ? 'bg-green-100 border-2 border-green-500' 
                    : 'bg-gray-50'
                } ${player.id === playerId ? 'ring-2 ring-indigo-500' : ''}`}
              >
                <div className="font-semibold">{player.name}</div>
                <div className="text-sm text-gray-600">Score: {player.score}</div>
                <div className="text-sm text-gray-600">Tiles: {player.tileCount}</div>
                {idx === gameState.currentPlayerIndex && (
                  <div className="text-xs text-green-600 font-semibold mt-1">Current Turn</div>
                )}
              </div>
            ))}
            <div className="mt-4 p-3 bg-gray-100 rounded">
              <div className="text-sm text-gray-600">Tiles Remaining</div>
              <div className="text-2xl font-bold">{gameState.tilesRemaining}</div>
            </div>
          </div>

          {/* Center - Game Board */}
          <div className="lg:col-span-2 bg-white rounded-lg shadow-lg p-4">
            <div className="inline-block">
              <div className="grid grid-cols-15 gap-0.5 bg-gray-800 p-1 rounded">
                {Array(15).fill(0).map((_, row) => (
                  Array(15).fill(0).map((_, col) => {
                    const key = `${row}-${col}`;
                    const placedTile = boardPlacements[key];
                    const existingTile = gameState.board[row][col];
                    const premium = getPremiumType(row, col);
                    const isCenter = row === 7 && col === 7;

                    let bgColor = 'bg-amber-50';
                    let label = '';
                    
                    if (!existingTile) {
                      if (premium === 'TW') {
                        bgColor = 'bg-red-500 text-white';
                        label = 'TW';
                      } else if (premium === 'DW' || isCenter) {
                        bgColor = 'bg-pink-400 text-white';
                        label = isCenter ? '★' : 'DW';
                      } else if (premium === 'TL') {
                        bgColor = 'bg-blue-500 text-white';
                        label = 'TL';
                      } else if (premium === 'DL') {
                        bgColor = 'bg-cyan-400 text-white';
                        label = 'DL';
                      }
                    }

                    return (
                      <div
                        key={key}
                        onDragOver={handleDragOver}
                        onDrop={(e) => handleDropOnBoard(e, row, col)}
                        className={`w-8 h-8 ${bgColor} flex items-center justify-center text-xs font-semibold cursor-pointer border border-gray-300 relative`}
                      >
                        {!placedTile && !existingTile && <span className="text-[8px]">{label}</span>}
                        {(placedTile || existingTile) && (
                          <div
                            draggable={!!placedTile}
                            onDragStart={(e) => placedTile && handleDragStart(e, placedTile.tile, key)}
                            className={`w-full h-full ${placedTile ? 'bg-yellow-200' : 'bg-amber-100'} border-2 border-amber-900 flex flex-col items-center justify-center cursor-move font-bold`}
                          >
                            <span className="text-sm">{(placedTile?.tile.letter || existingTile?.letter)}</span>
                            <span className="text-[8px]">{(placedTile?.tile.value || existingTile?.value)}</span>
                          </div>
                        )}
                      </div>
                    );
                  })
                ))}
              </div>
            </div>

            {/* Tile Rack */}
            <div className="mt-4">
              <h3 className="font-semibold mb-2">Your Tiles</h3>
              <div
                onDragOver={handleDragOver}
                onDrop={handleDropOnRack}
                className="flex gap-2 bg-amber-700 p-3 rounded-lg min-h-16"
              >
                {playerTiles.map(tile => (
                  <div
                    key={tile.id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, tile, 'rack')}
                    className="w-12 h-12 bg-amber-100 border-2 border-amber-900 rounded flex flex-col items-center justify-center cursor-move font-bold hover:shadow-lg transition"
                  >
                    <span className="text-lg">{tile.letter}</span>
                    <span className="text-xs">{tile.value}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Controls */}
            <div className="mt-4 flex gap-2 flex-wrap">
              <button
                onClick={playMove}
                disabled={!isMyTurn || Object.keys(boardPlacements).length === 0}
                className="flex-1 bg-green-600 text-white py-2 px-4 rounded-lg hover:bg-green-700 transition font-semibold disabled:bg-gray-400 disabled:cursor-not-allowed"
              >
                Play Word
              </button>
              <button
                onClick={passTurn}
                disabled={!isMyTurn}
                className="flex-1 bg-yellow-600 text-white py-2 px-4 rounded-lg hover:bg-yellow-700 transition font-semibold disabled:bg-gray-400 disabled:cursor-not-allowed"
              >
                Pass Turn
              </button>
              <button
                onClick={recallTiles}
                disabled={Object.keys(boardPlacements).length === 0}
                className="bg-blue-600 text-white py-2 px-4 rounded-lg hover:bg-blue-700 transition font-semibold disabled:bg-gray-400 disabled:cursor-not-allowed"
              >
                Recall
              </button>
              <button
                onClick={shuffleTiles}
                className="bg-purple-600 text-white py-2 px-4 rounded-lg hover:bg-purple-700 transition font-semibold"
              >
                Shuffle
              </button>
            </div>
          </div>

          {/* Right sidebar - Chat */}
          <div className="bg-white rounded-lg shadow-lg p-4 flex flex-col">
            <h2 className="text-xl font-bold mb-4">Chat</h2>
            <div className="flex-1 overflow-y-auto mb-4 space-y-2 max-h-96">
              {chatMessages.map((msg, idx) => (
                <div key={idx} className={`p-2 rounded ${msg.playerName === 'System' ? 'bg-gray-100 italic' : 'bg-blue-50'}`}>
                  <span className="font-semibold text-sm">{msg.playerName}: </span>
                  <span className="text-sm">{msg.message}</span>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && sendChat()}
                placeholder="Type message..."
                className="flex-1 p-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <button
                onClick={sendChat}
                className="bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition font-semibold"
              >
                Send
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

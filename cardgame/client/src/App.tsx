// @ts-ignore
import React, { useState, useEffect } from "react";
import { io } from "socket.io-client";

// Use environment variable for backend URL
// const BACKEND_URL = import.meta.env.VITE_API_URL || "localhost:3001";
const BACKEND_URL = import.meta.env.VITE_API_URL || "https://crookies-kessel-sabaac-client.onrender.com";
const socket = io(BACKEND_URL);

export default function App() {
  const [room, setRoom] = useState<any>(null);
  const [name, setName] = useState("");
  const [chips, setChips] = useState(null);
  const [roomId, setRoomId] = useState("");
  // @ts-ignore
  const [debug, setDebug] = useState(false);
  const [pendingDraw, setPendingDraw] = useState<any>(null);
  const [windowWidth, setWindowWidth] = useState(window.innerWidth);

  useEffect(() => {
    socket.on("roomUpdate", setRoom);
    const handleResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener("resize", handleResize);
    return () => {
      socket.off("roomUpdate");
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  if (!room)
    return (
      <div style={{ padding: 20 }}>
        <h2>Create or Join Room</h2>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name"
        />
        <input
          type="number"
          value={chips}
		  min={0}
          onChange={(e) => setChips(+e.target.value)}
          placeholder="Chips"
        />
        <input
          value={roomId}
          onChange={(e) => setRoomId(e.target.value)}
          placeholder="Room ID"
        />
        <div style={{ marginTop: 10 }}>
          <button
            onClick={() => {
              const currentName = name.trim();
              const currentChips = chips;
              const currentRoomId = roomId.trim();
              if (!currentName) return alert("Enter a name");
			  if (!currentRoomId) return alert("Enter a room");
              socket.emit(
                "createRoom",
                { name: currentName, chips: currentChips, roomId: currentRoomId },
                console.log
              );
            }}
          >
            Create Room
          </button>
          <button
            onClick={() => {
              const currentName = name.trim();
              const currentChips = chips;
              const currentRoomId = roomId.trim();
              if (!currentName) return alert("Enter a name");
			  if (!currentRoomId) return alert("Enter a room");
              socket.emit(
                "joinRoom",
                { name: currentName, chips: currentChips, roomId: currentRoomId },
                (res: any) => {
                  if (res.error) alert(res.error);
                }
              );
            }}
            style={{ marginLeft: 10 }}
          >
            Join Room
          </button>
{/*
		Rules Text
*/}
		<h3>Rules:</h3>
		<h6>Kessel Sabaac consists of two 22 card decks, named the Blood and Sand decks.  These decks consist of three copies of each number 1 through 6, three copies of the Imposter, and a single copy of the Sylops. <br /><br />Each player gets dealt one card from each deck, creating their hand.  They also start with a uniform number of chips, determined before play starts.<br /><br />On a player's turn they can either stand, choose to pass their turn, or draw a card.  If they draw, they ante one of their chips and then can draw from the Blood or Sand deck or the respective discard piles.<br /><br />A hand must always consist of one Blood and one Sand card, so after drawing the player must choose a card to discard to maintain this rule.<br /><br />Once each player has had 3 turns to draw or stand, the hands are revealed for scoring.<br /><br />When revealed, any holders of Imposters roll two 6 sided dice and choose one of the values to represent that card.  Any Sylops revealed will take the value of the other card in hand.</h6>
		<h3>Scoring:</h3>
		<h6>The goal is to have a pair in your final hand, called a sabaac.  Lower value cards are higher quality, so a 4 sabaac will beat a 5 sabaac, but lose to a 3 sabaac.  The best hand possible is a pair of Sylops, called a Prime sabaac.<br /><br />If no players have a sabaac, then scoring goes to the lowest difference between hand cards.  Ties in difference go to the hand with the highest quality cards.<br /><br />The winner of a round gets all of their anted chips back.  Losers lose their anted chips to the void, plus an amount of chips equal to the difference in their cards (no less than one chip in this way).</h6>
        </div>
      </div>
    );

  const player = room.players.find((p: any) => p.id === socket.id);
  const isYourTurn =
    room.players[room.currentTurnPlayerIndex]?.id === socket.id;

  const drawOptions = [
    { color: "red", source: "deck" },
    { color: "yellow", source: "deck" },
    { color: "red", source: "discard" },
    { color: "yellow", source: "discard" },
  ];

  const handleDraw = (drawOption: any) => {
    socket.emit("drawCard", { roomId, ...drawOption }, (res: any) => {
      if (res.ok) setPendingDraw(drawOption);
      else console.log(res.error);
    });
  };

  const handleDiscard = (discardIndex: number) => {
    if (!pendingDraw) return;
    socket.emit("discardCard", { roomId, discardIndex }, (res: any) => {
      if (res.ok) setPendingDraw(null);
      else console.log(res.error);
    });
  };

  const handleResolveMystery = (cardId: string, chosenValue: number) => {
    socket.emit(
      "resolveMysteryCards",
      { roomId, cardId, chosenValue },
      (res: any) => {
        if (!res.ok) console.log(res.error);
      }
    );
  };

  const handleNextRound = () => {
    socket.emit("nextRound", { roomId }, (res: any) => {
      if (!res.ok) console.log(res.error);
    });
  };

  const leftWidth = windowWidth * 0.75 - 30; // minus padding
  const rightWidth = windowWidth * 0.25 - 30;

  return (
    <div
      style={{
        display: "flex",
        width: "100%",
        height: "100vh",
        boxSizing: "border-box",
        overflow: "hidden",
      }}
    >
      {/* Left panel */}
      <div
        style={{
          width: leftWidth,
          paddingLeft: 30,
          paddingRight: 10,
          overflowY: "auto",
        }}
      >
        <h2>Room: {room.id}</h2>
        <h3>
          Round {room.roundNumber} | Current Turn:{" "}
          {room.players[room.currentTurnPlayerIndex]?.name}
        </h3>
        <h3>Your Chips: {player.chipsTotal} (Anted: {player.chipsAnted})</h3>

        <h3>Your Hand:</h3>
        <div style={{ display: "flex", gap: 10 }}>
          {["red", "yellow"].map((color) => {
            const card = player.hand.find((c: any) => c.color === color);
            return (
              <div
                key={color}
                style={{
                  border: "1px solid black",
                  padding: 10,
                  width: 70,
                  textAlign: "center",
                  backgroundColor: color === "red" ? "#ff4444" : "#ffeb3b",
                  color: "black",
                  fontWeight: "bold",
                }}
              >
                {card ? `${card.value}` : "empty"}
              </div>
            );
          })}
        </div>

        <h3>Deck Counts:</h3>
        <div>
          Red Deck: {room.deckRed.length} | Yellow Deck: {room.deckYellow.length}
        </div>

        <h3>Top of Discard Piles:</h3>
        <div style={{ display: "flex", gap: 20 }}>
          {["red", "yellow"].map((color) => {
            const discardPile = color === "red" ? room.discardRed : room.discardYellow;
            const topCard = discardPile[discardPile.length - 1];
            return (
              <div key={color}>
                {topCard ? (
					<div
						style={{
							display: "inline-block",
							width: 70,
							height: 70,
							textAlign: "center",
							lineHeight: "70px",
							backgroundColor: color === "red" ? "#ff4444" : "#ffeb3b",
							color: "black",
							fontWeight: "bold",
							clipPath: "polygon(30% 0%, 70% 0%, 100% 30%, 100% 70%, 70% 100%, 30% 100%, 0% 70%, 0% 30%)",
							transform: "rotate(45deg)",
							border: "1px solid black",
						}}
					>
						{topCard.value}
					</div>
                ) : (
                  "empty"
                )}
              </div>
            );
          })}
        </div>

        {/* Playing turn UI */}
        {room.phase === "playing" && isYourTurn && (
          <>
            <h3>Your Turn:</h3>
            {!pendingDraw ? (
              <div style={{ display: "wrap", gap: 10, marginTop: 10 }}>
                {drawOptions.map((o, i) => (
                  <button
                    key={i}
                    onClick={() => handleDraw(o)}
                    style={{
                      backgroundColor: o.color === "red" ? "#ff4444" : "#ffeb3b",
                      color: "black",
                      border: "1px solid black",
                      padding: "5px 10px",
                      cursor: "pointer",
                      fontWeight: "bold",
                    }}
                  >
                    Draw {o.color} {o.source}
                  </button>
                ))}
                <button
                  onClick={() => socket.emit("stand", { roomId }, console.log)}
                  style={{
                    backgroundColor: "#4fc3f7",
                    color: "black",
                    border: "1px solid black",
                    padding: "5px 10px",
                    cursor: "pointer",
                    fontWeight: "bold",
                  }}
                >
                  Stand
                </button>
              </div>
            ) : (
              <>
                <h4>Choose which card to discard:</h4>
                <div style={{ display: "flex", gap: 10 }}>
                  {player.hand
                    .filter((c: any) => c.color === pendingDraw.color)
                    .map((c: any) => (
                      <button
                        key={c.id}
                        onClick={() => handleDiscard(player.hand.indexOf(c))}
                        style={{
                          backgroundColor:
                            c.color === "red" ? "#ff4444" : "#ffeb3b",
                          color: "black",
                          border: "1px solid black",
                          padding: "5px 10px",
                          cursor: "pointer",
                          fontWeight: "bold",
                        }}
                      >
                        {c.value}
                      </button>
                    ))}
                </div>
              </>
            )}
          </>
        )}

        {/* Imposter roll, reveal, waiting, debug... */}
        {room.phase === "imposterRoll" &&
          player.pendingImposters &&
          player.pendingImposters.length > 0 && (
            <div style={{ marginTop: 20 }}>
              <h3>Imposter Dice Rolls</h3>
              {player.pendingImposters
                .filter((pi: any) => pi.active)
                .map((pi: any) => {
                  const card = player.hand.find((c: any) => c.id === pi.cardId);
                  if (!card) return null;
                  return (
                    <div key={pi.cardId} style={{ marginBottom: 10 }}>
                      <div>Imposter card (current value: {card.value})</div>
                      <div style={{ display: "flex", gap: 10, marginTop: 5 }}>
                        {pi.rolls.map((roll: number) => (
                          <button
                            key={roll}
                            style={{
                              backgroundColor: "#4fc3f7",
                              color: "black",
                              border: "1px solid black",
                              padding: "5px 10px",
                              cursor: "pointer",
                              fontWeight: "bold",
                            }}
                            onClick={() =>
                              handleResolveMystery(pi.cardId, roll)
                            }
                          >
                            {roll}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
            </div>
          )}

        {room.phase === "reveal" && (
          <div style={{ marginTop: 20 }}>
            <h2>Round Results</h2>
            {room.players.map((p: any) => {
              const isWinner = room.winnerId === p.id;
              return (
                <div
                  key={p.id}
                  style={{
                    marginBottom: 10,
                    padding: 10,
                    border: "1px solid black",
                    backgroundColor: isWinner ? "#fff176" : "#f0f0f0",
                    color: "black",
                  }}
                >
                  <strong>
                    {isWinner ? "★ " : ""}
                    {p.name} (Chips: {p.chipsTotal})
                  </strong>
                  <div style={{ display: "flex", gap: 10, marginTop: 5 }}>
                    {p.hand.map((c: any) => (
                      <div
                        key={c.id}
                        style={{
                          border: "1px solid black",
                          padding: 10,
                          width: 70,
                          textAlign: "center",
                          backgroundColor:
                            c.color === "red"
                              ? "#ff4444"
                              : c.color === "yellow"
                              ? "#ffeb3b"
                              : "#cfd8dc",
                          color: "black",
                          fontWeight: "bold",
                        }}
                      >
                        {c.value}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
            <button
              onClick={handleNextRound}
              style={{
                marginTop: 20,
                backgroundColor: "#4fc3f7",
                color: "black",
                border: "1px solid black",
                padding: "5px 10px",
                cursor: "pointer",
                fontWeight: "bold",
              }}
            >
              Continue
            </button>
          </div>
        )}

        {room.phase === "waiting" && (
          <button
            onClick={() => socket.emit("startGame", { roomId }, console.log)}
            style={{ marginTop: 20 }}
          >
            Start Game
          </button>
        )}
		
		{room.phase === "gameOver" && (
		  <div className="flex flex-col items-center justify-center p-4">
			<h2>
			  Grand Winner: {room.players.find((p: any) => p.id === room.grandWinnerId)?.name}
			</h2>
			<button
			  onClick={() => {
				socket.emit("remakeRoom", { roomId: room.id }, (res: any) => {
				  if (res.ok) {
					socket.emit("startGame", { roomId: room.id }, () => {});
				  }
				});
			  }}
			  className="mt-4 px-4 py-2 bg-blue-600 text-white rounded"
			>
			  Play Again
			</button>
		  </div>
		)}



		{/*
        <button
          onClick={() => setDebug(!debug)}
          style={{ marginTop: 20, display: "block" }}
        >
          Toggle Debug
        </button>
		*/}
        {debug && <pre>{JSON.stringify(room, null, 2)}</pre>}
      </div>

		
      {/* Right panel */}
      <div
        style={{
          width: rightWidth,
          borderLeft: "1px solid gray",
          paddingLeft: 10,
          display: "flex",
          flexDirection: "column",
          overflowY: "auto",
        }}
      >
        <div style={{ marginBottom: 20 }}>
          {room.players
            .filter((p: any) => p.id !== socket.id)
            .map((p: any) => (
              <div
                key={p.id}
                style={{
                  padding: 5,
                  marginBottom: 5,
                  border: "1px solid black",
                  borderRadius: 4,
                  backgroundColor: "#f5f5f5",
                  color: "black",
                  fontWeight: "bold",
                  display: "inline-block", // shrink to fit content
                }}
              >
                <div>{p.name}</div>
                <div>Chips: {p.chipsTotal}</div>
                <div>Anted: {p.chipsAnted}</div>
              </div>
            ))}
        </div>

        <div style={{ flex: 1, overflowY: "auto" }}>
			<h3>Game Log</h3>
			<div style={{ fontSize: 12 }}>
				{(room.gameLog || []).map((entry: any, i: number) => (
					<div key={i}>
						[{new Date(entry.timestamp).toLocaleTimeString()}] {entry.message}
					</div>
				))}
			</div>
		</div>

      </div>
    </div>
  );
}
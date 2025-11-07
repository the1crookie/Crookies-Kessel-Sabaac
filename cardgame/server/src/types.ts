export type CardColor = "red" | "yellow";

export interface Card {
  id: string;
  color: CardColor;
  value: number;
}

export interface PendingImposter {
  cardId: string;      // the ID of the card drawn as an imposter
  rolls: [number, number]; // the two dice rolled
}

export interface Player {
  id: string;
  name: string;
  chipsTotal: number;
  chipsAnted: number;
  hand: Card[];
  pendingImposters?: PendingImposter[]; // cards awaiting dice value choice
}

export interface Room {
  id: string;
  players: Player[];
  deckRed: Card[];
  deckYellow: Card[];
  discardRed: Card[];
  discardYellow: Card[];
  currentTurnPlayerIndex: number;
  roundNumber: number;
  turnsThisRound: number;
  phase: "waiting" | "playing" | "imposterRoll" | "reveal";
}
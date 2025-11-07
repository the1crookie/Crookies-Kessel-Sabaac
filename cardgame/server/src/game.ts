import { Card, Color } from "./types";

let cardCounter = 0;

export function makeDeck(color: Color): Card[] {
  const cards: Card[] = [];
  for (let i = 1; i <= 6; i++) {
    for (let j = 0; j < 3; j++) {
      cards.push({ id: `c${cardCounter++}`, color, value: i.toString() });
    }
  }
  for (let j = 0; j < 3; j++) {
    cards.push({ id: `c${cardCounter++}`, color, value: "Imposter" });
  }
  cards.push({ id: `c${cardCounter++}`, color, value: "Sylops" });
  return shuffle(cards);
}

export function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function drawCard(deck: Card[]): Card | undefined {
  return deck.pop();
}
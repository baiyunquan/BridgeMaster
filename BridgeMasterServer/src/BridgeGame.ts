import { BiddingPhase } from "./BiddingPhase";
import { cloneState, POSITIONS, RANK_VALUE, RANKS, SUITS } from "./BridgeGameShared";
import { PlayPhase } from "./PlayPhase";
import { Bid, BridgeGameState, Card, PlayerPosition } from "./types";

export class BridgeGame {
  private state: BridgeGameState;

  private biddingPhase: BiddingPhase;

  private playPhase: PlayPhase;

  constructor(playersByPosition: Record<PlayerPosition, string>) {
    this.state = {
      phase: "waiting",
      dealer: "N",
      turn: null,
      playersByPosition,
      hands: { N: [], E: [], S: [], W: [] },
      bidHistory: [],
      contract: null,
      tricks: [],
      currentTrick: null,
      score: null,
    };

    this.biddingPhase = new BiddingPhase(this.state);
    this.playPhase = new PlayPhase(this.state);
  }

  public getState(): BridgeGameState {
    return cloneState(this.state);
  }

  public start(): BridgeGameState {
    if (this.state.phase !== "waiting") {
      throw new Error("Game already started.");
    }

    const deck = this.buildShuffledDeck();
    const hands: Record<PlayerPosition, Card[]> = { N: [], E: [], S: [], W: [] };

    for (let i = 0; i < deck.length; i += 1) {
      const position = POSITIONS[i % POSITIONS.length];
      hands[position].push(deck[i]);
    }

    for (const position of POSITIONS) {
      hands[position].sort((a, b) => {
        if (a.suit !== b.suit) {
          return SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit);
        }
        return RANK_VALUE[a.rank] - RANK_VALUE[b.rank];
      });
    }

    this.state.hands = hands;
    this.state.phase = "bidding";
    this.state.turn = this.state.dealer;
    this.state.bidHistory = [];
    this.state.contract = null;
    this.state.tricks = [];
    this.state.currentTrick = null;
    this.state.score = null;

    return this.getState();
  }

  public submitBid(playerId: string, bid: Bid): BridgeGameState {
    this.biddingPhase.submitBid(playerId, bid);
    return this.getState();
  }

  public submitCard(playerId: string, card: Card): BridgeGameState {
    this.playPhase.submitCard(playerId, card);
    return this.getState();
  }

  private buildShuffledDeck(): Card[] {
    const deck: Card[] = [];
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        deck.push({ suit, rank });
      }
    }

    for (let i = deck.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }

    return deck;
  }
}
